package com.dockmind.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Minimal Gemini vision gateway (from the brief's starter kit). Returns the model's raw text and throws on any
 * failure: HTTP error, timeout, or an answer with no text. The caller decides what failure means.
 * The key comes from the LLM_API_KEY environment variable and is never logged.
 */
@Component
public class LlmGateway {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @Value("${llm.api-key:${LLM_API_KEY:}}")
    private String apiKey;
    @Value("${llm.model:gemini-2.5-flash}")
    private String model;
    @Value("${llm.timeout-seconds:45}")
    private int timeoutSeconds;

    public String callVision(String prompt, byte[] image, String mimeType) throws Exception {
        if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("LLM_API_KEY is not set");
        var parts = new java.util.ArrayList<Map<String, Object>>();
        parts.add(Map.of("text", prompt));
        parts.add(Map.of("inlineData", Map.of("mimeType", mimeType, "data", Base64.getEncoder().encodeToString(image))));
        var body = Map.of(
                "contents", List.of(Map.of("parts", parts)),
                "generationConfig", Map.of("responseMimeType", "application/json", "temperature", 0.1));

        var req = HttpRequest.newBuilder(URI.create(
                        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent"))
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .header("Content-Type", "application/json")
                .header("x-goog-api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)))
                .build();

        var res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) {
            // Status only: the response body can echo request details.
            throw new IllegalStateException("LLM HTTP " + res.statusCode());
        }
        JsonNode root = JSON.readTree(res.body());
        String text = root.path("candidates").path(0).path("content").path("parts").path(0).path("text").asText("");
        if (text.isBlank()) throw new IllegalStateException("LLM returned no text");
        return text;
    }
}
