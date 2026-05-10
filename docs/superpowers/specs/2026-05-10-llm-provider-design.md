# LLM Provider Configuration Redesign

## Summary

Redesign the LLM provider configuration module to support multiple providers (AWS Bedrock, OpenAI, Anthropic, Ollama, vLLM, OpenAI Compatible) with per-tenant encrypted credential storage, dynamic model discovery, and a multi-step wizard UI.

## Goals

- Support 6 provider types with provider-specific credential inputs.
- Encrypt per-tenant credentials at rest using AES-256-GCM.
- Dynamically discover available models from each provider via API.
- Let tenants configure which chat and embedding models to use.
- Maintain backward compatibility with existing `LlmProvider` records during migration.

## Non-Goals

- No external secrets manager integration (AWS Secrets Manager, HashiCorp Vault).
- No credential rotation scheduling.
- No usage-based billing or per-provider cost tracking.

## Background

The current module supports only `bedrock` and `openai` (openai-compatible) as provider strings. The Bedrock provider uses the host environment's AWS credential chain with no tenant-level override. The OpenAI-compatible provider stores a single `apiKey` and `baseUrl` in plaintext. Users must manually type model IDs with no validation. The UI is a single flat form with no model discovery.

## Data Model

### Prisma Schema Changes

```prisma
model LlmProvider {
  id                  String   @id @default(cuid())
  tenantId            String
  name                String
  providerType        String   // BEDROCK | OPENAI | ANTHROPIC | OLLAMA | VLLM | OPENAI_COMPATIBLE
  region              String?
  credentials         String?  // AES-256-GCM encrypted JSON blob (iv:ciphertext:tag base64)
  chatModel           String?
  embeddingModel      String?
  embeddingDimensions Int?
  models              Json?    // { models: [{ id, name, capabilities: [] }] }
  isDefault           Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([tenantId, isDefault])
  @@unique([tenantId, name])
  @@map("llm_providers")
}
```

**Migration:**
- Rename `provider` column to `providerType`.
- Migrate existing `apiKey` and `baseUrl` values into the new `credentials` JSON blob, encrypt them, and store in `credentials`.
- Drop `apiKey` and `baseUrl` columns.
- Add `region`, `credentials`, `models` columns.
- Map existing `bedrock` → `BEDROCK`, `openai` → `OPENAI_COMPATIBLE`.

### Credential JSON Shape per Provider

```typescript
// BEDROCK
{ accessKeyId?: string; secretAccessKey?: string }
// If omitted, falls back to host credential chain

// OPENAI
{ apiKey: string }

// ANTHROPIC
{ apiKey: string }

// OLLAMA
{ baseUrl: string; apiKey?: string }

// VLLM
{ baseUrl: string; apiKey?: string }

// OPENAI_COMPATIBLE
{ baseUrl: string; apiKey: string }
```

## Backend Architecture

### EncryptionService

New file: `libs/shared/src/services/encryption-service.ts`

- Reads `ENCRYPTION_KEY` from environment at startup (32-byte hex string).
- `encrypt(plaintext: string): string` — generates random IV, AES-256-GCM encrypts, returns `base64(iv:ciphertext:authtag)`.
- `decrypt(ciphertext: string): string` — parses base64, verifies tag, decrypts, returns plaintext.
- Throws at startup if `ENCRYPTION_KEY` is missing or not 64 hex chars.

### LlmProviderService (Refactored)

File: `libs/shared/src/services/llm-provider-service.ts`

Updated methods:
- `create(input)` — serializes `credentials` to JSON, encrypts, stores.
- `update(id, input)` — same encryption flow. If `credentials` not provided in update, leave existing encrypted value untouched.
- `findById(id)` — decrypts `credentials` before returning. API consumers see the decrypted object, never ciphertext.
- `validateAndDiscoverModels({ providerType, credentials, region })` — decrypts if needed, instantiates the correct discovery class, calls provider API, returns `{ success, models, error }`.
- `refreshModels(id)` — re-runs discovery using stored credentials, updates `models` cache.
- `getDefaultConfig()` — decrypts credentials, returns `TenantLLMConfig` for `libs/ai` consumption.

