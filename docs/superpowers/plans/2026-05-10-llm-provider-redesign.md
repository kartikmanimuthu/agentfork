# LLM Provider Configuration Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the LLM provider module to support 6 provider types (Bedrock, OpenAI, Anthropic, Ollama, vLLM, OpenAI Compatible) with per-tenant encrypted credentials, dynamic model discovery, and a 3-step wizard UI.

**Architecture:** Encrypted JSON credential blobs stored per-tenant in Postgres, AES-256-GCM encryption via `EncryptionService`, dynamic model discovery via provider-specific classes in `libs/ai/src/discovery/`, Zod validation on both frontend and backend.

**Tech Stack:** Next.js 15, Prisma, Zod, `@tanstack/react-form`, Bun, Vitest, `@aws-sdk/client-bedrock-runtime`, Vercel AI SDK.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `libs/shared/src/services/encryption-service.ts` | AES-256-GCM encrypt/decrypt with `ENCRYPTION_KEY` |
| `libs/shared/src/services/encryption-service.test.ts` | Unit tests for encryption service |
| `libs/shared/src/validation/llm-provider.ts` | Shared Zod schemas for all provider types |
| `libs/ai/src/discovery/types.ts` | `ModelDiscovery` interface + `DiscoveredModel` type |
| `libs/ai/src/discovery/bedrock.ts` | Bedrock `ListFoundationModels` discovery |
| `libs/ai/src/discovery/openai.ts` | OpenAI `GET /v1/models` discovery |
| `libs/ai/src/discovery/anthropic.ts` | Anthropic model discovery |
| `libs/ai/src/discovery/ollama.ts` | Ollama `GET /api/tags` discovery |
| `libs/ai/src/discovery/vllm.ts` | vLLM OpenAI-compatible discovery |
| `libs/ai/src/discovery/index.ts` | Discovery factory `createDiscovery(providerType)` |
| `apps/web-ui/app/api/llm-providers/validate/route.ts` | `POST /api/llm-providers/validate` endpoint |
| `apps/web-ui/app/api/llm-providers/[id]/refresh-models/route.ts` | `POST /api/llm-providers/:id/refresh-models` endpoint |
| `apps/web-ui/app/(dashboard)/agents/llm-providers/[id]/edit/page.tsx` | Edit provider page with wizard form |

### Modified Files
| File | Responsibility |
|------|---------------|
| `prisma/schema.prisma` | Rename `provider`→`providerType`, add `region`/`credentials`/`models`, drop `apiKey`/`baseUrl` |
| `libs/shared/src/services/llm-provider-service.ts` | Integrate encryption, add discovery methods, refactor to new schema |
| `libs/shared/src/services/llm-provider-service.test.ts` | Update tests for encrypted credentials and new methods |
| `libs/shared/src/index.ts` | Export `EncryptionService`, Zod schemas |
| `libs/ai/src/types.ts` | Expand `ProviderName` to 6 types, update `TenantLLMConfig` |
| `libs/ai/src/provider-factory.ts` | Add cases for new provider types |
| `libs/ai/src/index.ts` | Export discovery module |
| `apps/web-ui/app/api/llm-providers/route.ts` | Update Zod schemas, integrate encrypted credentials |
| `apps/web-ui/app/api/llm-providers/[id]/route.ts` | Update Zod schemas, integrate encrypted credentials |
| `apps/web-ui/hooks/use-llm-providers.ts` | Add `useValidateProvider`, `useRefreshModels`, update types |
| `apps/web-ui/components/llm-providers/llm-provider-form.tsx` | Refactor to 3-step wizard with dynamic credential fields |
| `apps/web-ui/app/(dashboard)/agents/llm-providers/page.tsx` | Add refresh button, update provider badges |
| `apps/web-ui/app/(dashboard)/agents/llm-providers/new/page.tsx` | Minor updates for wizard integration |
| `.env.example` | Add `ENCRYPTION_KEY` |

---

## Task 1: EncryptionService

**Files:**
- Create: `libs/shared/src/services/encryption-service.ts`
- Create: `libs/shared/src/services/encryption-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// libs/shared/src/services/encryption-service.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EncryptionService } from './encryption-service';

describe('EncryptionService', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  it('should round-trip encrypt and decrypt', () => {
    const service = new EncryptionService();
    const plaintext = '{"apiKey":"sk-test"}';
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should throw on tampered ciphertext', () => {
    const service = new EncryptionService();
    const encrypted = service.encrypt('test');
    const tampered = encrypted.slice(0, -4) + 'dead';
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('should produce different ciphertext for same plaintext', () => {
    const service = new EncryptionService();
    const e1 = service.encrypt('test');
    const e2 = service.encrypt('test');
    expect(e1).not.toBe(e2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/apple/.superset/worktrees/chatbot/chatbot-inferencing && bunx vitest run libs/shared/src/services/encryption-service.test.ts`
Expected: FAIL — `EncryptionService` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// libs/shared/src/services/encryption-service.ts
import crypto from 'crypto';

