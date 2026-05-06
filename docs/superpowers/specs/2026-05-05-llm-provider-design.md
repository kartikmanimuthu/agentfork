# LLM Provider Abstraction Design Spec

**Date:** 2026-05-05  
**Status:** Approved  
**Scope:** Make chat inference and message embedding providers tenant-configurable, with Bedrock as the default and support for OpenAI-compatible endpoints (Ollama, vLLM, etc.).

---

## 1. Goals

- Allow each tenant to choose their LLM provider for **chat inference**.
- Default to **Amazon Bedrock** (zero breaking changes for existing tenants).
- Support **OpenAI-compatible endpoints** (Ollama, vLLM, OpenRouter, etc.) via a configurable `baseURL`.
- Keep the change surface minimal: reuse existing tenant-config (`TenantConfig`) and AI SDK dependencies.
- Do **not** touch the knowledge-base embedding subsystem; it already has its own per-KB provider abstraction.
- Do **not** make message (chat history) embeddings tenant-configurable in this iteration; they remain on the global Bedrock default to avoid a Prisma migration for variable vector dimensions.

## 2. Non-Goals

- Provider-level billing metering or cost tracking per tenant.
- UI for testing connectivity ("Test connection" button).
- Streaming token usage / cost logging per provider.
- Changing the knowledge-base embedding provider architecture (it remains independent).

## 3. Architecture

### 3.1 Core Interface

