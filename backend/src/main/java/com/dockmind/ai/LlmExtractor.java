package com.dockmind.ai;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Reads the note with a vision model. The model only reads: it is not shown the purchase orders and does no
 * arithmetic. Code looks the PO up from the number it read and decides every discrepancy. Its answer goes through
 * ExtractionParser, then ReceiptService's checks, like any untrusted input.
 */
@Component
@ConditionalOnProperty(name = "dockmind.extractor", havingValue = "llm")
public class LlmExtractor implements Extractor {
    static final String PROMPT = """
            You are reading a photo of a delivery note handed over by a supplier's driver at a cold-store dock.
            The note may be printed or handwritten, rotated, crumpled or noisy. Read it the way a careful clerk would.

            Return ONLY one JSON object, no markdown, with exactly these fields:
            {
              "supplierName": string or null,
              "deliveryNoteNo": string or null,
              "poNumber": string or null,       // the purchase order number written on the note, e.g. "PO-4502"
              "poConfidence": number 0 to 1,    // how sure you are of every character of the PO number
              "lines": [
                { "description": string,        // the item as written on the note
                  "qty": number,                // quantity delivered, a plain number
                  "unit": string or null,       // KG, CASE, EA, TRAY ... as written
                  "confidence": number 0 to 1 }
              ],
              "freeText": string or null,       // any other writing on the note (e.g. "left at bay 3")
              "overallConfidence": number 0 to 1,
              "aiNote": string                  // one or two plain sentences for the clerk about how legible the note is
            }

            Rules:
            - Copy what is written. Do not guess. If a digit of the PO number is smudged or missing, set poNumber to null
              or lower poConfidence sharply; never fill it in from memory.
            - Ignore lines that are crossed out.
            - If a quantity is unreadable, set that line's qty to null rather than guessing.
            - Do not compare with any order and do not calculate shortages. Only report what the note says.
            - If this is not a delivery note, return an empty "lines" array and say so in aiNote.
            """;

    private final LlmGateway gateway;

    public LlmExtractor(LlmGateway gateway) {
        this.gateway = gateway;
    }

    @Override
    public Extraction extract(byte[] image, String mimeType, String filename) throws Exception {
        String mime = mimeType == null || mimeType.isBlank() || mimeType.equals("application/octet-stream") ? "image/jpeg" : mimeType;
        return ExtractionParser.parse(gateway.callVision(PROMPT, image, mime));
    }
}
