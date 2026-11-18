package com.dockmind.service;

import com.dockmind.domain.PurchaseOrderRepository;
import javax.sql.DataSource;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.stereotype.Component;

/** Loads seed.sql once, when there are no purchase orders yet. The H2 file keeps data between restarts. */
@Component
@Order(1)
public class SeedLoader implements ApplicationRunner {
    private final PurchaseOrderRepository orders;
    private final DataSource dataSource;

    public SeedLoader(PurchaseOrderRepository orders, DataSource dataSource) {
        this.orders = orders;
        this.dataSource = dataSource;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (orders.count() == 0) {
            new ResourceDatabasePopulator(new ClassPathResource("seed.sql")).execute(dataSource);
        }
    }
}
