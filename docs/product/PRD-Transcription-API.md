# Transcription API — Product Requirements Document

**Product Name:** Tenant Transcription API  
**Version:** 1.0  
**Status:** Implemented baseline; validation pending local end-to-end execution  
**Date:** 2026-07-24  

---

## Executive Summary

The Tenant Transcription API enables each tenant to configure a speech-to-text provider and expose transcription to external applications through scoped API keys. Callers upload audio to the platform, request synchronous or asynchronous transcription, receive results directly or by webhook, and can retrieve job status. Audio and output records are separated by tenant in the platform S3 bucket.

The feature provides a secure operational path for transcription without requiring callers to own or expose S3 credentials.

---

## Problem Statement

Teams need to transcribe audio from their applications, but direct model integrations require provider credentials, storage, job orchestration, retries, and callback security. In a multi-tenant platform, callers must not be able to access another tenant's audio, jobs, model settings, or transcription results.

The platform must provide a consistent API that supports short synchronous requests and long-running asynchronous jobs while keeping provider configuration, API keys, S3 objects, and webhook secrets isolated per tenant.

---

## Goals

- Let tenant admins configure a transcription provider and select its model.
- Let external callers authenticate using tenant-scoped transcription API keys.
- Support synchronous transcription for immediate results.
- Support asynchronous transcription for long-running work, job polling, and webhook delivery.
- Store input audio and transcript output under tenant-scoped S3 prefixes.
- Support immutable provider configuration snapshots and explicit version publishing.
- Apply quotas, audit-ready job records, and webhook replay protection.

## Non-Goals

- Caller-owned S3 buckets or caller-provided cloud credentials.
- A public unauthenticated transcription endpoint.
- Streaming / partial-token transcription responses.
- Automatic deletion and retention-policy configuration for S3 objects.
- A generic media-management UI.

---

## Target Users

| Persona | Need |
|---|---|
| Tenant Admin | Configure a provider, credentials, model, versions, quotas, and callback settings. |
| Application Developer | Upload audio, request transcripts, poll jobs, and receive verified webhooks. |
| Platform Operator | Observe job failures, quota events, worker retries, and storage errors. |

---

## User Journeys

### Configure a Provider

1. A tenant admin opens **Transcription Studio → LLM Providers**.
2. The admin selects a provider type, supplies credentials or runtime configuration, validates discovery, and selects a transcription model.
3. The admin creates the provider.
4. The admin optionally creates a configuration snapshot and publishes it.
5. The tenant assigns the provider as the default, or associates it with an API key.

### Create an API Key

1. A tenant admin opens **Transcription Studio → API Keys**.
2. The admin creates a key with a name, optional model association, request/minute quotas, and optional webhook URL.
3. The UI displays the raw API key exactly once.
4. The admin optionally opens **Webhook Secrets** and generates or rotates that key's signing secret.

### Synchronous Transcription

1. The caller uploads audio or sends an inline audio payload.
2. The caller sends `POST /api/v1/transcription` with `sync: true` (the default).
3. The API validates the API key, tenant ownership, request size, and quota.
4. The platform resolves the provider configuration, runs transcription, persists the job and output, and returns the transcript.

### Asynchronous Transcription

1. The caller uploads audio or sends an inline payload.
2. The caller sends `POST /api/v1/transcription` with `sync: false`.
3. The API persists a queued job and, when required, stashes inline audio in platform S3.
4. A worker transcribes the audio, persists the output, and sends a signed webhook if configured.
5. The caller polls the returned `statusUrl` or handles the callback.

---

## Functional Requirements

### Provider Management

- **FR-P1:** Tenant admins MUST create, view, update, delete, validate, and refresh transcription provider configurations.
- **FR-P2:** Supported provider types MUST include `BEDROCK`, `OLLAMA`, `VLLM`, `LITELLM`, `OPENAI_COMPATIBLE`, and `CUSTOM`.
- **FR-P3:** Provider credentials MUST be encrypted at rest and never returned in plaintext from read APIs.
- **FR-P4:** The provider creation flow MUST validate configuration before model selection.
- **FR-P5:** Bedrock provider creation MUST derive a valid Bedrock runtime endpoint when the admin leaves endpoint input empty.
- **FR-P6:** An admin MUST be able to mark one provider as the tenant default.

