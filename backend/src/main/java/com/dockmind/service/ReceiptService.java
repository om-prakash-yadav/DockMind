package com.dockmind.service;

import com.dockmind.ai.Extraction;
import com.dockmind.api.ApiException;
import com.dockmind.domain.*;
import com.dockmind.matching.Discrepancy;
import com.dockmind.matching.Matcher;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Receipt lifecycle. This is where an untrusted Extraction is checked against real purchase orders and turned into
 * receipt lines; nothing from the model reaches the database without passing through applyExtraction.
 */
@Service
public class ReceiptService {
    private final ReceiptRepository receipts;
    private final PurchaseOrderRepository orders;
    private final double reviewThreshold;

    public ReceiptService(ReceiptRepository receipts, PurchaseOrderRepository orders,
                          @Value("${dockmind.review-threshold:0.80}") double reviewThreshold) {
        this.receipts = receipts;
        this.orders = orders;
        this.reviewThreshold = reviewThreshold;
    }

    // ---- extraction result ----

    /** Stores the reader's result. A null extraction (reader failed) or an unusable one ends in NEEDS_MANUAL. */
    @Transactional
    public void applyExtraction(Long id, Extraction e) {
        Receipt r = receipts.lockById(id).orElseThrow();
        if (r.status != ReceiptStatus.CAPTURED) return; // already handled, e.g. a duplicate run after a restart
        if (e == null) {
            manual(r, "The note could not be read automatically. Please enter it by hand.");
            return;
        }
        r.supplier = e.supplierName();
        r.deliveryNoteNo = e.deliveryNoteNo();
        r.freeText = e.freeText();
        r.overallConfidence = e.overallConfidence();
        r.poConfidence = e.poConfidence();
        r.poNumberRead = e.poNumber();
        r.aiNote = e.aiNote();

        // Without lines, or with a line whose quantity cannot be read, we would be guessing: send to the clerk.
        boolean unusable = e.lines().isEmpty() || e.lines().stream().anyMatch(l -> l.qty() == null);
        if (unusable) {
            manual(r, "The note could not be read reliably. Please enter it by hand.");
            return;
        }

        PurchaseOrder po = resolvePo(e);
        r.poNumber = po == null ? null : po.poNumber;
        r.lines.clear();
        for (Extraction.Line l : e.lines()) {
            ReceiptLine line = new ReceiptLine();
            line.description = l.description();
            line.receivedQty = l.qty();
            line.unit = Matcher.normalizeUnit(l.unit());
            line.confidence = l.confidence();
            // A poLineId from the model is only trusted if it really belongs to the PO we resolved.
            if (po != null && po.lines.stream().anyMatch(p -> p.id.equals(l.poLineId()))) line.poLineId = l.poLineId();
            r.lines.add(line);
        }
        linkByDescription(r.lines, po);
        reconcile(r, po);
        r.status = ReceiptStatus.EXTRACTED;
    }

    private void manual(Receipt r, String note) {
        r.status = ReceiptStatus.NEEDS_MANUAL;
        r.poNumber = null;
        r.lines.clear();
        r.needsReview = true;
        if (r.aiNote == null || r.aiNote.isBlank()) r.aiNote = note;
    }

    /** The PO the note names, if it exists, is open, and belongs to the supplier named on the note. */
    private PurchaseOrder resolvePo(Extraction e) {
        if (e.poNumber() == null) return null;
        PurchaseOrder po = orders.findByPoNumberAndStatus(e.poNumber().trim().toUpperCase(), "OPEN").orElse(null);
        if (po == null) return null;
        // PO-4503 and PO-4513 differ by one smudged digit; the supplier tells us when the reader guessed wrong.
        return Matcher.suppliersAgree(e.supplierName(), po.supplier) ? po : null;
    }

    // ---- clerk actions ----

    /** The clerk's number wins; the discrepancy is recomputed here, never trusted from the client. */
    @Transactional
    public Receipt correctLine(Long receiptId, Long lineId, BigDecimal receivedQty, String unit) {
        Receipt r = open(receiptId);
        ReceiptLine line = r.lines.stream().filter(l -> l.id.equals(lineId)).findFirst()
                .orElseThrow(() -> ApiException.notFound("Line"));
        if (receivedQty == null || receivedQty.signum() < 0) throw ApiException.badRequest("receivedQty must be 0 or more");
        line.receivedQty = receivedQty;
        if (unit != null && !unit.isBlank()) line.unit = Matcher.normalizeUnit(unit);
        line.correctedByClerk = true;
        line.missingFromNote = false; // the clerk says it did arrive
        reconcile(r, poOf(r));
        return r;
    }

