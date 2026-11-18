package com.dockmind.domain;

import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "purchase_orders")
public class PurchaseOrder {
    @Id
    public String id;
    @Column(name = "po_number", nullable = false, unique = true)
    public String poNumber;
    public String supplier;
    public String status;
    @OneToMany(mappedBy = "po", fetch = FetchType.EAGER)
    @OrderBy("id")
    public List<PoLine> lines = new ArrayList<>();
}
