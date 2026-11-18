package com.dockmind.ai;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Returns canned extractions from fixtures/note-N.extracted.json instead of calling a model. N comes from the
 * uploaded file name (note-3-messy.png -> 3); any other name cycles through the fixtures so a demo still moves.
 * The JSON goes through the same parser as a real model answer.
 */
@Component
@ConditionalOnProperty(name = "dockmind.extractor", havingValue = "fixture", matchIfMissing = true)
public class FixtureExtractor implements Extractor {
    private static final Pattern NAME = Pattern.compile("note-(\\d)");
    private static final int FIXTURES = 9;
    private final AtomicInteger next = new AtomicInteger();

    @Override
    public Extraction extract(byte[] image, String mimeType, String filename) throws Exception {
        String name;
        String base = filename == null ? "" : filename.replaceAll("\\.[^.]*$", "");
        if (!base.isEmpty() && new ClassPathResource("fixtures/" + base + ".extracted.json").exists()) {
            name = base; // a fixture named exactly after the file, e.g. for tests
        } else if (filename != null && filename.toLowerCase().contains("followup")) {
            name = "note-followup"; // the second trip for PO-4502
        } else {
            Matcher m = filename == null ? null : NAME.matcher(filename);
            int n = m != null && m.find() ? Integer.parseInt(m.group(1)) : next.getAndIncrement() % FIXTURES + 1;
            name = "note-" + n;
        }
        try (InputStream in = new ClassPathResource("fixtures/" + name + ".extracted.json").getInputStream()) {
            return ExtractionParser.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }
}
