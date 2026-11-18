package com.dockmind.service;

import com.dockmind.ai.Extraction;
import com.dockmind.ai.Extractor;
import com.dockmind.domain.ReceiptImage;
import com.dockmind.domain.ReceiptImageRepository;
import com.dockmind.domain.ReceiptRepository;
import com.dockmind.domain.ReceiptStatus;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

/**
 * Reads photos in the background, one at a time, so a slow model never holds an HTTP request open.
 * Any failure ends in NEEDS_MANUAL, never an error to the phone.
 */
@Service
public class ExtractionRunner {
    private static final Logger log = LoggerFactory.getLogger(ExtractionRunner.class);

    private final Extractor extractor;
    private final ReceiptImageRepository images;
    private final ReceiptRepository receipts;
    private final ReceiptService service;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();

    public ExtractionRunner(Extractor extractor, ReceiptImageRepository images, ReceiptRepository receipts,
                            ReceiptService service) {
        this.extractor = extractor;
        this.images = images;
        this.receipts = receipts;
        this.service = service;
    }

    public void submit(Long receiptId) {
        pool.submit(() -> run(receiptId));
    }

    void run(Long receiptId) {
        Extraction result = null;
        try {
            ReceiptImage img = images.findById(receiptId).orElseThrow();
            result = extractor.extract(img.data, img.mimeType, img.filename);
        } catch (Exception e) {
            log.warn("Extraction failed for receipt {}: {}", receiptId, e.toString());
        }
        try {
            service.applyExtraction(receiptId, result);
        } catch (Exception e) {
            log.error("Could not store extraction for receipt {}", receiptId, e);
            try { service.applyExtraction(receiptId, null); } catch (Exception ignored) { }
        }
    }

    /** A receipt left in CAPTURED by a crash or restart is read again. */
    @EventListener(ApplicationReadyEvent.class)
    public void recover() {
        receipts.findByStatus(ReceiptStatus.CAPTURED).forEach(r -> submit(r.id));
    }

    @PreDestroy
    void stop() {
        pool.shutdown();
    }
}