    /** Assigns a PO to a receipt the reader could not resolve (or could not read at all). */
    @Transactional
    public Receipt assignPo(Long receiptId, String poNumber) {
        Receipt r = open(receiptId);
        if (r.poNumber != null) throw ApiException.conflict("PO_ALREADY_SET", "This receipt already has a PO");
        PurchaseOrder po = poNumber == null ? null
                : orders.findByPoNumberAndStatus(poNumber.trim().toUpperCase(), "OPEN").orElse(null);
        if (po == null) throw ApiException.badRequest("No open purchase order " + poNumber);
        r.poNumber = po.poNumber;
        r.poConfidence = 1.0; // the clerk has looked, so the weak reading no longer counts against it
        r.lines.forEach(l -> l.poLineId = null);
        linkByDescription(r.lines, po);
        reconcile(r, po);
        if (r.status == ReceiptStatus.NEEDS_MANUAL) r.status = ReceiptStatus.EXTRACTED;
        return r;
    }

    // noRollbackFor: when the outstanding quantities moved under the clerk, the refreshed numbers must be saved even
    // though we answer 409, so the next read shows them.
    @Transactional(noRollbackFor = ApiException.class)
    public Receipt confirm(Long id, boolean acknowledged) {
        Receipt r = receipts.lockById(id).orElseThrow(() -> ApiException.notFound("Receipt"));
        if (r.status == ReceiptStatus.CONFIRMED) return r; // safe to repeat: totals are summed from the database
        if (r.status == ReceiptStatus.DISPUTED) throw ApiException.conflict("ALREADY_DISPUTED", "Receipt was already disputed");
        if (r.status == ReceiptStatus.CAPTURED) throw ApiException.conflict("NOT_READY", "Receipt is still being read");
        if (r.poNumber == null) throw ApiException.conflict("PO_REQUIRED", "Assign a purchase order before confirming");
        PurchaseOrder po = poOf(r);

        // Another receipt for this PO may have been confirmed since the clerk last looked, which changes what is
        // outstanding. Recompute now; if anything moved, make the clerk look again instead of confirming stale numbers.
        Map<String, BigDecimal> before = outstandingByPoLine(r);
        reconcile(r, po);
        if (!before.equals(outstandingByPoLine(r))) {
            throw ApiException.conflict("OUTSTANDING_CHANGED",
                    "Another delivery for this order was confirmed meanwhile. The remaining quantities have been updated; please check them.");
        }
        if (r.needsReview && !acknowledged) {
            throw ApiException.conflict("NEEDS_REVIEW", "Low confidence or unresolved items: review before confirming");
        }
        r.status = ReceiptStatus.CONFIRMED;
        closeIfFullyReceived(po);
        return r;
    }

    /** What each linked line was compared against, normalised so 8 and 8.000 are equal. */
    private static Map<String, BigDecimal> outstandingByPoLine(Receipt r) {
        Map<String, BigDecimal> m = new HashMap<>();
        for (ReceiptLine l : r.lines) {
            if (l.poLineId != null && l.outstandingQty != null) m.put(l.poLineId, l.outstandingQty.stripTrailingZeros());
        }
        return m;
    }

    /**
     * Marks the PO RECEIVED, which drops it off the open list, once confirmed deliveries cover every line in full.
     * Disputed receipts never count. Over-delivery counts as received.
     */
    private void closeIfFullyReceived(PurchaseOrder po) {
        Map<String, BigDecimal> got = confirmedTotals(po, -1L);
        boolean complete = po.lines.stream().allMatch(p -> Matcher.outstanding(p.orderedQty, got.get(p.id)).signum() == 0);
        if (complete) {
            po.status = "RECEIVED";
            orders.save(po);
        }
    }

    /**
     * Quantity already received per PO line, summed over CONFIRMED receipts only (optionally leaving one out).
     * Lines in a different unit than the order line are not comparable and are not counted.
     */
    @Transactional(readOnly = true)
    public Map<String, BigDecimal> confirmedTotals(PurchaseOrder po, Long excludeReceiptId) {
        Map<String, String> unitOf = new HashMap<>();
        po.lines.forEach(p -> unitOf.put(p.id, Matcher.normalizeUnit(p.unit)));
        Map<String, BigDecimal> totals = new HashMap<>();
        for (Object[] row : receipts.confirmedLines(po.poNumber, excludeReceiptId == null ? -1L : excludeReceiptId)) {
            String poLineId = (String) row[0];
            BigDecimal qty = (BigDecimal) row[1];
            if (qty == null || !unitOf.containsKey(poLineId)) continue;
            if (!Objects.equals(Matcher.normalizeUnit((String) row[2]), unitOf.get(poLineId))) continue;
            totals.merge(poLineId, qty, BigDecimal::add);
        }
        return totals;
    }

