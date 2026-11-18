package com.dockmind;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

/** The phone sends the photo as the raw request body. It must behave exactly like the multipart upload. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RawUploadTest {
    @Autowired MockMvc mvc;
    private final ObjectMapper json = new ObjectMapper();

    private JsonNode send(String key, String contentType, byte[] body, String filename) throws Exception {
        var req = post("/receipts").header("Idempotency-Key", key).contentType(contentType).content(body);
        if (filename != null) req = req.header("X-Filename", filename);
        var res = mvc.perform(req).andReturn().getResponse();
        // Some errors (an empty body) answer 400 with no JSON at all, so build the node from the status first.
        var node = json.createObjectNode();
        node.put("httpStatus", res.getStatus());
        if (!res.getContentAsString().isBlank()) node.setAll((com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(res.getContentAsString()));
        return node;
    }

    @Test
    void rawBodyUploadCreatesOneReceiptAndReplaysTheSameKey() throws Exception {
        String key = UUID.randomUUID().toString();
        JsonNode first = send(key, "image/jpeg", new byte[] {1, 2, 3}, "note-2-short.jpg");
        assertEquals(202, first.get("httpStatus").asInt());
        JsonNode again = send(key, "image/jpeg", new byte[] {1, 2, 3}, "note-2-short.jpg");
        assertEquals(200, again.get("httpStatus").asInt());
        assertEquals(first.get("id").asText(), again.get("id").asText());
    }

    @Test
    void missingKeyOrEmptyBodyIsRejected() throws Exception {
        assertEquals(400, send("", "image/jpeg", new byte[] {1}, null).get("httpStatus").asInt());
        assertEquals(400, send("k-" + UUID.randomUUID(), "image/jpeg", new byte[0], null).get("httpStatus").asInt());
    }
}
