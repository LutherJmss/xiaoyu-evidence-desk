# Xiaoyu Evidence Desk 小羽·可信文档核验助手

> `$ verify --every-claim --show-source`

Paste a notice (a competition announcement, a scholarship call, a job post). **Clocked Extract** pulls out the facts you choose, and the app marks **where each value sits in the original text**. Then type what you *think* the notice says, and **Clocked Grounding** checks that claim against the text and shows the passage it rests on. Anything that doesn't match the source is flagged, never smoothed over.

**Demo video (1:42, real API calls):** https://drive.google.com/file/d/1u0xVbAgwVfKjGgrmHzL2igsXkge_FkWh/view

Built for the Clocked Build Challenge (Oct 21 – Nov 10, 2026). First prototype written 2026-10-27. Terminal / hacker-blog styled UI, no external fonts or scripts.

## What Clocked does in the app

**1. Extract → annotated source.** Five default fields (deadline, team rule, age requirement, rewards, required materials), or up to 12 of your own (`fields.conf`). For each field the app uses `value`, `start`, `end` and `confidence`, re-checks the offsets, and colours every verified span in the full text:

| Label | Meaning |
|---|---|
| `EXACT` | `text.slice(start, end)` equals the value; solid underline |
| `LOCAL` | offsets missing or wrong, but the value appears verbatim; we found it, not the API; dashed underline |
| `UNVERIFIED` | the value is not in the source; never shown as a quote |
| `NULL` | Clocked returned null; the app shows its confidence that the field is blank and does not guess |

**2. Grounding → claim check.** The notice is sent as the only document and your sentence as the answer (`evidence: 'all'`). Each claim shows supported / contradicted / not-stated probabilities as bars, the verdict, and its evidence passage, which is also re-checked against the source.

**3. Trace + export.** A `trace.log` panel records every request: endpoint, HTTP status, model, model time, round trip, idempotency key prefix, calls used. Results export to JSON or Markdown with evidence labels and quotes.

Safety and cost:
- The API key stays on the local server (`.env`); the browser never sees it. The server listens on 127.0.0.1 only.
- Every request carries an idempotency key that is reused on retry, so a timed-out request is not charged twice; `maxAttempts: 1`; a per-start cap on real calls (`LIVE_REQUEST_LIMIT`, default 3).
- Without a key, real mode returns HTTP 412 instead of quietly showing sample data. `replay --synthetic` replays a fixed made-up notice, labelled `SYNTHETIC · 非 API 结果`, with no API call.

## Run it

Requires Node.js 20+.

```bash
npm install
npm test            # offline, no API calls
cp .env.example .env   # Windows PowerShell: Copy-Item .env.example .env
# put your key after CLOCKED_API_KEY= in .env
npm start           # http://127.0.0.1:3000
```

Behind an HTTP proxy, set `HTTPS_PROXY` and start with `node --use-env-proxy server.mjs` (Node 24+); Node does not use the OS proxy settings by default.

`npm run smoke` runs `index.mjs`, the original one-request Extract test from 2026-10-27.

## Tests

`npm test` runs 15 offline tests (Node's built-in runner): offset verification and downgrades, unverified and null values, custom-field validation, grounding passage re-checks, key redaction, a readable message for Cloudflare blocks, the synthetic sample label, fail-closed without a key, idempotency-key validation, and both adapters (Extract, Grounding) against **hand-written fake responses shaped like the SDK 0.4.0 types** (not real API responses). Real API behaviour is verified separately by running the app with a key.

## Limitations

- Single document, up to 12 fields, Chinese/English text up to 20,000 characters.
- Offsets are compared as JavaScript string indices; characters outside the Basic Multilingual Plane (e.g. some emoji) could shift positions.
- Runs locally only; there is no hosted version.
- Results are an aid for human review, not legal or eligibility advice.

## History

- 2026-10-27: original prototype (`index.mjs`, `server.mjs`, `public/index.html`) — first real Extract call and a basic web page. Imported into git on 2026-11-10 (it had no git before).
- 2026-11-08: a separate reference implementation explored evidence verification, export and tests.
- 2026-11-10: merged those ideas into this project; first real Extract call from the merged app (HTTP 200, clocked-1.0); added custom fields, Grounding claim check, annotated view and the terminal UI.

Parts of the code were written with AI coding assistants, which the challenge allows.

## License

MIT
