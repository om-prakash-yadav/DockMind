package com.dockmind;

import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** Two clerks acting at the same instant. Every request below is released together by a barrier. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ConcurrencyTest {
    @Autowired MockMvc mvc;
    private final ObjectMapper json = new ObjectMapper();

    private JsonNode body(ResultActions a) throws Exception {
        return json.readTree(a.andReturn().getResponse().getContentAsString());
    }

    private String capture(String filename) throws Exception {
        var file = new MockMultipartFile("image", filename, "image/png", new byte[] {1, 2, 3});
        String id = body(mvc.perform(multipart("/receipts").file(file).header("Idempotency-Key", UUID.randomUUID().toString()))).get("id").asText();
        await().atMost(Duration.ofSeconds(10)).until(() -> !body(mvc.perform(get("/receipts/" + id))).get("status").asText().equals("CAPTURED"));
        return id;
    }

    /** Runs all calls at the same moment and returns their HTTP status codes. */
    private List<Integer> fireTogether(List<String[]> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        CyclicBarrier go = new CyclicBarrier(calls.size());
        List<Future<Integer>> results = new ArrayList<>();
        for (String[] c : calls) {
            results.add(pool.submit(() -> {
                go.await();
                return mvc.perform(post(c[0]).contentType(MediaType.APPLICATION_JSON).content(c[1])).andReturn().getResponse().getStatus();
            }));
        }
        List<Integer> codes = new ArrayList<>();
        for (Future<Integer> f : results) codes.add(f.get());
        pool.shutdown();
        return codes;
    }

    /** One receipt, a confirm and a dispute at the same instant: the row lock lets exactly one win. */
    @Test
    void confirmAndDisputeOfTheSameReceiptNeverBothSucceed() throws Exception {
        for (int i = 0; i < 15; i++) {
            String id = capture("note-5-eggs.png");
            // note-5 is a full match for PO-4513 the first time; later rounds are over-deliveries, still confirmable
            List<Integer> codes = fireTogether(List.of(
                    new String[] {"/receipts/" + id + "/confirm", "{\"acknowledged\":true}"},
                    new String[] {"/receipts/" + id + "/dispute", "{\"reason\":\"damaged\"}"}));
            long ok = codes.stream().filter(c -> c == 200).count();
            assertEquals(1, ok, "round " + i + ": exactly one of confirm/dispute may win, got " + codes);
            String status = body(mvc.perform(get("/receipts/" + id))).get("status").asText();
            assertTrue(status.equals("CONFIRMED") || status.equals("DISPUTED"));
        }
    }

    /**
     * Two different receipts for the same order line, confirmed at the same instant. Whichever commits second must be
     * told the outstanding quantity moved (409); two 200s would mean the order was received twice from the same stock.
     */
    @Test
    void twoReceiptsForTheSameOrderLineAreNotBothConfirmedFromTheSameOutstanding() throws Exception {
        // Each round must start with something still outstanding, otherwise two sequential confirms are both fine
        // (nothing moves once the line is complete). Milk: 240 ordered, 100 per round, so 3 rounds. Salmon: 80
        // ordered, 8 per round, so 9 rounds leave 8 outstanding.
        String[] rounds = {"milk-first-trip.png", "milk-first-trip.png", "milk-first-trip.png",
                "note-4-followup.png", "note-4-followup.png", "note-4-followup.png", "note-4-followup.png", "note-4-followup.png",
                "note-4-followup.png", "note-4-followup.png", "note-4-followup.png", "note-4-followup.png"};
        int bothSucceeded = 0;
        for (String note : rounds) {
            String a = capture(note);
            String b = capture(note);
            List<Integer> codes = fireTogether(List.of(
                    new String[] {"/receipts/" + a + "/confirm", "{\"acknowledged\":true}"},
                    new String[] {"/receipts/" + b + "/confirm", "{\"acknowledged\":true}"}));
            if (codes.get(0) == 200 && codes.get(1) == 200) bothSucceeded++;
        }
        assertEquals(0, bothSucceeded, "both receipts were confirmed against the same outstanding quantity in " + bothSucceeded + " of " + rounds.length + " rounds");
    }
}
