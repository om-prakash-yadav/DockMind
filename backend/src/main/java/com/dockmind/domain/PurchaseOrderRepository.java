package com.dockmind.domain;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PurchaseOrderRepository extends JpaRepository<PurchaseOrder, String> {
    List<PurchaseOrder> findByStatusOrderByPoNumber(String status);

    Optional<PurchaseOrder> findByPoNumber(String poNumber);

    Optional<PurchaseOrder> findByPoNumberAndStatus(String poNumber, String status);

    /**
     * Row lock on one purchase order. Confirming takes it so that two receipts for the same order are confirmed one
     * after the other: the second then sees what the first brought in, instead of both counting the same stock.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PurchaseOrder p where p.poNumber = :poNumber")
    Optional<PurchaseOrder> lockByPoNumber(@Param("poNumber") String poNumber);
}