    @Transactional
    public Receipt dispute(Long id, String reason) {
        Receipt r = receipts.lockById(id).orElseThrow(() -> ApiException.notFound("Receipt"));
        if (r.status == ReceiptStatus.DISPUTED) return r; // safe to repeat
        if (r.status == ReceiptStatus.CONFIRMED) throw ApiException.conflict("ALREADY_CONFIRMED", "Receipt was already confirmed");
        if (r.status == ReceiptStatus.CAPTURED) throw ApiException.conflict("NOT_READY", "Receipt is still being read");
        if (reason == null || reason.isBlank()) throw ApiException.badRequest("A dispute needs a reason");
        r.status = ReceiptStatus.DISPUTED;
        r.disputeReason = reason.trim();
        return r;
    }

    // ---- internals ----

    private Receipt open(Long id) {
        Receipt r = receipts.lockById(id).orElseThrow(() -> ApiException.notFound("Receipt"));
        if (r.isDecided()) throw ApiException.conflict("ALREADY_DECIDED", "Receipt is already " + r.status);
        if (r.status == ReceiptStatus.CAPTURED) throw ApiException.conflict("NOT_READY", "Receipt is still being read");
        return r;
    }

    private PurchaseOrder poOf(Receipt r) {
        return r.poNumber == null ? null : orders.findByPoNumber(r.poNumber).orElse(null);
    }

    /**
     * Links lines with no PO line yet by description: exact first, then a one-sided word match accepted only when
     * exactly one order line fits. Each order line is used once.
     */
    private static void linkByDescription(List<ReceiptLine> lines, PurchaseOrder po) {
        if (po == null) return;
        Set<String> taken = new HashSet<>();
        lines.stream().map(l -> l.poLineId).filter(x -> x != null).forEach(taken::add);
        for (ReceiptLine line : lines) {
            if (line.poLineId != null) continue;
            String d = Matcher.normalizeText(line.description);
            po.lines.stream().filter(p -> !taken.contains(p.id) && !d.isEmpty() && d.equals(Matcher.normalizeText(p.description)))
                    .findFirst().ifPresent(p -> { line.poLineId = p.id; taken.add(p.id); });
        }
        for (ReceiptLine line : lines) {
            if (line.poLineId != null) continue;
            List<PoLine> fits = po.lines.stream()
                    .filter(p -> !taken.contains(p.id) && Matcher.descriptionsOverlap(line.description, p.description)).toList();
            if (fits.size() == 1) { line.poLineId = fits.get(0).id; taken.add(fits.get(0).id); }
        }
    }

    /**
     * Recomputes every line's discrepancy against the PO, adds a NOT_DELIVERED line for each PO line the note lacks
     * (and drops earlier ones of those, so this is safe to run again), then refreshes the review flags.
     */
    private void reconcile(Receipt r, PurchaseOrder po) {
        // What earlier confirmed deliveries already brought in. Read from the database every time, never stored
        // as a running counter, so confirming twice or retrying can never double-count.
        Map<String, BigDecimal> already = po == null ? Map.of() : confirmedTotals(po, r.id);
        r.lines.removeIf(l -> l.missingFromNote);
        Set<String> present = new HashSet<>();
        for (ReceiptLine line : r.lines) {
            PoLine linked = po == null || line.poLineId == null ? null
                    : po.lines.stream().filter(p -> p.id.equals(line.poLineId)).findFirst().orElse(null);
            if (linked == null) line.poLineId = null; else present.add(linked.id);
            apply(line, linked, linked == null ? null : already.get(linked.id));
        }
        if (po != null) {
            for (PoLine p : po.lines) {
                if (present.contains(p.id)) continue;
                BigDecimal got = already.get(p.id);
                // A line that earlier deliveries already completed is not "missing" from this one.
                if (Matcher.outstanding(p.orderedQty, got).signum() == 0) continue;
                ReceiptLine missing = new ReceiptLine();
                missing.poLineId = p.id;
                missing.description = p.description;
                missing.receivedQty = BigDecimal.ZERO;
                missing.unit = p.unit;
                missing.missingFromNote = true;
                apply(missing, p, got);
                r.lines.add(missing);
            }
        }
        r.needsReview = r.poNumber == null
                || (r.poConfidence != null && r.poConfidence < reviewThreshold)
                || r.lines.stream().anyMatch(l -> l.needsReview);
    }

    /** Compares one line to what is still outstanding on its order line (ordered minus earlier confirmed receipts). */
    private void apply(ReceiptLine line, PoLine linked, BigDecimal alreadyReceived) {
        BigDecimal outstanding = linked == null ? null : Matcher.outstanding(linked.orderedQty, alreadyReceived);
        Matcher.Result res = Matcher.classify(line.receivedQty, line.unit, outstanding, linked == null ? null : linked.unit);
        line.discrepancy = res.discrepancy();
        line.orderedQty = linked == null ? null : linked.orderedQty;
        line.previouslyReceivedQty = linked == null ? null : (alreadyReceived == null ? BigDecimal.ZERO : alreadyReceived);
        line.outstandingQty = res.orderedQty();
        line.delta = res.delta();
        line.needsReview = !line.correctedByClerk && line.confidence != null && line.confidence < reviewThreshold;
    }
}
