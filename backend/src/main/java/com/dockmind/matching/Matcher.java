package com.dockmind.matching;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * All discrepancy logic. Pure functions, no Spring, no database. The model reads the note; this decides what is wrong.
 */
public final class Matcher {
    private Matcher() {}

    /** Result of comparing one received line to the ordered line it was linked to. */
    public record Result(Discrepancy discrepancy, BigDecimal orderedQty, BigDecimal delta) {}

    private static final Map<String, String> UNIT_ALIASES = Map.ofEntries(
            Map.entry("KGS", "KG"), Map.entry("KILO", "KG"), Map.entry("KILOS", "KG"),
            Map.entry("KILOGRAM", "KG"), Map.entry("KILOGRAMS", "KG"),
            Map.entry("CASES", "CASE"), Map.entry("CS", "CASE"),
            Map.entry("EACH", "EA"), Map.entry("PCS", "EA"), Map.entry("PC", "EA"),
            Map.entry("PIECE", "EA"), Map.entry("PIECES", "EA"),
            Map.entry("TRAYS", "TRAY"));

    public static String normalizeUnit(String unit) {
        if (unit == null) return null;
        String cleaned = unit.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        if (cleaned.isEmpty()) return null;
        return UNIT_ALIASES.getOrDefault(cleaned, cleaned);
    }

    /**
     * Rules, in order: no linked order line is UNKNOWN_ITEM; a different unit is UNIT_MISMATCH (quantities are not
     * comparable across units); nothing received is NOT_DELIVERED; otherwise SHORT, OVER or MATCH.
     */
    public static Result classify(BigDecimal received, String unit, BigDecimal ordered, String orderedUnit) {
        if (ordered == null) {
            return new Result(Discrepancy.UNKNOWN_ITEM, null, null);
        }
        String u = normalizeUnit(unit);
        if (u == null || !u.equals(normalizeUnit(orderedUnit))) {
            return new Result(Discrepancy.UNIT_MISMATCH, ordered, null);
        }
        BigDecimal delta = received.subtract(ordered);
        if (received.signum() == 0) return new Result(Discrepancy.NOT_DELIVERED, ordered, delta);
        int c = received.compareTo(ordered);
        return new Result(c < 0 ? Discrepancy.SHORT : c > 0 ? Discrepancy.OVER : Discrepancy.MATCH, ordered, delta);
    }

    public static String normalizeText(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    }

    /** Words of a description, for the "Cheddar" vs "Cheddar, mature" comparison. */
    public static Set<String> words(String s) {
        String n = normalizeText(s);
        return n.isEmpty() ? Set.of() : new LinkedHashSet<>(Arrays.asList(n.split(" ")));
    }

    /** True when one description's words are all contained in the other's. */
    public static boolean descriptionsOverlap(String a, String b) {
        Set<String> wa = words(a), wb = words(b);
        return !wa.isEmpty() && !wb.isEmpty() && (wa.containsAll(wb) || wb.containsAll(wa));
    }

    /** Supplier names agree if one contains the other once punctuation is gone. */
    public static boolean suppliersAgree(String a, String b) {
        String na = normalizeText(a).replace(" ", ""), nb = normalizeText(b).replace(" ", "");
        if (na.isEmpty() || nb.isEmpty()) return true; // nothing to compare
        return na.contains(nb) || nb.contains(na);
    }
}
