# Agent Inference API — Design Spec

**Date:** 2026-05-07
**Scope:** Public inference API for agent execution via API keys, with quota management, response caching, and session support.

---

## 1. Goals

- Enable external developers to invoke published agents via a REST API.
- Provide API key lifecycle management (create, rotate, revoke).
- Enforce usage quotas (requests per day + tokens per day) and sliding window rate limits.
- Cache LLM responses in an unlogged Postgres table to reduce cost and latency.
- Support both stateless (one-shot) and stateful (session-based) inference.
- Provide full execution audit via `ApiKeyExecution`.

---

## 2. Architecture

### 2.1 Route Layout

| Route | Auth | Description |
|---|---|---|
| `/api/v1/inference` | Bearer `sk_...` | Invoke an agent (streaming or non-streaming) |
| `/api/v1/inference/sessions` | Bearer `sk_...` | Create / list inference sessions |
| `/api/v1/inference/sessions/{id}` | Bearer `sk_...` | Get / delete a session |
| `/api/v1/inference/usage` | Bearer `sk_...` | Current usage for the API key |

### 2.2 Middleware (`/api/v1/inference/*`)

1. Extract `Authorization: Bearer <token>`.
2. SHA-256 hash the token; look up `ApiKey` by `keyHash`.
3. Validate status (`active`), check `expiresAt`.
4. Inject `x-tenant-id` and `x-api-key-id` into request headers.
5. Pass to handler.

### 2.3 Handler Flow (`POST /api/v1/inference`)

1. Parse body (`messages`, `sessionId`, `systemPrompt`, `temperature`, `maxTokens`, `stream`, `noCache`).
2. Resolve `agentId` from the API key record.
3. Fetch the published `AgentVersion` for this agent.
4. **Quota check:** query `ApiKeyUsage` for today. If limits exceeded → `429`.
5. **Cache check:** if `!noCache`, compute `cacheKey` hash and look up `LlmResponseCache`. Hit → return cached response, skip LLM.
6. **Session load:** if `sessionId`, append `messages` to `InferenceSession.messages`.
7. **Execute agent:** reuse existing `streamChat` / `createLLMProvider` logic from the playground.
8. **Track usage:** increment `ApiKeyUsage.requestCount` and `tokenCount`.
9. **Cache write:** if successful and `!noCache`, store response in `LlmResponseCache`.
10. **Audit:** create `ApiKeyExecution` record.
11. **Return:** SSE stream or JSON.

---

## 3. Data Model

### 3.1 Prisma Additions

```prisma
model ApiKey {
  id               String   @id @default(cuid())
  tenantId         String
  agentId          String
  name             String
  keyHash          String   @unique
  keyPrefix        String
  status           String   @default("active")
  scopes           String[] @default(["inference:read"])
  dailyReqLimit    Int      @default(1000)
  dailyTokenLimit  Int      @default(100000)
  expiresAt        DateTime?
  createdBy        String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  tenant       Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  agent        Agent             @relation(fields: [agentId], references: [id], onDelete: Cascade)
  executions   ApiKeyExecution[]
  usages       ApiKeyUsage[]
  sessions     InferenceSession[]

  @@index([keyHash])
  @@index([tenantId, agentId, status])
  @@map("api_keys")
}

model ApiKeyUsage {
  id            String   @id @default(cuid())
  apiKeyId      String
  date          DateTime @db.Date
  requestCount  Int      @default(0)
  tokenCount    Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  apiKey ApiKey @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)

  @@unique([apiKeyId, date])
  @@index([apiKeyId, date])
  @@map("api_key_usage")
}

model ApiKeyExecution {
  id             String    @id @default(cuid())
  apiKeyId       String
  tenantId       String
  agentId        String
  agentVersionId String?
  status         String    @default("pending")
  input          Json
  output         Json?
  error          String?
  tokenUsage     Json?
  cacheHit       Boolean   @default(false)
  latencyMs      Int?
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime  @default(now())

  apiKey ApiKey @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)

  @@index([apiKeyId, createdAt])
  @@index([tenantId, createdAt])
  @@index([status])
  @@map("api_key_executions")
}

model InferenceSession {
  id        String   @id @default(cuid())
  apiKeyId  String
  tenantId  String
  agentId   String
  name      String?
  messages  Json
  metadata  Json?
  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  apiKey ApiKey @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)

  @@index([apiKeyId])
  @@index([tenantId, agentId])
  @@index([expiresAt])
  @@map("inference_sessions")
}

model LlmResponseCache {
  id          String   @id @default(cuid())
  cacheKey    String   @unique
  response    Json
  metadata    Json?
  hitCount    Int      @default(0)
  expiresAt   DateTime
  createdAt   DateTime @default(now())

  @@index([cacheKey])
  @@index([expiresAt])
  @@map("llm_response_cache")
}
```

### 3.2 Agent Model Update

Add to existing `Agent` model:

```prisma
  apiKeys           ApiKey[]
  inferenceSessions InferenceSession[]
```

---

## 4. Caching Strategy

### 4.1 Unlogged Table

`LlmResponseCache` is created as **unlogged** (via raw SQL in migration) to avoid WAL overhead. Data is ephemeral: if the server crashes and the table truncates, the client simply re-invokes the LLM.

### 4.2 Cache Key

SHA-256 of serialized:
- `agentVersionId`
- `systemPrompt`
- `messages[]`
- `model`
- `temperature`

Tools and MCP server outputs are intentionally excluded from the cache key.

