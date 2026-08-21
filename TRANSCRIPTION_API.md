# Transcription API

Speech-to-text API. A calling service sends audio (or an S3 reference) and gets a
transcript back — synchronously, or asynchronously via webhook/polling.

- **Base URL:** `https://YOUR_HOST` (local dev: `http://localhost:3005`)
- **Endpoint:** `POST /api/v1/transcription`
- **Auth:** `Authorization: Bearer <API_KEY>` (generate keys in Transcription Studio → API Keys)

## Choosing a shape

| Axis | Options |
|------|---------|
| **How audio is sent** | **Payload** (upload the file/bytes) or **S3** (send `bucket` + `key`; we fetch it) |
| **How you get the result** | **Sync** (transcript in the HTTP response) or **Async** (`mode:"async"` → job id now, result via webhook/polling) |

Common optional fields (multipart form fields or JSON keys): `language` (ISO code e.g. `hi`, `ta`; **omit or send `"auto"` for automatic language detection** — see §0), `webhookUrl`, `mode` (`sync` default | `async`).

---

## 0. Automatic language detection

`language` is **optional**. If you omit it (or send `"language": "auto"`), the engine
detects the spoken language before transcribing, restricted to the 22 official Indian
languages the transcription model supports:

```
as bn brx doi gu hi kn kok ks mai ml mni mr ne or pa sa sat sd ta te ur
```
(Assamese, Bengali, Bodo, Dogri, Gujarati, Hindi, Kannada, Konkani, Kashmiri, Maithili,
Malayalam, Manipuri, Marathi, Nepali, Odia, Punjabi, Sanskrit, Santali, Sindhi, Tamil,
Telugu, Urdu.)

> **Known gap:** Dogri (`doi`) is supported for **transcription** but is not
> distinguishable by the detector — pass `"language": "doi"` explicitly for Dogri audio.

Detection adds a small amount of latency and is not perfect for near-identical
languages from short/noisy audio (e.g. Hindi vs. Marathi vs. Dogri). **If you already
know the language, pass it explicitly** — it skips detection and is the most accurate
path.

Responses now include:
```json
{ "language": "hi", "languageDetected": true, "languageDetectionConfidence": 0.86 }
```
- `languageDetected: false` when you passed `language` explicitly (detection was skipped).
- `languageDetectionConfidence`: 0–1, present only when detection ran.

---

## 1. SYNC + Payload (multipart upload) — recommended default

Uploads the **actual audio bytes** in the request body.

```bash
curl -X POST https://YOUR_HOST/api/v1/transcription \
  -H "Authorization: Bearer sk_YOUR_KEY" \
  -F "file=@recording.mp3" \
  -F "language=hi"
```

Omit `-F "language=hi"` (or pass `-F "language=auto"`) to auto-detect the language instead — see §0.

**Response `200`:**
```json
{
  "id": "cmrvx9hh2000vv8x4ie485zuk",
  "text": "ये चार सौ उन्स्सी ...",
  "language": "hi",
  "languageDetected": false,
  "languageDetectionConfidence": null,
  "durationSec": 54.9,
  "segments": null,
  "usage": { "remainingRequests": 998, "remainingMinutes": 598.17 }
}
```
Response headers: `X-Job-Id`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`.

---

## 2. SYNC + Payload (JSON base64)

For programmatic callers that prefer JSON. Audio is base64-encoded in the body.

```bash
curl -X POST https://YOUR_HOST/api/v1/transcription \
  -H "Authorization: Bearer sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "audio": "<base64-encoded-audio-bytes>",
        "mimeType": "audio/mp3",
        "fileName": "recording.mp3",
        "language": "hi"
      }'
```

**Response `200`:** same shape as §1.

---

## 3. SYNC + S3 (send a reference, we fetch the audio)

Caller does **not** upload audio — just the bucket + object key. The platform reads
the object from S3 using the AWS credentials configured in Transcription Studio → S3 Access.

```bash
curl -X POST https://YOUR_HOST/api/v1/transcription \
  -H "Authorization: Bearer sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "source": "s3",
        "bucket": "my-bucket",
        "key": "path/to/recording.mp3",
        "language": "hi"
      }'
```

**Response `200`:** same shape as §1.

---

## 4. ASYNC (payload or S3) — returns immediately, result via webhook/polling

Add `"mode": "async"` (JSON) or `-F "mode=async"` (multipart). Best for long audio so
the caller isn't blocked. Requires the background worker to be running.

**Async + payload:**
```bash
curl -X POST https://YOUR_HOST/api/v1/transcription \
  -H "Authorization: Bearer sk_YOUR_KEY" \
  -F "file=@long-call.mp3" \
  -F "language=hi" \
  -F "mode=async" \
  -F "webhookUrl=https://caller-service/webhooks/transcription"