### Model Discovery Module

New directory: `libs/ai/src/discovery/`

Each discovery class implements:
```typescript
interface ModelDiscovery {
  discover(credentials: Record<string, string>, region?: string): Promise<DiscoveredModel[]>;
}

type DiscoveredModel = {
  id: string;
  name: string;
  capabilities: ('chat' | 'embedding')[];
  contextWindow?: number;
};
```

**Providers:**
- `BedrockModelDiscovery` — `@aws-sdk/client-bedrock-runtime` `ListFoundationModels`. Filters `provider == 'anthropic' || 'amazon' || 'meta'`. Marks capabilities based on model ID patterns.
- `OpenAIModelDiscovery` — `GET {baseUrl}/v1/models` with `Authorization: Bearer {apiKey}`.
- `AnthropicModelDiscovery` — Anthropic REST API `GET /v1/models`.
- `OllamaModelDiscovery` — `GET {baseUrl}/api/tags`.
- `VllmModelDiscovery` — `GET {baseUrl}/v1/models` (OpenAI-compatible).

### API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/llm-providers/validate` | Validate credentials and discover models. Body: `{ providerType, credentials, region }`. Response: `{ success, models, error }`. |
| `GET` | `/api/llm-providers` | List providers for tenant. Returns decrypted credentials (never ciphertext). |
| `POST` | `/api/llm-providers` | Create provider. Encrypts credentials. |
| `GET` | `/api/llm-providers/:id` | Get provider. Returns decrypted credentials. |
| `PUT` | `/api/llm-providers/:id` | Update provider. Re-encrypts credentials if changed. |
| `DELETE` | `/api/llm-providers/:id` | Delete provider. |
| `POST` | `/api/llm-providers/:id/set-default` | Set as default. |
| `POST` | `/api/llm-providers/:id/refresh-models` | Re-run discovery with stored credentials, update cache. |

**Security rule:** API responses never include raw credential values. On read, the `credentials` field is replaced with a masked hint: `{ configured: true, apiKeyHint: 'sk-...abc' }`. The edit form shows empty credential inputs; the user must re-enter to change.

## Validation (Zod)

All input validation — frontend forms and backend API routes — uses Zod, matching the existing project standard.

### Shared Zod Schemas

New file: `libs/shared/src/validation/llm-provider.ts`

```typescript
export const ProviderTypeEnum = z.enum([
  'BEDROCK',
  'OPENAI',
  'ANTHROPIC',
  'OLLAMA',
  'VLLM',
  'OPENAI_COMPATIBLE',
]);

export const BedrockCredentialsSchema = z.object({
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
});

export const OpenAICredentialsSchema = z.object({
  apiKey: z.string().min(1),
});

export const AnthropicCredentialsSchema = z.object({
  apiKey: z.string().min(1),
});

export const OllamaCredentialsSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
});

export const VllmCredentialsSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
});

export const OpenAiCompatibleCredentialsSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
});

export const CredentialsSchema = z.union([
  BedrockCredentialsSchema,
  OpenAICredentialsSchema,
  AnthropicCredentialsSchema,
  OllamaCredentialsSchema,
  VllmCredentialsSchema,
  OpenAiCompatibleCredentialsSchema,
]);

export const ValidateInputSchema = z.object({
  providerType: ProviderTypeEnum,
  credentials: CredentialsSchema,
  region: z.string().optional(),
});

export const CreateLlmProviderSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: ProviderTypeEnum,
  region: z.string().optional(),
  credentials: CredentialsSchema,
  chatModel: z.string().optional(),
  embeddingModel: z.string().optional(),
  embeddingDimensions: z.number().int().positive().optional(),
  isDefault: z.boolean().optional(),
});

export const UpdateLlmProviderSchema = CreateLlmProviderSchema.partial().omit({}).extend({
  credentials: CredentialsSchema.optional(),
});
```

### Frontend
- `LlmProviderForm` uses `@tanstack/react-form` with Zod validators (existing pattern).
- Each wizard step validates its fields via Zod before allowing progression.
- Credential fields are conditionally validated based on `providerType`.

