package com.dockmind.api;

import com.dockmind.domain.PurchaseOrderRepository;
import com.dockmind.service.ReceiptService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

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
    @GetMapping
    public List<Views.PurchaseOrderView> list(@RequestParam(defaultValue = "OPEN") String status) {
        return orders.findByStatusOrderByPoNumber(status.toUpperCase()).stream()
                .map(po -> Views.of(po, service.confirmedTotals(po, null)))
                .toList();
    }
}
