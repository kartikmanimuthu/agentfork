# Transcription API — JSON Changes Reference

For the team. Covers every JSON surface (sync, async initial response, webhook, polling, transcript retrieval), each shown **with and without diarization**, plus the new "system announcement" outcome. All examples are real, verified shapes from the actual code.

**Status: not live yet.** The `systemAnnouncement` fields exist and work end-to-end on our side, but nothing will ever be `true` in production until the engine team ships the actual detection logic (a separate, still-blocked piece of work). This is prep — nothing changes for callers today, but the shapes below are what will start appearing once it ships.

---

## 1. Sync (`POST /api/v1/transcription`, `sync: true` — the default)

### 1a. Success, `diarize: false`
```json
{
  "id": "cmk3j9k1b0002v8p4a2n8w3e7",
  "systemAnnouncement": false,
  "text": "म की य वेदांता...",
  "language": "hi",
  "languageDetected": true,
  "languageDetectionConfidence": 0.86,
  "durationSec": 54.9,
  "segments": null,
  "outputS3Key": "transcription/tenant-folder/.../output.json",
  "usage": { "remainingRequests": 411, "remainingMinutes": 952.3 }
}
```

### 1b. Success, `diarize: true`
```json
{
  "id": "cmk3j9k1b0002v8p4a2n8w3e7",
  "systemAnnouncement": false,
  "text": "म की य वेदांता... तो सा डिपली कर दे...",
  "language": "hi",
  "languageDetected": true,
  "languageDetectionConfidence": 0.86,
  "durationSec": 54.9,
  "segments": [
    { "start": 0.03, "end": 1.03, "speaker": "Speaker 1", "text": "म की" },
    { "start": 1.03, "end": 7.39, "speaker": "Speaker 2", "text": "य वेदांता दे को वेदताद" }
  ],
  "outputS3Key": "transcription/tenant-folder/.../output.json",
  "usage": { "remainingRequests": 411, "remainingMinutes": 952.3 }
}
```
Only difference from 1a is `segments` being populated — `diarize` doesn't touch anything else in this shape.

### 1c. Success, system announcement — **new, diarize is irrelevant here** (engine short-circuits before ASR/diarization ever run)
```json
{
  "id": "cmk3j9k1b0002v8p4a2n8w3e7",
  "systemAnnouncement": true,
  "text": "कृपया बाद में पुनः प्रयास करें",
  "language": "hi",
  "languageDetected": false,
  "languageDetectionConfidence": null,
  "durationSec": null,
  "segments": null,
  "outputS3Key": null,
  "usage": { "remainingRequests": 411, "remainingMinutes": 1000 }
}
```
`usage.remainingMinutes` is **not decremented** — no audio minutes are billed for this outcome. `text` holds the known phrase, `language` holds the matched variant (e.g. `"hi"`) — not `null`.

### 1d. Failure
```json
{ "error": { "type": "transcription_error", "message": "Transcription engine unreachable after 6 attempts — not processed" } }
```
HTTP `502`. Unchanged shape — the "unreachable after N attempts" wording comes from an earlier fix (circuit breaker), not this batch of changes.

---

## 2. Async — initial response (`sync: false`)

