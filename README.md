# Xiaoyu Evidence Desk 小羽·可信文档核验助手

Paste a notice (a competition announcement, a scholarship call, a job post). **Clocked Extract** pulls out five things people most often miss — deadline, team rule, age requirement, rewards, required materials — and the app shows **where each value sits in the original text**, so you check the source instead of trusting a summary.

Built for the Clocked Build Challenge (Oct 21 – Nov 10, 2026). First prototype written 2026-10-27.

## How Clocked changes what the app shows

The app calls the Extract endpoint (`clocked-sdk@0.4.0`) and uses each field's `value`, `start`, `end` and `confidence`. Every value gets one of four evidence labels:

| Label | Meaning |
|---|---|
| **API exact position** (green) | `text.slice(start, end)` equals the value, so the source span is highlighted |
| **Local text match** (amber) | offsets missing or wrong, but the value appears verbatim; we found it, not the API, and say so |
| **Not found / unverified** (red) | the value does not appear in the source; never shown as a quote |
| **Not in source** | Clocked returned null (with its confidence that the field is blank); the app does not guess |

Click a field to see its span highlighted in context. Export the result as JSON or Markdown.

Other details:
- The API key stays on the local server (`.env`); the browser never sees it.
- Each request carries an idempotency key, reused on retry, so a timed-out request is not charged twice. `maxAttempts: 1`, and a per-start cap on real calls (`LIVE_REQUEST_LIMIT`, default 3).
- Without a key, real mode returns an error (HTTP 412) instead of quietly showing sample data.
- A separate **synthetic sample** button replays a fixed made-up notice for offline preview. It is labelled "合成示例 · 非 API 结果" and makes no API call.

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

`npm test` runs 11 offline tests (Node's built-in runner): offset verification, downgrade of wrong offsets, unverified values, missing fields, key redaction, readable Cloudflare-block message, the synthetic sample label, fail-closed without a key, idempotency-key validation, and the adapter against a **hand-written fake response shaped like the SDK 0.4.0 types** (not a real API response). Real API behaviour is verified separately by running the app with a key.

## Limitations

- Single document, five fixed fields, Chinese/English text up to 20,000 characters.
- Offsets are compared as JavaScript string indices; characters outside the Basic Multilingual Plane (e.g. some emoji) could shift positions.
- Runs locally only; there is no hosted version.
- Results are an aid for human review, not legal or eligibility advice.

## History

- 2026-10-27: original prototype (`index.mjs`, `server.mjs`, `public/index.html`) — first real Extract call and a basic web page. Imported into git on 2026-11-10 (it had no git before).
- 2026-11-08: a separate reference implementation explored evidence verification, export and tests.
- 2026-11-10: merged those ideas into this project.

Parts of the code were written with AI coding assistants, which the challenge allows.

## License

MIT
