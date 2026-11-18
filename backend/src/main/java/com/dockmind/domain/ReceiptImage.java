package com.dockmind.domain;

import jakarta.persistence.*;

/** The photo, in its own table so listing receipts never loads image bytes. Committed with the receipt. */
@Entity
@Table(name = "receipt_images")
public class ReceiptImage {
    @Id
    public Long receiptId;
    @Lob
    @Column(length = 20_000_000)
    public byte[] data;
    public String mimeType;
    public String filename;
}
