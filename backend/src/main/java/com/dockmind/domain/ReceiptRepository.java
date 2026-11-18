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

    /** Row lock, so a simultaneous confirm and dispute cannot both succeed. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Receipt r where r.id = :id")
    Optional<Receipt> lockById(@Param("id") Long id);
}