```

**Async + S3:**
```bash
curl -X POST https://YOUR_HOST/api/v1/transcription \
  -H "Authorization: Bearer sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "source": "s3",
        "bucket": "my-bucket",
        "key": "path/long-call.mp3",
        "language": "hi",
        "mode": "async",
        "webhookUrl": "https://caller-service/webhooks/transcription"
      }'
```

**Response `202`:**
```json
{
  "id": "cmrvx9hh2000vv8x4ie485zuk",
  "status": "queued",
  "statusUrl": "/api/v1/transcription/jobs/cmrvx9hh2000vv8x4ie485zuk"
}
```
The transcript is **not** in this response — collect it via the webhook (§5) or polling (§6).

---

## 5. WEBHOOK (async result push)

If `webhookUrl` is set (on the request or the API key), the platform **POSTs the result**
to that URL when the job finishes.

- Method: `POST` to your `webhookUrl`
- Headers: `Content-Type: application/json`, `User-Agent: chatbot-inference/1.0`, and — if a webhook secret is configured on the key — `Authorization: Bearer <rawSecret>`

**Webhook body — success:**
```json
{
  "executionId": "cmrvx9hh2000vv8x4ie485zuk",
  "status": "completed",
  "input":  { "fileName": "long-call.mp3", "mimeType": "audio/mp3" },
  "output": {
    "text": "…transcript…",
    "language": "hi",
    "durationSec": 54.9,
    "languageDetected": true,
    "languageDetectionConfidence": 0.86
  },
  "latencyMs": 799,
  "timestamp": "2026-07-22T09:16:39.728Z"
}
```
`languageDetected`/`languageDetectionConfidence` are present only when `language` was
auto-detected (see §0) — omitted if you passed an explicit `language`.

**Webhook body — failure:**
```json
{
  "executionId": "cmrvx9hh2000vv8x4ie485zuk",
  "status": "failed",
  "input": { "fileName": "long-call.mp3", "mimeType": "audio/mp3" },
  "error": "…reason…",
  "timestamp": "2026-07-22T09:16:39.728Z"
}
```

**Correlating each audio:** `executionId` is unique per audio and equals the `id`
returned at submit (§4). Store `your audio ↔ executionId` when you submit, then match on
`executionId` in the webhook.

**Verifying the token (Node example):**
```js
import crypto from 'crypto';
const token = (authorizationHeader || '').replace(/^Bearer\s+/, '');
const ok = Buffer.byteLength(token) === Buffer.byteLength(WEBHOOK_SECRET) &&
  crypto.timingSafeEqual(Buffer.from(token), Buffer.from(WEBHOOK_SECRET));
```
It's a static, unsigned token (no replay protection) — keep the endpoint on HTTPS and make handling idempotent on `executionId`.

---

## 6. POLL job status (async pull alternative)

```bash
curl https://YOUR_HOST/api/v1/transcription/jobs/cmrvx9hh2000vv8x4ie485zuk \
  -H "Authorization: Bearer sk_YOUR_KEY"
```

**Response `200`:**
```json
{
  "id": "cmrvx9hh2000vv8x4ie485zuk",
  "status": "queued | running | completed | failed",
  "source": "payload | s3",
  "text": "…transcript… (null until completed)",
  "language": "hi",
  "durationSec": 54.9,
  "output": { "languageDetected": true, "languageDetectionConfidence": 0.86 },
  "error": null,
  "latencyMs": 799,
  "createdAt": "2026-07-22T09:15:00.000Z",
  "completedAt": "2026-07-22T09:16:39.728Z"
}
```

---

## 7. Usage / quota

```bash
curl https://YOUR_HOST/api/v1/transcription/usage \
  -H "Authorization: Bearer sk_YOUR_KEY"
```

**Response `200`:**
```json
{
  "date": "2026-07-22",
  "requestCount": 4,
  "minutesCount": 3.7,
  "requestLimit": 1000,
  "minutesLimit": 600
}
```

---

## Errors

All errors use: `{ "error": { "type": "<type>", "message": "<detail>" } }`

| HTTP | `type` | Meaning |
|------|--------|---------|
| 401 | `invalid_api_key` | Missing/invalid/revoked/expired key |
| 429 | `quota_exceeded` | Daily request, daily audio-minute, or per-minute limit hit (includes `Retry-After` header) |
| 413 | `payload_too_large` | Audio exceeds the max size (default 50 MB) |
| 400 | `validation_error` | Malformed body / missing required field / empty audio |
| 502 | `transcription_error` | The model engine failed |

---

## Notes / limits

- **Max upload size:** ~50 MB per request (configurable). For larger/longer audio, prefer **S3 + async**.
- **Quotas** are per API key: requests/day, audio-minutes/day, requests/minute.
- **Audio formats:** decoded by content (wav, mp3, m4a, etc.) — the filename/extension is metadata only and does not affect decoding.
- **Language:** pass an ISO code (`hi`, `ta`, `bn`, …), or omit it / send `"auto"` to auto-detect — see §0.
- **Async** requires the background worker to be running; **webhook** requires a reachable `webhookUrl`.
