package com.dockmind.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "po_lines")
public class PoLine {
    @Id
    public String id;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "po_id")
    public PurchaseOrder po;
    public String sku;
    public String description;
    @Column(name = "ordered_qty", precision = 12, scale = 3)
    public BigDecimal orderedQty;
    public String unit;
}
