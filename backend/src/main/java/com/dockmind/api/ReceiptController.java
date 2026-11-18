package com.dockmind.api;

import com.dockmind.domain.Receipt;
import com.dockmind.domain.ReceiptImageRepository;
import com.dockmind.domain.ReceiptRepository;
import com.dockmind.domain.ReceiptStatus;
import com.dockmind.service.CaptureService;
import com.dockmind.service.ReceiptService;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/receipts")
public class ReceiptController {
    public record LineCorrection(BigDecimal receivedQty, String unit) {}
    public record AssignPo(String poNumber) {}
    public record Confirm(Boolean acknowledged) {}
    public record Dispute(String reason) {}

    private final ReceiptRepository receipts;
    private final ReceiptImageRepository images;
    private final CaptureService capture;
    private final ReceiptService service;

    public ReceiptController(ReceiptRepository receipts, ReceiptImageRepository images, CaptureService capture,
                             ReceiptService service) {
        this.receipts = receipts;
        this.images = images;
        this.capture = capture;
        this.service = service;
    }

    @GetMapping
    public List<Views.ReceiptView> list(@RequestParam(required = false) String status) {
        List<Receipt> found;
        if (status == null || status.isBlank()) {
            found = receipts.findAllByOrderByIdDesc();
        } else {
            try {
                found = receipts.findByStatusOrderByIdDesc(ReceiptStatus.valueOf(status.toUpperCase()));
            } catch (IllegalArgumentException e) {
                throw ApiException.badRequest("Unknown status " + status);
            }
        }
        return found.stream().map(Views::of).toList();
    }

    @GetMapping("/{id}")
    public Views.ReceiptView get(@PathVariable String id) {
        return Views.of(find(id));
    }

    @GetMapping("/{id}/image")
    public ResponseEntity<byte[]> image(@PathVariable String id) {
        var img = images.findById(Views.parseReceiptId(id)).orElseThrow(() -> ApiException.notFound("Image"));
        MediaType type = img.mimeType == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(img.mimeType);
        return ResponseEntity.ok().contentType(type).body(img.data);
    }

    /** 202 with status CAPTURED; the app polls GET /receipts/{id}. The same Idempotency-Key returns the same receipt. */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Views.ReceiptView> create(@RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                    @RequestPart("image") MultipartFile image) throws IOException {
        if (key == null || key.isBlank()) throw ApiException.badRequest("Idempotency-Key header is required");
        if (image.isEmpty()) throw ApiException.badRequest("image is empty");
        var captured = capture.capture(key.trim(), image.getBytes(), image.getContentType(), image.getOriginalFilename());
        return ResponseEntity.status(captured.created() ? HttpStatus.ACCEPTED : HttpStatus.OK).body(Views.of(captured.receipt()));
    }

    @PatchMapping("/{id}/lines/{lineId}")
    public Views.ReceiptView correct(@PathVariable String id, @PathVariable String lineId, @RequestBody LineCorrection body) {
        Long lid;
        try {
            lid = Long.parseLong(lineId.startsWith("RL-") ? lineId.substring(3) : lineId);
        } catch (NumberFormatException e) {
            throw ApiException.notFound("Line");
        }
        return Views.of(service.correctLine(Views.parseReceiptId(id), lid, body.receivedQty(), body.unit()));
    }

    /** Assigns a PO to a receipt whose PO could not be resolved. */
    @PatchMapping("/{id}")
    public Views.ReceiptView assignPo(@PathVariable String id, @RequestBody AssignPo body) {
        return Views.of(service.assignPo(Views.parseReceiptId(id), body.poNumber()));
    }

    @PostMapping("/{id}/confirm")
    public Views.ReceiptView confirm(@PathVariable String id, @RequestBody(required = false) Confirm body) {
        boolean ack = body != null && Boolean.TRUE.equals(body.acknowledged());
        return Views.of(service.confirm(Views.parseReceiptId(id), ack));
    }

    @PostMapping("/{id}/dispute")
    public Views.ReceiptView dispute(@PathVariable String id, @RequestBody Dispute body) {
        return Views.of(service.dispute(Views.parseReceiptId(id), body.reason()));
    }

    private Receipt find(String id) {
        return receipts.findById(Views.parseReceiptId(id)).orElseThrow(() -> ApiException.notFound("Receipt"));
    }
}
