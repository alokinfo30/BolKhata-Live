# BolKhata Live 

**BolKhata Live** is a real-time **Hinglish voice operations agent** built for Indian wholesale and kirana distribution counters. It combines low-latency bidirectional audio streaming (`Gemini Live API`) with live **Firebase Firestore** ACID ledger transactions, inventory tracking, Human-in-the-Loop (HITL) manager overrides, dynamic UPI QR payment generation, and operational analytics.

[Click here for Backend URL
](https://bolkhata-live.onrender.com/)

[Click here for Frontend URL](https://boalkhata.netlify.app/)

## Live Deployments

- **Frontend (Netlify Static Host):** `[https://boalkhata.netlify.app/](https://boalkhata.netlify.app/)`
- **Backend API & WebSocket Server (Render Docker):** `[https://bolkhata-live.onrender.com/](https://bolkhata-live.onrender.com/)`
- **Full-Stack Hosted App (AI Studio Cloud Run):** `https://ais-pre-36crxmm6aatbkmxysccgd5-440468285390.asia-east1.run.app`

> When running on `*.netlify.app`, the client (`src/services/backendConfig.ts`) automatically routes `/api/*` HTTP calls and `/ws/live` WebSocket connections to `https://bolkhata-live.onrender.com` unless overridden via `VITE_API_BASE_URL` or the in-app Backend URL bar.

---

## Key Features

### 1. Counter Workspace (`src/components/CounterWorkspace.tsx`)
- **Live Hinglish Voice Agent:** Real-time 16 kHz PCM microphone capture via `AudioWorklet` (`src/services/geminiLiveClient.ts`) and 24 kHz audio playback with instant mid-sentence barge-in interruption and latency telemetry (`ms`).
- **Automatic Text + Voice Output Fallback:** If a browser/device reports missing microphone hardware (`"Device was removed"`), `useGeminiLiveVoice` automatically connects in `Text + Voice Output` mode so operators can type Hinglish commands and still hear spoken confirmations.
- **Persistent Scrollable Transcripts & Quick Action Menu:** Live and persisted timestamped transcripts (`voice_transcripts`) highlight customer names, SKU aliases, and amounts (`₹`, `bori`, `peti`, `tin`, `kg`). Clicking or right-clicking any token opens a Quick Action menu to re-run `lookup_customer_and_stock`, draft a correction, or sync the UPI QR amount.
- **Dynamic UPI QR Code Generator:** Uses `qrcode.react` (`QRCodeSVG`) synced automatically with the active voice read-back, HITL approval, or latest transaction (`upi://pay?...`). Includes configurable store VPA/merchant name (`localStorage`) and one-click `JAMA` payment logging.
- **Header Low-Stock Alert Badge:** Highlights the count of items below `reorder_threshold`; clicking navigates directly to **Khata & Stock** filtered to low-stock SKUs.

### 2. Khata & Stock (`src/components/KhataInventoryView.tsx` & `src/components/CsvImportModal.tsx`)
- Real-time customer Khata balances (`current_udhaar_balance`, `credit_limit`), wholesale SKU inventory (`stock_qty`, `reorder_threshold`, Hinglish `aliases`), transaction ledger (`UDHAAR`, `JAMA`, `CASH_SALE`, `UNDONE`), and supplier restock POs.
- **CSV Import Tool:** Client-side RFC-4180 CSV parser with live preview and chunked Firestore `writeBatch` import for bootstrapping customers and product catalogs.

### 3. Human-in-the-Loop Approvals (`src/components/ApprovalsHistoryView.tsx`)
- Automatically pauses and triggers manager approval cards whenever a transaction exceeds the customer's `credit_limit` or a single order exceeds `₹50,000`.
- Approving an override atomically updates Khata balance, deducts inventory, logs the transaction, triggers automatic restock POs if stock drops below `reorder_threshold`, and notifies the active voice session to announce confirmation in Hinglish.

### 4. Performance Dashboard (`src/components/PerformanceView.tsx`)
- Built with `recharts` to visualize:
  - **Response Latency Over Time** (ms + session average)
  - **Autonomous vs. Human-Approved Transaction Mix** (plus undone rollbacks)
  - **Transaction Value Stream** (`₹`) and **Counter ROI & Risk Guardrails**

### 5. Insights & Audit (`src/components/InsightsAuditView.tsx`)
- Synthesizes live Firestore state via `/api/insights/generate` into structured JSON outputs:
  - Hinglish **WhatsApp Payment Reminder** for highest-balance customer
  - Formal **Distributor Purchase Order** for urgent restocks
  - **End-of-Day Owner Financial & Risk Summary**
  - **Operator Feedback & Sentiment Digest** powered by `/api/sentiment/analyze`

---

## Agentic Tooling & Safety Workflow

Tool schemas are declared in `server.ts` and executed client-side against live Firestore transactions in `src/services/toolHandlers.ts` and `src/services/firestoreOps.ts`:

| Tool Name | Purpose |
| :--- | :--- |
| `lookup_customer_and_stock` | Searches customer Khata accounts and inventory SKUs/Hinglish aliases before quoting prices or balances. |
| `check_business_policy` | Validates credit limit breaches, orders `> ₹50,000`, stock sufficiency, and duplicate entries within 5 minutes. |
| `request_human_approval` | Creates a `PENDING` HITL manager approval document in `approvals` when a policy guardrail triggers. |
| `execute_ledger_and_inventory_tx` | Runs `runTransaction` to atomically update customer balance, deduct stock, and store rollback snapshots (`user_confirmed=true` required). |
| `create_supplier_restock` | Generates a distributor PO in `restocks` whenever `stock_qty < reorder_threshold`. |
| `undo_last_transaction` | Atomically rolls back the latest completed ledger & stock transaction using stored `previous_balance` and `previous_stock`. |

---

## Tech Stack

- **Frontend:** React 19, TypeScript 7, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`, `recharts`, `qrcode.react`, `motion`
- **Backend:** Node.js (`>=20`), Express 4, `ws` (WebSocket proxy on `/ws/live`), `cors`, `tsx`
- **AI / Voice SDK:** `@google/genai` (server-side only — `gemini-3.8-live` for native audio streaming; `gemini-4-hydrogen` for structured insights & sentiment analysis)
- **Database & Auth:** Firebase Authentication (Google Sign-In) + Cloud Firestore (`firebase` v13)

---

## Firebase Configuration & Firestore Collections

- **Firebase Project ID:** `numeric-dolphin-bds98`
- **Firestore Database ID:** `ai-studio-81ba709d-95b0-45b8-91f0-77258e8a2905`
- **Config File:** `firebase-applet-config.json`
- **Schema & Security Rules:** Defined in `firebase-blueprint.json` and `firestore.rules` (enforces verified email sign-in and strict `ownerId == request.auth.uid` isolation on all collections).

| Collection | Description |
| :--- | :--- |
| `/customers/{customerId}` | Customer store profiles, phone, location, `current_udhaar_balance`, `credit_limit` |
| `/inventory/{itemId}` | Wholesale SKUs, Hinglish `aliases`, `stock_qty`, `unit_price`, `reorder_threshold` |
| `/transactions/{transactionId}` | Ledger entries (`UDHAAR`, `JAMA`, `CASH_SALE`) with `previous_balance` & `previous_stock` undo snapshots |
| `/approvals/{approvalId}` | HITL override requests (`PENDING`, `APPROVED`, `REJECTED`) |
| `/restocks/{restockId}` | Automated supplier purchase orders (`ORDERED`, `RECEIVED`, `CANCELLED`) |
| `/sentiment_logs/{logId}` | Operator ratings, sentiment (`POSITIVE`, `NEUTRAL`, `FRICTION`), and AI summaries |
| `/agent_traces/{traceId}` | Real-time tool execution traces and latency (`latency_ms`) |
| `/voice_transcripts/{transcriptId}` | Persisted counter conversation transcripts with role and timestamps |

---

## Backend Endpoints (`server.ts`)

| Endpoint | Method / Protocol | Description |
| :--- | :--- | :--- |
| `/api/health` | `GET` | Health probe returning `{ ok: true, hasApiKey: boolean }`. |
| `/api/gemini-token` | `POST` | Mints short-lived ephemeral Gemini auth tokens (`ai.authTokens.create`) so `GEMINI_API_KEY` stays server-side. |
| `/api/sentiment/analyze` | `POST` | Classifies operator feedback sentiment and category using `gemini-4-hydrogen`. |
| `/api/insights/generate` | `POST` | Generates structured WhatsApp reminder, distributor PO, EOD summary, and sentiment digest. |
| `/ws/live` | `WebSocket` | Proxies 16 kHz PCM audio, text turns, tool calls/responses, and HITL updates to `gemini-3.8-live`. |

---

## CSV Import Formats

Accessible from **Khata & Stock → Import Data** (`src/components/CsvImportModal.tsx`):

- **Customers CSV:**
  ```csv
  name,phone,location,current_udhaar_balance,credit_limit
  Gupta Kirana Mart,+91 98110 22334,Chawri Bazaar Delhi,8500,50000
  ```
- **Inventory CSV** (pipe-delimited `aliases`):
  ```csv
  sku,name,unit,aliases,stock_qty,unit_price,reorder_threshold,supplier_name
  DAL_TOOR_30,Toor Dal Arhar (30kg),bori,toor dal|arhar dal|dal,32,3900,10,Mahalaxmi Pulses Mill
  ```

---

## Environment Variables

Configure via `.env` locally or Secrets / Environment Variables in Render, Cloud Run, and Netlify (see `.env.example`):

| Variable | Side | Purpose |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Server | **Required** for `/ws/live`, `/api/gemini-token`, `/api/sentiment/analyze`, and `/api/insights/generate`. Never exposed to the browser. |
| `PORT` | Server | HTTP + WebSocket port (defaults to `3000`; `8080` in `Dockerfile`). |
| `APP_URL` | Server | Hosted application base URL (optional). |
| `VITE_API_BASE_URL` | Client | Optional explicit backend URL when hosting static frontend separately (defaults to `https://bolkhata-live.onrender.com` on `*.netlify.app`). |

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Add your GEMINI_API_KEY in .env

# 3. Run full-stack Express + Vite dev server on port 3000
npm run dev

# 4. Typecheck & production build
npm run lint
npm run build
```

---

## Deployment Architecture

### Split Frontend (Netlify) + Backend (Render / Cloud Run)
1. **Backend (`Dockerfile` & `server.ts`):**
   - Uses `node:20-slim`, installs dependencies (`npm install --include=dev`), builds assets (`npm run build`), exposes port `8080`, and runs `npx tsx server.ts`.
   - Express `cors` middleware allows `https://boalkhata.netlify.app`, `https://netlify.app`, `*.netlify.app`, `https://bolkhata-live.onrender.com`, `*.run.app`, and `localhost` (`5173`, `3000`) with `OPTIONS` preflight support.
   - Set `GEMINI_API_KEY` in the Render / Cloud Run environment.
2. **Frontend (`netlify.toml` & `public/_headers`):**
   - Build command: `npm run build`, publish directory: `dist`.
   - Serves `Cross-Origin-Opener-Policy: same-origin-allow-popups` on `/*` to prevent `window.closed` COOP console errors during Google OAuth popup login.
   - Add `boalkhata.netlify.app` (bare hostname) under **Firebase Console → Authentication → Settings → Authorized domains** for project `numeric-dolphin-bds98`.

---

## Repository Structure

```text
.
├── Dockerfile                   # Container build for Render / Cloud Run (port 8080)
├── server.ts                    # Express API, CORS/COOP headers, and /ws/live Gemini proxy
├── netlify.toml                 # Netlify static COOP header configuration
├── public/_headers              # Static header rules copied into dist/
├── firebase-applet-config.json  # Firebase project & Firestore DB configuration
├── firebase-blueprint.json      # Firestore entity schemas and collection map
├── firestore.rules              # Owner-isolated Firestore security rules
├── package.json                 # Dependencies & scripts (dev, start, build, lint)
├── vite.config.ts               # Vite React + Tailwind CSS v4 configuration
└── src/
    ├── App.tsx                  # Auth, Firestore live listeners, header & tab routing
    ├── firebase.ts              # Firebase App, Auth, and Firestore initialization
    ├── types.ts                 # Shared TypeScript interfaces
    ├── hooks/
    │   └── useGeminiLiveVoice.ts
    ├── services/
    │   ├── backendConfig.ts     # API & WS URL resolution (local, VITE_API_BASE_URL, Netlify -> Render)
    │   ├── firestoreOps.ts      # Atomic Firestore transactions, seeding & CSV batch imports
    │   ├── geminiLiveClient.ts  # 16kHz AudioWorklet capture, 24kHz playback & barge-in client
    │   └── toolHandlers.ts      # Voice tool dispatcher with latency tracing
    └── components/
        ├── CounterWorkspace.tsx # Voice console, interactive transcripts, UPI QR & HITL cards
        ├── KhataInventoryView.tsx
        ├── CsvImportModal.tsx
        ├── ApprovalsHistoryView.tsx
        ├── PerformanceView.tsx  # Recharts latency, approval mix & ROI dashboard
        ├── InsightsAuditView.tsx
        ├── VoiceWaveform.tsx
        └── ErrorBoundary.tsx
```
