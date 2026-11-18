package com.dockmind.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "receipts")
public class Receipt {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "idempotency_key", nullable = false, unique = true)
    public String idempotencyKey;
    @Enumerated(EnumType.STRING)
    public ReceiptStatus status = ReceiptStatus.CAPTURED;
    /** PO the receipt is matched against. Null when unresolved. */
    public String poNumber;
    /** What the reader saw on the note, kept so the clerk can see why the PO was not accepted. */
    public String poNumberRead;
    public String supplier;
    public String deliveryNoteNo;
    public Double overallConfidence;
    public Double poConfidence;
    @Column(length = 1000)
    public String aiNote;
    @Column(length = 1000)
    public String freeText;
    public boolean needsReview;
    @Column(length = 1000)
    public String disputeReason;
    public Instant createdAt = Instant.now();
    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @JoinColumn(name = "receipt_id")
    @OrderBy("id")
    public List<ReceiptLine> lines = new ArrayList<>();

    public boolean isDecided() {
        return status == ReceiptStatus.CONFIRMED || status == ReceiptStatus.DISPUTED;
    }
}