### Provider Versioning

- **FR-V1:** An admin MUST be able to create an immutable, numbered draft snapshot of the current provider configuration.
- **FR-V2:** A snapshot MUST capture provider type, contract, endpoint, region, selected model, and configuration.
- **FR-V3:** Publishing a snapshot MUST set the provider's `activeVersionId`.
- **FR-V4:** A transcription job MUST record the provider version selected for its execution when a version is supplied.
- **FR-V5:** Version history MUST show draft/published state, change notes, creation time, publish time, and active status.

### API Key Management

- **FR-K1:** Tenant admins MUST create, revoke, and list transcription API keys.
- **FR-K2:** Raw API keys MUST be displayed only at creation time; only a safe prefix may be displayed later.
- **FR-K3:** A key MAY define daily request, daily audio-minute, and per-minute request limits.
- **FR-K4:** A key MAY select a provider/model and a default webhook URL.
- **FR-K5:** Revoked or expired keys MUST be rejected with `401`.

### Input and Storage

- **FR-S1:** The upload endpoint MUST accept multipart audio under the `file` field and require bearer authentication.
- **FR-S2:** The server MUST derive `tenantId` from the authenticated key; it MUST NOT trust client-supplied tenant identifiers.
- **FR-S3:** Uploads MUST be written below `transcription/{tenantId}/input/`.
- **FR-S4:** A caller referencing an `s3Key` MUST only reference an object below `transcription/{tenantId}/`; other prefixes MUST return `403`.
- **FR-S5:** Inline payloads used by async jobs MUST be stashed in the platform S3 bucket before queueing work.
- **FR-S6:** Completed transcript JSON MUST be stored below `transcription/{tenantId}/output/{jobId}.json` on a best-effort basis.
- **FR-S7:** The maximum accepted audio size MUST be controlled by `TRANSCRIPTION_MAX_AUDIO_MB`.

### Transcription API

- **FR-A1:** `POST /api/v1/transcription` MUST require `Authorization: Bearer <transcription-api-key>`.
- **FR-A2:** The endpoint MUST support a multipart audio upload and JSON requests using either inline base64 `audio` or a tenant-scoped `s3Key` / `s3Url`.
- **FR-A3:** `sync` MUST default to `true`.
- **FR-A4:** A synchronous request MUST return a completed job ID, transcript, language, duration, segments when supplied by the provider, output S3 key, and quota usage.
- **FR-A5:** An asynchronous request MUST return `202`, a job ID, `queued` status, and a status URL.
- **FR-A6:** The service MUST persist a job lifecycle record for both sync and async requests.
- **FR-A7:** `GET /api/v1/transcription/jobs/{id}` MUST only return a job owned by the authenticated API key; inaccessible jobs MUST return `404`.

### Webhooks

- **FR-W1:** A tenant admin MUST generate or rotate a signing secret for each active API key.
- **FR-W2:** The raw signing secret MUST be revealed only once after rotation.
- **FR-W3:** Completion and failure callbacks MUST be signed using HMAC-SHA256.
- **FR-W4:** The preferred signature header MUST be `X-Webhook-Signature-V2`, containing a timestamp and signature over `{timestamp}.{body}`.
- **FR-W5:** Consumers MUST reject callback timestamps outside a five-minute replay-protection window.
- **FR-W6:** Failed webhook delivery MUST be recorded and queued for retry without rerunning transcription.

---

## API Contract

### Upload Audio

`POST /api/v1/transcription/upload`

- Authentication: `Authorization: Bearer <key>`
- Content type: `multipart/form-data`
- Required field: `file`
- Success: `201` with `s3Key`, signed `downloadUrl`, expiry, file metadata, and size.

