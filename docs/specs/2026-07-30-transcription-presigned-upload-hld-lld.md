# Transcription Studio — Presigned Upload & Stable Identifier (HLD + LLD)

**Feature:** Direct-to-S3 presigned upload, opaque `uploadId` identifier, transcript retrieval API
**Version:** 1.0 (Revised design)
**Status:** Draft — for review before implementation
**Date:** 2026-07-30
**Branch / commit of record:** `feature/transcribing-studio` @ `1e5fe1c`
**Related docs:** `docs/product/PRD-Transcription-API.md`, `docs/transcription-api-integration-guide.md`, `docs/transcription-api-request-response-reference.md`, `TRANSCRIPTION_API.md`

---

## 0. Purpose & Scope

Today a caller uploads audio *through* our API (`multipart/form-data` → our server buffers the whole file → we write it to S3). This document specifies the revised design where:

1. The caller asks us for a **presigned PUT URL** and uploads the bytes **directly to S3**, bypassing our servers.
2. Every upload is identified by a short, stable, opaque **`uploadId`** that the caller holds from the very first call and which appears in every later response, including the webhook.
3. A new authenticated **GET endpoint** returns the transcript for a given `uploadId`, scoped so only the owning tenant can read it.

All references to existing code are real paths as of `1e5fe1c`. Proposed additions follow the conventions already in the repo: string-valued status fields (not Prisma enums), `cuid()` ids, `@@map()` to snake_case, tenant-scoped composite indexes, class-based services with an injected Prisma client, Zod validation at every boundary, Pino structured logging, T3 Env for config.

**Out of scope (explicitly parked, see §11):** the pg-boss per-request lifecycle problem and the sync-mode GPU concurrency gap. Both are real and documented, but deferred until the module is built.

---

# PART A — HIGH LEVEL DESIGN

## 1. Problem Statement

### 1.1 What is wrong with the current flow

| Problem | Consequence |
|---|---|
| Whole file buffered in our process (`Buffer.from(await file.arrayBuffer())` in `apps/web-ui/app/api/v1/transcription/upload/route.ts`) | Memory scales with file size × concurrency; our API is a throughput bottleneck for a transfer that adds no value |
| The caller-facing identifier is `s3Key`, and **`s3Key` is destroyed during processing** | `dispatchUploadedTranscription` calls `moveObject(staging → job folder)` then overwrites `TranscriptionJob.s3Key`. The key the caller holds no longer exists in S3 and is in no DB column — it survives only inside the webhook body |
| `s3Key` contains `/` and embeds our internal layout + `tenantId` | Cannot be a URL path segment; leaks storage structure into a permanent public contract |
| No DB record exists at upload time | No way to validate, tenant-scope, deduplicate, or garbage-collect an upload |

### 1.2 Why not use the presigned URL as the identifier

Considered and rejected. The decisive reasons:

- **Not stable.** The signature embeds a timestamp, access-key id, and session token. Regenerating a URL for the *same* object yields a completely different string, so equality-based lookup is unsound.
- **~2 KB per URL.** Our own captured URLs run close to 2,000 chars (the `X-Amz-Security-Token` alone is ~900). PostgreSQL's btree index entry ceiling is ≈2,704 bytes, so a unique index on that column sits at the limit and will fail outright on longer tokens.
- **Carries credential material** (`X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-Signature`). As the identifier it would land in both parties' logs and databases — and, per the requirement that the identifier be echoed back, inside **every webhook payload**.
- **Redundant.** The URL's path already *contains* the S3 key; everything else is noise or secrets.

