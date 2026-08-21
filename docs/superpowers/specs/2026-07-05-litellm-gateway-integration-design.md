# LiteLLM Gateway Integration

## Summary

Add `LITELLM` as a new LLM provider type so tenants can route chat/embedding traffic through a self-hosted LiteLLM proxy instead of (or alongside) Bedrock/OpenAI/etc. On setup, the backend automatically provisions a scoped virtual key for the tenant on the LiteLLM gateway — the tenant never sees or enters a key. At inference time, the existing `OpenAICompatibleProvider` handles the traffic unchanged, since LiteLLM's proxy speaks the OpenAI wire protocol. The gateway itself is configured to front both Bedrock (Claude) and self-hosted open models (Qwen/Gemma) via its own `model_list`, so switching a tenant off a commercial model onto a self-hosted one during a cost spike is a single-field edit (`chatModel`) on their existing provider row — no new keys, no redeploy, no app code change.

## Goals

- Tenants can select "LiteLLM Gateway" as a provider type in the existing LLM provider wizard.
- The app automatically provisions and revokes a per-tenant virtual key on the LiteLLM proxy — no manual key handling by tenants or admins.
- Per-tenant spend is trackable and budget-cappable via LiteLLM's own virtual-key budgeting.
- The gateway's `model_list` includes both Bedrock (Claude, via Global Cross-Region Inference) and self-hosted open models, reachable through the same tenant key, switchable via the existing `chatModel` field.
- Zero changes to the runtime inference path (`LLMProvider` interface, `streamChat`, `embed`).

## Non-Goals

- Migrating existing Bedrock-direct tenants onto LiteLLM (this is additive — a new opt-in provider type).
- Fixing/tuning the self-hosted model serving (SGLang GPU OOM, model choice/quantization) — tracked separately, out of scope here. This spec treats the self-hosted `api_base` as "whatever OpenAI-compatible endpoint is running," and lists Gemma 4 (E2B/E4B) and Qwen3.5-0.8B as the intended future targets without designing their deployment.
- Automatic cost-based routing/fallback inside LiteLLM (e.g. auto-switch on budget threshold) — the switch is a manual one-field edit for now.
- Replacing the existing direct-Bedrock path (`BedrockLLMProvider`) — it stays as-is for tenants who don't opt into LiteLLM.

## Background

The codebase already has a working per-tenant `LLMProvider` abstraction (`libs/ai/src/provider.ts`, `provider-factory.ts`) with an `OpenAICompatibleProvider` that accepts any `baseUrl`/`apiKey` and works against any OpenAI-wire-protocol endpoint. A LiteLLM proxy is already running (Docker, on an existing EC2 GPU instance) with:

- `litellm-proxy` (port 4000) + `litellm-db` (Postgres, internal-only) — virtual-key/spend-tracking infra already present.
- `sglang` serving self-hosted models on the box's GPU (currently crash-looping on a CUDA OOM loading `zai-org/GLM-4.7-Flash` — a pre-existing, separate issue, out of scope here).
- `litellm_config.yaml` at `/opt/llm-stack/litellm_config.yaml` with a hardcoded dev `master_key` and two model entries pointing at `sglang`.
- A security group (`llm-inference-sg`) with an overly broad `-1/0.0.0.0/0` (all ports, all protocols, whole internet) rule, plus explicit public rules for several other services on the box (open-webui, speaches-stt, Ollama, LM Studio).

This spec wires the chatbot app to that gateway safely and with real per-tenant isolation, rather than sharing one key across all tenants.

## Architecture

```
Setup (once per LlmProvider row, synchronous HTTP call):
  Wizard → POST /api/llm-providers → LlmProviderService.create()
    → LiteLLMAdminClient.generateVirtualKey()  [POST gateway/key/generate, master key, 8s timeout + retry]
    → encrypt + store virtual key in LlmProvider.credentials (existing mechanism, unchanged)

Inference (every chat message — existing mechanism, unchanged):
  createLLMProvider(tenantConfig) → OpenAICompatibleProvider(baseUrl=gateway, apiKey=tenant's virtual key)
    → LiteLLM proxy /v1/chat/completions → routes by `model` name to:
        - bedrock/global.anthropic.claude-sonnet-4-6  (via AWS Bedrock Global CRIS)
        - openai/<self-hosted-model>                  (via sglang on the box's GPU)

Teardown:
  DELETE /api/llm-providers/:id → LiteLLMAdminClient.revokeVirtualKey() → POST gateway/key/delete
```

