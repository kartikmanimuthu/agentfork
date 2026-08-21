# Transcription API — Integration Guide

Everything the web team needs to send us audio and get transcripts back: the upload/transcribe split, when to use sync vs. async, and how webhook delivery and signing work.

## Contents

1. [Mental model](#1-mental-model)
2. [Authentication & quotas](#2-authentication--quotas)
3. [Endpoint reference](#3-endpoint-reference)
4. [Sync vs. async](#4-sync-vs-async)
5. [Webhooks & authentication](#5-webhooks--authentication)
6. [Language detection & diarization](#6-language-detection--diarization)
7. [Defaults via Job Configs](#7-defaults-via-job-configs)
8. [Error reference](#8-error-reference)
9. [End-to-end walkthrough](#9-end-to-end-walkthrough)
10. [Gotchas & FAQ](#10-gotchas--faq)

---

## 1. Mental model

There are two APIs, not one. An **Upload API** puts audio into our storage and hands you back a reference. A **Transcription API** takes that reference (or the raw audio bytes directly) and runs it through the speech engine. You call the Upload API when it's convenient to separate "get the file to us" from "start transcribing it" — otherwise you can skip it and send the file inline in one call.

```
Your server            our S3                  Result
 (has audio)  ──POST──▶ staged  ──POST /transcription──▶ response
              /upload   (tenant-scoped)         { s3Key }        or webhook
```

Every transcription request also picks, independently, whether it runs **synchronously** (block and wait for the transcript) or **asynchronously** (get a job id immediately, collect the result later by polling or webhook). That choice is orthogonal to upload-vs-inline — you can mix any combination.

---

## 2. Authentication & quotas

Every request carries a Bearer API key issued from the dashboard (Transcription Studio → API Keys):

```
Authorization: Bearer tsk_live_...
```

The raw key is shown **exactly once**, at creation time — store it in your secrets manager immediately, we only keep a hash. Each key carries its own limits, enforced server-side on every request:

| Limit | Enforcement |
|---|---|
| `dailyReqLimit` | max requests per calendar day |
| `dailyMinutesLimit` | max audio-minutes transcribed per day |
| `minuteReqLimit` | max requests per rolling minute |

Exceeding any of these returns `429` with an `X-RateLimit-Remaining` header and (when applicable) `Retry-After`. Check current usage anytime:

```
GET /api/v1/transcription/usage
→ { date, requestCount, minutesCount, requestLimit, minutesLimit }
```

Keys can be revoked instantly or rotated with a 24-hour overlap window, so credential rotation doesn't require a synchronized cutover on your side.

---

## 3. Endpoint reference

### `POST /api/v1/transcription/get-presigned-url`  — Bearer key  ·  **recommended**

Step 1 of the two-step flow. Ask for a place to put the file; we return an **`uploadId`** plus a presigned POST policy. You then upload **directly to S3** — the bytes never pass through our servers.

```json
{ "fileName": "call.wav", "mimeType": "audio/wav", "clientReference": "recording_8891" }

→ 201
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "url": "https://<bucket>.s3.<region>.amazonaws.com/",
  "fields": { "key": "...", "Content-Type": "audio/wav", "Policy": "...",
              "X-Amz-Signature": "...", "success_action_status": "201", ... },
  "expiresAt": "2026-08-01T05:48:27Z",
  "maxBytes": 52428800,
  "clientReference": "recording_8891"
}
```

`mimeType` is required and must be an MP3 or WAV type. `fileName` and `clientReference` are optional.

**`uploadId` is the only identifier you need to keep.** Pass it to the Transcription API, receive it back on the webhook, and use it to fetch the transcript later. `clientReference` — your own id — is echoed back everywhere too, so you don't need a mapping table.

Then POST the file to S3 with every returned field, **`file` last**:

```
POST <url>                       (multipart/form-data — this goes to S3, not to us)
  ...all fields from "fields"...
  file: (binary audio)           <- must be the LAST field

→ 201 Created   with <PostResponse><Bucket/><Key/><ETag/></PostResponse>
```

That `201` from S3 **is** your confirmation the upload landed — you don't need to ask us. Failures come straight from S3: `400 EntityTooLarge` (over the cap), `400 EntityTooSmall` (empty), `403 AccessDenied` (wrong `Content-Type`, or the policy expired).

The policy's `content-length-range` and `Content-Type` conditions are enforced by S3 itself and covered by the signature — readable, but not raisable.

### `POST /api/v1/transcription/upload`  — Bearer key  ·  simpler alternative

Streams the audio through us instead. Simpler (one call, no separate upload step) but the whole file passes through our servers, so prefer the presigned route above at volume.

```
Content-Type: multipart/form-data
file: (binary audio)

→ 201
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "s3Key": "transcription/_uploads/<tenant>/8f2a-call.wav",
  "downloadUrl": "https://...",   // presigned, expires in 900s
  "expiresInSeconds": 900,
  "fileName": "call.wav",
  "mimeType": "audio/wav",
  "sizeBytes": 481203
}
```

Either upload style yields the same `uploadId`, so everything downstream is identical.

### `POST /api/v1/transcription`  — Bearer key

Step 2 — or the only step, if you send audio inline. Accepts three request shapes:

**A · Reference an upload (JSON)**

```json
{
  "s3Key": "transcription/_uploads/<tenant>/8f2a-call.wav",
  "sync": true,
  "webhookUrl": "https://you.example.com/hooks/transcription"
}
```

**B · Inline base64 (JSON)**

```json
{
  "audio": "UklGRi...",
  "mimeType": "audio/wav",
  "sync": false
}
```

**C · Inline multipart**

```
Content-Type: multipart/form-data
file: (binary audio)
sync: "true"
```

Optional fields, all three shapes:

| Field | Meaning |
|---|---|
| `sync` | default `true` — see [§4](#4-sync-vs-async) |
| `language` | omit for auto-detect — see [§6](#6-language-detection--diarization) |
| `diarize` | `true` for per-speaker segments — see [§6](#6-language-detection--diarization) |
| `webhookUrl` | overrides the key's default for this call only |
| `modelId` / `versionId` | override the key's configured engine — usually left unset, see [§7](#7-defaults-via-job-configs) |

**Sync response — `200`**

```json
{
  "id": "job_abc123",
  "text": "...full transcript...",
  "language": "hi",
  "languageDetected": true,
  "languageDetectionConfidence": 0.94,
  "durationSec": 42.1,
  "segments": null,
  "outputS3Key": "transcription/.../output.json",
  "usage": { "remainingRequests": 412, "remainingMinutes": 953.2 }
}
```

**Async response — `202`**

```json
{ "id": "job_abc123", "status": "queued", "statusUrl": "/api/v1/transcription/jobs/job_abc123" }
```

### `GET /api/v1/transcription/jobs/{id}`  — Bearer key

Poll a job's status — the companion to webhooks, and useful even in sync mode if you want to re-check a result later.

```json
{
  "id": "job_abc123",
  "status": "completed",
  "text": "...", "language": "hi", "durationSec": 42.1,
  "output": { "segments": [] },
  "error": null,
  "webhookStatus": "delivered",
  "webhookAttempts": 1,
  "createdAt": "...", "completedAt": "..."
}
```

`status` progresses `queued` → `running` → `completed` | `failed`. A key can only see jobs it created — a mismatched or unknown id returns `404`.

---

## 4. Sync vs. async

Both modes run the identical transcription pipeline. The only difference is *when and how you get the result*.

```
sync   ├───────────── request held open until transcript is ready ─────────────┤

async  ├─ 202 ─┤          engine runs in the background          ├─ webhook / poll ─┤
```

| | Use it when |
|---|---|
| `sync: true` (default) | short clips, a user is waiting on-screen, you want one request/response with nothing else to build |
| `sync: false` | longer audio, batch/bulk jobs, or anything where holding an HTTP connection open for the transcription's full duration is impractical |

> **Async engine failures never become an HTTP error** on your original call — that request already returned `202`. A failed transcription shows up as `status: "failed"` with an `error` message, delivered via webhook or discovered on poll. Sync failures, by contrast, come back as an immediate `502 transcription_error`.

---

## 5. Webhooks & authentication

### Registering one

Set a default `webhookUrl` on the API key itself (dashboard → API Keys → edit), or pass `webhookUrl` on any individual request to override it just for that call. Either way, before it'll fire you need a **secret**: click *Generate secret* on the key (or call `POST /api/transcription/api-keys/{id}/webhook-secret` from your own backend). The raw secret — prefixed `whsec_` — is shown **once**; we only ever store it. That's the whole "why register + generate a secret" answer: the URL says *where* to send results, the secret is what lets your endpoint prove a delivery genuinely came from us.

### What fires, and when

Exactly one delivery per job, on `completed` or `failed` — never on `queued`/`running`. If the first attempt doesn't get a 2xx back (timeout, 500, DNS failure, whatever), **we retry it automatically** on a backoff schedule — you don't need your own retry loop. Your endpoint should just be safe to receive the same job twice.

### Payload

```
POST https://you.example.com/hooks/transcription
Authorization: Bearer whsec_8fN2kQx...

{
  "executionId": "job_abc123",   // = the job id — ignore the misleading name
  "agentId": "",                // always blank here — ignore
  "status": "completed",        // or "failed"
  "output": { "text": "...", "language": "hi", "durationSec": 42.1 },
  "error": null,
  "latencyMs": 8120,
  "timestamp": "2026-07-28T..."
}
```

### Verifying the token

The secret is sent back as a static bearer token on every delivery. Compare it to the value you stored — no signing, no raw-body handling:

```js
// Node.js
const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');

const expected = Buffer.from(WEBHOOK_SECRET);
const got = Buffer.from(token);
if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
  throw new Error('bad token');
}
```

This is a static, unsigned credential — it proves the request came from someone holding your secret, but (unlike a timestamped signature) a captured request could in principle be resent. Keep your endpoint on HTTPS and make handling idempotent on `executionId` and this doesn't matter in practice.

> **Your receiving URL must be publicly reachable** over http/https — we actively block localhost, private IP ranges, and cloud metadata addresses as an SSRF guard. A tunnel with a real public hostname (ngrok, etc.) is fine for testing; a bare LAN IP is not.

---

## 6. Language detection & diarization

### Language

Leave `language` out entirely to auto-detect the spoken language. The response tells you what happened: `languageDetected: true` plus a `languageDetectionConfidence` (0–1). If you already know the language, pass a hint (`"hi"`, `"ta"`, `"te"`, ...) to skip detection — faster, and often more accurate on short or noisy clips. Auto-detect and language hints are restricted to the 22 official Indian languages the engine supports (see §0 of TRANSCRIPTION_API.md) — English is not one of them.

### Diarization

Pass `diarize: true` to get a `segments` array back — `{ start, end, text, speaker }` per turn, with speakers labeled `SPEAKER_00`, `SPEAKER_01`, etc. — in both the sync response and the webhook `output`.

> **Diarization only runs on our self-hosted engine.** If a tenant's Transcription Studio model points at a plain OpenAI-compatible endpoint instead, `diarize: true` is silently ignored — no error, you just won't see a `segments` array. Worth knowing before chasing a "diarization isn't working" report against the wrong engine.

---

## 7. Defaults via Job Configs

An Owner/Admin can bundle a chosen model + version + defaults (`language`, `diarize`, etc.) into a named, versioned **Job Config** in the dashboard, then attach an API key to it. Any field a request omits — `modelId`, `versionId`, `language`, `diarize` — falls back to that key's Job Config. In practice this means your integration code can often be as small as "send audio, pick sync/async, optionally set a webhook" — the engine choice and language/diarize defaults live entirely on the platform side and can change without a code deploy on your end.

---

## 8. Error reference

Every error comes back as `{ "error": { "type": "...", "message": "..." } }` on these endpoints.

| Status | `type` | Meaning |
|---|---|---|
| 400 | `validation_error` | malformed request — missing field, bad content-type, etc. |
| 401 | `invalid_api_key` | missing / unknown / revoked / expired key |
| 403 | `validation_error` | referenced `s3Key` doesn't belong to your tenant |
| 404 | `not_found` | unknown job id, or it belongs to a different key |
| 413 | `payload_too_large` | audio exceeds the configured max (50MB by default) |
| 429 | `quota_exceeded` | a rate/quota limit was hit — see `Retry-After` |
| 502 | `transcription_error` | the engine itself failed (sync mode only) |
| 500 | `internal_error` | unexpected server-side failure — safe to retry |

---

## 9. End-to-end walkthrough

### Synchronous, inline audio

```bash
curl -X POST https://app.example.com/api/v1/transcription \
  -H "Authorization: Bearer $TSK" \
  -F "file=@call.wav" \
  -F "sync=true"
# → 200, transcript in the response body, done.
```

### Asynchronous, via upload + webhook

```bash
# 1. stage the file
curl -X POST .../upload -H "Authorization: Bearer $TSK" -F "file=@interview.wav"
# → { s3Key: "transcription/_uploads/..." }

# 2. trigger transcription against it, async, with a webhook
curl -X POST .../transcription -H "Authorization: Bearer $TSK" \
  -H "Content-Type: application/json" \
  -d '{"s3Key":"transcription/_uploads/...","sync":false,"webhookUrl":"https://you.example.com/hooks/transcription"}'
# → 202 { id: "job_...", statusUrl: "..." }

# 3a. do nothing — your /hooks/transcription endpoint gets POSTed the result, or
# 3b. poll if you'd rather not run a public endpoint yet:
curl .../transcription/jobs/job_... -H "Authorization: Bearer $TSK"
```

---

## 10. Gotchas & FAQ

**When should we bother with the Upload API instead of sending audio inline?**
Small, one-off files: send them inline (multipart or base64) directly on the Transcription API and skip Upload entirely. Reach for the two-step Upload flow when files are large, when upload and "start transcribing" happen at different times or different parts of your system (e.g. a browser uploads directly, your backend triggers transcription later), or when you want to try the same audio against more than one config without re-sending bytes.

**What happens to an uploaded file that's never transcribed?**
There's currently no automatic expiry job for a staged upload that never gets referenced by a transcription call. Treat that as your integration's responsibility for now — don't stage files you might not use.

**Do we need to build our own webhook retry logic?**
No — failed deliveries are retried on our side automatically. Just make your endpoint idempotent (safe to process the same `executionId` twice) and make sure it responds fast; do slow work asynchronously after acknowledging.

**Why is `sync` true by default?**
So a bare minimal request (no `sync` field at all) behaves predictably: send audio, get a transcript back, nothing else to configure. Set `sync: false` explicitly to opt into the async flow.

---

*Internal integration reference for the Transcription Studio API (`/api/v1/transcription/*`). Reflects the routes and services as implemented — update alongside API changes.*