## 2. Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Introduce an opaque **`uploadId`** (`cuid()`) as the single caller-facing identifier | Short, fixed-length, safe in a URL path or query string, cheap to index uniquely, leaks nothing, and stable because it is a primary key that never moves |
| D2 | Introduce a **`TranscriptionUpload`** table representing an upload intent | Gives `uploadId` somewhere to live, and simultaneously solves tenant scoping, idempotency, and orphan tracking |
| D3 | Store `uploadId` as an **FK on `TranscriptionJob`**; the immutable original key lives on the upload row | Correct normalisation. Avoids duplicating the key onto the job, and inherently fixes the "key gets overwritten" defect — nothing mutates the upload row's `s3Key` |
| D4 | Accept an optional **`clientReference`** and echo it everywhere | Lets the caller use *their own* id (e.g. `recording_8891`) end-to-end and keep no mapping table at all |
| D5 | Keep the existing multipart upload endpoint, and make it **also** mint a `TranscriptionUpload` row | One identifier concept regardless of upload style; no breaking change for existing callers |
| D6 | Enforce size/existence at **transcribe** time via `HeadObject`, not upload time | A presigned PUT cannot cap size. Checking on the transcribe call is before any GPU spend, and the call already exists in this path |
| D7 | `s3Key` stays in responses as **informational only** | Useful for support/debugging; ceases to be the thing anyone keys on |

## 3. Component Map

```
 ┌─────────┐  1. POST /get-presigned-url {fileName, mimeType, clientReference?}
 │ Caller  │ ─────────────────────────────────────────────────────────▶ ┌──────────────────────────┐
 │ backend │ ◀───────────── {uploadId, uploadUrl, expiresAt, s3Key} ─── │  Upload/Presign Route    │
 └────┬────┘                                                            │  (NEW endpoint)          │
      │                                                                 │  → TranscriptionUpload   │  ── writes ──▶ ┌──────────┐
      │ 2. PUT bytes  (Content-Type must match signature)               │    status='pending'      │                │ Postgres │
      │    ─────────────────────────────────────────────▶ ┌──────┐      └──────────────────────────┘                └────┬─────┘
      │    ◀──────────── 200 OK + ETag ─────────────────  │  S3  │        (no bytes through our API)                     │
      │       caller now knows the upload landed          └──▲───┘                                                       │
      │                                                     │                                                           │
      │ 3. POST /transcription {uploadId, sync|async, ...}   │                                                           │
      │ ───────────────────────────────────────────────────────────────▶ ┌──────────────────────────┐                    │
      │                                                     │           │  Transcription Route     │                    │
      │                                                     │           │  auth → quota → resolve  │ ◀──────────────────┘
      │                                                     │           │  upload → HeadObject     │
      │                                                     │           │  → idempotency check     │
      │                                                     │           └────────┬─────────────────┘
      │                                                     │                    │
      │   sync ◀── 200 {transcript, uploadId, clientRef} ───────────────────────┤
      │   async ◀─ 202 {transcriptionId, uploadId, clientRef, statusUrl} ───────┤
      │                                                     │                    │ async
      │                                                     │                    ▼
      │                                                     │        ┌────────────────────────────┐
      │                                                     │        │ pg-boss 'transcription'    │
      │                                                     │        │ batchSize:1 (serialised)   │
      │                                                     │        └────────────┬───────────────┘
      │                                                     │                     ▼
      │                                                     │        ┌────────────────────────────┐
      │                                                     └────────│ executeTranscription       │
      │                                                   GetObject  │ → GPU engine → S3 output   │
      │                                                              └────────────┬───────────────┘
      │ 4. webhook POST {uploadId, clientReference, transcript|error}             │
      │ ◀────────────────────────────────────────────────────────────────────────┘
      │       Authorization: Bearer <webhookSecret>
      │
      │ 5. GET /transcripts?uploadId=...   (any time later, tenant-scoped)
      └───────────────────────────────────────────────────────────────▶ Transcript Retrieval Route (NEW)
```

## 4. Identifier Contract

One id, present from the first call, unchanged throughout:

| Step | Caller sends | Caller receives |
|---|---|---|
| Presign | `fileName`, `mimeType`, `clientReference?` | **`uploadId`**, `uploadUrl`, `expiresAt`, `s3Key` (info) |
| PUT to S3 | file bytes | S3 `200` + `ETag` — **self-service confirmation, no call to us** |
| Transcribe | `uploadId` | sync: transcript + `uploadId`; async: `transcriptionId` + `uploadId` + `statusUrl` |
| Webhook | — | `uploadId`, `clientReference`, `executionId`, transcript/segments or `error` |
| GET transcript | `uploadId` | status, transcript, segments, `clientReference` |

**Answering the recurring question directly:** the caller does *not* need an API from us to know whether the upload succeeded. A presigned PUT is a plain synchronous HTTP request — S3 replies `200` with an `ETag` on success or a 4xx/5xx XML error on failure, in that same request. We independently confirm arrival at transcribe time via `HeadObject`.

