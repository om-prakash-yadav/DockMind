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
 * Vision gateway for any OpenAI-compatible chat API; defaults to Groq. (The brief's starter gateway spoke Gemini;
 * the interface is the same, so only this class changed.) Returns the model's raw text and throws on any failure:
 * HTTP error, timeout, or an answer with no text. The caller decides what failure means.
 * The key comes from the LLM_API_KEY environment variable and is never logged.
 */
@Component
public class LlmGateway {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_RETRIES = 3;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    private static long seconds(String retryAfter) {
        try { return Math.max(1, (long) Math.ceil(Double.parseDouble(retryAfter.trim()))); } catch (NumberFormatException e) { return 3; }
    }

    @Value("${llm.api-key:${LLM_API_KEY:}}")
    private String apiKey;
    @Value("${llm.base-url:https://api.groq.com/openai/v1}")
    private String baseUrl;
    @Value("${llm.model:qwen/qwen3.8-27b}")
    private String model;
    @Value("${llm.timeout-seconds:45}")
    private int timeoutSeconds;

    public String callVision(String prompt, byte[] image, String mimeType) throws Exception {
        if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("LLM_API_KEY is not set");
        String dataUrl = "data:" + mimeType + ";base64," + Base64.getEncoder().encodeToString(image);
        var body = Map.of(
                "model", model,
                "temperature", 0.1,
                "max_tokens", 2000,
                "response_format", Map.of("type", "json_object"),
                "messages", List.of(Map.of("role", "user", "content", List.of(
                        Map.of("type", "text", "text", prompt),
                        Map.of("type", "image_url", "image_url", Map.of("url", dataUrl))))));

        var req = HttpRequest.newBuilder(URI.create(baseUrl.replaceAll("/$", "") + "/chat/completions"))
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)))
                .build();

        var res = http.send(req, HttpResponse.BodyHandlers.ofString());
        // Rate limits and brief server trouble are worth a couple of patient retries before giving up.
        for (int attempt = 1; attempt <= MAX_RETRIES && (res.statusCode() == 429 || res.statusCode() / 100 == 5); attempt++) {
            long waitSeconds = res.headers().firstValue("Retry-After").map(LlmGateway::seconds).orElse(2L * attempt);
            Thread.sleep(Math.min(waitSeconds, 20) * 1000);
            res = http.send(req, HttpResponse.BodyHandlers.ofString());
        }
        if (res.statusCode() / 100 != 2) {
            // Status only: the response body can echo request details.
            throw new IllegalStateException("LLM HTTP " + res.statusCode());
        }
        JsonNode root = JSON.readTree(res.body());
        String text = root.path("choices").path(0).path("message").path("content").asText("");
        if (text.isBlank()) throw new IllegalStateException("LLM returned no text");
        return text;
    }
}
