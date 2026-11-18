package com.dockmind.service;

import com.dockmind.domain.Receipt;
import com.dockmind.domain.ReceiptImage;
import com.dockmind.domain.ReceiptImageRepository;
import com.dockmind.domain.ReceiptRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Creates a receipt from a photo, exactly once per Idempotency-Key. The unique constraint on the key is the
 * guarantee: a retry, or two simultaneous requests, both end up with the same receipt.
 */
@Service
public class CaptureService {
    /** The receipt, and whether this call created it (false means the key was seen before). */
    public record Captured(Receipt receipt, boolean created) {}

    private final ReceiptRepository receipts;
    private final ReceiptImageRepository images;
    private final ExtractionRunner runner;
    private final TransactionTemplate tx;

    public CaptureService(ReceiptRepository receipts, ReceiptImageRepository images, ExtractionRunner runner,
                          TransactionTemplate tx) {
        this.receipts = receipts;
        this.images = images;
        this.runner = runner;
        this.tx = tx;
    }

    public Captured capture(String key, byte[] image, String mimeType, String filename) {
        var existing = receipts.findByIdempotencyKey(key);
        if (existing.isPresent()) return new Captured(existing.get(), false);
        Receipt created;
        try {
            // Receipt and photo commit together, so a retry can never find one without the other.
            created = tx.execute(status -> {
                Receipt r = new Receipt();
                r.idempotencyKey = key;
                receipts.saveAndFlush(r);
                ReceiptImage img = new ReceiptImage();
                img.receiptId = r.id;
                img.data = image;
                img.mimeType = mimeType;
                img.filename = filename;
                images.save(img);
                return r;
            });
        } catch (DataIntegrityViolationException raced) {
            // Another request with the same key won the race.
            return new Captured(receipts.findByIdempotencyKey(key).orElseThrow(), false);
        }
        runner.submit(created.id); // only after commit, so the runner can see the photo
        return new Captured(created, true);
    }
}