```typescript
// libs/ai/src/provider.ts
export interface LLMProvider {
  readonly name: string;
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;

  streamChat(options: StreamChatOptions): Promise<ReadableStream>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

### 3.2 Implementations

| Provider Class | AI SDK Wrapper | Use Case |
|---|---|---|
| `BedrockLLMProvider` | `@ai-sdk/amazon-bedrock` | Default. Uses `streamText` + `embed`/`embedMany` |
| `OpenAICompatibleProvider` | `@ai-sdk/openai` with `baseURL` | Ollama, vLLM, OpenRouter, or any OpenAI-compatible server |

### 3.3 Factory

```typescript
// libs/ai/src/provider-factory.ts
export function createLLMProvider(config: TenantLLMConfig): LLMProvider {
  switch (config.provider) {
    case 'bedrock': return new BedrockLLMProvider(config);
    case 'openai':  return new OpenAICompatibleProvider(config);
    default: throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
```

### 3.4 Tenant Configuration Schema

Stored in `TenantConfig` under key `llmConfig` (`Json`).

```typescript
interface TenantLLMConfig {
  provider: 'bedrock' | 'openai';
  chatModel?: string;        // default: Bedrock default or OpenAI 'gpt-4o'
  embeddingModel?: string;   // default: Bedrock Titan v2 or OpenAI 'text-embedding-3-large'
  baseUrl?: string;          // required when provider === 'openai'
  apiKey?: string;           // optional for local endpoints, required for cloud ones
}
```

Defaults (applied by API/UI when a key is missing):

| Field | Default (`bedrock`) | Default (`openai`) |
|---|---|---|
| `chatModel` | `anthropic.claude-sonnet-4-20250514` | `gpt-4o` |
| `embeddingModel` | `amazon.titan-embed-text-v2:0` | `text-embedding-3-large` |
| `embeddingDimensions` | `1024` | `3072` |

### 3.5 Environment Variables

No new env vars are required. Existing vars continue to work:
- `AWS_REGION` — used by Bedrock provider (already required).
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL` — unchanged.

Optional env vars for global fallback:
- `DEFAULT_LLM_PROVIDER` — overrides the hardcoded default for new tenants (`bedrock` or `openai`).
- `DEFAULT_OPENAI_BASE_URL` — global fallback `baseUrl` when a tenant hasn't configured one.

## 4. Data Flow

### 4.1 Chat Inference (`/api/chat`, `/api/agents/[id]/playground`)

1. Route extracts `tenantId` from the request (via `x-tenant-id` header set by middleware).
2. Calls `tenantConfigService.get<TenantLLMConfig>('llmConfig')`.
3. If missing, falls back to the global default (`provider: 'bedrock'`).
4. Invokes `createLLMProvider(config)`.
5. Passes the provider to `streamChat({ provider, messages, ... })`.
6. `streamChat` calls `provider.streamChat(...)` which delegates to the correct AI SDK wrapper.
7. Returns the `ReadableStream` to the client.

### 4.2 Message Embedding (Worker)

1. Worker reads the tenant ID from the job payload.
2. Fetches `TenantConfig` key `llmConfig`.
3. Creates provider via `createLLMProvider(config)`.
4. Calls `provider.embedBatch(texts)`.
5. Stores results in `Message.embedding` as `vector(1024)`.

### 4.3 Dimension Handling for Message Embeddings

**Decision:** Keep message embeddings globally hardcoded to Bedrock Titan v2 (`vector(1024)`) for this iteration. The per-tenant `llmConfig` will initially **only affect chat inference**. This avoids a Prisma migration and pgvector dimension headaches. A follow-up can make message embeddings tenant-configurable once we decide how to handle variable dimensions (dynamic column size, separate columns per dimension, or dimension-normalization).

## 5. File-Level Changes

### New Files

| Path | Purpose |
|---|---|
| `libs/ai/src/provider.ts` | `LLMProvider` interface |
| `libs/ai/src/types.ts` | `TenantLLMConfig`, `ProviderName` |
| `libs/ai/src/providers/bedrock.ts` | `BedrockLLMProvider` implementation |
| `libs/ai/src/providers/openai-compatible.ts` | `OpenAICompatibleProvider` implementation |
| `libs/ai/src/provider-factory.ts` | `createLLMProvider()` factory |

### Modified Files

| Path | Change |
|---|---|
| `libs/ai/src/chat-completion.ts` | Accept `provider` in `StreamChatOptions`; call `provider.streamChat(...)` instead of hardcoded Bedrock |
| `libs/ai/src/embeddings.ts` | Accept `provider` parameter; delegate to `provider.embed` / `provider.embedBatch` |
| `libs/ai/src/index.ts` | Export new public API |
| `apps/web-ui/app/api/chat/route.ts` | Read tenant `llmConfig`, create provider, pass to `streamChat` |
| `apps/web-ui/app/api/agents/[id]/playground/route.ts` | Same |
| `apps/web-ui/app/api/tenants/settings/route.ts` | Add `llmConfig` to GET/PUT payload |
| `apps/web-ui/app/(dashboard)/settings/organization/page.tsx` | Add LLM provider selector UI |
| `apps/workers/src/jobs/conversation-summary/handler.ts` | Use factory + provider |
| `apps/workers/src/jobs/message-embedding/handler.ts` | No change — remains on global Bedrock default to avoid vector dimension migration |

### Unchanged Files

- `libs/knowledge-base/**` — KB embeddings remain independent.
- `prisma/schema.prisma` — No migration needed for chat inference; message embedding dimensions stay `vector(1024)`.

## 6. Error Handling

| Scenario | Handling |
|---|---|
| Unknown `provider` value in tenant config | Factory throws `Error`; API route catches and returns `400 Bad Request` |
| `provider === 'openai'` but `baseUrl` missing | Factory throws; API returns `400` with `"OpenAI provider requires baseUrl"` |
| Ollama/vLLM unreachable | AI SDK throws network error; route returns `503 Service Unavailable` |
| Invalid `apiKey` | AI SDK returns authentication error; route returns `502 Bad Gateway` with provider message |
| Missing tenant config entirely | Falls back to Bedrock default (no error) |

## 7. Security & RBAC

- **Read `llmConfig`:** Any authenticated user with `Settings` `read` permission (all roles have this).
- **Update `llmConfig`:** Requires `Settings` `update` permission (Owner/Admin only).
- **API key exposure:** The `apiKey` field is **never** returned by `GET /api/tenants/settings`. The UI shows a masked placeholder (`••••••`). On `PUT`, an empty or masked string is treated as "keep existing" (read current value, merge).

## 8. Testing Strategy

| Layer | What to Test |
|---|---|
| **Unit (`libs/ai`)** | Factory returns correct provider class; `BedrockLLMProvider` delegates to `@ai-sdk/amazon-bedrock`; `OpenAICompatibleProvider` constructs `@ai-sdk/openai` with `baseURL`; missing `baseUrl` throws |
| **Integration (API routes)** | Mock `TenantConfigService`; test `/api/chat` with `bedrock` and `openai` configs; verify correct provider instantiated; verify `400` on bad config |
| **Integration (Workers)** | Mock provider; verify `conversation-summary` and `message-embedding` handlers use factory |
| **E2E (Settings UI)** | Open Organization Settings; select OpenAI provider; enter base URL; save; refresh; verify persisted |

## 9. Rollout Plan

1. **Phase 1:** Implement `libs/ai` provider abstraction + `bedrock` provider (refactor, no behavior change).
2. **Phase 2:** Implement `openai-compatible` provider + tenant config wiring.
3. **Phase 3:** UI changes (Organization Settings page).
4. **Phase 4:** Integration + E2E tests.
5. **Phase 5:** Merge to `main`; existing tenants see no change (default = Bedrock).

## 10. Open Questions (Resolved)

| Question | Resolution |
|---|---|
| Per-tenant or global config? | **Per-tenant** via `TenantConfig`. |
| Should message embeddings be configurable too? | **Not in this iteration.** Keep `vector(1024)` global default to avoid migration. Chat inference only is tenant-configurable. |
| How to handle API key in responses? | **Never return it.** Mask in UI; merge on PUT (empty = keep existing). |

---

*Spec written and committed by Claude Code. Awaiting implementation plan.*
