package com.dockmind.api;

import com.dockmind.domain.PurchaseOrderRepository;
import com.dockmind.service.ReceiptService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Purchase orders", description = "What was ordered, what has arrived, what is still to come")
@RestController
@RequestMapping("/purchase-orders")
public class PurchaseOrderController {
    private final PurchaseOrderRepository orders;
    private final ReceiptService service;

    public PurchaseOrderController(PurchaseOrderRepository orders, ReceiptService service) {
        this.orders = orders;
        this.service = service;
    }

    /** OPEN orders by default. An order whose lines are all fully received becomes RECEIVED and leaves this list. */
    @Operation(summary = "List purchase orders (OPEN by default) with received and remaining quantity per line")
    @GetMapping
    public List<Views.PurchaseOrderView> list(@RequestParam(defaultValue = "OPEN") String status) {
        return orders.findByStatusOrderByPoNumber(status.toUpperCase()).stream()
                .map(po -> Views.of(po, service.confirmedTotals(po, null)))
                .toList();
    }
}
