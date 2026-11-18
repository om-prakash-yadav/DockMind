# AI log

Tool: Claude Code (Claude Sonnet) in VS Code, for planning, code and tests. I ran and reviewed what it produced.

## Prompts that moved me most

1. **"Create a plan for this", with the problem statement in the folder.** It read the brief and returned a time-boxed plan that followed the brief's own cut order: backend on fixtures first, then the app, then the real model, then offline. I used it to decide what to protect if time ran short. It also flagged early that the starter kit was missing from the folder.
2. **The pasted mid-hack change (deliveries in several trips).** I asked for it to be absorbed in one place. The result is a single pure function, `Matcher.outstanding`, and received totals that are summed from CONFIRMED receipts on every read instead of kept as a counter. That is why confirming twice cannot double-count and why disputed receipts are ignored for free.
3. **"Make the UI of the Expo app better and more user friendly."** It redesigned both screens around a clerk at a dock: Confirm and Dispute pinned at the bottom, problem lines sorted first, +/- buttons for quantities, a visible "No signal" state, and large touch targets.

## Things the AI got wrong

Found during review, by the type checker, or by a failing test:

1. **A toast bug.** To make the same message appear twice, it appended a timestamp to the message text, which would have been shown to the clerk. Fixed with a separate counter field.
2. **A prompt that contradicted the parser.** The reader prompt told the model to "omit that line's quantity" when unreadable, but the parser treats a missing quantity as a failure and sends the receipt to manual entry. The prompt now says to set it to null.
3. **A wrong assumption in its own test.** It assumed `note-4-over` belonged to PO-4503. It is PO-4501, which another test had already closed, so the stale-quantity test failed. The application code was right; the test data was wrong.
4. **A check that missed cases.** The first "did the outstanding quantity change?" check on confirm compared by receipt-line id, so it would miss the placeholder "not delivered" lines, which are recreated. Switched to comparing by order line.
5. **Stale tooling.** After new packages were installed, Metro could not resolve them until it was restarted with a cleared cache. The bundle check caught it before I tried the app.

It was also careful about the phone: it reported that the app type-checks and bundles, not that it works on a device. The airplane-mode flow is untested on a device, and `DECISIONS.md` says so.

## A decision I made myself: Groq instead of Gemini

The starter gateway spoke Gemini. My Gemini key authenticated but Google refused every call with "prepayment credits are depleted" (HTTP 402), so the real reader could not run. I chose to switch provider and supplied a Groq key instead of asking the AI to work around it.

The AI rewrote `LlmGateway` for Groq's OpenAI-compatible chat API. The reader interface did not change, so nothing else in the backend moved. I did not compare several models: my key listed only one vision-capable model, `qwen/qwen3.8-27b`, so I used it and checked it on the kit notes. It read the clean, short, handwritten, wrong-supplier, no-PO, crossed-out and not-a-note cases correctly, and on the smudged PO it returned no PO instead of guessing. Groq's rate limit made the first burst of requests fail, so a retry with backoff was added.

I do not claim this is the best model, only the one available to me that worked. Swapping it is one setting (`llm.model`), and the base URL is configurable.
