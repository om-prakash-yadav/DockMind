package com.dockmind.ai;

import java.math.BigDecimal;
import java.util.List;

/** What the reader says it saw on the note. Untrusted until ReceiptService has checked it against the PO. */
public record Extraction(
        String supplierName,
        String deliveryNoteNo,
        String poNumber,
        double poConfidence,
        List<Line> lines,
        String freeText,
        double overallConfidence,
        String aiNote) {

    /** qty is null when the reader gave something that is not a usable number. */
    public record Line(String description, String poLineId, BigDecimal qty, String unit, double confidence) {}
}