## 5. Upload Lifecycle

```
   presign issued                transcribe called                 job completes
        │                              │                                │
        ▼                              ▼                                ▼
   ┌─────────┐   HeadObject ok    ┌──────────┐    job finishes    ┌───────────┐
   │ pending │ ─────────────────▶ │ consumed │ ─────────────────▶ │ (terminal)│
   └────┬────┘                    └──────────┘                    └───────────┘
        │
        │ expiresAt passed, never transcribed
        ▼
   ┌─────────┐
   │ expired │  ── swept by cron + S3 lifecycle rule
   └─────────┘
```

**Honest limitation:** without S3 event notifications we cannot distinguish *"uploaded but not yet transcribed"* from *"never uploaded"*. Both look like `pending`. We only learn the object exists when transcribe runs `HeadObject`. Adding an S3 → EventBridge notification to flip `pending → uploaded` is a worthwhile later enhancement but is **not required** for this design, because the caller already has S3's own `200` as proof.

---

# PART B — LOW LEVEL DESIGN

## 6. Data Model

### 6.1 `TranscriptionUpload` — NEW

```prisma
model TranscriptionUpload {
  id               String    @id @default(cuid())   // the caller-facing uploadId
  tenantId         String
  apiKeyId         String
  s3Key            String    @unique                // IMMUTABLE. never rewritten.
  fileName         String
  mimeType         String
  declaredSizeBytes Int?                            // optional client hint
  actualSizeBytes  Int?                             // from HeadObject at transcribe time
  clientReference  String?                          // caller's own id, echoed back
  status           String    @default("pending")    // pending | consumed | expired
  expiresAt        DateTime                         // presign expiry
  consumedAt       DateTime?
  createdAt        DateTime  @default(now())

  tenant      Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  apiKey      TranscriptionApiKey  @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)
  jobs        TranscriptionJob[]

  @@index([tenantId, createdAt])
  @@index([tenantId, clientReference])
  @@index([status, expiresAt])                      // for the expiry sweep
  @@map("transcription_uploads")
}
```

Notes:
- `s3Key @unique` is safe here precisely because this row's `s3Key` is never mutated (unlike `TranscriptionJob.s3Key`).
- `status` is a plain `String`, matching the repo's existing convention (`TranscriptionJob.status`, `TranscriptionApiKey.status`).

### 6.2 `TranscriptionJob` — one added column

```prisma
model TranscriptionJob {
  // ... all 27 existing columns unchanged ...
  uploadId  String?                                 // NEW — FK to the upload intent

  upload    TranscriptionUpload? @relation(fields: [uploadId], references: [id], onDelete: SetNull)

  @@index([tenantId, uploadId])                     // NEW — backs the GET endpoint
}
```

`uploadId` is nullable because `source: 'payload'` jobs (inline base64 / direct multipart to the transcription API) have no upload row.

**Deliberately *not* adding `uploadS3Key` to the job.** An earlier iteration proposed that; with the upload table it would be denormalised duplication. The immutable key lives on exactly one row.

### 6.3 Migration

`bunx prisma db push` for local, then `bunx prisma migrate dev`. Purely additive — one new table, one nullable column, two new indexes. No backfill required; pre-existing jobs simply have `uploadId = null` and remain reachable by `transcriptionId`.

## 7. API Surface

### 7.1 `POST /api/v1/transcription/get-presigned-url` — NEW (presign)

Auth: `Authorization: Bearer <transcription API key>` → `validateTranscriptionApiKey` (existing helper, `apps/web-ui/app/api/v1/transcription/lib/auth.ts`).

Request:
```json
{
  "fileName": "call-recording.wav",
  "mimeType": "audio/wav",
  "clientReference": "recording_8891",
  "expiresInSeconds": 3600
}
```

Zod: `fileName` non-empty ≤255; `mimeType` non-empty (must match an allow-list of audio types); `clientReference` optional ≤255; `expiresInSeconds` optional int, **clamped server-side to [300, 3600]**.