Key property: LiteLLM is invisible to the runtime inference code. All new logic lives in the *provisioning* control plane (`LlmProviderService` + a small admin client), not the data plane (`streamChat`/`embed`).

## Data Model

### Prisma Schema Changes

```prisma
model LlmProvider {
  // ...existing fields unchanged...
  maxBudgetUsd      Float?   // passed as max_budget to LiteLLM's /key/generate; null = unlimited
  externalKeyAlias  String?  // the key_alias we chose when generating the key; needed to revoke it later
}
```

`providerType` gains a new allowed string value: `LITELLM`. Migration adds two nullable columns — no backfill required, no data migration for existing rows.

## Backend Architecture

### LiteLLMAdminClient (new)

New file: `libs/shared/src/services/litellm-admin-client.ts`

```typescript
export class LiteLLMProvisioningError extends Error {}

export class LiteLLMAdminClient {
  constructor(
    private readonly gatewayUrl: string,
    private readonly masterKey: string,
  ) {}

  async generateVirtualKey(opts: {
    tenantId: string;
    providerId: string;
    maxBudgetUsd?: number;
  }): Promise<{ key: string; keyAlias: string }> {
    const keyAlias = `tenant-${opts.tenantId}-${opts.providerId}`;
    // POST {gatewayUrl}/key/generate
    // body: { key_alias: keyAlias, max_budget: opts.maxBudgetUsd, metadata: { tenantId: opts.tenantId } }
    // Authorization: Bearer {masterKey}
    // 8s timeout via AbortController, 2 retries with backoff on network failure
    // Returns { key, keyAlias } — key_alias is echoed back from what we sent, not parsed from response
  }

  async revokeVirtualKey(keyAlias: string): Promise<void> {
    // POST {gatewayUrl}/key/delete
    // body: { key_aliases: [keyAlias] }
  }
}
```

- We choose `key_alias` ourselves (deterministic, always unique since `providerId` is a fresh cuid generated before the row is created) rather than depending on the response to tell us what alias was assigned.
- All calls logged via the shared Pino logger with `{ tenantId, providerId }` context — the virtual key and master key are never logged.
- Non-2xx or network failure throws `LiteLLMProvisioningError`, caught by the API route and turned into a clean error response.

### LlmProviderService changes

File: `libs/shared/src/services/llm-provider-service.ts`

- `create(input)`:
  1. Generate the row's `id` up front via `createId()` (cuid2) so it's available before the DB write.
  2. If `input.providerType === 'LITELLM'`: call `LiteLLMAdminClient.generateVirtualKey({ tenantId, providerId: id, maxBudgetUsd: input.maxBudgetUsd })` **before** writing the DB row. On failure, throw immediately — no row is created.
  3. On success, store `credentials = encrypt(JSON.stringify({ apiKey: generatedKey }))` and `externalKeyAlias = keyAlias`, using the existing `EncryptionService` — same mechanism as every other provider type.
  4. For all other provider types, behavior is unchanged.