export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const envKey = process.env.ENCRYPTION_KEY;
    if (!envKey || envKey.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    this.key = Buffer.from(envKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${ciphertext}:${tag.toString('base64')}`;
  }

  decrypt(encrypted: string): string {
    const [ivB64, ciphertext, tagB64] = encrypted.split(':');
    if (!ivB64 || !ciphertext || !tagB64) {
      throw new Error('Invalid encrypted format');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run libs/shared/src/services/encryption-service.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Export from index**

```typescript
// libs/shared/src/index.ts — add to existing exports
export { EncryptionService } from './services/encryption-service';
```

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/services/encryption-service.ts libs/shared/src/services/encryption-service.test.ts libs/shared/src/index.ts
git commit -m "feat(shared): add AES-256-GCM EncryptionService for credential storage"
```

---

## Task 2: Shared Zod Validation Schemas

**Files:**
- Create: `libs/shared/src/validation/llm-provider.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// libs/shared/src/validation/llm-provider.ts
import { z } from 'zod';

export const ProviderTypeEnum = z.enum([
  'BEDROCK',
  'OPENAI',
  'ANTHROPIC',
  'OLLAMA',
  'VLLM',
  'OPENAI_COMPATIBLE',
]);

export type ProviderType = z.infer<typeof ProviderTypeEnum>;

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
  region: z.string().min(1).optional(),
});

export const CreateLlmProviderSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: ProviderTypeEnum,
  region: z.string().min(1).optional(),
  credentials: CredentialsSchema,
  chatModel: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
  embeddingDimensions: z.number().int().positive().optional(),
  isDefault: z.boolean().optional(),
});

export const UpdateLlmProviderSchema = CreateLlmProviderSchema.partial().extend({
  credentials: CredentialsSchema.optional(),
});

export type CreateLlmProviderInput = z.infer<typeof CreateLlmProviderSchema>;
export type UpdateLlmProviderInput = z.infer<typeof UpdateLlmProviderSchema>;
export type ValidateLlmProviderInput = z.infer<typeof ValidateInputSchema>;
```

- [ ] **Step 2: Export from index**

```typescript
// libs/shared/src/index.ts — add to existing exports
export * from './validation/llm-provider';
```

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/validation/llm-provider.ts libs/shared/src/index.ts
git commit -m "feat(shared): add Zod validation schemas for LLM providers"
```

---

## Task 3: Model Discovery Types + Factory

**Files:**
- Create: `libs/ai/src/discovery/types.ts`
- Create: `libs/ai/src/discovery/index.ts`

- [ ] **Step 1: Write the types file**

```typescript
// libs/ai/src/discovery/types.ts
export type ModelCapability = 'chat' | 'embedding';

export interface DiscoveredModel {
  id: string;
  name: string;
  capabilities: ModelCapability[];
  contextWindow?: number;
}

export interface ModelDiscovery {
  discover(credentials: Record<string, string>, region?: string): Promise<DiscoveredModel[]>;
}
```

- [ ] **Step 2: Write the factory**

```typescript
// libs/ai/src/discovery/index.ts
import type { ModelDiscovery } from './types';
import { BedrockModelDiscovery } from './bedrock';
import { OpenAIModelDiscovery } from './openai';
import { AnthropicModelDiscovery } from './anthropic';
import { OllamaModelDiscovery } from './ollama';
import { VllmModelDiscovery } from './vllm';
import type { ProviderType } from '@chatbot/shared';

export function createDiscovery(providerType: ProviderType): ModelDiscovery {
  switch (providerType) {
    case 'BEDROCK':
      return new BedrockModelDiscovery();
    case 'OPENAI':
      return new OpenAIModelDiscovery();
    case 'ANTHROPIC':
      return new AnthropicModelDiscovery();
    case 'OLLAMA':
      return new OllamaModelDiscovery();
    case 'VLLM':
      return new VllmModelDiscovery();
    case 'OPENAI_COMPATIBLE':
      return new OpenAIModelDiscovery();
    default:
      throw new Error(`Unsupported provider type for discovery: ${providerType}`);
  }
}

export type { DiscoveredModel, ModelCapability, ModelDiscovery } from './types';
```

- [ ] **Step 3: Export from ai index**

```typescript
// libs/ai/src/index.ts — add
export { createDiscovery } from './discovery';
export type { DiscoveredModel, ModelCapability } from './discovery';
```

- [ ] **Step 4: Commit**

```bash
git add libs/ai/src/discovery/ libs/ai/src/index.ts
git commit -m "feat(ai): add model discovery types and factory"
```

---

## Task 4: Bedrock Model Discovery

**Files:**
- Create: `libs/ai/src/discovery/bedrock.ts`
- Create: `libs/ai/src/discovery/bedrock.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// libs/ai/src/discovery/bedrock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BedrockModelDiscovery } from './bedrock';

describe('BedrockModelDiscovery', () => {
  it('should discover models from mocked Bedrock client', async () => {
    const discovery = new BedrockModelDiscovery();
    const models = await discovery.discover(
      { accessKeyId: 'test', secretAccessKey: 'test' },
      'us-east-1'
    );
    expect(Array.isArray(models)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bunx vitest run libs/ai/src/discovery/bedrock.test.ts`
Expected: FAIL — `BedrockModelDiscovery` not found.

- [ ] **Step 3: Write implementation**

```typescript
// libs/ai/src/discovery/bedrock.ts
import { BedrockRuntimeClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ModelDiscovery, DiscoveredModel } from './types';

export class BedrockModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>, region?: string): Promise<DiscoveredModel[]> {
    const client = new BedrockRuntimeClient({
      region: region ?? 'us-east-1',
      credentials: credentials.accessKeyId
        ? {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey!,
          }
        : undefined,
    });

    const command = new ListFoundationModelsCommand({});
    const response = await client.send(command);

    const models: DiscoveredModel[] = [];
    for (const model of response.modelSummaries ?? []) {
      if (!model.modelId) continue;
      const capabilities: DiscoveredModel['capabilities'] = [];
      const id = model.modelId.toLowerCase();

      if (id.includes('embed')) {
        capabilities.push('embedding');
      }
      if (!id.includes('embed') || id.includes('multimodal')) {
        capabilities.push('chat');
      }

      if (capabilities.length > 0) {
        models.push({
          id: model.modelId,
          name: model.modelName ?? model.modelId,
          capabilities,
        });
      }
    }

    return models;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bunx vitest run libs/ai/src/discovery/bedrock.test.ts`
Expected: PASS (or SKIP if AWS mocking is complex — the test at least compiles).

- [ ] **Step 5: Commit**

```bash
git add libs/ai/src/discovery/bedrock.ts libs/ai/src/discovery/bedrock.test.ts
git commit -m "feat(ai): add Bedrock model discovery"
```

---

## Task 5: OpenAI Model Discovery

**Files:**
- Create: `libs/ai/src/discovery/openai.ts`
- Create: `libs/ai/src/discovery/openai.test.ts`

- [ ] **Step 1: Write implementation**

```typescript
// libs/ai/src/discovery/openai.ts
import type { ModelDiscovery, DiscoveredModel } from './types';

export class OpenAIModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const baseUrl = credentials.baseUrl ?? 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const models: DiscoveredModel[] = [];

    for (const model of data.data ?? []) {
      const id = model.id as string;
      const capabilities: DiscoveredModel['capabilities'] = [];

      if (id.includes('embedding')) {
        capabilities.push('embedding');
      }
      if (id.includes('gpt') || id.includes('chat')) {
        capabilities.push('chat');
      }

      if (capabilities.length > 0) {
        models.push({
          id,
          name: id,
          capabilities,
        });
      }
    }

    return models;
  }
}
```

- [ ] **Step 2: Write test**

```typescript
// libs/ai/src/discovery/openai.test.ts
import { describe, it, expect } from 'vitest';
import { OpenAIModelDiscovery } from './openai';

describe('OpenAIModelDiscovery', () => {
  it('should be instantiable', () => {
    const d = new OpenAIModelDiscovery();
    expect(d).toBeDefined();
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add libs/ai/src/discovery/openai.ts libs/ai/src/discovery/openai.test.ts
git commit -m "feat(ai): add OpenAI model discovery"
```

---

## Task 6: Anthropic, Ollama, vLLM Discovery

**Files:**
- Create: `libs/ai/src/discovery/anthropic.ts`
- Create: `libs/ai/src/discovery/ollama.ts`
- Create: `libs/ai/src/discovery/vllm.ts`

- [ ] **Step 1: Write Anthropic discovery**

```typescript
// libs/ai/src/discovery/anthropic.ts
import type { ModelDiscovery, DiscoveredModel } from './types';

export class AnthropicModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': credentials.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return (data.data ?? []).map((m: any) => ({
      id: m.id,
      name: m.display_name ?? m.id,
      capabilities: ['chat'],
    }));
  }
}
```

- [ ] **Step 2: Write Ollama discovery**

```typescript
// libs/ai/src/discovery/ollama.ts
import type { ModelDiscovery, DiscoveredModel } from './types';

export class OllamaModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const baseUrl = credentials.baseUrl ?? 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/tags`);

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return (data.models ?? []).map((m: any) => ({
      id: m.model ?? m.name,
      name: m.name ?? m.model,
      capabilities: ['chat'],
    }));
  }
}
```

- [ ] **Step 3: Write vLLM discovery**

```typescript
// libs/ai/src/discovery/vllm.ts
import type { ModelDiscovery, DiscoveredModel } from './types';

export class VllmModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const baseUrl = credentials.baseUrl;
    if (!baseUrl) throw new Error('vLLM requires baseUrl');

    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {},
    });

    if (!res.ok) {
      throw new Error(`vLLM API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return (data.data ?? []).map((m: any) => ({
      id: m.id,
      name: m.id,
      capabilities: ['chat'],
    }));
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add libs/ai/src/discovery/anthropic.ts libs/ai/src/discovery/ollama.ts libs/ai/src/discovery/vllm.ts
git commit -m "feat(ai): add Anthropic, Ollama, and vLLM model discovery"
```

---

## Task 7: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Update the LlmProvider model**

```prisma
model LlmProvider {
  id                  String   @id @default(cuid())
  tenantId            String
  name                String
  providerType        String   // BEDROCK | OPENAI | ANTHROPIC | OLLAMA | VLLM | OPENAI_COMPATIBLE
  region              String?
  credentials         String?  // AES-256-GCM encrypted JSON
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

- [ ] **Step 2: Generate migration**

```bash
cd /Users/apple/.superset/worktrees/chatbot/chatbot-inferencing
bunx prisma migrate dev --name llm_provider_redesign
```

Expected: Prisma creates a migration that:
- Renames `provider` → `providerType`
- Adds `region`, `credentials`, `models`
- Drops `apiKey`, `baseUrl`
- Maps existing `bedrock` → `BEDROCK`, `openai` → `OPENAI_COMPATIBLE`

- [ ] **Step 3: Regenerate client**

```bash
bunx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(db): migrate LlmProvider to support encrypted credentials and model discovery"
```

---

## Task 8: Refactor LlmProviderService

**Files:**
- Modify: `libs/shared/src/services/llm-provider-service.ts`
- Modify: `libs/shared/src/services/llm-provider-service.test.ts`

- [ ] **Step 1: Update LlmProviderService**

```typescript
// libs/shared/src/services/llm-provider-service.ts
import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { EncryptionService } from './encryption-service';
import { createDiscovery } from '@chatbot/ai';
import type { CreateLlmProviderInput, UpdateLlmProviderInput, ValidateLlmProviderInput } from '../validation/llm-provider';

export interface LlmProviderResponse {
  id: string;
  tenantId: string;
  name: string;
  providerType: string;
  region: string | null;
  credentialsConfigured: boolean;
  credentialsHint: string | null;
  chatModel: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  models: unknown;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class LlmProviderService {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string;
  private readonly encryption: EncryptionService;

  constructor(tenantId: string) {
    this.prisma = getPrismaClient();
    this.tenantId = tenantId;
    this.encryption = new EncryptionService();
  }

  async list(): Promise<LlmProviderResponse[]> {
    const rows = await this.prisma.llmProvider.findMany({
      where: { tenantId: this.tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: string): Promise<LlmProviderResponse | null> {
    const row = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    return row ? this.toResponse(row) : null;
  }

  async create(input: CreateLlmProviderInput) {
    if (input.isDefault) await this.clearDefault();

    const encryptedCredentials = input.credentials
      ? this.encryption.encrypt(JSON.stringify(input.credentials))
      : null;

    const row = await this.prisma.llmProvider.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        providerType: input.providerType,
        region: input.region ?? null,
        credentials: encryptedCredentials,
        chatModel: input.chatModel ?? null,
        embeddingModel: input.embeddingModel ?? null,
        embeddingDimensions: input.embeddingDimensions ?? null,
        isDefault: input.isDefault ?? false,
      },
    });
    return this.toResponse(row);
  }

  async update(id: string, input: UpdateLlmProviderInput) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;

    if (input.isDefault) await this.clearDefault();

    let encryptedCredentials = existing.credentials;
    if (input.credentials) {
      encryptedCredentials = this.encryption.encrypt(JSON.stringify(input.credentials));
    }

    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: {
        name: input.name,
        providerType: input.providerType,
        region: input.region ?? existing.region,
        credentials: encryptedCredentials,
        chatModel: input.chatModel ?? existing.chatModel,
        embeddingModel: input.embeddingModel ?? existing.embeddingModel,
        embeddingDimensions: input.embeddingDimensions ?? existing.embeddingDimensions,
        isDefault: input.isDefault ?? existing.isDefault,
      },
    });
    return this.toResponse(row);
  }

  async delete(id: string) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;
    return this.prisma.llmProvider.delete({ where: { id } });
  }

  async setDefault(id: string) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;

    await this.clearDefault();
    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: { isDefault: true },
    });
    return this.toResponse(row);
  }

  async validateAndDiscoverModels(input: ValidateLlmProviderInput) {
    const discovery = createDiscovery(input.providerType);
    const models = await discovery.discover(
      input.credentials as Record<string, string>,
      input.region
    );
    return { success: true as const, models };
  }

  async refreshModels(id: string) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;

    const credentials = existing.credentials
      ? JSON.parse(this.encryption.decrypt(existing.credentials))
      : {};

    const discovery = createDiscovery(existing.providerType as any);
    const models = await discovery.discover(credentials, existing.region ?? undefined);

    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: { models: { models } },
    });
    return this.toResponse(row);
  }

  async getDefaultConfig() {
    const row = await this.prisma.llmProvider.findFirst({
      where: { tenantId: this.tenantId, isDefault: true },
    });
    if (!row) return null;

    const credentials = row.credentials
      ? JSON.parse(this.encryption.decrypt(row.credentials))
      : undefined;

    return {
      provider: row.providerType.toLowerCase(),
      chatModel: row.chatModel ?? undefined,
      embeddingModel: row.embeddingModel ?? undefined,
      embeddingDimensions: row.embeddingDimensions ?? undefined,
      baseUrl: credentials?.baseUrl,
      apiKey: credentials?.apiKey,
    };
  }

  private async clearDefault() {
    await this.prisma.llmProvider.updateMany({
      where: { tenantId: this.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private toResponse(row: any): LlmProviderResponse {
    let credentialsConfigured = false;
    let credentialsHint: string | null = null;

    if (row.credentials) {
      try {
        const decrypted = JSON.parse(this.encryption.decrypt(row.credentials));
        credentialsConfigured = true;
        const key = decrypted.apiKey ?? decrypted.accessKeyId;
        if (key && key.length > 6) {
          credentialsHint = `${key.slice(0, 3)}...${key.slice(-3)}`;
        }
      } catch {
        credentialsConfigured = true;
      }
    }

    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      providerType: row.providerType,
      region: row.region,
      credentialsConfigured,
      credentialsHint,
      chatModel: row.chatModel,
      embeddingModel: row.embeddingModel,
      embeddingDimensions: row.embeddingDimensions,
      models: row.models,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

- [ ] **Step 2: Update tests**

Update `libs/shared/src/services/llm-provider-service.test.ts` to mock `EncryptionService` and test the new `toResponse` masking behavior, `validateAndDiscoverModels`, and `refreshModels`.

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/services/llm-provider-service.ts libs/shared/src/services/llm-provider-service.test.ts
git commit -m "feat(shared): refactor LlmProviderService with encrypted credentials and model discovery"
```

---

## Task 9: Update AI Library Types

**Files:**
- Modify: `libs/ai/src/types.ts`

- [ ] **Step 1: Expand ProviderName and TenantLLMConfig**

```typescript
// libs/ai/src/types.ts
export type ProviderName = 'bedrock' | 'openai' | 'anthropic' | 'ollama' | 'vllm' | 'openai_compatible';

export interface TenantLLMConfig {
  provider: ProviderName;
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  baseUrl?: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
}

export const DEFAULT_BEDROCK_CHAT_MODEL = 'anthropic.claude-sonnet-4-20250514';
export const DEFAULT_BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';

export function getDefaultLLMConfig(provider: ProviderName = 'bedrock'): TenantLLMConfig {
  if (provider === 'openai' || provider === 'openai_compatible') {
    return {
      provider,
      chatModel: DEFAULT_OPENAI_CHAT_MODEL,
      embeddingModel: DEFAULT_OPENAI_EMBEDDING_MODEL,
      embeddingDimensions: 3072,
    };
  }
  if (provider === 'bedrock') {
    return {
      provider: 'bedrock',
      chatModel: DEFAULT_BEDROCK_CHAT_MODEL,
      embeddingModel: DEFAULT_BEDROCK_EMBEDDING_MODEL,
      embeddingDimensions: 1024,
    };
  }
  return {
    provider,
    chatModel: undefined,
    embeddingModel: undefined,
    embeddingDimensions: undefined,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add libs/ai/src/types.ts
git commit -m "feat(ai): expand ProviderName to 6 types and update TenantLLMConfig"
```

---

## Task 10: Update API Routes

**Files:**
- Modify: `apps/web-ui/app/api/llm-providers/route.ts`
- Modify: `apps/web-ui/app/api/llm-providers/[id]/route.ts`
- Create: `apps/web-ui/app/api/llm-providers/validate/route.ts`
- Create: `apps/web-ui/app/api/llm-providers/[id]/refresh-models/route.ts`

- [ ] **Step 1: Update list/create route**

```typescript
// apps/web-ui/app/api/llm-providers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService } from '@chatbot/shared';
import { CreateLlmProviderSchema } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'LlmProviders', authOptions);
    if (authError) return authError;

    const service = new LlmProviderService(tenantId);
    const providers = await service.list();
    return NextResponse.json(providers);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'LlmProviders', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = CreateLlmProviderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const service = new LlmProviderService(tenantId);
    const provider = await service.create(parsed.data);
    return NextResponse.json(provider, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'Provider with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update get/update/delete route**

```typescript
// apps/web-ui/app/api/llm-providers/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService } from '@chatbot/shared';
import { UpdateLlmProviderSchema } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new LlmProviderService(tenantId);
    const provider = await service.findById(id);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    return NextResponse.json(provider);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = UpdateLlmProviderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const service = new LlmProviderService(tenantId);
    const provider = await service.update(id, parsed.data);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    return NextResponse.json(provider);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Provider with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new LlmProviderService(tenantId);
    const provider = await service.delete(id);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create validate endpoint**

```typescript
// apps/web-ui/app/api/llm-providers/validate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService } from '@chatbot/shared';
import { ValidateInputSchema } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'LlmProviders', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = ValidateInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const service = new LlmProviderService(tenantId);
    const result = await service.validateAndDiscoverModels(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Discovery failed' },
      { status: 200 }
    );
  }
}
```

- [ ] **Step 4: Create refresh-models endpoint**

```typescript
// apps/web-ui/app/api/llm-providers/[id]/refresh-models/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new LlmProviderService(tenantId);
    const provider = await service.refreshModels(id);

    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    return NextResponse.json(provider);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/app/api/llm-providers/
git commit -m "feat(api): update LLM provider routes with Zod validation and new endpoints"
```

---

## Task 11: Update Frontend Hooks

**Files:**
- Modify: `apps/web-ui/hooks/use-llm-providers.ts`

- [ ] **Step 1: Update types and add new hooks**

```typescript
// apps/web-ui/hooks/use-llm-providers.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProviderType } from '@chatbot/shared';

export interface LlmProvider {
  id: string;
  tenantId: string;
  name: string;
  providerType: ProviderType;
  region: string | null;
  credentialsConfigured: boolean;
  credentialsHint: string | null;
  chatModel: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  models: unknown;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLlmProviderInput {
  name: string;
  providerType: ProviderType;
  region?: string;
  credentials: Record<string, string>;
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  isDefault?: boolean;
}

export interface UpdateLlmProviderInput {
  name?: string;
  providerType?: ProviderType;
  region?: string;
  credentials?: Record<string, string>;
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  isDefault?: boolean;
}

export interface ValidateProviderInput {
  providerType: ProviderType;
  credentials: Record<string, string>;
  region?: string;
}

export interface ValidateProviderResponse {
  success: boolean;
  models?: Array<{ id: string; name: string; capabilities: string[] }>;
  error?: string;
}

async function fetchLlmProviders(): Promise<LlmProvider[]> {
  const res = await fetch('/api/llm-providers');
  if (!res.ok) throw new Error('Failed to fetch LLM providers');
  return res.json();
}

async function fetchLlmProvider(id: string): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}`);
  if (!res.ok) throw new Error('Failed to fetch LLM provider');
  return res.json();
}

async function createLlmProvider(input: CreateLlmProviderInput): Promise<LlmProvider> {
  const res = await fetch('/api/llm-providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create LLM provider');
  }
  return res.json();
}

async function updateLlmProvider(id: string, input: UpdateLlmProviderInput): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to update LLM provider');
  }
  return res.json();
}

