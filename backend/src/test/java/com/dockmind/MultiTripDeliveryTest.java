package com.dockmind;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import static org.awaitility.Awaitility.await;

/** The warehouse manager's change: one PO, several deliveries. Runs the real HTTP API on the fixture reader. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MultiTripDeliveryTest {
    @Autowired MockMvc mvc;
    private final ObjectMapper json = new ObjectMapper();

    private JsonNode body(ResultActions a) throws Exception {
        return json.readTree(a.andReturn().getResponse().getContentAsString());
    }

    /** Uploads a note (the fixture reader picks its answer from the file name) and waits until it is read. */
    private JsonNode capture(String filename) throws Exception {
        var file = new MockMultipartFile("image", filename, "image/png", new byte[] {1, 2, 3});
        JsonNode created = body(mvc.perform(multipart("/receipts").file(file).header("Idempotency-Key", UUID.randomUUID().toString())));
        String id = created.get("id").asText();
        await().atMost(Duration.ofSeconds(10)).until(() -> !body(mvc.perform(get("/receipts/" + id))).get("status").asText().equals("CAPTURED"));
        return body(mvc.perform(get("/receipts/" + id)));
    }

    private JsonNode confirm(String id) throws Exception {
        return body(mvc.perform(post("/receipts/" + id + "/confirm").contentType(MediaType.APPLICATION_JSON).content("{\"acknowledged\":true}")));
    }

    private JsonNode line(JsonNode receipt, String poLineId) {
        for (JsonNode l : receipt.get("lines")) if (poLineId.equals(l.path("poLineId").asText(null))) return l;
        throw new AssertionError("no line " + poLineId + " in " + receipt);
    }

    private double qty(JsonNode n, String field) {
        return n.get(field).asDouble();
    }

    private JsonNode poLine(String poNumber, String poLineId, String status) throws Exception {
        JsonNode list = body(mvc.perform(get("/purchase-orders?status=" + status)));
        for (JsonNode po : list) {
            if (!po.get("poNumber").asText().equals(poNumber)) continue;
            for (JsonNode l : po.get("lines")) if (l.get("id").asText().equals(poLineId)) return l;
        }
        return null;
    }

    @Test
    void followUpDeliveryIsComparedWithWhatIsStillOutstanding() throws Exception {
        // Trip 1: note 2 brings 72 of 80 kg salmon. Confirmed.
        JsonNode first = capture("note-2-short.png");
        assertEquals("SHORT", line(first, "POL-4502-1").get("discrepancy").asText());
        assertEquals(80, qty(line(first, "POL-4502-1"), "remainingQty"));
        String firstId = first.get("id").asText();
        assertEquals("CONFIRMED", confirm(firstId).get("status").asText());

        // The order now shows 72 received and 8 remaining.
        JsonNode pol = poLine("PO-4502", "POL-4502-1", "OPEN");
        assertEquals(72, qty(pol, "receivedQty"));
        assertEquals(8, qty(pol, "remainingQty"));

        // Trip 2: 8 kg arrives. Against the remaining 8 it is a full match, not "short by 72".
        JsonNode second = capture("note-4-followup.png");
        JsonNode salmon = line(second, "POL-4502-1");
        assertEquals("MATCH", salmon.get("discrepancy").asText());
        assertEquals(80, qty(salmon, "orderedQty"));
        assertEquals(72, qty(salmon, "previouslyReceivedQty"));
        assertEquals(8, qty(salmon, "remainingQty"));
        assertEquals(0, qty(salmon, "delta"));

        // Confirming the first receipt again changes nothing: totals are summed, not counted up.
        confirm(firstId);
        assertEquals(72, qty(poLine("PO-4502", "POL-4502-1", "OPEN"), "receivedQty"));

        // Confirming trip 2 completes the salmon line (80 of 80). Prawns were never delivered, so the PO stays open.
        confirm(second.get("id").asText());
        confirm(second.get("id").asText()); // and twice is still safe
        assertEquals(80, qty(poLine("PO-4502", "POL-4502-1", "OPEN"), "receivedQty"));
        assertEquals(0, qty(poLine("PO-4502", "POL-4502-1", "OPEN"), "remainingQty"));
        assertNotNull(poLine("PO-4502", "POL-4502-2", "OPEN"), "PO-4502 still has prawns outstanding");
    }

    @Test
    void fullyReceivedPoLeavesTheOpenList() throws Exception {
        assertNotNull(poLine("PO-4501", "POL-4501-1", "OPEN"));
        JsonNode r = capture("note-1-clean.png");
        assertEquals("MATCH", line(r, "POL-4501-1").get("discrepancy").asText());
        confirm(r.get("id").asText());
        assertNull(poLine("PO-4501", "POL-4501-1", "OPEN"), "a fully received PO must drop off the open list");
        assertNotNull(poLine("PO-4501", "POL-4501-1", "RECEIVED"));
    }

    @Test
    void disputedReceiptsDoNotCountAsReceived() throws Exception {
        JsonNode r = capture("note-5-eggs.png"); // 120 trays of 120 on PO-4513
        mvc.perform(post("/receipts/" + r.get("id").asText() + "/dispute").contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"crates damaged\"}"))
                .andExpect(status().isOk());
        JsonNode pol = poLine("PO-4513", "POL-4513-1", "OPEN");
        assertNotNull(pol, "a disputed delivery must not close the PO");
        assertEquals(0, qty(pol, "receivedQty"));
        assertEquals(120, qty(pol, "remainingQty"));
    }

    @Test
    void confirmingStaleNumbersIsRefusedAndRefreshed() throws Exception {
        // Two clerks open deliveries for the same line before either is confirmed.
        JsonNode a = capture("milk-first-trip.png");  // 100 of the 240 milk on PO-4503
        JsonNode b = capture("milk-first-trip.png");
        String aId = a.get("id").asText(), bId = b.get("id").asText();
        double before = qty(line(b, "POL-4503-1"), "remainingQty");
        confirm(aId); // changes what is outstanding for b
        var res = mvc.perform(post("/receipts/" + bId + "/confirm").contentType(MediaType.APPLICATION_JSON).content("{\"acknowledged\":true}"))
                .andReturn().getResponse();
        assertEquals(409, res.getStatus());
        assertTrue(res.getContentAsString().contains("OUTSTANDING_CHANGED"));
        JsonNode refreshed = body(mvc.perform(get("/receipts/" + bId)));
        assertTrue(qty(line(refreshed, "POL-4503-1"), "remainingQty") < before, "remaining quantity must have been refreshed");
    }
}
