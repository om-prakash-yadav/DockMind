package com.dockmind.domain;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReceiptRepository extends JpaRepository<Receipt, Long> {
    Optional<Receipt> findByIdempotencyKey(String key);

    List<Receipt> findAllByOrderByIdDesc();

    List<Receipt> findByStatusOrderByIdDesc(ReceiptStatus status);

    List<Receipt> findByStatus(ReceiptStatus status);

    /**
     * Lines of CONFIRMED receipts for a PO, as (poLineId, receivedQty, unit). Disputed and unconfirmed receipts are
     * deliberately absent: only a confirmed delivery counts as received. Pass -1 to exclude nothing.
     */
    @Query("select l.poLineId, l.receivedQty, l.unit from Receipt r join r.lines l "
            + "where r.status = com.dockmind.domain.ReceiptStatus.CONFIRMED and r.poNumber = :po "
            + "and r.id <> :excludeId and l.poLineId is not null")
    List<Object[]> confirmedLines(@Param("po") String poNumber, @Param("excludeId") Long excludeReceiptId);

    /** Row lock, so a simultaneous confirm and dispute cannot both succeed. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Receipt r where r.id = :id")
    Optional<Receipt> lockById(@Param("id") Long id);
}