Response `201`:
```json
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "uploadUrl": "https://<bucket>.s3.<region>.amazonaws.com/transcription/_uploads/...?X-Amz-...",
  "method": "PUT",
  "headers": { "Content-Type": "audio/wav" },
  "expiresInSeconds": 3600,
  "expiresAt": "2026-07-30T13:45:00.000Z",
  "s3Key": "transcription/_uploads/{tenantId}/{uuid}-call-recording.wav",
  "clientReference": "recording_8891"
}
```

Implementation:
1. Derive `tenantId`/`apiKeyId` from the API key — **never** accept a client-supplied path or tenant.
2. Build the key using the existing convention: `transcription/_uploads/${tenantId}/${crypto.randomUUID()}-${safeName}` where `safeName = fileName.replace(/[^\w.\-]+/g, '_').slice(-120)`.
3. `await new S3Service().getUploadUrl(s3Key, mimeType, expiresInSeconds)` — **this method already exists** (`libs/shared/src/services/s3-service.ts:38`) and pins `ContentType` into the signature.
4. Insert the `TranscriptionUpload` row with `status: 'pending'`.
5. Apply quota to this endpoint (see §9).

> **Caller gotcha to document loudly:** because `getUploadUrl` signs `ContentType`, the PUT **must** send exactly `Content-Type: audio/wav` (the value returned in `headers`). A mismatched or omitted header makes S3 reject the PUT with `403 SignatureDoesNotMatch`.

### 7.2 `POST /api/v1/transcription` — extended

Existing accepted shapes (multipart file, JSON `audio` base64, JSON `s3Key`/`s3Url`) are unchanged. One new shape:

```json
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "sync": false,
  "diarize": true,
  "language": "en",
  "webhookUrl": "https://you.example.com/hooks/transcription"
}
```

Resolution order for the audio source becomes: `uploadId` → `s3Key`/`s3Url` → `audio` → multipart `file`.

New pre-flight sequence when `uploadId` is present:

| Step | Action | Failure response |
|---|---|---|
| 1 | `findFirst({ where: { id: uploadId, tenantId } })` | `404 upload_not_found` (tenant mismatch is indistinguishable from absent — deliberate) |
| 2 | If `status === 'consumed'` → **idempotent return** of the existing job for this upload | — (returns `200`/`202` as if first call) |
| 3 | If `status === 'expired'` | `410 upload_expired` |
| 4 | `HeadObject(upload.s3Key)` → not found | `409 upload_incomplete` — *"no object at this key; confirm your PUT returned 200 before calling transcribe"* |
| 5 | `ContentLength > TRANSCRIPTION_MAX_AUDIO_MB` | `413 payload_too_large` |
| 6 | Persist `actualSizeBytes`, create job with `uploadId`, set upload `status='consumed'`, `consumedAt=now()` | — |

Steps 1 and 6 together replace the current string-prefix tenant guard (`s3Key.startsWith('transcription/_uploads/{tenantId}/')` in `route.ts`) with a real column check for the `uploadId` path. The prefix guard **stays** for the legacy `s3Key`/`s3Url` path.

Response `202` (async) gains two fields:
```json
{
  "transcriptionId": "cms745j100003v8dcn8dv4dkf",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "queued",
  "statusUrl": "/api/v1/transcription/jobs/cms745j100003v8dcn8dv4dkf"
}
```
`id` is retained as an alias of `transcriptionId` for back-compat.

### 7.3 `GET /api/v1/transcription/transcripts` — NEW

Query params (exactly one required): `uploadId` **or** `transcriptionId`. Optionally `clientReference`.

> Query params, not a path segment — an `s3Key` contains `/` and cannot be a path param, and even for `uploadId` a query param keeps the two lookup modes symmetrical.

Auth: Bearer API key → `tenantId`.

Query: `WHERE tenantId = ? AND (uploadId = ? | id = ?)`.

Response `200`:
```json
{
  "transcriptionId": "cms745j100003v8dcn8dv4dkf",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "completed",
  "fileName": "call-recording.wav",
  "language": "en",
  "durationSec": 54.9,
  "transcript": "...",
  "segments": [ { "start": 0.03, "end": 3.2, "speaker": "Speaker 1", "text": "..." } ],
  "languageDetected": true,
  "languageDetectionConfidence": 0.86,
  "createdAt": "2026-07-30T06:09:15.156Z",
  "completedAt": "2026-07-30T06:09:40.274Z"
}
```