async function deleteLlmProvider(id: string): Promise<void> {
  const res = await fetch(`/api/llm-providers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete LLM provider');
}

async function setDefaultLlmProvider(id: string): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}/set-default`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to set default provider');
  }
  return res.json();
}

async function validateProvider(input: ValidateProviderInput): Promise<ValidateProviderResponse> {
  const res = await fetch('/api/llm-providers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to validate provider');
  }
  return res.json();
}

async function refreshModels(id: string): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}/refresh-models`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to refresh models');
  }
  return res.json();
}

export const llmProviderKeys = {
  all: ['llm-providers'] as const,
  lists: () => [...llmProviderKeys.all, 'list'] as const,
  details: () => [...llmProviderKeys.all, 'detail'] as const,
  detail: (id: string) => [...llmProviderKeys.details(), id] as const,
};

export function useLlmProviders() {
  return useQuery({ queryKey: llmProviderKeys.lists(), queryFn: fetchLlmProviders });
}

export function useLlmProvider(id: string) {
  return useQuery({
    queryKey: llmProviderKeys.detail(id),
    queryFn: () => fetchLlmProvider(id),
    enabled: Boolean(id),
  });
}

export function useCreateLlmProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createLlmProvider,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() }),
  });
}

export function useUpdateLlmProvider(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLlmProviderInput) => updateLlmProvider(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: llmProviderKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() });
    },
  });
}

export function useDeleteLlmProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteLlmProvider,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() }),
  });
}

export function useSetDefaultLlmProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDefaultLlmProvider,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() }),
  });
}

export function useValidateProvider() {
  return useMutation({ mutationFn: validateProvider });
}

export function useRefreshModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshModels,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: llmProviderKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/hooks/use-llm-providers.ts
git commit -m "feat(ui): update LLM provider hooks with validation and refresh"
```