### Request Transcription

`POST /api/v1/transcription`

- Authentication: `Authorization: Bearer <key>`
- JSON input options:
  - `{ "s3Key": "transcription/{tenantId}/input/...", "sync": true }`
  - `{ "source": "payload", "audio": "<base64>", "mimeType": "audio/wav", "sync": false }`
- Optional properties: `language`, `webhookUrl`, `modelId`, `versionId`, and `fileName` for payload input.

### Poll a Job

`GET /api/v1/transcription/jobs/{id}`

- Authentication: `Authorization: Bearer <key>`
- Response includes status, transcript, language, duration, output, errors, latency, webhook status, and timestamps.

---

## Storage Model

```text
{S3_BUCKET}/
└── transcription/
    └── {tenantId}/
        ├── input/
        │   ├── {uuid}-{filename}
        │   └── {jobId}
        └── output/
            └── {jobId}.json
```

Output JSON contains the job ID, transcript text, language, duration, language-detection metadata, and segments when available.

---

## Security and Tenant Isolation

- API keys are stored as hashes; the raw value is never persisted.
- Provider credentials are encrypted at rest.
- The authenticated API key establishes tenant identity, quotas, selected model, and webhook defaults.
- S3 references are prefix-validated against the authenticated tenant.
- Job polling verifies both tenant ownership and originating API-key ownership.
- Webhook signing secrets are key-scoped and one-time reveal only.
- Logs MUST use structured identifiers such as tenant ID, API key ID, and job ID without logging raw keys, credentials, or audio payloads.

---

## Non-Functional Requirements

| Category | Requirement |
|---|---|
| Reliability | Async jobs MUST survive request completion and be processed by the background worker. |
| Isolation | No API path may expose another tenant's S3 objects, jobs, models, or secrets. |
| Observability | Job creation, completion, failure, upload, and webhook outcomes MUST produce structured logs. |
| Quotas | Quota checks MUST occur before transcription execution. |
| Failure handling | Provider errors MUST mark the job failed and return a typed error response or failure callback. |
| Storage resilience | Failure to write output JSON to S3 MUST not discard a successful database transcript. |

---

## Success Metrics

| Metric | Definition | Initial Target |
|---|---|---|
| Successful transcription rate | Completed jobs / started jobs | ≥ 98% excluding provider outages |
| Async completion latency | p95 time from queued to terminal state | Tenant/provider dependent; baseline before target |
| Webhook delivery rate | Successfully delivered callbacks / attempted callbacks | ≥ 99% after retries |
| Cross-tenant access incidents | Confirmed isolation failures | 0 |
| Invalid request handling | Invalid requests returning expected 4xx status | 100% of covered negative tests |

---

## Acceptance Criteria

- A tenant can configure a provider, select a model, create a version snapshot, and publish it.
- A tenant can create an API key and generate a webhook signing secret from the merged API Keys interface.
- An authenticated caller can upload audio and submit a synchronous request.
- An authenticated caller can submit an asynchronous request and poll a terminal job state.
- A request with no key or an invalid/revoked key returns `401`.
- A JSON payload missing required audio data returns `400`.
- A request referring to another tenant's S3 prefix returns `403`.
- A key cannot poll a job created by another key.
- Completed jobs persist input/output S3 keys and transcript data according to the storage model.
- Async webhook callbacks contain the v2 signature and can be verified with the generated secret.

---

## Risks and Open Questions

- Provider compatibility depends on the selected engine honoring the configured `custom` or `openai-audio` transcription contract.
- Bedrock provider configuration is supported in the administration flow; production ASR support must be validated against the chosen Bedrock-compatible transcription model and runtime contract.
- S3 lifecycle/retention, deletion, encryption-key choice, and residency policy require a separate operational decision.
- Local end-to-end curl validation remains pending because the agent execution environment cannot access the local server; the acceptance test suite must be executed in the development environment before release.