### Backend
- Every API route (`POST /validate`, `POST /`, `PUT /:id`) validates the request body with the shared Zod schemas before processing.
- `safeParse` is used; on failure, return `400` with the first Zod issue message.
- The `LlmProviderService` accepts already-validated input (Post-Zod types), never raw `any`.

## Frontend Architecture

### LlmProviderForm (3-Step Wizard)

**Step 1: Provider Type & Name**
- Name input (free text, required).
- Provider type `<Select>` with 6 options.
- Region input (shown only when `providerType === 'BEDROCK'`).

**Step 2: Credentials**
- Dynamic fields based on provider:
  - **Bedrock:** Access Key ID (optional, password), Secret Access Key (optional, password). Help text: "Leave blank to use host AWS credentials."
  - **OpenAI:** API Key (required, password).
  - **Anthropic:** API Key (required, password).
  - **Ollama:** Base URL (required, text, default `http://localhost:11434`), API Key (optional, password).
  - **vLLM:** Base URL (required, text), API Key (optional, password).
  - **OpenAI Compatible:** Base URL (required, text), API Key (required, password).

**Step 3: Validate & Select Models**
- "Validate & Discover Models" button triggers `useValidateProvider` mutation.
- On success: two `<Select>` dropdowns appear — "Chat Model" and "Embedding Model" — populated from discovered models, filtered by `capabilities`.
- If no models have `embedding` capability, the embedding dropdown is hidden.
- "Embedding Dimensions" input — auto-populated from model metadata if available, otherwise manual.
- "Set as default provider" `<Switch>`.

### Updated Hooks

- `useValidateProvider` — mutation for `/api/llm-providers/validate`.
- `useRefreshModels(id)` — mutation for `/api/llm-providers/:id/refresh-models`.
- Updated `useCreateLlmProvider`, `useUpdateLlmProvider` — send full `credentials` object in payload.

### Updated Listing Page

- Provider cards show: name, `providerType` badge, selected chat model, default badge.
- Edit link navigates to `/agents/llm-providers/[id]/edit`.
- New "Refresh Models" button on each card to re-run discovery.

## Error Handling

- **Discovery failure:** Return `{ success: false, error: "Invalid API key or insufficient permissions" }`. UI shows inline error below the validate button.
- **Encryption key missing:** Server throws at startup. `bun run dev` logs a fatal error and exits.
- **Credential decryption failure:** If `ENCRYPTION_KEY` changed or ciphertext corrupted, `findById` throws. API returns 500 with generic message. UI shows toast.
- **Validation schema errors:** Zod returns 400 with first error message.

## Testing Strategy

- **Unit:**
  - `EncryptionService` — round-trip encrypt/decrypt, tamper detection (wrong tag), missing key behavior.
  - Each discovery class — mock HTTP responses, test filtering and capability mapping.
  - `LlmProviderService` — mock Prisma, verify encryption on create/update, decryption on read, masked hints in responses.
- **Integration:**
  - API route tests for `/api/llm-providers/validate` with mocked discovery.
  - End-to-end: create a provider, validate, select models, save, verify listing.

## Rollout / Migration Plan

1. Add `ENCRYPTION_KEY` to `.env.example` and document generation command (`openssl rand -hex 32`).
2. Create Prisma migration: rename `provider`→`providerType`, add `region`/`credentials`/`models`, migrate and encrypt existing `apiKey`/`baseUrl` into `credentials`, drop old columns.
3. Deploy backend changes (new services, API routes, discovery module).
4. Deploy frontend changes (wizard form, updated hooks, listing page).
5. Verify existing providers still work (credentials decrypted correctly, models still selectable).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ENCRYPTION_KEY` | Yes | 64-char hex string (32 bytes). Used for AES-256-GCM. |

## Open Questions

- Should we cache discovered models with a TTL (e.g., refresh daily), or only on explicit user action?
- Should Bedrock discovery filter by `outputModalities.includes('TEXT')` to exclude image-only models?
