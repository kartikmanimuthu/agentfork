# Transcription API — Request/Response Reference

A payload-level reference for the Upload and Transcription APIs: every request shape, every response shape, for sync, async, webhook, and polling — each with a full worked example. Companion to [`transcription-api-integration-guide.md`](./transcription-api-integration-guide.md), which covers the conceptual/onboarding side; this doc is the one to keep open while wiring up actual requests.

## Contents

1. [Auth (every request)](#1-auth-every-request)
2. [Curl cookbook](#2-curl-cookbook)
3. [Upload API](#3-upload-api)
4. [Transcription API — request shapes](#4-transcription-api--request-shapes)
5. [Transcription API — sync response](#5-transcription-api--sync-response)
6. [Transcription API — async response](#6-transcription-api--async-response)
7. [Polling: GET /jobs/{id}](#7-polling-get-jobsid)
8. [Webhook: registration, payload, verification](#8-webhook-registration-payload-verification)
9. [Transcript retrieval: GET /transcripts](#9-transcript-retrieval-get-transcripts)
10. [Error responses](#10-error-responses)

---

## 1. Auth (every request)

Every request below carries:

```
Authorization: Bearer tsk_live_...
```

Issued once from the dashboard (Transcription Studio → API Keys). The raw key is shown exactly once at creation — store it server-side, never in client-side code.

---

## 2. Curl cookbook

Copy-pasteable end to end. Set these once:

```bash
export BASE_URL="https://app.example.com"
export API_KEY="tsk_live_your_key_here"
```

### A · Get a place to upload

```bash
curl -s -X POST "$BASE_URL/api/v1/transcription/get-presigned-url" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "fileName": "call-recording.wav", "mimeType": "audio/wav",
        "clientReference": "recording_8891" }'
```

```json
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "url": "https://chatbot-970547372609-us-east-1.s3.us-east-1.amazonaws.com/",
  "fields": { "key": "...", "Content-Type": "audio/wav", "Policy": "...",
              "X-Amz-Signature": "...", "success_action_status": "201", "...": "..." },
  "expiresAt": "2026-08-01T05:48:27Z",
  "maxBytes": 52428800,
  "clientReference": "recording_8891"
}
```

**Keep `uploadId`** — it identifies this file in every later call. Full breakdown: [§3A](#3a--presigned-upload-recommended).

### B · Upload the file to S3

This request goes to **S3, not to us**. Send every field from `fields`, with `file` **last**:

```bash
curl -s -X POST "https://chatbot-970547372609-us-east-1.s3.us-east-1.amazonaws.com/" \
  -F "key=transcription/_uploads/cms4vk4ve0001v8icz4jy80gb/8f2a1c3d-call-recording.wav" \
  -F "Content-Type=audio/wav" \
  -F "bucket=chatbot-970547372609-us-east-1" \
  -F "X-Amz-Algorithm=AWS4-HMAC-SHA256" \
  -F "X-Amz-Credential=ASIA.../20260801/us-east-1/s3/aws4_request" \
  -F "X-Amz-Date=20260801T044827Z" \
  -F "X-Amz-Security-Token=IQoJb3JpZ2luX2Vj..." \
  -F "Policy=eyJleHBpcmF0aW9uIjoi..." \
  -F "X-Amz-Signature=70c5084ceb56f0a5..." \
  -F "success_action_status=201" \
  -F "file=@./call-recording.wav"
```

```xml
HTTP/1.1 201 Created

<PostResponse>
  <Bucket>chatbot-970547372609-us-east-1</Bucket>
  <Key>transcription/_uploads/.../8f2a1c3d-call-recording.wav</Key>
  <ETag>"9b2cf535f27731c974343645a3985328"</ETag>
</PostResponse>
```

That `201` **is** your confirmation — nothing to ask us. `400 EntityTooLarge` means you exceeded `maxBytes`; `403` means a field was altered or the policy expired.

### C · Transcribe it, synchronously

Take the `uploadId` from step A — the call blocks until the transcript is ready:

```bash
curl -s -X POST "$BASE_URL/api/v1/transcription" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "uploadId": "cmsx7f2k0000v8abcd1234ef",
    "sync": true,
    "diarize": true
  }'
```

```json
{
  "id": "cmk3j9k1b0002v8p4a2n8w3e7",
  "text": "म की य वेदांता... तो सा डिपली कर दे...",
  "language": "hi",
  "languageDetected": true,
  "languageDetectionConfidence": 0.86,
  "durationSec": 54.9,
  "segments": [
    { "start": 0.03, "end": 1.03, "speaker": "Speaker 1", "text": "म की" }
  ],
  "outputS3Key": "transcription/chatflow/cmk3j9k1b0002v8p4a2n8w3e7/output/output.json",
  "usage": { "remainingRequests": 411, "remainingMinutes": 952.3 }
}
```

Full breakdown incl. error cases: [§5](#5-transcription-api--sync-response).

### D · Transcribe it, asynchronously + webhook

Same `uploadId`, but don't block — get the job back instantly, and have the result pushed to your own endpoint when it's done:

```bash
curl -s -X POST "$BASE_URL/api/v1/transcription" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "uploadId": "cmsx7f2k0000v8abcd1234ef",
    "sync": false,
    "diarize": true,
    "webhookUrl": "https://you.example.com/hooks/transcription"
  }'
```

```json
{
  "id": "cmk3jaf9c0003v8p4h5t2b1x9",
  "transcriptionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "queued",
  "statusUrl": "/api/v1/transcription/jobs/cmk3jaf9c0003v8p4h5t2b1x9"
}
```

Full breakdown: [§6](#6-transcription-api--async-response). Webhook payload/token verification: [§8](#8-webhook-registration-payload-verification).

### E · Poll instead of (or in addition to) the webhook

```bash
curl -s "$BASE_URL/api/v1/transcription/jobs/cmk3jaf9c0003v8p4h5t2b1x9" \
  -H "Authorization: Bearer $API_KEY"
```

```json
{ "id": "cmk3jaf9c0003v8p4h5t2b1x9", "status": "completed", "text": "...", "...": "..." }
```

Full response shapes per status (`queued`/`running`/`completed`/`failed`): [§7](#7-polling-get-jobsid).

### F · Fetch the transcript later, or upload inline

Fetch a finished transcript any time with the `uploadId`:

```bash
curl -s "$BASE_URL/api/v1/transcription/transcripts?uploadId=cmsx7f2k0000v8abcd1234ef"   -H "Authorization: Bearer $API_KEY"
```

For small files you can also skip steps A/B entirely and post the audio straight to the Transcription API — either multipart:

```bash
curl -s -X POST "$BASE_URL/api/v1/transcription" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@./clip.mp3" \
  -F "sync=true" \
  -F "diarize=false"
```

...or base64-in-JSON (handy from environments where multipart is awkward, e.g. some serverless runtimes):

```bash
curl -s -X POST "$BASE_URL/api/v1/transcription" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"audio\":\"$(base64 -w0 ./clip.mp3)\",\"mimeType\":\"audio/mpeg\",\"sync\":false}"
```

---

## 3. Upload API

Two ways to get audio into our bucket. Both return the same `uploadId`, so everything downstream is identical.

### 3A · Presigned upload (recommended)

#### Request

```
POST /api/v1/transcription/get-presigned-url
Authorization: Bearer tsk_live_...
Content-Type: application/json

{ "fileName": "call-recording.wav", "mimeType": "audio/wav", "clientReference": "recording_8891" }
```

| Field | Required | Notes |
|---|---|---|
| `mimeType` | **yes** | Must be an MP3 or WAV type (`audio/mpeg`, `audio/mp3`, `audio/mpeg3`, `audio/x-mpeg-3`, `audio/wav`, `audio/wave`, `audio/x-wav`, `audio/vnd.wave`). Pinned into the policy — your upload must send this exact `Content-Type`. |
| `fileName` | no | Cosmetic; used in the key and echoed back |
| `clientReference` | no | Your own id. Echoed in the webhook and in transcript retrieval, so you need no mapping table |
| `declaredSizeBytes` | no | Rejected up front with `413` if it already exceeds the cap |
| `expiresInSeconds` | no | Clamped to `[300, 3600]`. Default 3600 |

#### Response — `201 Created`

```json
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "url": "https://chatbot-970547372609-us-east-1.s3.us-east-1.amazonaws.com/",
  "fields": {
    "key": "transcription/_uploads/cms4vk4ve0001v8icz4jy80gb/8f2a1c3d-call-recording.wav",
    "Content-Type": "audio/wav",
    "bucket": "chatbot-970547372609-us-east-1",
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": "ASIA.../20260801/us-east-1/s3/aws4_request",
    "X-Amz-Date": "20260801T044827Z",
    "X-Amz-Security-Token": "IQoJb3JpZ2luX2Vj...",
    "Policy": "eyJleHBpcmF0aW9uIjoi...",
    "X-Amz-Signature": "70c5084ceb56f0a5...",
    "success_action_status": "201"
  },
  "method": "POST",
  "expiresInSeconds": 3600,
  "expiresAt": "2026-08-01T05:48:27Z",
  "maxBytes": 52428800,
  "s3Key": "transcription/_uploads/cms4vk4ve0001v8icz4jy80gb/8f2a1c3d-call-recording.wav",
  "clientReference": "recording_8891"
}
```

| Field | Notes |
|---|---|
| `uploadId` | **The identifier to keep.** Pass to the Transcription API, received back on the webhook, used for retrieval. Short and opaque |
| `url` | The **bare S3 bucket endpoint** — no key, no query string. This is normal: unlike a presigned PUT/GET URL, a presigned POST carries its credentials in the form fields, not the URL |
| `fields` | Signed form fields. Send all of them, unchanged, and add none |
| `Policy` | Base64 JSON holding the enforced conditions (`content-length-range`, `Content-Type`, `key`, expiry). `X-Amz-Signature` is an HMAC **over this policy**, so it cannot be altered |
| `maxBytes` | The cap S3 will enforce (`TRANSCRIPTION_MAX_AUDIO_MB`, default 50 MB) |
| `s3Key` | Informational, for support/debugging. Not needed for any later call |

#### Uploading — goes to S3, not to us

```
POST https://<bucket>.s3.<region>.amazonaws.com/
Content-Type: multipart/form-data; boundary=...

  ...every field from "fields"...
  file: <binary audio bytes>       <- MUST be the last field
```

| Status | Meaning |
|---|---|
| `201 Created` | Uploaded. Body is `<PostResponse><Location/><Bucket/><Key/><ETag/></PostResponse>`. **This is your confirmation — no call to us required** |
| `400 EntityTooLarge` | Exceeded `maxBytes`; S3 rejected it and nothing was stored |
| `400 EntityTooSmall` | Empty file (the policy sets a 1-byte minimum) |
| `403 AccessDenied` | `Content-Type` didn't match the policy, a field was altered, or the policy expired |

Three rules: `file` must be **last** (S3 ignores anything after it), send every field **unchanged**, and add **no extra fields**.

> **Note on type enforcement.** The policy validates the *declared* `Content-Type`; S3 never inspects the bytes. The real container is verified from magic bytes when you call transcribe — a mismatched file is rejected there with `415`.

### 3B · Direct upload (simpler, streams through us)

#### Request

```
POST /api/v1/transcription/upload
Authorization: Bearer tsk_live_...
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="call-recording.wav"
Content-Type: audio/wav

<binary audio bytes>
--boundary--
```

`file` is required; an optional `clientReference` field is also read. The whole file passes through our servers, so prefer 3A at volume.

#### Response — `201 Created`

```json
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "s3Key": "transcription/_uploads/cms4vk4ve0001v8icz4jy80gb/8f2a1c3d-call-recording.wav",
  "downloadUrl": "https://chatbot-970547372609-us-east-1.s3.amazonaws.com/transcription/_uploads/.../call-recording.wav?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-...",
  "expiresInSeconds": 900,
  "fileName": "call-recording.wav",
  "mimeType": "audio/wav",
  "sizeBytes": 481203,
  "clientReference": null
}
```

| Field | Notes |
|---|---|
| `uploadId` | Same meaning as in 3A — the identifier for every later call |
| `downloadUrl` | Presigned GET for the raw file, valid 900s. Only useful to re-fetch what you just uploaded; not needed to transcribe |
| `sizeBytes` | Echoes what was received, for your own logging/validation |
```

### Error responses (both upload styles)

| Status | `type` | Cause |
|---|---|---|
| `400` | `validation_error` | Presign: bad/missing `mimeType` (not MP3/WAV). Direct: wrong `Content-Type`, no `file` field, or a zero-byte upload |
| `413` | `payload_too_large` | `declaredSizeBytes` or the received file exceeds the max (50 MB default) |
| `429` | `quota_exceeded` | The key's per-minute or daily request budget is spent (presigning is metered too) |
| `401` | `invalid_api_key` | No/bad Bearer token |

---

## 4. Transcription API — request shapes

`POST /api/v1/transcription`, same Bearer auth. Four request bodies, your choice per call:

### A · Reference an upload by `uploadId` (JSON) — **recommended**

```json
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "sync": false,
  "diarize": true,
  "webhookUrl": "https://you.example.com/hooks/transcription"
}
```

Before queuing, we verify the upload belongs to your tenant, that the object actually arrived, that it's within the size cap, and that its magic bytes really are MP3/WAV:

| Status | `type` | Cause |
|---|---|---|
| `404` | `upload_not_found` | Unknown `uploadId` — or it belongs to another tenant (deliberately indistinguishable) |
| `410` | `upload_expired` | The presign window closed without the upload being transcribed |
| `409` | `upload_incomplete` | No object at that key — your upload didn't complete. Confirm you got `201` from S3 first |
| `413` | `payload_too_large` | The stored object exceeds the cap |
| `415` | `unsupported_media_type` | Magic bytes aren't MP3 or WAV, whatever the declared `Content-Type` said |

Calling twice with the same `uploadId` is safe: the second call returns the **existing** job rather than creating a duplicate (also enforced by a unique index), so client-side retries need no special handling.

### B · Reference an upload by `s3Key` (JSON) — legacy

```json
{
  "s3Key": "transcription/_uploads/cms4vk4ve0001v8icz4jy80gb/8f2a1c3d-call-recording.wav",
  "sync": true,
  "diarize": true,
  "webhookUrl": "https://you.example.com/hooks/transcription"
}
```

`s3Url` (the `downloadUrl` from the upload step) works in place of `s3Key` if that's more convenient — both resolve to the same object.

### C · Inline base64 (JSON)

```json
{
  "audio": "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA...",
  "mimeType": "audio/mpeg",
  "fileName": "clip.mp3",
  "sync": false,
  "language": "hi"
}
```

### D · Inline multipart

```
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="clip.mp3"
Content-Type: audio/mpeg

<binary audio bytes>
--boundary
Content-Disposition: form-data; name="sync"

true
--boundary
Content-Disposition: form-data; name="diarize"

false
--boundary--
```

Multipart fields are all strings — send `"true"`/`"false"` for booleans, not JSON `true`/`false`.

### Fields common to all three shapes

| Field | Type | Default | Notes |
|---|---|---|---|
| `sync` | boolean | `true` | See [§5](#5-transcription-api--sync-response)/[§6](#6-transcription-api--async-response) |
| `language` | string | *(omit → auto-detect)* | Hint restricted to the 22 supported Indian languages (see §0 of TRANSCRIPTION_API.md), e.g. `"hi"`, `"ta"`, `"te"` — English is not supported |
| `diarize` | boolean | `false` | Per-speaker segments — only honored by the self-hosted engine, silently ignored on OpenAI-compatible engines |
| `webhookUrl` | string (URL) | *(key's default, if any)* | Overrides the API key's registered webhook for this call only |
| `modelId` / `versionId` | string | *(key's default)* | Almost always left unset — the key's linked Job Config supplies these |

---

## 5. Transcription API — sync response

`sync: true` (or omitted). The HTTP response **is** the transcript.

### Plain transcription — `200 OK`

```json
{
  "id": "cmk3j8f2a0001v8p4x7q1z9r5",
  "text": "यह चार सौ अस्सी में बेच रही हूँ, डब्ल्यू एम जीरो जीरो नाइंटी सिक्स में",
  "language": "hi",
  "languageDetected": true,
  "languageDetectionConfidence": 0.86,
  "durationSec": 54.9,
  "segments": null,
  "outputS3Key": "transcription/chatflow/cmk3j8f2a0001v8p4x7q1z9r5/output/output.json",
  "usage": {
    "remainingRequests": 412,
    "remainingMinutes": 953.2
  }
}
```

Response headers:

```
X-Job-Id: cmk3j8f2a0001v8p4x7q1z9r5
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 412
```

### With `diarize: true` — segments populated

```json
{
  "id": "cmk3j9k1b0002v8p4a2n8w3e7",
  "text": "म की य वेदांता... तो सा डिपली कर दे...",
  "language": "hi",
  "languageDetected": true,
  "languageDetectionConfidence": 0.86,
  "durationSec": 54.9,
  "segments": [
    { "start": 0.03, "end": 1.03, "speaker": "Speaker 1", "text": "म की" },
    { "start": 1.03, "end": 7.39, "speaker": "Speaker 2", "text": "य वेदांता दे को वेदताद" },
    { "start": 8.1,  "end": 10.48, "speaker": "Speaker 1", "text": "तो सा डिपली कर दे इटर आ बिल्डंग को" }
  ],
  "outputS3Key": "transcription/chatflow/cmk3j9k1b0002v8p4a2n8w3e7/output/output.json",
  "usage": { "remainingRequests": 411, "remainingMinutes": 952.3 }
}
```

### Engine failure — `502`

```json
{ "error": { "type": "transcription_error", "message": "Transcription engine returned 500: internal error" } }
```

Sync failures come back as an HTTP error on this same call — there's no separate status to poll for sync mode.

---

## 6. Transcription API — async response

`sync: false`. Returns immediately; the transcript is **not** in this response.

### Request

```json
{
  "s3Key": "transcription/_uploads/.../interview.wav",
  "sync": false,
  "diarize": true,
  "webhookUrl": "https://you.example.com/hooks/transcription"
}
```

### Response — `202 Accepted`

```json
{
  "id": "cmk3jaf9c0003v8p4h5t2b1x9",
  "status": "queued",
  "statusUrl": "/api/v1/transcription/jobs/cmk3jaf9c0003v8p4h5t2b1x9"
}
```

```
X-Job-Id: cmk3jaf9c0003v8p4h5t2b1x9
```

That's the entire response — `text`, `segments`, etc. are not here. Get the result either by polling `statusUrl` ([§7](#7-polling-get-jobsid)) or waiting for the webhook ([§8](#8-webhook-registration-payload-verification)).

> **Async engine failures are invisible to this call.** The `202` above returns the instant the job is queued, before the engine has even started. If transcription later fails, you find out only via the poll response (`status:"failed"`) or the webhook (`status:"failed"`) — never as an HTTP error on the original request.

---

## 7. Polling: GET /jobs/{id}

```
GET /api/v1/transcription/jobs/cmk3jaf9c0003v8p4h5t2b1x9
Authorization: Bearer tsk_live_...
```

### While running

```json
{
  "id": "cmk3jaf9c0003v8p4h5t2b1x9",
  "status": "running",
  "source": "upload",
  "text": null,
  "language": null,
  "durationSec": null,
  "output": null,
  "error": null,
  "latencyMs": null,
  "webhookStatus": null,
  "webhookAttempts": 0,
  "outputS3Key": null,
  "providerVersionId": null,
  "createdAt": "2026-07-29T07:10:18.145Z",
  "completedAt": null
}
```

### Completed

```json
{
  "id": "cmk3jaf9c0003v8p4h5t2b1x9",
  "status": "completed",
  "source": "upload",
  "text": "म की य वेदांता... तो सा डिपली कर दे...",
  "language": "hi",
  "durationSec": 54.9,
  "output": {
    "segments": [
      { "start": 0.03, "end": 1.03, "speaker": "Speaker 1", "text": "म की" }
    ],
    "languageDetected": true,
    "languageDetectionConfidence": 0.86
  },
  "error": null,
  "latencyMs": 7894,
  "webhookStatus": "delivered",
  "webhookAttempts": 1,
  "outputS3Key": "transcription/chatflow/cmk3jaf9c0003v8p4h5t2b1x9/output/output.json",
  "providerVersionId": null,
  "createdAt": "2026-07-29T07:10:18.145Z",
  "completedAt": "2026-07-29T07:10:26.039Z"
}
```

### Failed

```json
{
  "id": "cmk3jaf9c0003v8p4h5t2b1x9",
  "status": "failed",
  "source": "upload",
  "text": null,
  "error": "Transcription engine returned 502: fetch failed",
  "webhookStatus": "delivered",
  "webhookAttempts": 1,
  "createdAt": "2026-07-29T07:10:18.145Z",
  "completedAt": "2026-07-29T07:10:19.512Z"
}
```

`status` progresses `queued` → `running` → `completed` | `failed`, and stays there — poll on an interval (2–5s is plenty) until it's out of `queued`/`running`. A key can only see jobs it created; an unknown id or one belonging to a different key returns:

```
404
{ "error": { "type": "not_found", "message": "Job not found" } }
```

---

## 8. Webhook: registration, payload, verification

### Registration

Two ways to set it, both produce the same result:

**A. In the dashboard** — Transcription Studio → API Keys → edit the key → set **Webhook URL**, then click **Generate secret**.

**B. From your own backend:**

```
POST /api/transcription/api-keys/{keyId}/webhook-secret
```
```json
{ "rawSecret": "whsec_8fN2kQx...", "hasSecret": true }
```

`rawSecret` is shown **once** — this is the token we send back on every delivery. Losing it means generating a new one (invalidates the old one).

Per-request override — pass `webhookUrl` directly in a transcription request body to use a different URL just for that call; the secret is always the one on the API key (not overridable per-request).

### Delivery — fires once, on completion or failure

```
POST https://you.example.com/hooks/transcription
Content-Type: application/json
User-Agent: chatbot-inference/1.0
Authorization: Bearer whsec_8fN2kQx...
```

**Success payload** (request was made with `diarize: true`):

```json
{
  "executionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "agentId": "",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "completed",
  "input": { "fileName": "interview.wav", "mimeType": "audio/wav", "s3Key": "transcription/_uploads/.../interview.wav" },
  "output": {
    "text": "म की य वेदांता... तो सा डिपली कर दे...",
    "language": "hi",
    "durationSec": 54.9,
    "segments": [
      { "start": 0.03, "end": 1.03, "speaker": "Speaker 1", "text": "म की" },
      { "start": 1.03, "end": 7.39, "speaker": "Speaker 2", "text": "य वेदांता दे को वेदताद" },
      { "start": 8.1,  "end": 10.48, "speaker": "Speaker 1", "text": "तो सा डिपली कर दे इटर आ बिल्डंग को" }
    ],
    "languageDetected": true,
    "languageDetectionConfidence": 0.86
  },
  "cacheHit": false,
  "latencyMs": 7894,
  "timestamp": "2026-07-29T07:10:26.039Z"
}
```

`segments` is present only when the job ran with `diarize: true` (omitted entirely otherwise, same rule as everywhere else in this doc). `uploadId`/`clientReference` are present only when the original request supplied them.

**Failure payload:**

```json
{
  "executionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "agentId": "",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "failed",
  "input": { "fileName": "interview.wav", "mimeType": "audio/wav", "s3Key": "transcription/_uploads/.../interview.wav" },
  "error": "Transcription engine returned 502: fetch failed",
  "cacheHit": false,
  "timestamp": "2026-07-29T07:10:19.512Z"
}
```

There is no `output` on a failure payload — diarization never ran, so there are no `segments` to report either.

**System-announcement payload** (the engine recognized the audio as a known non-conversational system message, e.g. a carrier "please try again later" announcement, instead of a real conversation):

```json
{
  "executionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "agentId": "",
  "status": "completed",
  "input": { "fileName": "call.wav", "mimeType": "audio/wav", "s3Key": null },
  "output": {
    "systemAnnouncement": true,
    "matchedVariant": "hi",
    "matchConfidence": 0.97
  },
  "cacheHit": false,
  "latencyMs": 812,
  "timestamp": "2026-08-05T00:10:26.039Z"
}
```

This is still `status: "completed"` — the call was successfully identified, just not transcribed as a real conversation. There is no `text`, `language`, `durationSec`, or `segments` in this `output` shape; check `output.systemAnnouncement` before reading `output.text`.

`GET /api/v1/transcription/transcripts` surfaces the same signal for callers polling instead of using the webhook — the response includes top-level `systemAnnouncement`, `matchedVariant`, and `matchConfidence` fields alongside `transcript`, mirroring the webhook's `output`.

> `executionId` **is** the job id — same value as `id` everywhere else in this doc. `agentId` is always `""` here; it's a field name inherited from a shared internal payload shape, not something specific to transcription. Ignore both quirks, just map `executionId` → your job id.

### Verifying the request

Every delivery carries the secret as a static bearer token: `Authorization: Bearer <rawSecret>`. Compare it against the value you stored when the secret was generated — no HMAC, no signing, no raw-body handling required.

```js
// Node.js / Express
const crypto = require('crypto');

app.post('/hooks/transcription', express.json(), (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  const expected = Buffer.from(process.env.WEBHOOK_SECRET);
  const got = Buffer.from(token);
  const ok = expected.length === got.length && crypto.timingSafeEqual(expected, got);
  if (!ok) return res.status(401).send('bad token');

  const event = req.body;
  // event.executionId, event.status — check event.output?.systemAnnouncement before reading event.output?.text
  res.status(200).send('ok'); // ack fast, process async
});
```

**Note:** this is a static, unsigned token — it authenticates the sender but has no built-in replay protection (a captured request could be resent). Serve your webhook endpoint over HTTPS only, and make your handler idempotent on `executionId` regardless (see Retries below) so a legitimate retry or an unlikely replay both land safely.

### Retries

If the first delivery attempt doesn't get a `2xx` back (timeout, non-2xx status, DNS failure), it's automatically retried on a backoff schedule — no action needed on your end. Just make the handler idempotent (safe to process the same `executionId` twice) in case a retry and your own reconciliation poll both land.

### Security requirement

The webhook URL must resolve to a public address. Localhost, private IP ranges (`10.x`, `172.16–31.x`, `192.168.x`, etc.), link-local, and cloud-metadata addresses are blocked as an SSRF guard — a tunnel with a real public hostname (ngrok, etc.) works fine for local testing.

---

## 9. Transcript retrieval: GET /transcripts

Fetch a transcript at any time after the job completes — the durable alternative to catching
the webhook once. Strictly tenant-scoped.

```
GET /api/v1/transcription/transcripts?uploadId=cmsx7f2k0000v8abcd1234ef
Authorization: Bearer tsk_live_...
```

Supply **exactly one** of `uploadId` or `transcriptionId`.

### Completed — `200 OK`

```json
{
  "transcriptionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "completed",
  "fileName": "call-recording.wav",
  "mimeType": "audio/wav",
  "language": "hi",
  "durationSec": 54.9,
  "transcript": "म की य वेदांता... तो सा डिपली कर दे...",
  "transcriptUrl": null,
  "segments": [
    { "start": 0.03, "end": 1.03, "speaker": "Speaker 1", "text": "म की" }
  ],
  "languageDetected": true,
  "languageDetectionConfidence": 0.86,
  "error": null,
  "outputS3Key": "transcription/chatflow/cmk3jaf9c0003v8p4h5t2b1x9/output/output.json",
  "createdAt": "2026-08-01T04:48:15.156Z",
  "completedAt": "2026-08-01T04:48:40.274Z"
}
```

| Field | Notes |
|---|---|
| `transcript` | The full text — **unless** it is very large (>256 KB), in which case this is `null` and `transcriptUrl` is populated instead |
| `transcriptUrl` | A short-lived (900s) link to the stored transcript JSON. Only present for very large transcripts |
| `segments` | Per-speaker segments when the job ran with `diarize: true`; otherwise `null` |
| `clientReference` | Your own reference from the presign call, echoed back |

### Still running — `200 OK`

Same envelope with `status: "queued"` or `"running"` and `transcript: null`.

### Uploaded but never transcribed — `200 OK`

```json
{
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "transcriptionId": null,
  "status": "not_requested",
  "message": "This upload exists but no transcription has been requested for it yet",
  "createdAt": "2026-08-01T04:47:02.001Z"
}
```

### Failed — `200 OK`

Same envelope with `status: "failed"`, `error` populated, and no `segments`.

### Not found — `404`

```json
{ "error": { "type": "not_found", "message": "No transcription found for the supplied identifier" } }
```

> Returned for an unknown identifier **and** for one belonging to another tenant — deliberately
> indistinguishable, so this endpoint cannot be used to probe for other tenants' ids.

---

## 10. Error responses

Every endpoint in this doc uses this envelope:

```json
{ "error": { "type": "validation_error", "message": "human-readable detail" } }
```

| Status | `type` | Meaning |
|---|---|---|
| 400 | `validation_error` | Malformed request body, bad content-type, missing required field |
| 401 | `invalid_api_key` | Missing / unknown / revoked / expired Bearer key |
| 403 | `validation_error` | Referenced `s3Key` doesn't belong to your tenant |
| 404 | `not_found` | Unknown job id, or it belongs to a different API key |
| 413 | `payload_too_large` | Audio exceeds the configured max (50MB default) |
| 429 | `quota_exceeded` | Daily/per-minute limit hit — see `Retry-After` header |
| 502 | `transcription_error` | Engine itself failed (sync mode only — see [§6](#6-transcription-api--async-response) for async) |
| 500 | `internal_error` | Unexpected server-side failure — safe to retry |

Rate-limit headers on every authenticated response:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 412
Retry-After: 43        # only present on 429
```

---

*Internal reference for `/api/v1/transcription/*`. Reflects the routes and services as implemented — update alongside API changes.*
