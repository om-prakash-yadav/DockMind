package com.dockmind.api;

import com.dockmind.domain.Receipt;
import com.dockmind.domain.ReceiptImageRepository;
import com.dockmind.domain.ReceiptRepository;
import com.dockmind.domain.ReceiptStatus;
import com.dockmind.service.CaptureService;
import com.dockmind.service.ReceiptService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "Receipts", description = "Capture a delivery note, review it, correct it, then confirm or dispute")
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

    @Operation(summary = "List receipts, newest first. Optional ?status=EXTRACTED etc.")
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

    @Operation(summary = "Get one receipt, e.g. RCP-1. Poll this after capture until status leaves CAPTURED.")
    @GetMapping("/{id}")
    public Views.ReceiptView get(@PathVariable String id) {
        return Views.of(find(id));
    }

    @Operation(summary = "The stored photo of the note")
    @GetMapping("/{id}/image")
    public ResponseEntity<byte[]> image(@PathVariable String id) {
        var img = images.findById(Views.parseReceiptId(id)).orElseThrow(() -> ApiException.notFound("Image"));
        MediaType type = img.mimeType == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(img.mimeType);
        return ResponseEntity.ok().contentType(type).body(img.data);
    }

    /** 202 with status CAPTURED; the app polls GET /receipts/{id}. The same Idempotency-Key returns the same receipt. */
    @Operation(summary = "Upload a delivery note photo. 202 = new receipt; 200 = this Idempotency-Key was already used and the same receipt is returned.")
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Views.ReceiptView> create(@Parameter(description = "Any unique string. Reusing it returns the same receipt instead of creating another.", required = true)
                                                    @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                    @RequestPart("image") MultipartFile image) throws IOException {
        if (key == null || key.isBlank()) throw ApiException.badRequest("Idempotency-Key header is required");
        if (image.isEmpty()) throw ApiException.badRequest("image is empty");
        var captured = capture.capture(key.trim(), image.getBytes(), image.getContentType(), image.getOriginalFilename());
        return ResponseEntity.status(captured.created() ? HttpStatus.ACCEPTED : HttpStatus.OK).body(Views.of(captured.receipt()));
    }

    /**
     * The same upload with the photo as the raw request body (Content-Type image/jpeg, image/png or
     * application/octet-stream) instead of a multipart form. The phone uses this: its HTTP client cannot build a
     * file part from a file path, but sends bytes reliably. The file name travels in X-Filename, URL-encoded.
     */
    @Operation(summary = "Upload a delivery note photo as the raw request body (what the phone app uses). Same rules as the multipart form.")
    @PostMapping(consumes = {"image/jpeg", "image/png", "image/webp", MediaType.APPLICATION_OCTET_STREAM_VALUE})
    public ResponseEntity<Views.ReceiptView> createFromBytes(
            @Parameter(description = "Any unique string. Reusing it returns the same receipt.", required = true)
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            @RequestHeader(value = "X-Filename", required = false) String filename,
            @RequestHeader(value = "Content-Type") String contentType,
            @RequestBody byte[] photo) {
        if (key == null || key.isBlank()) throw ApiException.badRequest("Idempotency-Key header is required");
        if (photo == null || photo.length == 0) throw ApiException.badRequest("image is empty");
        String name = null;
        if (filename != null && !filename.isBlank()) {
            try {
                name = java.net.URLDecoder.decode(filename, java.nio.charset.StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                name = filename;
            }
        }
        var captured = capture.capture(key.trim(), photo, contentType, name);
        return ResponseEntity.status(captured.created() ? HttpStatus.ACCEPTED : HttpStatus.OK).body(Views.of(captured.receipt()));
    }

    @Operation(summary = "Correct a received quantity (the clerk wins). The server recomputes the discrepancy.")
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
    @Operation(summary = "Assign a purchase order when the reader could not resolve one")
    @PatchMapping("/{id}")
    public Views.ReceiptView assignPo(@PathVariable String id, @RequestBody AssignPo body) {
        return Views.of(service.assignPo(Views.parseReceiptId(id), body.poNumber()));
    }

    @Operation(summary = "Confirm the delivery. Needs acknowledged=true if the receipt is flagged for review. Safe to repeat.")
    @PostMapping("/{id}/confirm")
    public Views.ReceiptView confirm(@PathVariable String id, @RequestBody(required = false) Confirm body) {
        boolean ack = body != null && Boolean.TRUE.equals(body.acknowledged());
        return Views.of(service.confirm(Views.parseReceiptId(id), ack));
    }

    @Operation(summary = "Dispute the delivery with a reason. Safe to repeat.")
    @PostMapping("/{id}/dispute")
    public Views.ReceiptView dispute(@PathVariable String id, @RequestBody Dispute body) {
        return Views.of(service.dispute(Views.parseReceiptId(id), body.reason()));
    }

    private Receipt find(String id) {
        return receipts.findById(Views.parseReceiptId(id)).orElseThrow(() -> ApiException.notFound("Receipt"));
    }
}
