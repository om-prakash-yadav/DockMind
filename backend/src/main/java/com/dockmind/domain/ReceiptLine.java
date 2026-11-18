package com.dockmind.domain;

import com.dockmind.matching.Discrepancy;
import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "receipt_lines")
public class ReceiptLine {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    public String poLineId;
    public String description;
    /** The quantity on the purchase order line, as originally ordered. */
    @Column(precision = 12, scale = 3)
    public BigDecimal orderedQty;
    /** Confirmed on earlier receipts for this PO line when this receipt was last reconciled. */
    @Column(precision = 12, scale = 3)
    public BigDecimal previouslyReceivedQty;
    /** Ordered minus previously received: what this line was compared against. */
    @Column(precision = 12, scale = 3)
    public BigDecimal outstandingQty;
    @Column(precision = 12, scale = 3)
    public BigDecimal receivedQty;
    public String unit;
    public Double confidence;
    @Enumerated(EnumType.STRING)
    public Discrepancy discrepancy;
    @Column(precision = 12, scale = 3)
    public BigDecimal delta;
    public boolean correctedByClerk;
    public boolean needsReview;
    /** True when added because the PO has this line and the note does not (NOT_DELIVERED). */
    public boolean missingFromNote;
}
