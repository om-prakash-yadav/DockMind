package com.dockmind.api;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Swagger UI at /swagger-ui.html, generated from the controllers. Like the API, it has no login. */
@Configuration
public class OpenApiConfig {
    @Bean
    OpenAPI dockMindApi() {
        return new OpenAPI().info(new Info()
                .title("DockMind API")
                .version("1.0")
                .description("""
                        Receiving-dock API. Capture a delivery note photo, let the reader extract it, compare it with the \
                        purchase order, then confirm or dispute.

                        **Try the whole flow:** `POST /receipts` with a photo and an `Idempotency-Key` (any string; reuse it \
                        to see the same receipt come back) → poll `GET /receipts/{id}` until status is not `CAPTURED` → \
                        `PATCH` a line if needed → `POST /receipts/{id}/confirm` or `/dispute`.

                        Receipt status: CAPTURED → EXTRACTED | NEEDS_MANUAL → CONFIRMED | DISPUTED. \
                        With the fixture reader, a file named like `note-2-short.png` returns fixture 2."""));
    }
}