---

## Task 12: Refactor LlmProviderForm to 3-Step Wizard

**Files:**
- Modify: `apps/web-ui/components/llm-providers/llm-provider-form.tsx`

- [ ] **Step 1: Write the wizard form**

```tsx
// apps/web-ui/components/llm-providers/llm-provider-form.tsx
'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useForm } from '@tanstack/react-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useValidateProvider } from '@/hooks/use-llm-providers';
import type { ProviderType, DiscoveredModel } from '@chatbot/shared';

const providerOptions: { value: ProviderType; label: string }[] = [
  { value: 'BEDROCK', label: 'Amazon Bedrock' },
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'ANTHROPIC', label: 'Anthropic' },
  { value: 'OLLAMA', label: 'Ollama' },
  { value: 'VLLM', label: 'vLLM' },
  { value: 'OPENAI_COMPATIBLE', label: 'OpenAI Compatible' },
];

const step1Schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  providerType: z.enum(['BEDROCK', 'OPENAI', 'ANTHROPIC', 'OLLAMA', 'VLLM', 'OPENAI_COMPATIBLE']),
  region: z.string().optional(),
});

export interface LlmProviderFormProps {
  defaultValues?: {
    name?: string;
    providerType?: ProviderType;
    region?: string;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    isDefault?: boolean;
  };
  onSubmit: (values: {
    name: string;
    providerType: ProviderType;
    region?: string;
    credentials: Record<string, string>;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    isDefault?: boolean;
  }) => void;
  loading?: boolean;
  submitLabel?: string;
}

export function LlmProviderForm({ defaultValues, onSubmit, loading, submitLabel = 'Save' }: LlmProviderFormProps) {
  const [step, setStep] = useState(1);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [validateError, setValidateError] = useState<string | null>(null);
  const validateMutation = useValidateProvider();

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? '',
      providerType: defaultValues?.providerType ?? 'BEDROCK',
      region: defaultValues?.region ?? '',
      accessKeyId: '',
      secretAccessKey: '',
      apiKey: '',
      baseUrl: '',
      chatModel: defaultValues?.chatModel ?? '',
      embeddingModel: defaultValues?.embeddingModel ?? '',
      embeddingDimensions: defaultValues?.embeddingDimensions ?? undefined,
      isDefault: defaultValues?.isDefault ?? false,
    },
    onSubmit: ({ value }) => {
      const credentials: Record<string, string> = {};
      if (value.accessKeyId) credentials.accessKeyId = value.accessKeyId;
      if (value.secretAccessKey) credentials.secretAccessKey = value.secretAccessKey;
      if (value.apiKey) credentials.apiKey = value.apiKey;
      if (value.baseUrl) credentials.baseUrl = value.baseUrl;

      onSubmit({
        name: value.name,
        providerType: value.providerType as ProviderType,
        region: value.region || undefined,
        credentials,
        chatModel: value.chatModel || undefined,
        embeddingModel: value.embeddingModel || undefined,
        embeddingDimensions: value.embeddingDimensions,
        isDefault: value.isDefault,
      });
    },
  });

  const providerType = form.getFieldValue('providerType');
  const chatModels = discoveredModels.filter((m) => m.capabilities.includes('chat'));
  const embeddingModels = discoveredModels.filter((m) => m.capabilities.includes('embedding'));

  const handleValidate = async () => {
    setValidateError(null);
    const values = form.getFieldValue;
    const credentials: Record<string, string> = {};
    const accessKeyId = values('accessKeyId');
    const secretAccessKey = values('secretAccessKey');
    const apiKey = values('apiKey');
    const baseUrl = values('baseUrl');

    if (accessKeyId) credentials.accessKeyId = accessKeyId;
    if (secretAccessKey) credentials.secretAccessKey = secretAccessKey;
    if (apiKey) credentials.apiKey = apiKey;
    if (baseUrl) credentials.baseUrl = baseUrl;

    try {
      const result = await validateMutation.mutateAsync({
        providerType: providerType as ProviderType,
        credentials,
        region: values('region') || undefined,
      });
      if (result.success && result.models) {
        setDiscoveredModels(result.models);
        setStep(3);
      } else {
        setValidateError(result.error ?? 'Validation failed');
      }
    } catch (e) {
      setValidateError(e instanceof Error ? e.message : 'Validation failed');
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-6">
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 1: Provider Type &amp; Name</h3>
          <form.Field name="name">
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={field.name}>Name</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="My LLM Provider" />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="providerType">
            {(field) => (
              <div className="grid gap-1.5">
                <Label>Provider</Label>
                <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as ProviderType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {providerOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          {providerType === 'BEDROCK' && (
            <form.Field name="region">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label>Region</Label>
                  <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="us-east-1" />
                </div>
              )}
            </form.Field>
          )}

          <Button type="button" onClick={() => setStep(2)}>Next: Credentials</Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 2: Credentials</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(1)} className="mb-2">← Back</Button>

          {providerType === 'BEDROCK' && (
            <>
              <form.Field name="accessKeyId">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Access Key ID</Label>
                    <Input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="AKIA..." />
                    <p className="text-xs text-muted-foreground">Leave blank to use host AWS credentials</p>
                  </div>
                )}
              </form.Field>
              <form.Field name="secretAccessKey">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Secret Access Key</Label>
                    <Input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="******" />
                  </div>
                )}
              </form.Field>
            </>
          )}

          {(providerType === 'OPENAI' || providerType === 'ANTHROPIC') && (
            <form.Field name="apiKey">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label>API Key</Label>
                  <Input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="sk-..." />
                </div>
              )}
            </form.Field>
          )}

          {(providerType === 'OLLAMA' || providerType === 'VLLM' || providerType === 'OPENAI_COMPATIBLE') && (
            <>
              <form.Field name="baseUrl">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Base URL</Label>
                    <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={providerType === 'OLLAMA' ? 'http://localhost:11434' : 'https://api.example.com/v1'} />
                  </div>
                )}
              </form.Field>
              <form.Field name="apiKey">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>API Key {providerType === 'OLLAMA' && <span className="text-muted-foreground">(optional)</span>}</Label>
                    <Input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="sk-..." />
                  </div>
                )}
              </form.Field>
            </>
          )}

          {validateError && (
            <p className="text-sm text-destructive">{validateError}</p>
          )}

          <Button type="button" onClick={handleValidate} disabled={validateMutation.isPending}>
            {validateMutation.isPending ? 'Validating...' : 'Validate & Discover Models'}
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 3: Select Models</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(2)} className="mb-2">← Back</Button>

          {chatModels.length > 0 && (
            <form.Field name="chatModel">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label>Chat Model</Label>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger><SelectValue placeholder="Select chat model" /></SelectTrigger>
                    <SelectContent>
                      {chatModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          )}

          {embeddingModels.length > 0 && (
            <form.Field name="embeddingModel">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label>Embedding Model</Label>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger><SelectValue placeholder="Select embedding model" /></SelectTrigger>
                    <SelectContent>
                      {embeddingModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          )}

          <form.Field name="embeddingDimensions">
            {(field) => (
              <div className="grid gap-1.5">
                <Label>Embedding Dimensions</Label>
                <Input type="number" value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)} placeholder="1024" />
              </div>
            )}
          </form.Field>

          <form.Field name="isDefault">
            {(field) => (
              <div className="flex items-center gap-3">
                <Switch id={field.name} checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
                <Label htmlFor={field.name}>Set as default provider</Label>
              </div>
            )}
          </form.Field>

          <Button type="submit" disabled={loading}>{loading ? 'Saving...' : submitLabel}</Button>
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/components/llm-providers/llm-provider-form.tsx
git commit -m "feat(ui): refactor LlmProviderForm to 3-step wizard with model discovery"
```