- `queued`/`running` → same envelope with `transcript: null`, `status` reflecting progress.
- `failed` → `error` populated, no `output`/`segments`.
- **Large transcripts:** if `transcript` exceeds a threshold (~256 KB), return `transcriptUrl` — a presigned GET (900 s) to the already-persisted `outputS3Key` — instead of inlining. The output JSON is already written by `executeTranscription` to `transcription/{tenantFolder}/{jobId}/output/output.json`, so this needs no new storage.
- **404, never 403,** when the row belongs to another tenant, so the endpoint cannot be used to confirm existence of other tenants' ids.

### 7.4 Webhook payload — two added fields

`WebhookPayload` (`libs/shared/src/services/webhook-service.ts`) is shared with Agent Inference, so both fields are **optional**:

```ts
uploadId?: string;
clientReference?: string;
```

Set by `executeTranscription` on both the success and failure paths (which already carry `input.s3Key` from earlier work). Delivery continues via `deliverWithToken()` — static bearer token, no HMAC.

Success body (diarized), abbreviated:
```json
{
  "executionId": "cms745j100003v8dcn8dv4dkf",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "completed",
  "input": { "fileName": "...", "mimeType": "audio/wav", "s3Key": "transcription/_uploads/..." },
  "output": { "text": "...", "language": "en", "durationSec": 54.9, "segments": [ ... ] },
  "cacheHit": false, "latencyMs": 14493, "timestamp": "..."
}
```

Failure body: identical minus `output`, plus `"error": "..."`. `segments` never appears on failure regardless of `diarize`.

### 7.5 `POST /api/v1/transcription/upload` — retained, lightly extended

The existing multipart endpoint keeps working. It additionally creates a `TranscriptionUpload` row (`status: 'consumed'` immediately if `autoTranscribe=true`, else `'pending'`) and returns `uploadId` alongside today's fields. This is what makes the identifier story uniform across both upload styles.

## 8. Service Layer Changes