- `delete(id)`:
  1. If the row's `providerType === 'LITELLM'` and `externalKeyAlias` is set, call `LiteLLMAdminClient.revokeVirtualKey(externalKeyAlias)` first.
  2. If revocation fails, log at `error` severity with full context and **still proceed** to delete the local row. This is a deliberate trade-off: availability of the delete operation over guaranteed cleanup on the gateway. A rare revoke failure leaves an orphaned (but budget-capped, alias-namespaced) key on the gateway rather than an undeletable row in the app — accepted, not silently swallowed (it's logged at `error`, not `warn`).
- `getDefaultConfig()` / `getConfigById()`: for `LITELLM` rows, inject `baseUrl: env.LITELLM_GATEWAY_URL` (from server env — one shared gateway for all tenants, not stored per-row) into the `TenantLLMConfig` returned for `libs/ai` consumption.

### Provider factory & discovery (minimal changes)

- `libs/ai/src/types.ts`: add `'litellm'` to `ProviderName`.
- `libs/ai/src/provider-factory.ts`: add `case 'litellm': return new OpenAICompatibleProvider(effectiveConfig);` — reuses the existing runtime class, no new inference code.
- `libs/ai/src/discovery/index.ts`: add `case 'LITELLM': return new OpenAIModelDiscovery();` — reuses the existing discovery class as-is, since LiteLLM's `/v1/models` is OpenAI-shaped.

### API routes

- `POST /api/llm-providers/validate`: for `providerType === 'LITELLM'`, run discovery against `env.LITELLM_GATEWAY_URL` using the **master key** server-side (no tenant key exists yet at validate time) — same response shape as today (`{ success, models, error }`), so the wizard's model-selection step needs no UI changes beyond adding the new provider type.
- `POST /api/llm-providers`: on `LITELLM`, triggers key generation as described above. Returns a clean error (no partial state) if provisioning fails.
- `DELETE /api/llm-providers/:id`: triggers key revocation as described above.

### Validation (Zod)

File: `libs/shared/src/validation/schemas/llm-provider.ts`

- Add `'LITELLM'` to `ProviderTypeEnum`.
- Add optional `maxBudgetUsd: z.number().positive().optional()` to `CreateLlmProviderSchema` (and inherited by `UpdateLlmProviderSchema`).
- Client-supplied `credentials` for `LITELLM` type is accepted by the schema (it's a subset of the existing generic `CredentialsSchema`) but **ignored server-side** — the service layer never trusts tenant-supplied credentials for this provider type; the key always comes from `LiteLLMAdminClient`.

## Environment Variables

Added to `libs/shared/src/env.ts` (same file that already validates `ENCRYPTION_KEY` for this service layer):

| Variable | Required | Description |
|----------|----------|--------------|
| `LITELLM_GATEWAY_URL` | Only if any tenant uses `LITELLM` | Base URL of the LiteLLM proxy, e.g. `http://<host>:4000`. Shared across all tenants. |
| `LITELLM_MASTER_KEY` | Only if any tenant uses `LITELLM` | Server-side only secret used exclusively by `LiteLLMAdminClient` for provisioning calls. Never stored per-tenant, never sent to the frontend. |

## Frontend Architecture

### LlmProviderForm changes

- Add "LiteLLM Gateway" as a 7th `providerType` option in the wizard's Step 1 select.
- Step 2 (Credentials) for `LITELLM`: no `baseUrl`/`apiKey` inputs. Instead, a single optional "Monthly Budget (USD)" number field, with help text: "We'll automatically provision an isolated API key for this tenant on the shared LiteLLM gateway."
- Step 3 (Validate & Discover Models): unchanged UX — "Validate" calls the existing endpoint, which for `LITELLM` hits the gateway with the master key server-side and returns the configured model list (Claude via Bedrock + whichever self-hosted models are configured) for selection.
- Submit button disabled while the create request is in flight, to prevent a double-click from generating two keys for one tenant.

## Gateway-Side Configuration (infra, not app code)

On the existing EC2 box, `/opt/llm-stack/litellm_config.yaml`:

```yaml
model_list:
  - model_name: claude-sonnet-4-6-global
    litellm_params:
      model: bedrock/global.anthropic.claude-sonnet-4-6
      aws_region_name: ap-south-1
      aws_access_key_id: os.environ/AWS_ACCESS_KEY_ID
      aws_secret_access_key: os.environ/AWS_SECRET_ACCESS_KEY
      # No `api_key` field for Bedrock entries — LiteLLM tries to use it instead of
      # the AWS credential chain if present, and auth fails silently.

  # Self-hosted models — placeholders until the deployment work (tracked separately) lands.
  # Pattern shown for whichever OpenAI-compatible engine ends up serving them (sglang/vLLM/etc).
  - model_name: gemma-4-e4b
    litellm_params:
      model: openai/gemma-4-e4b
      api_base: http://sglang:30000/v1
      api_key: "no-key"
  - model_name: qwen3.5-0.8b
    litellm_params:
      model: openai/qwen3.5-0.8b
      api_base: http://sglang:30000/v1
      api_key: "no-key"

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY   # remove the hardcoded "sk-local-proxy" value
  database_url: os.environ/DATABASE_URL

litellm_settings:
  drop_params: true
```

- **AWS credentials for the Bedrock entry**: a dedicated, narrowly-scoped IAM user/role (only `bedrock:InvokeModel*` on the specific Claude model), supplied via container env — not the app's broader AWS credentials.
- **Master key**: rotate off the current placeholder (`sk-local-proxy`) to a strong generated secret, sourced only from the `LITELLM_MASTER_KEY` container env var (already present per `docker inspect`), not the plaintext YAML.
- **Security group (`llm-inference-sg`)**: replace the current `-1 / 0.0.0.0/0` (all ports, whole internet) rule with a scoped rule for port 4000 restricted to the app's known egress IP(s)/CIDR. The other currently-public ports (3000 open-webui, 8000 speaches-stt, 8002 XTTS, 1234 LM Studio, 11434 Ollama, 30000 sglang) should be closed to the internet unless a specific reason requires them public — none of them need to be reachable by the chatbot app, only by the LiteLLM proxy internally (docker network).

## Error Handling

- `LiteLLMAdminClient` methods throw typed `LiteLLMProvisioningError` distinguishing timeout/network failure from a non-2xx gateway response; every throw is preceded by a `logger.error` call with `{ tenantId, providerId }` context (never the key values).
- `POST /api/llm-providers` catches provisioning errors and returns a typed error response (e.g. 502) with no DB row left behind.
- `DELETE /api/llm-providers/:id` logs revoke failures at `error` but does not block local deletion (see trade-off noted under Backend Architecture).
- Existing Zod `safeParse` validation pattern applies unchanged to the new fields.

## Testing Strategy

- **Unit**:
  - `LiteLLMAdminClient` — mock `fetch`; cover success, timeout (verify retry/backoff), and non-2xx response paths.
  - `LlmProviderService.create()` — mock the admin client; verify encrypted credentials are stored on success, verify no DB row is created when provisioning fails.
  - `LlmProviderService.delete()` — mock the admin client; verify revoke is called for `LITELLM` rows, verify local deletion still proceeds if revoke throws (and that it's logged).
- **Integration**: extend existing `/api/llm-providers` route tests to cover the `LITELLM` provider-type path with a mocked gateway.
- **Manual pilot**: one real tenant against the actual EC2 gateway — create the provider through the UI, run a chat in the playground, confirm streaming works end-to-end, confirm spend appears in LiteLLM's own Postgres/dashboard, delete the provider, confirm the key is gone (`/key/info` returns not-found).

## Rollout / Migration Plan

1. **Infra (EC2, manual, no app code)**: narrow the security group, rotate the master key off the placeholder, add the Bedrock model entry (with scoped IAM credentials) to `litellm_config.yaml`.
2. **Prisma migration**: add `maxBudgetUsd`, `externalKeyAlias` columns; extend the `providerType` value set to include `LITELLM`.
3. **Backend**: `LiteLLMAdminClient`, `LlmProviderService` changes, provider-factory/discovery/validation wiring, new env vars.
4. **Frontend**: wizard changes for the `LITELLM` provider type.
5. **Tests**: unit + integration as above.
6. **Manual pilot** with one real tenant before wider rollout.
7. *(Tracked separately, not part of this rollout)*: deploy Gemma 4 (E2B/E4B) and/or Qwen3.5-0.8B on the EC2 box's GPU, replacing the current crash-looping GLM-4.7-Flash config, and update the `model_list` placeholder entries above with the real served model names.

## Open Questions

- Should `maxBudgetUsd` be enforced as a hard cutoff (LiteLLM blocks further requests once exceeded) or just a monitored soft limit? Deferred to LiteLLM's own default `/key/generate` budget behavior for now — revisit once real spend data exists.
- Should there be a periodic reconciliation job to catch and clean up any orphaned gateway keys from failed revocations? Not built in this pass — the failure mode is logged and rare; revisit if it turns out to happen in practice.
