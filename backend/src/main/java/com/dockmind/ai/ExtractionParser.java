package com.dockmind.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns raw model text into an Extraction. The model's answer is untrusted: it may be wrapped in markdown fences or
 * prose, have strings where numbers belong, or miss fields. Anything unusable throws IllegalArgumentException, which
 * the caller turns into NEEDS_MANUAL.
 */
public final class ExtractionParser {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern NUMBER = Pattern.compile("-?\\d+(?:\\.\\d+)?");

    private ExtractionParser() {}

    public static Extraction parse(String raw) {
        if (raw == null) throw new IllegalArgumentException("empty answer");
        int start = raw.indexOf('{'), end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) throw new IllegalArgumentException("no JSON object in answer");
        JsonNode root;
        try {
            root = JSON.readTree(raw.substring(start, end + 1)); // drops ``` fences and any prose around the object
        } catch (Exception e) {
            throw new IllegalArgumentException("answer is not valid JSON", e);
        }
        if (!root.isObject() || !root.path("lines").isArray()) {
            throw new IllegalArgumentException("answer has no lines array");
        }
        List<Extraction.Line> lines = new ArrayList<>();
        for (JsonNode l : root.get("lines")) {
            if (!l.isObject()) continue;
            lines.add(new Extraction.Line(
                    text(l, "description"), text(l, "poLineId"), quantity(l.get("qty")),
                    text(l, "unit"), confidence(l.get("confidence"))));
        }
        return new Extraction(
                text(root, "supplierName"), text(root, "deliveryNoteNo"), text(root, "poNumber"),
                confidence(root.get("poConfidence")), lines, text(root, "freeText"),
                confidence(root.get("overallConfidence")), text(root, "aiNote"));
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        if (v == null || v.isNull()) return null;
        String s = v.asText().trim();
        return s.isEmpty() || s.equalsIgnoreCase("null") ? null : s;
    }

    /** Accepts 72, "72", "72 kg", "1,5". Returns null for anything else, including negatives. */
    static BigDecimal quantity(JsonNode v) {
        if (v == null || v.isNull()) return null;
        BigDecimal result = null;
        if (v.isNumber()) {
            result = v.decimalValue();
        } else if (v.isTextual()) {
            Matcher m = NUMBER.matcher(v.asText().replace(',', '.'));
            if (m.find()) result = new BigDecimal(m.group());
        }
        return result == null || result.signum() < 0 ? null : result;
    }

    /** A missing or unreadable confidence counts as zero, so it is flagged for review rather than trusted. */
    static double confidence(JsonNode v) {
        if (v == null || v.isNull()) return 0.0;
        double d = v.isNumber() ? v.asDouble() : 0.0;
        if (v.isTextual()) {
            try { d = Double.parseDouble(v.asText().trim()); } catch (NumberFormatException e) { d = 0.0; }
        }
        return Double.isNaN(d) ? 0.0 : Math.max(0.0, Math.min(1.0, d));
    }
}
