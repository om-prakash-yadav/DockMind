package com.dockmind.ai;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class ExtractionParserTest {
    @Test
    void stripsMarkdownFencesAndProse() {
        var e = ExtractionParser.parse("Sure! ```json\n{\"poNumber\":\"PO-4502\",\"lines\":[]}\n``` hope that helps");
        assertEquals("PO-4502", e.poNumber());
    }

    @Test
    void coercesStringQuantitiesAndDropsNegatives() {
        var e = ExtractionParser.parse("{\"lines\":[{\"qty\":\"72 kg\"},{\"qty\":\"1,5\"},{\"qty\":-3},{\"qty\":\"lots\"},{\"qty\":12}]}");
        assertEquals(0, new BigDecimal("72").compareTo(e.lines().get(0).qty()));
        assertEquals(0, new BigDecimal("1.5").compareTo(e.lines().get(1).qty()));
        assertNull(e.lines().get(2).qty());
        assertNull(e.lines().get(3).qty());
        assertEquals(0, new BigDecimal("12").compareTo(e.lines().get(4).qty()));
    }

    @Test
    void missingOrBadConfidenceCountsAsZero() {
        var e = ExtractionParser.parse("{\"lines\":[{\"qty\":1},{\"qty\":1,\"confidence\":\"high\"},{\"qty\":1,\"confidence\":7}]}");
        assertEquals(0.0, e.lines().get(0).confidence());
        assertEquals(0.0, e.lines().get(1).confidence());
        assertEquals(1.0, e.lines().get(2).confidence());
    }

    @Test
    void nullStringsBecomeNull() {
        var e = ExtractionParser.parse("{\"poNumber\":\"null\",\"supplierName\":\"  \",\"lines\":[]}");
        assertNull(e.poNumber());
        assertNull(e.supplierName());
    }

    @Test
    void garbageThrows() {
        assertThrows(IllegalArgumentException.class, () -> ExtractionParser.parse("I cannot read this image"));
        assertThrows(IllegalArgumentException.class, () -> ExtractionParser.parse("{\"lines\": oops}"));
        assertThrows(IllegalArgumentException.class, () -> ExtractionParser.parse("{\"poNumber\":\"PO-1\"}"));
        assertThrows(IllegalArgumentException.class, () -> ExtractionParser.parse(null));
    }
}