### 4.3 TTL & Cleanup

- `expiresAt = NOW() + INTERVAL '24 hours'` on insert (default TTL).
- `pg_cron` extension job runs every 10 minutes: `DELETE FROM llm_response_cache WHERE expiresAt < NOW()`.
- Clients can bypass cache with `"noCache": true` in the request body.

---

## 5. Quota Enforcement

### 5.1 Daily Quota

- Per-key, per-day counters stored in `ApiKeyUsage`.
- Pre-flight check before LLM invocation.
- On success: increment `requestCount` and `tokenCount` atomically.
- On failure: record status as `rate_limited` in `ApiKeyExecution`.

### 5.2 Sliding Window Rate Limit

- Burst prevention: default `100 req/min`, `10K tokens/min`.
- Minute-level counter stored alongside daily counters; reset when `updatedAt` > 1 minute old.
- If exceeded → `429` with retry-after header.

### 5.3 Quota Headers

Every response includes:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1715097600
X-TokenLimit-Limit: 100000
X-TokenLimit-Remaining: 92340
```

---

## 6. API Surface

### 6.1 POST /api/v1/inference

Invoke an agent. Supports streaming (`stream: true`) and non-streaming.

**Request:**
```json
{
  "messages": [{ "role": "user", "content": "Hello!" }],
  "sessionId": "optional-session-id",
  "systemPrompt": "optional-override",
  "temperature": 0.7,
  "maxTokens": 4096,
  "stream": true,
  "noCache": false
}
```

**Response (non-streaming):**
```json
{
  "id": "execution-id",
  "model": "anthropic.claude-sonnet-4-20250514",
  "content": "Hello! How can I help you?",
  "usage": { "inputTokens": 10, "outputTokens": 25, "totalTokens": 35 },
  "cacheHit": false,
  "sessionId": "optional"
}
```

**Response (streaming):**
SSE stream of text chunks, terminated with a final chunk containing usage metadata.

### 6.2 POST /api/v1/inference/sessions

Create a new session.

**Request:**
```json
{
  "name": "Support Chat Session",
  "ttlHours": 24
}
```

**Response:**
```json
{
  "id": "session-id",
  "name": "Support Chat Session",
  "expiresAt": "2026-05-08T12:00:00Z"
}
```

### 6.3 GET /api/v1/inference/sessions/{id}

Retrieve session messages and metadata.

### 6.4 DELETE /api/v1/inference/sessions/{id}

Delete a session.

### 6.5 GET /api/v1/inference/usage

Current usage for this API key (today).

**Response:**
```json
{
  "date": "2026-05-07",
  "requestCount": 153,
  "tokenCount": 12340,
  "requestLimit": 1000,
  "tokenLimit": 100000
}
```

---

## 7. Key Lifecycle & Security

### 7.1 Creation

- Admin/tenant owner creates a key scoped to an agent.
- Raw key shown **once** (like AWS IAM keys). Only SHA-256 hash persisted.
- `keyPrefix` stored for UI display (e.g., `sk_live_a3f...`).

### 7.2 Rotation

- Create new key → mark old key `status = 'rotating'` with `gracePeriod` (default 24h).
- Old key still works during grace period; UI warns it's deprecated.
- After grace period, old key auto-revoked (`status = 'revoked'`).

### 7.3 Revocation

- Immediate: `status = 'revoked'`. All future calls return `401`.
- Record retained for audit.

### 7.4 Scopes

| Scope | Permission |
|---|---|
| `inference:read` | Invoke agents (default) |
| `inference:write` | Create/manage sessions |
| `inference:admin` | Manage keys (create/revoke for others) |

---

## 8. Webhooks (Optional)

- Each `ApiKey` can have an optional `webhookUrl`.
- On execution complete/fail, POST result payload to the URL.
- Signature via `X-Webhook-Signature: sha256=<hmac>` using tenant-level webhook secret.

---

## 9. Error Handling

Standardized error envelope:

```json
{
  "error": {
    "type": "quota_exceeded",
    "message": "Daily request limit of 1000 exceeded.",
    "code": "rate_limit_exceeded",
    "param": null
  }
}
```

| Error Type | HTTP | Description |
|---|---|---|
| `invalid_api_key` | `401` | Key not found or revoked |
| `quota_exceeded` | `429` | Daily or rate limit hit |
| `agent_not_found` | `404` | Agent inactive or missing |
| `session_expired` | `410` | Inference session TTL expired |
| `cache_error` | `500` | Internal cache read/write failure |
| `llm_error` | `502` | Upstream LLM provider failure |

---

## 10. UI & Dashboard

| Page | Route |
|---|---|
| API Keys | `/dashboard/agents/[id]/api-keys` |
| Usage Dashboard | `/dashboard/agents/[id]/usage` |
| Execution Logs | `/dashboard/agents/[id]/executions` |

---

## 11. Testing Strategy

| Layer | Coverage |
|---|---|
| Unit | `ApiKeyService` (hash, validate), `QuotaService` (counter logic), `ResponseCacheService` (key generation, TTL) |
| Integration | End-to-end inference call with API key auth, quota enforcement, cache hit/miss |
| E2E | Playwright: create key → call inference → verify usage dashboard |

---

## 12. Open Questions / Future Work

- Graph agent execution in the inference API (currently simulated in playground).
- Async webhook-only inference for long-running graph executions.
- Tenant-level cost analytics dashboard (aggregated across all agents).
