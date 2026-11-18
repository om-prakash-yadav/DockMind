# DockMind: AI Dock Receiver

A receiving clerk photographs a supplier's delivery note. A vision model reads it, plain code compares it with the purchase order, and the clerk confirms or disputes before the truck leaves. Capture keeps working with no signal.

- **Backend:** Spring Boot 3.5, Java 17+, H2 (file database, no setup)
- **Mobile:** Expo (SDK 58), React Native, TypeScript, runs in **Expo Go**
- **Reader:** Groq vision model by default, or canned fixtures with no API key

## Run it (about 5 minutes)

You need Java 17+, Maven 3.9+, Node 20+, and the **Expo Go** app on a phone that is on the **same Wi-Fi** as your computer.

### 1. Backend

```bash
cd backend
mvn spring-boot:run
```

It listens on port 8080, creates its database in `backend/data/`, and loads the four sample purchase orders on first start. By default it uses the **fixture reader**, so it works with no key. Check it: <http://localhost:8080/purchase-orders>.

To use the **real vision model**, set a [Groq](https://console.groq.com) key before starting:

```bash
# bash
export LLM_API_KEY=gsk_...        # never commit this
export DOCKMIND_EXTRACTOR=llm
mvn spring-boot:run
```

```powershell
# PowerShell
$env:LLM_API_KEY = "gsk_..."
$env:DOCKMIND_EXTRACTOR = "llm"
mvn spring-boot:run
```

The model is `qwen/qwen3.8-27b` (change with `LLM_MODEL` or `llm.model`). The base URL is any OpenAI-compatible endpoint (`llm.base-url`).

### 2. Mobile app

```bash
cd mobile
npm install
cp .env.example .env     # then edit .env
npx expo start --lan
```

Put your computer's **LAN IP** in `mobile/.env` (find it with `ipconfig` / `ifconfig`). `localhost` does not work from a phone:

```
EXPO_PUBLIC_API_URL=http://192.168.1.20:8080
```

Scan the QR code with Expo Go (Android) or the Camera app (iPhone).

### If the phone cannot connect

1. Open `http://<your-ip>:8080/purchase-orders` in the phone's browser. If that fails, it is the network, not the app.
2. **Windows firewall** blocks it by default on public networks. In an Administrator PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "DockMind API" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Any
   New-NetFirewallRule -DisplayName "DockMind Metro" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Any
   ```
3. Guest Wi-Fi often isolates devices from each other. Use a normal network or your phone's hotspot.

## Try it

The delivery notes are in `kit/delivery-notes/`. Copy a few to the phone, then use **Choose from gallery**.

| Note | What it shows |
|---|---|
| `note-1-clean` | Everything matches. Confirming it closes PO-4501 |
| `note-2-short` | Salmon short by 8, scallops not on the order, prawns not delivered |
| `note-3-messy` | Handwritten, smudged PO. The app will not guess it; pick the PO by hand |
| `note-6-wrong-supplier` | A PO number that belongs to a different supplier is refused |
| `note-8-crossed-out` | A crossed-out quantity is ignored |
| `note-9-not-a-note` | A cafe receipt goes to manual entry |

**Several trips for one order:** confirm `note-2` (72 of 80 kg salmon), then photograph a follow-up with 8 kg. It comes out as a full match for the remaining 8 kg.

**Offline:** turn on airplane mode, photograph a note, and it appears under *Waiting to sync*. Close the app, reopen it, then turn airplane mode off. It uploads by itself, once.

With the fixture reader, the file name picks the answer (`note-3-messy.png` gives fixture 3). Any other name cycles through the fixtures. With the real reader, any photo works.

## Tests

```bash
cd backend && mvn test      # 20 tests
cd mobile && npx tsc --noEmit
```

The backend tests cover the matching rules, the answer parser, and a full HTTP scenario for deliveries split over several trips. The offline queue has **no automated tests**; I checked it by reading the code and by the server-side idempotency tests, not on a device.

## API

| Call | Purpose |
|---|---|
| `GET /purchase-orders?status=OPEN` | Open orders with received and remaining per line |
| `GET /receipts?status=` , `GET /receipts/{id}` | List and read |
| `POST /receipts` | Multipart `image` + `Idempotency-Key` header. `202` with status `CAPTURED`, then poll. Same key returns the same receipt (`200`) |
| `PATCH /receipts/{id}/lines/{lineId}` | `{"receivedQty": 70}`, recomputes the discrepancy |
| `PATCH /receipts/{id}` | `{"poNumber": "PO-4503"}`, assigns a PO when the reader could not |
| `POST /receipts/{id}/confirm` | `{"acknowledged": true}` is needed when the receipt is flagged for review |
| `POST /receipts/{id}/dispute` | `{"reason": "..."}` |
| `GET /receipts/{id}/image` | The stored photo |

Receipt status: `CAPTURED` → `EXTRACTED` or `NEEDS_MANUAL` → `CONFIRMED` or `DISPUTED`.

## Layout

```
backend/   Spring Boot API
  matching/   Matcher: all discrepancy rules, pure functions
  ai/         Extractor interface, Fixture/Llm extractors, LlmGateway, answer parser
  service/    ReceiptService (checks the reader's answer), CaptureService, ExtractionRunner
mobile/    Expo app (src/screens, src/offline = the queue)
kit/       Sample notes, fixtures, seed data
DECISIONS.md  Design decisions and what was cut
```

Never commit a key. `backend/.env` and `mobile/.env` are git-ignored.