Identical regardless of `diarize` (the outcome isn't known yet):
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
**No change here.**

---

## 3. Webhook payload (delivered after async completes)

### 3a. Success, `diarize: false`
```json
{
  "executionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "agentId": "",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "completed",
  "input": { "fileName": "call.wav", "mimeType": "audio/wav", "s3Key": "transcription/_uploads/.../call.wav" },
  "output": {
    "text": "म की य वेदांता...",
    "language": "hi",
    "durationSec": 54.9,
    "languageDetected": true,
    "languageDetectionConfidence": 0.86
  },
  "cacheHit": false,
  "latencyMs": 7894,
  "timestamp": "2026-08-05T00:10:26.039Z"
}
```
Note: `output.segments` is **absent entirely** (not `null` — the key doesn't exist) when `diarize` wasn't requested.

### 3b. Success, `diarize: true`
Same as 3a, but `output` gains a `segments` key:
```json
"output": {
  "text": "म की य वेदांता... तो सा डिपली कर दे...",
  "language": "hi",
  "durationSec": 54.9,
  "segments": [
    { "start": 0.03, "end": 1.03, "speaker": "Speaker 1", "text": "म की" },
    { "start": 1.03, "end": 7.39, "speaker": "Speaker 2", "text": "य वेदांता दे को वेदताद" }
  ],
  "languageDetected": true,
  "languageDetectionConfidence": 0.86
}
```

### 3c. Success, system announcement — **new, different `output` shape entirely**
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
Still `status: "completed"`. **No `text`, `language`, `durationSec`, or `segments` at all** — this is the one genuinely breaking shape difference if your handler assumes `output.text` always exists on a completed webhook.

### 3d. Failure — normal engine error
```json
{
  "executionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "agentId": "",
  "status": "failed",
  "input": { "fileName": "call.wav", "mimeType": "audio/wav", "s3Key": null },
  "error": "Transcription engine returned 502: fetch failed",
  "cacheHit": false,
  "timestamp": "2026-08-05T00:10:26.039Z"
}
```

### 3e. Failure — engine down (circuit breaker), final attempt
Same shape as 3d, only `error` differs:
```json
"error": "Transcription engine unreachable after 6 attempts — not processed"
```
Both 3d/3e are unchanged shapes — pre-existing behavior, not from this batch of work.

---

## 4. Polling: `GET /api/v1/transcription/jobs/{id}`

Same response shape at every status; fields are `null`/default until populated.

```json
{
  "id": "cmk3jaf9c0003v8p4h5t2b1x9",
  "status": "queued",
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
  "createdAt": "2026-08-05T00:09:00.000Z",
  "completedAt": null
}
```
`status` becomes `"running"`, then `"completed"` or `"failed"`. On completion, `output` is the **raw stored JSON** — for `diarize:false` it's `null` or `{ languageDetected, languageDetectionConfidence }`; for `diarize:true` it also has `segments`; for a system announcement it's `{ systemAnnouncement: true, matchedVariant, matchConfidence }` (`text`/`language` columns are still populated with the known phrase/variant, `durationSec`/`outputS3Key` are `null`).

**No code change was needed here** — this endpoint already passed `output` through raw, so the new shape just shows up inside it automatically.

---

## 5. Transcript retrieval: `GET /api/v1/transcription/transcripts?uploadId=...`

### 5a. Completed, `diarize: false`
```json
{
  "transcriptionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "completed",
  "fileName": "call.wav",
  "mimeType": "audio/wav",
  "language": "hi",
  "durationSec": 54.9,
  "transcript": "म की य वेदांता...",
  "transcriptUrl": null,
  "systemAnnouncement": false,
  "matchedVariant": null,
  "matchConfidence": null,
  "segments": null,
  "languageDetected": true,
  "languageDetectionConfidence": 0.86,
  "error": null,
  "outputS3Key": "transcription/.../output.json",
  "createdAt": "2026-08-05T00:09:00.000Z",
  "completedAt": "2026-08-05T00:10:26.039Z"
}
```
`systemAnnouncement`, `matchedVariant`, `matchConfidence` are **new fields on this endpoint** (just added — this was the one place the earlier fix missed).

### 5b. Completed, `diarize: true`
Same as 5a, but `segments` is populated (same array shape as everywhere else).

### 5c. Completed, system announcement — **new**
```json
{
  "transcriptionId": "cmk3jaf9c0003v8p4h5t2b1x9",
  "uploadId": "cmsx7f2k0000v8abcd1234ef",
  "clientReference": "recording_8891",
  "status": "completed",
  "fileName": "call.wav",
  "mimeType": "audio/wav",
  "language": "hi",
  "durationSec": null,
  "transcript": "कृपया बाद में पुनः प्रयास करें",
  "transcriptUrl": null,
  "systemAnnouncement": true,
  "matchedVariant": "hi",
  "matchConfidence": 0.97,
  "segments": null,
  "languageDetected": false,
  "languageDetectionConfidence": null,
  "error": null,
  "outputS3Key": null,
  "createdAt": "2026-08-05T00:09:00.000Z",
  "completedAt": "2026-08-05T00:10:26.039Z"
}
```
Before this fix, a system-announcement job read through this endpoint would have looked **exactly like case 5a with no segments** — indistinguishable from a real (short) transcript. That gap is now closed.

### Other cases on this endpoint (unchanged)
- Upload exists, no transcription requested yet: `{ "status": "not_requested", "message": "...", ... }`
- No matching upload/job at all: `404 { "error": { "type": "not_found", ... } }`
- Failed job: `status: "failed"`, `transcript: null`, `error` populated.

---

## Which cases your team needs to actually change something for

| Surface | Action needed |
|---|---|
| **Webhook** (§3c) | **Yes, when you start seeing it** — check `output.systemAnnouncement` before reading `output.text`/`segments`. This is the one place the shape is genuinely different (no transcript fields at all), not just an added field. |
| **Sync response** (§1c) | Recommended, not required — `systemAnnouncement` is a new field; every other field your code already reads still exists (with `null`s where there's no real content), so nothing breaks if you ignore it, but you'll want to branch on it once it starts appearing. |
| **`GET /transcripts`** (§5c) | Recommended, same as sync — new fields, nothing existing removed or renamed. |
| **`GET /jobs/{id}`** (§4) | No endpoint change — if your code already treats `output` as an opaque JSON blob, nothing to do. If you inspect specific keys inside `output`, apply the same check as the webhook. |
| **Diarization (`segments`) in general** | No JSON shape change at all from this work — same array shape as always. The actual fix (capping speaker count at 2 so you stop seeing a phantom 3rd speaker) only takes effect once the engine ships its side; nothing to code against, it's an accuracy improvement, not a contract change. |

**Bottom line for right now:** nothing is required today. When the engine team ships detection, the only *mandatory* change is the webhook handler's `output.systemAnnouncement` check — everything else is additive and safe to adopt on your own schedule.
