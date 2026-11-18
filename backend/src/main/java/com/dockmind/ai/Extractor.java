package com.dockmind.ai;

/** Reads a photo of a delivery note. Implementations are swapped with the dockmind.extractor property. */
public interface Extractor {
    /** Throws on any failure; the caller turns that into NEEDS_MANUAL. */
    Extraction extract(byte[] image, String mimeType, String filename) throws Exception;
}
