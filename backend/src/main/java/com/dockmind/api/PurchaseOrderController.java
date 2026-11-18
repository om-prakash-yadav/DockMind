package com.dockmind.api;

import com.dockmind.domain.PurchaseOrderRepository;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/purchase-orders")
public class PurchaseOrderController {
    private final PurchaseOrderRepository orders;

    public PurchaseOrderController(PurchaseOrderRepository orders) {
        this.orders = orders;
    }

    @GetMapping
    public List<Views.PurchaseOrderView> list(@RequestParam(defaultValue = "OPEN") String status) {
        return orders.findByStatusOrderByPoNumber(status.toUpperCase()).stream().map(Views::of).toList();
    }
}
