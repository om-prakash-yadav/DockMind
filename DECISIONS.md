# Decisions

## Why is discrepancy logic in code and not in the model, and what stops a bad model answer reaching the database?

A discrepancy can start a dispute with a supplier, so it has to be repeatable and testable, and a model is neither. The model only reads the note and writes a sentence about how legible it is. All comparison lives in one pure class, `Matcher`, with no Spring or database in it. It has unit tests for every outcome.

The model is not shown the purchase orders. Code looks the PO up from the number the model read. That matters because PO-4503 and PO-4513 differ by one digit, and a model that has seen the list will fill a smudged digit with a PO it knows.

Every answer passes through two checks before anything is saved:

1. `ExtractionParser` strips fences and surrounding prose, survives bad JSON, turns `"72 kg"` into 72, and treats a missing confidence as 0.
2. `ReceiptService.applyExtraction` accepts a PO only if it exists, is open, and its supplier agrees with the note. It trusts a `poLineId` from the model only if that line belongs to the PO. It links lines by description itself.

A note with no lines, or any line whose quantity is unreadable, goes to `NEEDS_MANUAL`. Guessing a number could start a false dispute.

## How is the extractor swapped, and what happens when the model fails?

`Extractor` is an interface with `FixtureExtractor` and `LlmExtractor`, chosen by `dockmind.extractor` (env `DOCKMIND_EXTRACTOR`, default `fixture`). Both feed the same parser and checks, so fixtures exercise the real validation path. The vision call goes through `LlmGateway`, which retries a rate limit or server error up to three times and otherwise throws.

Any failure (timeout, HTTP error, garbage answer) ends in `NEEDS_MANUAL` with the photo kept. It never becomes a 500 and is never silently dropped. The clerk picks the PO and types quantities by hand. This was tested with an exhausted API key and with a real rate limit.

## How does the sync stay idempotent end to end?

The phone makes the key once, at capture, and writes it to storage together with a copy of the photo before any upload. Every retry in any session sends that same key, including after an app kill. The queue removes an item only on a 2xx response, and an item left "uploading" by a kill goes back to pending on start.

The server has a unique constraint on the key. A repeat returns the existing receipt, and two simultaneous requests are settled by catching the constraint violation. The receipt and its photo are saved in one transaction. I tested 8 simultaneous uploads with one key: one receipt.

Confirm and dispute are safe to repeat. Received totals are never kept as a counter: they are summed from CONFIRMED receipts on every read, so confirming twice cannot double-count.

## What did you cut, and what would you build next?

Cut or not done:
- **The offline queue is untested on a device.** It is written and type-checked, and the server side is tested, but I did not run the airplane-mode flow end to end.
- No login, per the brief. The API is open, so keep it on a private network.
- Correcting a quantity and deciding need the server. Only capture works offline.
- No automated tests for the mobile app.
- No bonus items.

Next: run the offline flow on a device and fix what it finds, write queue tests, add a unit field to the correction screen, and let a clerk re-run the reader on a bad photo.

## Other decisions and spec gaps

- **Capture is asynchronous** (202, then the app polls). A vision call can take 30 seconds, and a dock connection may not hold that long.
- **Several trips per order (the mid-hack change).** "Ordered" becomes "outstanding" (ordered minus confirmed receipts) in one pure function, `Matcher.outstanding`. `classify` did not change. Disputed receipts never count. A PO becomes RECEIVED, and leaves the open list, only when every line is fully received; over-delivery counts as received. Confirm re-reads the outstanding amounts and returns `409 OUTSTANDING_CHANGED` if another delivery was confirmed meanwhile, saving the refreshed numbers so the clerk sees them.
- **Two clerks at once.** Confirm and dispute lock the receipt row, so a confirm and a dispute of the same receipt cannot both win. Confirm also locks the purchase order row (always receipt first, then order, so it cannot deadlock). I found this was needed by test: with only the receipt lock, two different receipts for the same order, confirmed at the same instant, were both confirmed against the same outstanding quantity in 12 of 12 rounds. With the order lock the second one gets `409 OUTSTANDING_CHANGED`. Not covered: two clerks photographing the same paper note get two receipts, because the key is per photo and the server does not compare notes by content.
- A line in a different unit than the order is not counted toward received, so it cannot close a PO silently.
- A note for a PO that is already closed is treated as having no PO. The clerk assigns one.
- A line needs review below 0.80 confidence (configurable). The server refuses to confirm a flagged receipt unless the call carries `acknowledged: true`, and the app asks the clerk first.
- When the clerk assigns a PO, it counts as full confidence, so the receipt is not flagged forever for the model's weak reading.
- Two additions to the suggested API: `PATCH /receipts/{id}` assigns a PO, and `GET /receipts/{id}/image` serves the photo.
- The sample notes and fixtures were not supplied. I took the delivery notes, fixtures and seed from a public repo that had them, and used the seed from the brief. If the organizers' versions differ, swap them in `kit/` and `backend/src/main/resources/fixtures/`.
- The vision model is Groq `qwen/qwen3.8-27b`, the only vision-capable model available to my key. The brief's Gemini gateway was replaced after that key's credit ran out; the gateway interface did not change.
