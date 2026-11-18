package com.dockmind.api;

import com.dockmind.domain.PurchaseOrder;
import com.dockmind.domain.Receipt;
import com.dockmind.domain.ReceiptLine;
import com.dockmind.matching.Discrepancy;
import com.dockmind.matching.Matcher;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** JSON shapes of the API, kept apart from the entities so the contract can change without touching the database. */
public final class Views {
    private Views() {}

    /** receivedQty is what confirmed deliveries have brought in so far; remainingQty is what is still to arrive. */
    public record PoLineView(String id, String description, BigDecimal orderedQty, BigDecimal receivedQty,
                             BigDecimal remainingQty, String unit) {}

    public record PurchaseOrderView(String id, String poNumber, String supplier, String status, List<PoLineView> lines) {}

    /**
     * orderedQty is the original order; previouslyReceivedQty came in on earlier confirmed deliveries; remainingQty
     * (ordered minus previously received) is what this delivery is compared against, and delta is relative to it.
     */
    public record LineView(String id, String poLineId, String description, BigDecimal orderedQty,
                           BigDecimal previouslyReceivedQty, BigDecimal remainingQty, BigDecimal receivedQty,
                           String unit, Double confidence, Discrepancy discrepancy, BigDecimal delta,
                           boolean needsReview, boolean corrected, boolean missingFromNote) {}

    public record ReceiptView(String id, String status, String poNumber, String poNumberRead, String supplier,
                              String deliveryNoteNo, Double overallConfidence, Double poConfidence, String aiNote,
                              String freeText, boolean needsReview, String disputeReason, Instant createdAt,
                              List<LineView> lines) {}

    public static String receiptId(Long id) {
        return "RCP-" + id;
    }

    public static Long parseReceiptId(String id) {
        try {
            return Long.parseLong(id.startsWith("RCP-") ? id.substring(4) : id);
        } catch (NumberFormatException e) {
            throw ApiException.notFound("Receipt");
        }
    }

    private static BigDecimal plain(BigDecimal v) {
        return v == null ? null : v.signum() == 0 ? BigDecimal.ZERO : v.stripTrailingZeros();
    }

    public static PurchaseOrderView of(PurchaseOrder po, Map<String, BigDecimal> received) {
        return new PurchaseOrderView(po.id, po.poNumber, po.supplier, po.status, po.lines.stream().map(l -> {
            BigDecimal got = received.getOrDefault(l.id, BigDecimal.ZERO);
            return new PoLineView(l.id, l.description, plain(l.orderedQty), plain(got),
                    plain(Matcher.outstanding(l.orderedQty, got)), l.unit);
        }).toList());
    }

    public static ReceiptView of(Receipt r) {
        return new ReceiptView(receiptId(r.id), r.status.name(), r.poNumber, r.poNumberRead, r.supplier,
                r.deliveryNoteNo, r.overallConfidence, r.poConfidence, r.aiNote, r.freeText, r.needsReview,
                r.disputeReason, r.createdAt, r.lines.stream().map(Views::of).toList());
    }

    private static LineView of(ReceiptLine l) {
        // Receipts stored before multi-trip deliveries have no outstanding figure; for them remaining = ordered.
        BigDecimal remaining = l.outstandingQty != null ? l.outstandingQty : l.orderedQty;
        return new LineView("RL-" + l.id, l.poLineId, l.description, plain(l.orderedQty), plain(l.previouslyReceivedQty),
                plain(remaining), plain(l.receivedQty), l.unit, l.confidence, l.discrepancy, plain(l.delta),
                l.needsReview, l.correctedByClerk, l.missingFromNote);
    }
}