| File | Change |
|---|---|
| `libs/shared/src/services/transcription-upload-service.ts` | **NEW.** `TranscriptionUploadService` — class-based, injected Prisma, tenant-scoped constructor (mirrors `TranscriptionJobConfigService`). Methods: `createPresigned()`, `findById()`, `markConsumed()`, `markExpiredBatch()`. |
| `libs/shared/src/services/s3-service.ts` | Add `headObject(key): Promise<{ contentType, contentLength } \| null>`. The existing `headContentType` returns **only** `ContentType` (line 90) and cannot enforce size — keep it for back-compat, implement it in terms of the new method. |
| `libs/shared/src/services/transcription-dispatch.ts` | Accept `uploadId` in params; pass it to `jobService.create()`. The `moveObject` + `s3Key` overwrite behaviour is **left exactly as-is** — it is now harmless because the immutable key lives on the upload row. |
| `libs/shared/src/services/transcription-runner.ts` | Thread `uploadId`/`clientReference` into both webhook payloads. |
| `libs/shared/src/services/transcription-job-service.ts` | `CreateTranscriptionJobInput` gains `uploadId?: string \| null`. |
| `libs/shared/src/index.ts` | Export the new service + types. |
| `apps/workers/src/jobs/transcription/schema.ts` | Job payload gains `uploadId`, `clientReference` (both nullable/optional, matching the existing style). |
| `apps/workers/src/jobs/transcription/handler.ts` | Forward the two new fields into `executeTranscription`. |
| `apps/workers/src/jobs/transcription-webhook-retry/handler.ts` | Include `uploadId`/`clientReference` on redelivery (read via the job's `upload` relation). |

## 9. Configuration

| Env var | Current | Action |
|---|---|---|
| `TRANSCRIPTION_MAX_AUDIO_MB` | declared in `libs/shared/src/env.ts:46` with **default 25**; *not set* in `.env` (only commented in `.env.example:129`) | ⚠️ The effective limit today is **50 MB, not 30 MB**. If 30 MB is intended, set it explicitly in `.env`. Enforced at transcribe time per §7.2 step 5. |
| `TRANSCRIPTION_UPLOAD_URL_TTL_SECONDS` | — | **NEW.** Default 3600, clamp [300, 3600]. Used by the presign endpoint. |
| `TRANSCRIPTION_UPLOAD_RETENTION_DAYS` | — | **NEW.** Default 7. Drives the expiry sweep and the S3 lifecycle rule. |

All three go through the T3 Env object — never `process.env` directly.

## 10. Hygiene: Orphans & Retention

**Orphan uploads** (presign issued, bytes possibly uploaded, transcribe never called) are a new failure mode: with presign there is no reason to assume follow-through, and the bytes are PII audio sitting in our bucket. Two layers:

1. **S3 lifecycle rule** on prefix `transcription/_uploads/` expiring objects after `TRANSCRIPTION_UPLOAD_RETENTION_DAYS`. This is the actual storage reclaim.
2. **pg-boss cron job** (`transcription-upload-expiry`, daily) flipping `status: 'pending' → 'expired'` for rows past `expiresAt`, backed by the `@@index([status, expiresAt])`. This keeps the DB truthful so the `410 upload_expired` response in §7.2 is accurate rather than a lie inferred from a timestamp.

**Transcript retention** must be decided before the GET endpoint ships, since "fetch it any time later" currently implies indefinite retention of both transcript text and source audio. Recommend an explicit tenant-configurable window, documented in the integration guide. **Open question — see §13.**

## 11. Parked Pre-existing Issues

Documented here so they are not lost, but **not addressed by this design**:

1. **pg-boss lifecycle per request** — `createBoss()` → `start()` → `send()` → `stop()` runs on every async submission (`route.ts`, `transcription-dispatch.ts`). `start()` builds a connection pool and runs schema checks; at high concurrency this will exhaust Neon connections. Fix is a module-level singleton started once. **This is the single biggest risk to any high-concurrency test** and should be the first thing done after this module lands.
2. **Sync mode has no GPU serialisation.** The async worker deliberately uses `boss.work(..., { batchSize: 1 }, ...)` with the comment *"serialize model calls so concurrent jobs don't contend for the single GPU"* — but sync mode calls `executeTranscription` inline in the route, bypassing that queue entirely. N concurrent sync calls hit the single GPU N-ways concurrently.
3. **Throughput ceiling.** `batchSize: 1` means strictly serial processing. Nothing is lost (`expireInHours: 4` applies only to already-*active* jobs, not queued ones), but last-in latency grows linearly with queue depth. Real parallelism requires more GPU capacity, not a config change.

## 12. Security & Privacy

- **Tenant isolation:** every lookup is `AND tenantId = <from API key>`. The presign endpoint derives the key path from the authenticated tenant and never trusts a client-supplied path — the same principle as the existing code's comment *"server derives tenantId, never trust the client"*.
- **Existence non-disclosure:** `404` (not `403`) for another tenant's `uploadId`/`transcriptionId`. Ids are `cuid()`/UUIDv4 so enumeration is not practical, but the endpoint still must not confirm.
- **Presign blast radius:** each URL is scoped to exactly one key, one method (PUT), and one `Content-Type`, and expires within ≤1 h. A leaked URL permits overwriting that single key until expiry — hence the short clamp and the `consumed` guard.
- **Webhook auth:** unchanged — static bearer token via `deliverWithToken()`, plus the existing SSRF guard (`assertPublicWebhookUrl` blocks localhost, private ranges, link-local, cloud metadata).
- **PII:** source audio and transcripts are both sensitive; §10 retention is a privacy requirement, not just a cost one.

## 13. Open Questions

1. **Transcript retention window** — indefinite, or N days? Blocks §7.3 sign-off.
2. **Idempotency semantics** on a repeat transcribe for a `consumed` upload: return the existing job (proposed, §7.2 step 2) or reject with `409`? Proposal favours the former since it makes client retries safe for free.
3. **`clientReference` uniqueness** — enforce unique per tenant (enabling `GET ?clientReference=`), or allow duplicates (lookup returns most recent)? Proposal: allow duplicates, index only.
4. Should the presign endpoint consume request quota, or only transcribe? Proposal: rate-limit presign separately, since with presign no bytes flow through our API and there is therefore no natural throttle on abuse.

## 14. Phased Implementation Plan

| Phase | Scope | Breaking? |
|---|---|---|
| **1 — Foundation** | `TranscriptionUpload` model + `TranscriptionJob.uploadId` + migration + `TranscriptionUploadService` + `S3Service.headObject()`. Existing multipart upload starts returning `uploadId`. | No — additive |
| **2 — Presign + transcribe** | `POST /get-presigned-url` endpoint; `uploadId` accepted by the transcription API; `HeadObject` existence + size enforcement; idempotency on `consumed`; `uploadId`/`clientReference` added to both webhook payloads and the worker job schema. | No |
| **3 — Retrieval** | `GET /transcripts` with tenant scoping, 404-not-403, large-transcript presigned fallback. | No |
| **4 — Hygiene** | S3 lifecycle rule, `transcription-upload-expiry` cron, retention policy documented. | No |
| **5 — Docs** | Update `docs/transcription-api-integration-guide.md`, `docs/transcription-api-request-response-reference.md`, `TRANSCRIPTION_API.md`, and the in-app Integration Guide dialog (`transcription-api-guide-dialog.tsx` — add a *Presigned upload* tab). | No |

Phases 1–2 are the minimum for the caller-facing goal (upload → identifier → transcribe → webhook with the same identifier). Phase 3 delivers the GET requirement.

## 15. Testing Strategy

Extends the suite added in `1e5fe1c` (11 files / 132 tests, all currently passing), following the same mocking style — `vi.hoisted()` for module mocks, injected Prisma stubs, no live AWS.

| Target | Cases |
|---|---|
| `transcription-upload-service.test.ts` (new) | presign row creation & tenant scoping; `markConsumed` transition; `findById` cross-tenant returns null; expiry batch |
| `s3-service` | `headObject` returns both fields; returns null on missing key (no throw) |
| `transcription-dispatch.test.ts` (extend) | `uploadId` threaded onto the created job |
| `transcription-runner.test.ts` (extend) | `uploadId`/`clientReference` present in both success and failure webhook payloads |
| Route-level | presign happy path + `Content-Type` allow-list rejection; transcribe with unknown/foreign/expired/unconsumed-but-absent-object `uploadId` → 404/410/409; oversize → 413; repeat call → idempotent; GET own vs. other tenant → 200 vs 404 |
| E2E (`apps/web-ui-e2e`, `@inference-api` module) | full presign → PUT → transcribe(async) → webhook → GET chain against a real bucket |

Manual verification mirrors what was already proven live for `autoTranscribe`: real curl, real audio file, `webhook.site` receiver, confirming the identifier is byte-identical across presign response → webhook body → GET response.

---

## Appendix — Touched / New Files

**New**
```
libs/shared/src/services/transcription-upload-service.ts
libs/shared/src/services/transcription-upload-service.test.ts
apps/web-ui/app/api/v1/transcription/get-presigned-url/route.ts          # presign
apps/web-ui/app/api/v1/transcription/transcripts/route.ts      # GET retrieval
apps/workers/src/jobs/transcription-upload-expiry/{handler,schema,register}.ts
```

**Modified**
```
prisma/schema.prisma                                           # +TranscriptionUpload, +TranscriptionJob.uploadId
libs/shared/src/env.ts                                         # +2 env vars
libs/shared/src/index.ts                                       # exports
libs/shared/src/services/s3-service.ts                         # +headObject()
libs/shared/src/services/transcription-dispatch.ts             # uploadId passthrough
libs/shared/src/services/transcription-runner.ts               # webhook fields
libs/shared/src/services/transcription-job-service.ts          # +uploadId input
libs/shared/src/services/webhook-service.ts                    # +2 optional payload fields
apps/web-ui/app/api/v1/transcription/route.ts                  # accept uploadId
apps/web-ui/app/api/v1/transcription/upload/route.ts           # mint upload row
apps/workers/src/jobs/transcription/{schema,handler}.ts         # new fields
apps/workers/src/jobs/transcription-webhook-retry/handler.ts   # new fields
apps/web-ui/components/transcription-jobs/transcription-api-guide-dialog.tsx
docs/transcription-api-integration-guide.md
docs/transcription-api-request-response-reference.md
TRANSCRIPTION_API.md
```