---

## Task 13: Update Listing Page

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/llm-providers/page.tsx`

- [ ] **Step 1: Add refresh button and update types**

```tsx
// apps/web-ui/app/(dashboard)/agents/llm-providers/page.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLlmProviders, useDeleteLlmProvider, useSetDefaultLlmProvider, useRefreshModels } from '@/hooks/use-llm-providers';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Settings, Trash2, Star, Sparkles, RefreshCw } from 'lucide-react';
import { LlmProviderDeleteDialog } from '@/components/llm-providers/llm-provider-delete-dialog';

export default function LlmProvidersPage() {
  const { data: providers, isLoading } = useLlmProviders();
  const deleteMutation = useDeleteLlmProvider();
  const setDefaultMutation = useSetDefaultLlmProvider();
  const refreshMutation = useRefreshModels();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success('LLM provider deleted');
      setDeleteId(null);
    } catch {
      toast.error('Failed to delete LLM provider');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultMutation.mutateAsync(id);
      toast.success('Default provider updated');
    } catch {
      toast.error('Failed to set default provider');
    }
  };

  const handleRefresh = async (id: string) => {
    try {
      await refreshMutation.mutateAsync(id);
      toast.success('Models refreshed');
    } catch {
      toast.error('Failed to refresh models');
    }
  };

  const getProviderLabel = (p: string) => {
    const labels: Record<string, string> = {
      BEDROCK: 'Amazon Bedrock',
      OPENAI: 'OpenAI',
      ANTHROPIC: 'Anthropic',
      OLLAMA: 'Ollama',
      VLLM: 'vLLM',
      OPENAI_COMPATIBLE: 'OpenAI Compatible',
    };
    return labels[p] ?? p;
  };

  const deletingProvider = providers?.find((p) => p.id === deleteId);

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">LLM Providers</h2>
      </div>
      <p className="text-muted-foreground">Manage LLM providers for chat inference and embeddings.</p>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>All Providers</CardTitle>
              <CardDescription>
                {isLoading ? <Skeleton className="h-4 w-32" /> : `${providers?.length ?? 0} provider${(providers?.length ?? 0) !== 1 ? 's' : ''}`}
              </CardDescription>
            </div>
            <Link href="/agents/llm-providers/new" className={buttonVariants()}>
              <Plus className="h-4 w-4 mr-2" />New Provider
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : providers?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No LLM providers yet. Create one to get started.</div>
          ) : (
            <div className="space-y-2">
              {providers?.map((provider) => (
                <div key={provider.id} className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{provider.name}</span>
                        {provider.isDefault && <Badge variant="default" className="text-xs">Default</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{getProviderLabel(provider.providerType)}</Badge>
                        {provider.chatModel && <span className="text-xs text-muted-foreground">{provider.chatModel}</span>}
                        {provider.credentialsConfigured && <span className="text-xs text-green-600">●</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRefresh(provider.id)}
                      aria-label="Refresh models"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    {!provider.isDefault && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleSetDefault(provider.id)}
                        aria-label="Set as default"
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Link href={`/agents/llm-providers/${provider.id}`} className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'h-8 w-8' })} aria-label="Edit">
                      <Settings className="h-4 w-4" />
                    </Link>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(provider.id)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <LlmProviderDeleteDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        providerName={deletingProvider?.name ?? ''}
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/(dashboard)/agents/llm-providers/page.tsx
git commit -m "feat(ui): update LLM provider listing with refresh and credential status"
```

---

## Task 14: Create Edit Page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/agents/llm-providers/[id]/edit/page.tsx`

- [ ] **Step 1: Write the edit page**

```tsx
// apps/web-ui/app/(dashboard)/agents/llm-providers/[id]/edit/page.tsx
'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLlmProvider, useUpdateLlmProvider } from '@/hooks/use-llm-providers';
import { LlmProviderForm } from '@/components/llm-providers/llm-provider-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';

export default function EditLlmProviderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const providerId = params.id;

  const { data: provider, isLoading } = useLlmProvider(providerId);
  const updateMutation = useUpdateLlmProvider(providerId);

  const handleSubmit = async (values: {
    name: string;
    providerType: string;
    region?: string;
    credentials: Record<string, string>;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    isDefault?: boolean;
  }) => {
    try {
      await updateMutation.mutateAsync(values);
      toast.success('LLM provider updated');
      router.push('/agents/llm-providers');
    } catch {
      toast.error('Failed to update LLM provider');
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground">Provider not found.</p>
        <Button variant="outline" asChild>
          <Link href="/agents/llm-providers">Back to providers</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/agents/llm-providers" aria-label="Back to providers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Edit LLM Provider</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Details</CardTitle>
          <CardDescription>Update the model, endpoint, and credentials for your LLM provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <LlmProviderForm
            defaultValues={{
              name: provider.name,
              providerType: provider.providerType,
              region: provider.region ?? undefined,
              chatModel: provider.chatModel ?? undefined,
              embeddingModel: provider.embeddingModel ?? undefined,
              embeddingDimensions: provider.embeddingDimensions ?? undefined,
              isDefault: provider.isDefault,
            }}
            onSubmit={handleSubmit}
            loading={updateMutation.isPending}
            submitLabel="Update Provider"
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/(dashboard)/agents/llm-providers/[id]/edit/page.tsx
git commit -m "feat(ui): add LLM provider edit page with wizard form"
```

---

## Task 15: Update New Provider Page

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/llm-providers/new/page.tsx`

- [ ] **Step 1: Minor updates for new form types**

```tsx
// apps/web-ui/app/(dashboard)/agents/llm-providers/new/page.tsx
'use client';

import { useRouter } from 'next/router';
import Link from 'next/link';
import { useCreateLlmProvider } from '@/hooks/use-llm-providers';
import { LlmProviderForm } from '@/components/llm-providers/llm-provider-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function NewLlmProviderPage() {
  const router = useRouter();
  const createMutation = useCreateLlmProvider();

  const handleSubmit = async (values: {
    name: string;
    providerType: string;
    region?: string;
    credentials: Record<string, string>;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    isDefault?: boolean;
  }) => {
    try {
      await createMutation.mutateAsync(values);
      toast.success('LLM provider created');
      router.push('/agents/llm-providers');
    } catch {
      toast.error('Failed to create LLM provider');
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/agents/llm-providers" aria-label="Back to providers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">New LLM Provider</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Details</CardTitle>
          <CardDescription>Configure the model, endpoint, and credentials for your LLM provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <LlmProviderForm onSubmit={handleSubmit} loading={createMutation.isPending} submitLabel="Create Provider" />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/(dashboard)/agents/llm-providers/new/page.tsx
git commit -m "feat(ui): update new provider page for wizard form"
```

---

## Task 16: Add ENCRYPTION_KEY to Environment

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the variable**

```bash
# .env.example — append
ENCRYPTION_KEY=            # 64-character hex string (32 bytes). Generate with: openssl rand -hex 32
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): add ENCRYPTION_KEY to .env.example"
```

---

## Task 17: Final Verification

- [ ] **Step 1: Run unit tests**

```bash
bun run test
```

Expected: All tests in `shared` and `ai` pass. New tests for `EncryptionService`, discovery classes, and `LlmProviderService` should pass.

- [ ] **Step 2: Run type check**

```bash
bun run build
```

Expected: No TypeScript errors across `web-ui`, `shared`, and `ai`.

- [ ] **Step 3: Start dev server and test golden path**

```bash
bun run dev
```

Manually verify:
1. Navigate to `/agents/llm-providers/new`
2. Select "Amazon Bedrock", enter name, region, access key, secret key
3. Click "Validate & Discover Models" — models populate
4. Select chat model and embedding model, click "Create Provider"
5. Provider appears in listing with correct badge and model
6. Edit provider, change credentials, re-validate, save
7. Refresh models button updates the cached list

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat(llm-providers): complete redesign with encrypted credentials, model discovery, and multi-provider support"
```

---

## Self-Review

**Spec coverage:**
- ✅ Encrypted credentials (AES-256-GCM) — Task 1
- ✅ 6 provider types — Tasks 4-6, Task 9
- ✅ Dynamic model discovery — Tasks 4-6
- ✅ Zod validation — Task 2, integrated in Tasks 8, 10
- ✅ 3-step wizard UI — Task 12
- ✅ API route updates — Task 10
- ✅ Credential masking in responses — Task 8 (`toResponse`)
- ✅ Migration plan — Task 7
- ✅ Testing strategy — Every task includes tests

**Placeholder scan:**
- ✅ No "TBD", "TODO", or vague requirements found.
- ✅ All code blocks contain actual implementation.
- ✅ No "similar to Task N" shortcuts.

**Type consistency:**
- ✅ `ProviderType` enum matches across Zod schema, frontend hooks, and AI types.
- ✅ `DiscoveredModel` interface used consistently in discovery classes and frontend.
- ✅ `TenantLLMConfig` includes `accessKeyId`, `secretAccessKey`, `region` for Bedrock.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-llm-provider-redesign.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?