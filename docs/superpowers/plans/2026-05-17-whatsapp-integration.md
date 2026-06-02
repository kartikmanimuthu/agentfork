# WhatsApp Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enterprise-grade WhatsApp Business Platform integration enabling tenants to connect their WABAs via Embedded Signup, configure routing strategies, and serve conversations through simple/graph agents.

**Architecture:** New `libs/whatsapp/` library handles Meta API interactions, webhook processing, routing, sessions, and media. Webhook endpoints live in `apps/web-ui/app/api/webhooks/whatsapp/`. Inline processing via `waitUntil()` — no pg-boss queue. Dashboard pages under `/settings/channels/whatsapp`.

**Tech Stack:** Meta Cloud API v21.0, Next.js API routes, Prisma (PostgreSQL), T3 Env, Zod, Pino, AES-256-GCM encryption, Redis (concurrency controls)

---

## File Structure

### New Library: `libs/whatsapp/`

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Public exports |
| `src/env.ts` | T3 Env validation for Meta app config |
| `src/client/meta-api.ts` | Meta Graph API HTTP client (send messages, upload media, manage templates) |
| `src/client/types.ts` | Meta API request/response TypeScript types |
| `src/webhook/signature.ts` | HMAC-SHA256 webhook signature verification |
| `src/webhook/parser.ts` | Raw webhook payload → typed event discriminated union |
| `src/webhook/types.ts` | Webhook payload types |
| `src/router/router.interface.ts` | WhatsAppRouter interface, RoutingContext, RoutingResult types |
| `src/router/menu-router.ts` | Interactive message routing strategy |
| `src/router/keyword-router.ts` | Keyword matching routing strategy |
| `src/router/ai-intent-router.ts` | LLM-based intent classification routing |
| `src/router/time-router.ts` | Time-based routing rules |
| `src/router/factory.ts` | Strategy string → router instance factory |
| `src/session/session-manager.ts` | Find/create/expire sessions, 24h window tracking |
| `src/session/command-handler.ts` | /reset, /switch, /help command interception |
| `src/media/downloader.ts` | Download media from Meta CDN → S3 |
| `src/media/uploader.ts` | Upload media to Meta for outbound messages |
| `src/templates/template-sync.ts` | Sync templates from Meta API |
| `src/templates/template-sender.ts` | Send template messages outside 24h window |
| `src/concurrency/contact-lock.ts` | Per-contact Redis advisory lock |
| `src/concurrency/rate-limiter.ts` | Per-account rate limiting |
| `src/concurrency/circuit-breaker.ts` | Meta API failure backoff |
| `src/processor/message-processor.ts` | Orchestration: dedupe → lock → route → execute → respond → persist |

### New API Routes: `apps/web-ui/app/api/`

| File | Responsibility |
|------|---------------|
| `webhooks/whatsapp/route.ts` | GET (verification challenge) + POST (receive events) |
| `whatsapp/connect/route.ts` | POST: Exchange Embedded Signup code → provision account |
| `whatsapp/disconnect/route.ts` | POST: Disconnect WABA |
| `whatsapp/accounts/route.ts` | GET: List tenant's connected accounts |
| `whatsapp/accounts/[id]/routing/route.ts` | GET/PUT: Routing config |
| `whatsapp/accounts/[id]/templates/route.ts` | GET: List templates |
| `whatsapp/accounts/[id]/templates/sync/route.ts` | POST: Sync from Meta |
| `whatsapp/accounts/[id]/templates/send/route.ts` | POST: Send template message |

### Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 6 new models |
| `tsconfig.base.json` | Add `@chatbot/whatsapp` path alias |
| `apps/web-ui/next.config.ts` | Add `@chatbot/whatsapp` to transpilePackages |
| `libs/shared/src/env.ts` | Add `ENCRYPTION_KEY` as required (already optional) |

---

## Task 1: Prisma Schema — WhatsApp Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add WhatsAppAccount model**

Add after the `ApiKey` model in `prisma/schema.prisma`:

```prisma
model WhatsAppAccount {
  id             String   @id @default(cuid())
  tenantId       String
  wabaId         String
  phoneNumberId  String   @unique
  displayPhone   String
  displayName    String
  accessToken    String
  webhookSecret  String
  status         String   @default("active")
  qualityRating  String?
  messagingLimit String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant        Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  routingConfig WhatsAppRouting?
  sessions      WhatsAppSession[]
  messages      WhatsAppMessage[]
  templates     WhatsAppTemplate[]

  @@unique([tenantId, wabaId])
  @@index([tenantId])
  @@map("whatsapp_accounts")
}
```

- [ ] **Step 2: Add WhatsAppRouting and WhatsAppRoutingRule models**

```prisma
model WhatsAppRouting {
  id              String   @id @default(cuid())
  accountId       String   @unique
  strategy        String
  config          Json     @default("{}")
  fallbackAgentId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  account WhatsAppAccount      @relation(fields: [accountId], references: [id], onDelete: Cascade)
  rules   WhatsAppRoutingRule[]

  @@map("whatsapp_routing")
}

model WhatsAppRoutingRule {
  id        String  @id @default(cuid())
  routingId String
  agentId   String
  priority  Int     @default(0)
  condition Json
  isActive  Boolean @default(true)

  routing WhatsAppRouting @relation(fields: [routingId], references: [id], onDelete: Cascade)

  @@index([routingId, priority])
  @@map("whatsapp_routing_rules")
}
```

- [ ] **Step 3: Add WhatsAppSession model**

```prisma
model WhatsAppSession {
  id              String   @id @default(cuid())
  accountId       String
  contactPhone    String
  contactName     String?
  agentId         String
  state           String   @default("active")
  context         Json     @default("{}")
  lastMessageAt   DateTime
  windowExpiresAt DateTime
  metadata        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  account  WhatsAppAccount   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  messages WhatsAppMessage[]

  @@unique([accountId, contactPhone, state])
  @@index([accountId, contactPhone])
  @@index([windowExpiresAt])
  @@map("whatsapp_sessions")
}
```

- [ ] **Step 4: Add WhatsAppMessage model**

```prisma
model WhatsAppMessage {
  id              String    @id @default(cuid())
  accountId       String
  sessionId       String?
  waMessageId     String    @unique
  direction       String
  contactPhone    String
  type            String
  content         Json
  status          String    @default("received")
  statusTimestamp DateTime?
  errorCode       String?
  errorMessage    String?
  createdAt       DateTime  @default(now())

  account WhatsAppAccount  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  session WhatsAppSession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)

  @@index([accountId, contactPhone, createdAt])
  @@index([sessionId, createdAt])
  @@map("whatsapp_messages")
}
```

- [ ] **Step 5: Add WhatsAppTemplate model**

```prisma
model WhatsAppTemplate {
  id         String   @id @default(cuid())
  accountId  String
  name       String
  language   String
  category   String
  status     String
  components Json
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  account WhatsAppAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, name, language])
  @@map("whatsapp_templates")
}
```

- [ ] **Step 6: Add relation to Tenant model**

Add to the `Tenant` model's relation fields:

```prisma
  whatsappAccounts  WhatsAppAccount[]
```

- [ ] **Step 7: Generate Prisma client and create migration**

Run:
```bash
bunx prisma migrate dev --name add-whatsapp-models
```

Expected: Migration created successfully, Prisma client regenerated.

- [ ] **Step 8: Commit**

```bash
git add prisma/
git commit -m "feat(whatsapp): add Prisma models for WhatsApp integration

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 2: Library Scaffolding — `libs/whatsapp/`

**Files:**
- Create: `libs/whatsapp/package.json`
- Create: `libs/whatsapp/tsconfig.json`
- Create: `libs/whatsapp/project.json`
- Create: `libs/whatsapp/src/index.ts`
- Create: `libs/whatsapp/src/env.ts`
- Create: `libs/whatsapp/vitest.config.ts`
- Modify: `tsconfig.base.json`
- Modify: `apps/web-ui/next.config.ts`

- [ ] **Step 1: Create `libs/whatsapp/package.json`**

```json
{
  "name": "@chatbot/whatsapp",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@t3-oss/env-core": "^0.11.1",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Create `libs/whatsapp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `libs/whatsapp/project.json`**

```json
{
  "name": "whatsapp",
  "sourceRoot": "libs/whatsapp/src",
  "projectType": "library",
  "targets": {
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bunx vitest run",
        "cwd": "libs/whatsapp"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bunx eslint src/",
        "cwd": "libs/whatsapp"
      }
    }
  }
}
```

- [ ] **Step 4: Create `libs/whatsapp/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@chatbot/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@chatbot/ai': path.resolve(__dirname, '../ai/src/index.ts'),
      '@chatbot/agent-studio': path.resolve(__dirname, '../agent-studio/src/index.ts'),
    },
  },
});
```

- [ ] **Step 5: Create `libs/whatsapp/src/env.ts`**

```typescript
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const whatsappEnv = createEnv({
  server: {
    META_APP_ID: z.string().min(1),
    META_APP_SECRET: z.string().min(1),
    META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
    META_API_VERSION: z.string().default("v21.0"),
    WHATSAPP_MEDIA_S3_BUCKET: z.string().default("chatbot-whatsapp-media"),
    REDIS_URL: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 6: Create `libs/whatsapp/src/index.ts`**

```typescript
export { whatsappEnv } from './env';
```

- [ ] **Step 7: Add path alias to `tsconfig.base.json`**

Add to `compilerOptions.paths`:

```json
"@chatbot/whatsapp": ["libs/whatsapp/src/index.ts"]
```

- [ ] **Step 8: Add to `apps/web-ui/next.config.ts` transpilePackages**

Add `'@chatbot/whatsapp'` to the `transpilePackages` array.

- [ ] **Step 9: Run `bun install` to link workspace**

Run:
```bash
bun install
```

Expected: No errors, workspace linked.

- [ ] **Step 10: Commit**

```bash
git add libs/whatsapp/ tsconfig.base.json apps/web-ui/next.config.ts
git commit -m "feat(whatsapp): scaffold libs/whatsapp library with env config

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 3: Webhook Signature Verification

**Files:**
- Create: `libs/whatsapp/src/webhook/signature.ts`
- Create: `libs/whatsapp/src/webhook/signature.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/whatsapp/src/webhook/signature.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from './signature';
import { createHmac } from 'crypto';

describe('verifyWebhookSignature', () => {
  const appSecret = 'test-app-secret';

  function sign(body: string, secret: string): string {
    const hmac = createHmac('sha256', secret);
    hmac.update(body);
    return `sha256=${hmac.digest('hex')}`;
  }

  it('returns true for valid signature', () => {
    const body = '{"entry":[]}';
    const signature = sign(body, appSecret);
    expect(verifyWebhookSignature(body, signature, appSecret)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    const body = '{"entry":[]}';
    const signature = 'sha256=invalid';
    expect(verifyWebhookSignature(body, signature, appSecret)).toBe(false);
  });

  it('returns false for missing signature', () => {
    const body = '{"entry":[]}';
    expect(verifyWebhookSignature(body, '', appSecret)).toBe(false);
  });

  it('returns false for tampered body', () => {
    const body = '{"entry":[]}';
    const signature = sign(body, appSecret);
    expect(verifyWebhookSignature('{"entry":[{"id":"x"}]}', signature, appSecret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/webhook/signature.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `libs/whatsapp/src/webhook/signature.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  appSecret: string
): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const expectedHash = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const expected = `sha256=${expectedHash}`;

  if (expected.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/webhook/signature.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add libs/whatsapp/src/webhook/
git commit -m "feat(whatsapp): add HMAC-SHA256 webhook signature verification

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 4: Webhook Payload Parser

**Files:**
- Create: `libs/whatsapp/src/webhook/types.ts`
- Create: `libs/whatsapp/src/webhook/parser.ts`
- Create: `libs/whatsapp/src/webhook/parser.test.ts`

- [ ] **Step 1: Create webhook types**

Create `libs/whatsapp/src/webhook/types.ts`:

```typescript
export interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: WebhookValue;
  field: string;
}

export interface WebhookValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: WebhookContact[];
  messages?: WebhookInboundMessage[];
  statuses?: WebhookStatus[];
  errors?: WebhookError[];
}

export interface WebhookContact {
  profile: { name: string };
  wa_id: string;
}

export interface WebhookInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'interactive' | 'button';
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  document?: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { text: string; payload: string };
}

export interface WebhookStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: WebhookError[];
}

export interface WebhookError {
  code: number;
  title: string;
  message: string;
  error_data?: { details: string };
}

export type ParsedEvent =
  | { type: 'message'; phoneNumberId: string; contact: WebhookContact; message: WebhookInboundMessage }
  | { type: 'status'; phoneNumberId: string; status: WebhookStatus }
  | { type: 'error'; phoneNumberId: string; error: WebhookError };
```

- [ ] **Step 2: Write the failing test**

Create `libs/whatsapp/src/webhook/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseWebhookPayload } from './parser';
import type { WebhookPayload } from './types';

describe('parseWebhookPayload', () => {
  it('parses a text message event', () => {
    const payload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_ID' },
            contacts: [{ profile: { name: 'John' }, wa_id: '15559876543' }],
            messages: [{
              from: '15559876543',
              id: 'wamid.abc123',
              timestamp: '1234567890',
              type: 'text',
              text: { body: 'Hello' },
            }],
          },
          field: 'messages',
        }],
      }],
    };

    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message',
      phoneNumberId: 'PHONE_ID',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: expect.objectContaining({ id: 'wamid.abc123', type: 'text' }),
    });
  });

  it('parses a status update event', () => {
    const payload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_ID' },
            statuses: [{
              id: 'wamid.abc123',
              status: 'delivered',
              timestamp: '1234567890',
              recipient_id: '15559876543',
            }],
          },
          field: 'messages',
        }],
      }],
    };

    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'status',
      phoneNumberId: 'PHONE_ID',
      status: expect.objectContaining({ id: 'wamid.abc123', status: 'delivered' }),
    });
  });

  it('returns empty array for non-whatsapp object', () => {
    const payload = { object: 'instagram', entry: [] } as any;
    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(0);
  });

  it('handles multiple messages in one payload', () => {
    const payload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_ID' },
            contacts: [{ profile: { name: 'John' }, wa_id: '15559876543' }],
            messages: [
              { from: '15559876543', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'Hi' } },
              { from: '15559876543', id: 'wamid.2', timestamp: '2', type: 'text', text: { body: 'Hello' } },
            ],
          },
          field: 'messages',
        }],
      }],
    };

    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('message');
    expect(events[1].type).toBe('message');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/webhook/parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write implementation**

Create `libs/whatsapp/src/webhook/parser.ts`:

```typescript
import type { WebhookPayload, ParsedEvent, WebhookContact } from './types';

export function parseWebhookPayload(payload: WebhookPayload): ParsedEvent[] {
  if (payload.object !== 'whatsapp_business_account') {
    return [];
  }

  const events: ParsedEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change;
      const phoneNumberId = value.metadata.phone_number_id;
      const contactMap = new Map<string, WebhookContact>();

      if (value.contacts) {
        for (const contact of value.contacts) {
          contactMap.set(contact.wa_id, contact);
        }
      }

      if (value.messages) {
        for (const message of value.messages) {
          const contact = contactMap.get(message.from) ?? {
            profile: { name: '' },
            wa_id: message.from,
          };
          events.push({ type: 'message', phoneNumberId, contact, message });
        }
      }

      if (value.statuses) {
        for (const status of value.statuses) {
          events.push({ type: 'status', phoneNumberId, status });
        }
      }

      if (value.errors) {
        for (const error of value.errors) {
          events.push({ type: 'error', phoneNumberId, error });
        }
      }
    }
  }

  return events;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/webhook/parser.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add libs/whatsapp/src/webhook/
git commit -m "feat(whatsapp): add webhook payload parser with typed events

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 5: Meta Graph API Client

**Files:**
- Create: `libs/whatsapp/src/client/types.ts`
- Create: `libs/whatsapp/src/client/meta-api.ts`
- Create: `libs/whatsapp/src/client/meta-api.test.ts`

- [ ] **Step 1: Create client types**

Create `libs/whatsapp/src/client/types.ts`:

```typescript
export interface SendTextMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

export interface SendImageMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'image';
  image: { id?: string; link?: string; caption?: string };
}

export interface SendDocumentMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'document';
  document: { id?: string; link?: string; caption?: string; filename?: string };
}

export interface SendInteractiveMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: InteractiveMessage;
}

export interface InteractiveMessage {
  type: 'button' | 'list';
  header?: { type: 'text'; text: string };
  body: { text: string };
  footer?: { text: string };
  action: InteractiveAction;
}

export interface InteractiveAction {
  buttons?: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
  button?: string;
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
}

export interface SendTemplateMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: { name: string; language: { code: string }; components?: TemplateComponent[] };
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: Array<{ type: 'text'; text: string } | { type: 'image'; image: { link: string } }>;
  sub_type?: string;
  index?: number;
}

export type SendMessageRequest =
  | SendTextMessageRequest
  | SendImageMessageRequest
  | SendDocumentMessageRequest
  | SendInteractiveMessageRequest
  | SendTemplateMessageRequest;

export interface SendMessageResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface MediaUrlResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

export interface UploadMediaResponse {
  id: string;
}

export interface MetaApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id: string;
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `libs/whatsapp/src/client/meta-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetaWhatsAppClient } from './meta-api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MetaWhatsAppClient', () => {
  let client: MetaWhatsAppClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MetaWhatsAppClient({
      accessToken: 'test-token',
      phoneNumberId: 'PHONE_ID',
      apiVersion: 'v21.0',
    });
  });

  describe('sendTextMessage', () => {
    it('sends a text message and returns message id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '15559876543', wa_id: '15559876543' }],
          messages: [{ id: 'wamid.sent123' }],
        }),
      });

      const result = await client.sendTextMessage('15559876543', 'Hello!');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PHONE_ID/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        }),
      );
      expect(result.messages[0].id).toBe('wamid.sent123');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Invalid recipient', type: 'OAuthException', code: 100, fbtrace_id: 'trace' },
        }),
      });

      await expect(client.sendTextMessage('invalid', 'Hi')).rejects.toThrow('Invalid recipient');
    });
  });

  describe('getMediaUrl', () => {
    it('fetches media download URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.fbsbx.com/media/123',
          mime_type: 'image/jpeg',
          sha256: 'abc',
          file_size: 1024,
          id: 'media_123',
        }),
      });

      const result = await client.getMediaUrl('media_123');
      expect(result.url).toBe('https://lookaside.fbsbx.com/media/123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/media_123',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
      );
    });
  });

  describe('sendInteractiveMessage', () => {
    it('sends a button message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '15559876543', wa_id: '15559876543' }],
          messages: [{ id: 'wamid.interactive1' }],
        }),
      });

      const result = await client.sendInteractiveMessage('15559876543', {
        type: 'button',
        body: { text: 'Choose an option:' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'sales', title: 'Sales' } },
            { type: 'reply', reply: { id: 'support', title: 'Support' } },
          ],
        },
      });

      expect(result.messages[0].id).toBe('wamid.interactive1');
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/client/meta-api.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write implementation**

Create `libs/whatsapp/src/client/meta-api.ts`:

```typescript
import type {
  SendMessageResponse,
  MediaUrlResponse,
  UploadMediaResponse,
  InteractiveMessage,
  SendTemplateMessageRequest,
  MetaApiError,
} from './types';

export interface MetaClientConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

export class MetaWhatsAppClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly phoneNumberId: string;

  constructor(config: MetaClientConfig) {
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
    this.baseUrl = `https://graph.facebook.com/${config.apiVersion}`;
  }

  async sendTextMessage(to: string, text: string): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  async sendImageMessage(to: string, imageId: string, caption?: string): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { id: imageId, caption },
    });
  }

  async sendDocumentMessage(to: string, documentId: string, filename?: string, caption?: string): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: { id: documentId, filename, caption },
    });
  }

  async sendInteractiveMessage(to: string, interactive: InteractiveMessage): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive,
    });
  }

  async sendTemplateMessage(to: string, templateName: string, languageCode: string, components?: SendTemplateMessageRequest['template']['components']): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode }, components },
    });
  }

  async getMediaUrl(mediaId: string): Promise<MediaUrlResponse> {
    const response = await fetch(`${this.baseUrl}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      const error = (await response.json()) as MetaApiError;
      throw new Error(error.error.message);
    }

    return response.json() as Promise<MediaUrlResponse>;
  }

  async downloadMedia(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status}`);
    }

    return response.arrayBuffer();
  }

  async uploadMedia(file: Buffer, mimeType: string, filename: string): Promise<UploadMediaResponse> {
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', new Blob([file], { type: mimeType }), filename);
    formData.append('type', mimeType);

    const response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: formData,
    });

    if (!response.ok) {
      const error = (await response.json()) as MetaApiError;
      throw new Error(error.error.message);
    }

    return response.json() as Promise<UploadMediaResponse>;
  }

  private async sendMessage(body: Record<string, unknown>): Promise<SendMessageResponse> {
    const response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as MetaApiError;
      throw new Error(error.error.message);
    }

    return response.json() as Promise<SendMessageResponse>;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/client/meta-api.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add libs/whatsapp/src/client/
git commit -m "feat(whatsapp): add Meta Graph API client for messaging and media

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 6: Router Interface & Factory

**Files:**
- Create: `libs/whatsapp/src/router/router.interface.ts`
- Create: `libs/whatsapp/src/router/factory.ts`
- Create: `libs/whatsapp/src/router/factory.test.ts`

- [ ] **Step 1: Create router interface and types**

Create `libs/whatsapp/src/router/router.interface.ts`:

```typescript
import type { WebhookInboundMessage } from '../webhook/types';
import type { InteractiveMessage } from '../client/types';

export interface RoutingContext {
  message: WebhookInboundMessage;
  contactPhone: string;
  contactName: string;
  accountId: string;
  routing: {
    strategy: string;
    config: Record<string, unknown>;
    fallbackAgentId: string | null;
  };
  rules: Array<{
    agentId: string;
    priority: number;
    condition: Record<string, unknown>;
    isActive: boolean;
  }>;
}

export type RoutingResult =
  | { type: 'resolved'; agentId: string }
  | { type: 'prompt'; interactiveMessage: InteractiveMessage }
  | { type: 'fallback'; agentId: string; reason: string };

export interface WhatsAppRouter {
  route(ctx: RoutingContext): Promise<RoutingResult>;
}
```

- [ ] **Step 2: Write the failing test for factory**

Create `libs/whatsapp/src/router/factory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createRouter } from './factory';

describe('createRouter', () => {
  it('returns a KeywordRouter for keyword strategy', () => {
    const router = createRouter('keyword');
    expect(router).toBeDefined();
    expect(router.constructor.name).toBe('KeywordRouter');
  });

  it('returns a MenuRouter for menu strategy', () => {
    const router = createRouter('menu');
    expect(router).toBeDefined();
    expect(router.constructor.name).toBe('MenuRouter');
  });

  it('returns a TimeRouter for time_based strategy', () => {
    const router = createRouter('time_based');
    expect(router).toBeDefined();
    expect(router.constructor.name).toBe('TimeRouter');
  });

  it('returns an AiIntentRouter for ai_intent strategy', () => {
    const router = createRouter('ai_intent');
    expect(router).toBeDefined();
    expect(router.constructor.name).toBe('AiIntentRouter');
  });

  it('throws for unknown strategy', () => {
    expect(() => createRouter('unknown')).toThrow('Unknown routing strategy: unknown');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/router/factory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write stub routers and factory**

Create `libs/whatsapp/src/router/keyword-router.ts`:

```typescript
import type { WhatsAppRouter, RoutingContext, RoutingResult } from './router.interface';

export class KeywordRouter implements WhatsAppRouter {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const messageText = ctx.message.text?.body?.toLowerCase() ?? '';
    const activeRules = ctx.rules
      .filter((r) => r.isActive)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of activeRules) {
      const condition = rule.condition as { type: string; value: string; values?: string[] };
      if (condition.type !== 'keyword') continue;

      const keywords = condition.values ?? [condition.value];
      const matched = keywords.some((kw) => messageText.includes(kw.toLowerCase()));
      if (matched) {
        return { type: 'resolved', agentId: rule.agentId };
      }
    }

    if (ctx.routing.fallbackAgentId) {
      return { type: 'fallback', agentId: ctx.routing.fallbackAgentId, reason: 'no keyword matched' };
    }

    throw new Error('No routing rule matched and no fallback agent configured');
  }
}
```

Create `libs/whatsapp/src/router/menu-router.ts`:

```typescript
import type { WhatsAppRouter, RoutingContext, RoutingResult } from './router.interface';

export class MenuRouter implements WhatsAppRouter {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const interactiveReply = ctx.message.interactive;
    if (interactiveReply) {
      const selectedId = interactiveReply.button_reply?.id ?? interactiveReply.list_reply?.id;
      if (selectedId) {
        const matchedRule = ctx.rules.find(
          (r) => r.isActive && (r.condition as { id: string }).id === selectedId
        );
        if (matchedRule) {
          return { type: 'resolved', agentId: matchedRule.agentId };
        }
      }
    }

    const menuConfig = ctx.routing.config as { bodyText?: string; buttonLabel?: string };
    const activeRules = ctx.rules.filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);

    if (activeRules.length <= 3) {
      return {
        type: 'prompt',
        interactiveMessage: {
          type: 'button',
          body: { text: menuConfig.bodyText ?? 'How can I help you today?' },
          action: {
            buttons: activeRules.map((rule) => ({
              type: 'reply' as const,
              reply: {
                id: (rule.condition as { id: string }).id,
                title: (rule.condition as { label: string }).label,
              },
            })),
          },
        },
      };
    }

    return {
      type: 'prompt',
      interactiveMessage: {
        type: 'list',
        body: { text: menuConfig.bodyText ?? 'How can I help you today?' },
        action: {
          button: menuConfig.buttonLabel ?? 'Choose',
          sections: [{
            title: 'Options',
            rows: activeRules.map((rule) => ({
              id: (rule.condition as { id: string }).id,
              title: (rule.condition as { label: string }).label,
              description: (rule.condition as { description?: string }).description,
            })),
          }],
        },
      },
    };
  }
}
```

Create `libs/whatsapp/src/router/time-router.ts`:

```typescript
import type { WhatsAppRouter, RoutingContext, RoutingResult } from './router.interface';

export class TimeRouter implements WhatsAppRouter {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const now = new Date();
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDay = now.getDay();

    const activeRules = ctx.rules
      .filter((r) => r.isActive)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of activeRules) {
      const condition = rule.condition as {
        type: string;
        start: string;
        end: string;
        days?: number[];
      };
      if (condition.type !== 'time') continue;

      if (condition.days && !condition.days.includes(currentDay)) continue;

      if (currentHHMM >= condition.start && currentHHMM <= condition.end) {
        return { type: 'resolved', agentId: rule.agentId };
      }
    }

    if (ctx.routing.fallbackAgentId) {
      return { type: 'fallback', agentId: ctx.routing.fallbackAgentId, reason: 'no time rule matched' };
    }

    throw new Error('No time-based routing rule matched and no fallback agent configured');
  }
}
```

Create `libs/whatsapp/src/router/ai-intent-router.ts`:

```typescript
import type { WhatsAppRouter, RoutingContext, RoutingResult } from './router.interface';

export class AiIntentRouter implements WhatsAppRouter {
  async route(ctx: RoutingContext): Promise<RoutingResult> {
    const messageText = ctx.message.text?.body ?? '';
    if (!messageText) {
      if (ctx.routing.fallbackAgentId) {
        return { type: 'fallback', agentId: ctx.routing.fallbackAgentId, reason: 'no text to classify' };
      }
      throw new Error('Cannot classify intent without text content');
    }

    const config = ctx.routing.config as { model?: string; systemPrompt?: string };
    const activeRules = ctx.rules.filter((r) => r.isActive);

    const agentDescriptions = activeRules.map((rule) => {
      const condition = rule.condition as { intent: string; description: string };
      return `- "${condition.intent}": ${condition.description} (agentId: ${rule.agentId})`;
    }).join('\n');

    const systemPrompt = config.systemPrompt ?? [
      'You are a routing classifier. Given a user message, determine which agent should handle it.',
      'Available agents:',
      agentDescriptions,
      '',
      'Respond with ONLY the agentId that best matches. If unsure, respond with "fallback".',
    ].join('\n');

    // AI classification will be wired in during integration
    // For now, use fallback
    if (ctx.routing.fallbackAgentId) {
      return { type: 'fallback', agentId: ctx.routing.fallbackAgentId, reason: 'ai_intent requires LLM integration' };
    }

    throw new Error('AI intent router requires fallback agent until LLM integration is complete');
  }
}
```

Create `libs/whatsapp/src/router/factory.ts`:

```typescript
import type { WhatsAppRouter } from './router.interface';
import { KeywordRouter } from './keyword-router';
import { MenuRouter } from './menu-router';
import { TimeRouter } from './time-router';
import { AiIntentRouter } from './ai-intent-router';

export function createRouter(strategy: string): WhatsAppRouter {
  switch (strategy) {
    case 'keyword':
      return new KeywordRouter();
    case 'menu':
      return new MenuRouter();
    case 'time_based':
      return new TimeRouter();
    case 'ai_intent':
      return new AiIntentRouter();
    default:
      throw new Error(`Unknown routing strategy: ${strategy}`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/router/factory.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add libs/whatsapp/src/router/
git commit -m "feat(whatsapp): add configurable routing framework with 4 strategies

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 7: Keyword Router Tests

**Files:**
- Create: `libs/whatsapp/src/router/keyword-router.test.ts`

- [ ] **Step 1: Write tests for keyword router**

Create `libs/whatsapp/src/router/keyword-router.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { KeywordRouter } from './keyword-router';
import type { RoutingContext } from './router.interface';

function makeContext(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    message: { from: '15559876543', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'I need sales help' } },
    contactPhone: '15559876543',
    contactName: 'John',
    accountId: 'acc_1',
    routing: { strategy: 'keyword', config: {}, fallbackAgentId: 'agent_fallback' },
    rules: [
      { agentId: 'agent_sales', priority: 0, condition: { type: 'keyword', value: 'sales' }, isActive: true },
      { agentId: 'agent_support', priority: 1, condition: { type: 'keyword', value: 'support' }, isActive: true },
    ],
    ...overrides,
  };
}

describe('KeywordRouter', () => {
  const router = new KeywordRouter();

  it('routes to agent matching keyword', async () => {
    const result = await router.route(makeContext());
    expect(result).toEqual({ type: 'resolved', agentId: 'agent_sales' });
  });

  it('matches case-insensitively', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'SALES please' } },
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'resolved', agentId: 'agent_sales' });
  });

  it('respects priority order', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'sales and support' } },
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'resolved', agentId: 'agent_sales' });
  });

  it('falls back when no keyword matches', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'hello there' } },
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'fallback', agentId: 'agent_fallback', reason: 'no keyword matched' });
  });

  it('skips inactive rules', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'sales' } },
      rules: [
        { agentId: 'agent_sales', priority: 0, condition: { type: 'keyword', value: 'sales' }, isActive: false },
        { agentId: 'agent_support', priority: 1, condition: { type: 'keyword', value: 'support' }, isActive: true },
      ],
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'fallback', agentId: 'agent_fallback', reason: 'no keyword matched' });
  });

  it('supports multiple keywords via values array', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'billing issue' } },
      rules: [
        { agentId: 'agent_billing', priority: 0, condition: { type: 'keyword', values: ['billing', 'invoice', 'payment'] }, isActive: true },
      ],
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'resolved', agentId: 'agent_billing' });
  });

  it('throws when no match and no fallback', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'hello' } },
      routing: { strategy: 'keyword', config: {}, fallbackAgentId: null },
    });
    await expect(router.route(ctx)).rejects.toThrow('No routing rule matched and no fallback agent configured');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd libs/whatsapp && bunx vitest run src/router/keyword-router.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 3: Commit**

```bash
git add libs/whatsapp/src/router/keyword-router.test.ts
git commit -m "test(whatsapp): add keyword router unit tests

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 8: Session Manager

**Files:**
- Create: `libs/whatsapp/src/session/session-manager.ts`
- Create: `libs/whatsapp/src/session/session-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/whatsapp/src/session/session-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from './session-manager';

const mockPrisma = {
  whatsAppSession: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager(mockPrisma as any);
  });

  describe('findActiveSession', () => {
    it('returns active session for contact', async () => {
      const session = { id: 'sess_1', state: 'active', agentId: 'agent_1', windowExpiresAt: new Date(Date.now() + 86400000) };
      mockPrisma.whatsAppSession.findFirst.mockResolvedValueOnce(session);

      const result = await manager.findActiveSession('acc_1', '15559876543');
      expect(result).toEqual(session);
      expect(mockPrisma.whatsAppSession.findFirst).toHaveBeenCalledWith({
        where: { accountId: 'acc_1', contactPhone: '15559876543', state: 'active' },
      });
    });

    it('returns null when no active session', async () => {
      mockPrisma.whatsAppSession.findFirst.mockResolvedValueOnce(null);
      const result = await manager.findActiveSession('acc_1', '15559876543');
      expect(result).toBeNull();
    });

    it('expires session if window has passed', async () => {
      const expired = { id: 'sess_1', state: 'active', agentId: 'agent_1', windowExpiresAt: new Date(Date.now() - 1000) };
      mockPrisma.whatsAppSession.findFirst.mockResolvedValueOnce(expired);
      mockPrisma.whatsAppSession.update.mockResolvedValueOnce({ ...expired, state: 'expired' });

      const result = await manager.findActiveSession('acc_1', '15559876543');
      expect(result).toBeNull();
      expect(mockPrisma.whatsAppSession.update).toHaveBeenCalledWith({
        where: { id: 'sess_1' },
        data: { state: 'expired' },
      });
    });
  });

  describe('createSession', () => {
    it('creates a new session with 24h window', async () => {
      const now = new Date();
      mockPrisma.whatsAppSession.create.mockImplementation(({ data }) => Promise.resolve({ id: 'sess_new', ...data }));

      const result = await manager.createSession({
        accountId: 'acc_1',
        contactPhone: '15559876543',
        contactName: 'John',
        agentId: 'agent_1',
      });

      expect(result.accountId).toBe('acc_1');
      expect(result.agentId).toBe('agent_1');
      expect(result.state).toBe('active');
      expect(mockPrisma.whatsAppSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'acc_1',
          contactPhone: '15559876543',
          contactName: 'John',
          agentId: 'agent_1',
          state: 'active',
          context: {},
        }),
      });
    });
  });

  describe('refreshWindow', () => {
    it('updates lastMessageAt and windowExpiresAt', async () => {
      mockPrisma.whatsAppSession.update.mockResolvedValueOnce({ id: 'sess_1' });

      await manager.refreshWindow('sess_1');

      expect(mockPrisma.whatsAppSession.update).toHaveBeenCalledWith({
        where: { id: 'sess_1' },
        data: expect.objectContaining({
          lastMessageAt: expect.any(Date),
          windowExpiresAt: expect.any(Date),
        }),
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/session/session-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `libs/whatsapp/src/session/session-manager.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';

const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CreateSessionInput {
  accountId: string;
  contactPhone: string;
  contactName: string | null;
  agentId: string;
}

export class SessionManager {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findActiveSession(accountId: string, contactPhone: string) {
    const session = await (this.prisma as any).whatsAppSession.findFirst({
      where: { accountId, contactPhone, state: 'active' },
    });

    if (!session) return null;

    if (new Date() > session.windowExpiresAt) {
      await (this.prisma as any).whatsAppSession.update({
        where: { id: session.id },
        data: { state: 'expired' },
      });
      return null;
    }

    return session;
  }

  async createSession(input: CreateSessionInput) {
    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + WINDOW_DURATION_MS);

    return (this.prisma as any).whatsAppSession.create({
      data: {
        accountId: input.accountId,
        contactPhone: input.contactPhone,
        contactName: input.contactName,
        agentId: input.agentId,
        state: 'active',
        context: {},
        lastMessageAt: now,
        windowExpiresAt,
      },
    });
  }

  async refreshWindow(sessionId: string) {
    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + WINDOW_DURATION_MS);

    return (this.prisma as any).whatsAppSession.update({
      where: { id: sessionId },
      data: { lastMessageAt: now, windowExpiresAt },
    });
  }

  async updateContext(sessionId: string, context: Record<string, unknown>) {
    return (this.prisma as any).whatsAppSession.update({
      where: { id: sessionId },
      data: { context },
    });
  }

  async closeSession(sessionId: string) {
    return (this.prisma as any).whatsAppSession.update({
      where: { id: sessionId },
      data: { state: 'closed' },
    });
  }

  async switchAgent(sessionId: string, agentId: string) {
    return (this.prisma as any).whatsAppSession.update({
      where: { id: sessionId },
      data: { agentId, context: {} },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/session/session-manager.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add libs/whatsapp/src/session/
git commit -m "feat(whatsapp): add session manager with 24h window tracking

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 9: Command Handler

**Files:**
- Create: `libs/whatsapp/src/session/command-handler.ts`
- Create: `libs/whatsapp/src/session/command-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/whatsapp/src/session/command-handler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CommandHandler, CommandResult } from './command-handler';

describe('CommandHandler', () => {
  const handler = new CommandHandler();

  it('detects /reset command', () => {
    const result = handler.parse('/reset');
    expect(result).toEqual({ type: 'reset' });
  });

  it('detects /switch command with agent name', () => {
    const result = handler.parse('/switch sales');
    expect(result).toEqual({ type: 'switch', agentName: 'sales' });
  });

  it('detects /help command', () => {
    const result = handler.parse('/help');
    expect(result).toEqual({ type: 'help' });
  });

  it('returns null for non-command messages', () => {
    const result = handler.parse('Hello, I need help');
    expect(result).toBeNull();
  });

  it('returns null for messages starting with / but not a known command', () => {
    const result = handler.parse('/unknown');
    expect(result).toBeNull();
  });

  it('is case-insensitive', () => {
    const result = handler.parse('/RESET');
    expect(result).toEqual({ type: 'reset' });
  });

  it('trims whitespace', () => {
    const result = handler.parse('  /help  ');
    expect(result).toEqual({ type: 'help' });
  });

  it('handles /switch without agent name', () => {
    const result = handler.parse('/switch');
    expect(result).toEqual({ type: 'switch', agentName: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/session/command-handler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `libs/whatsapp/src/session/command-handler.ts`:

```typescript
export type CommandResult =
  | { type: 'reset' }
  | { type: 'switch'; agentName: string | undefined }
  | { type: 'help' };

const COMMANDS = ['reset', 'switch', 'help'] as const;

export class CommandHandler {
  parse(text: string): CommandResult | null {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0];

    if (!COMMANDS.includes(command as any)) return null;

    switch (command) {
      case 'reset':
        return { type: 'reset' };
      case 'switch':
        return { type: 'switch', agentName: parts[1] || undefined };
      case 'help':
        return { type: 'help' };
      default:
        return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/session/command-handler.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add libs/whatsapp/src/session/command-handler.ts libs/whatsapp/src/session/command-handler.test.ts
git commit -m "feat(whatsapp): add command handler for /reset, /switch, /help

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 10: Media Downloader

**Files:**
- Create: `libs/whatsapp/src/media/downloader.ts`
- Create: `libs/whatsapp/src/media/downloader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/whatsapp/src/media/downloader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaDownloader } from './downloader';

const mockMetaClient = {
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
};

const mockS3Client = {
  upload: vi.fn(),
};

describe('MediaDownloader', () => {
  let downloader: MediaDownloader;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new MediaDownloader(mockMetaClient as any, mockS3Client as any, 'test-bucket');
  });

  it('downloads media from Meta and uploads to S3', async () => {
    mockMetaClient.getMediaUrl.mockResolvedValueOnce({
      url: 'https://lookaside.fbsbx.com/media/123',
      mime_type: 'image/jpeg',
      file_size: 2048,
      id: 'media_123',
    });
    mockMetaClient.downloadMedia.mockResolvedValueOnce(new ArrayBuffer(2048));
    mockS3Client.upload.mockResolvedValueOnce('s3://test-bucket/whatsapp/acc_1/media_123.jpg');

    const result = await downloader.download('media_123', 'acc_1');

    expect(result).toEqual({
      s3Key: 'whatsapp/acc_1/media_123.jpg',
      mimeType: 'image/jpeg',
      fileSize: 2048,
    });
    expect(mockMetaClient.getMediaUrl).toHaveBeenCalledWith('media_123');
    expect(mockMetaClient.downloadMedia).toHaveBeenCalledWith('https://lookaside.fbsbx.com/media/123');
    expect(mockS3Client.upload).toHaveBeenCalledWith(
      'test-bucket',
      'whatsapp/acc_1/media_123.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
  });

  it('derives file extension from mime type', async () => {
    mockMetaClient.getMediaUrl.mockResolvedValueOnce({
      url: 'https://lookaside.fbsbx.com/media/456',
      mime_type: 'application/pdf',
      file_size: 4096,
      id: 'media_456',
    });
    mockMetaClient.downloadMedia.mockResolvedValueOnce(new ArrayBuffer(4096));
    mockS3Client.upload.mockResolvedValueOnce('s3://test-bucket/whatsapp/acc_1/media_456.pdf');

    const result = await downloader.download('media_456', 'acc_1');
    expect(result.s3Key).toBe('whatsapp/acc_1/media_456.pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/media/downloader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `libs/whatsapp/src/media/downloader.ts`:

```typescript
import type { MetaWhatsAppClient } from '../client/meta-api';

export interface S3Uploader {
  upload(bucket: string, key: string, body: Buffer, contentType: string): Promise<string>;
}

export interface DownloadResult {
  s3Key: string;
  mimeType: string;
  fileSize: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'text/plain': 'txt',
};

export class MediaDownloader {
  private readonly metaClient: MetaWhatsAppClient;
  private readonly s3: S3Uploader;
  private readonly bucket: string;

  constructor(metaClient: MetaWhatsAppClient, s3: S3Uploader, bucket: string) {
    this.metaClient = metaClient;
    this.s3 = s3;
    this.bucket = bucket;
  }

  async download(mediaId: string, accountId: string): Promise<DownloadResult> {
    const mediaInfo = await this.metaClient.getMediaUrl(mediaId);
    const data = await this.metaClient.downloadMedia(mediaInfo.url);

    const ext = MIME_TO_EXT[mediaInfo.mime_type] ?? 'bin';
    const s3Key = `whatsapp/${accountId}/${mediaId}.${ext}`;

    await this.s3.upload(this.bucket, s3Key, Buffer.from(data), mediaInfo.mime_type);

    return {
      s3Key,
      mimeType: mediaInfo.mime_type,
      fileSize: mediaInfo.file_size,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/media/downloader.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add libs/whatsapp/src/media/
git commit -m "feat(whatsapp): add media downloader (Meta CDN → S3)

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 11: Concurrency Controls

**Files:**
- Create: `libs/whatsapp/src/concurrency/contact-lock.ts`
- Create: `libs/whatsapp/src/concurrency/rate-limiter.ts`
- Create: `libs/whatsapp/src/concurrency/circuit-breaker.ts`
- Create: `libs/whatsapp/src/concurrency/circuit-breaker.test.ts`

- [ ] **Step 1: Create contact lock**

Create `libs/whatsapp/src/concurrency/contact-lock.ts`:

```typescript
export interface LockProvider {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export class InMemoryLockProvider implements LockProvider {
  private readonly locks = new Map<string, number>();

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing > now) return false;
    this.locks.set(key, now + ttlMs);
    return true;
  }

  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

export class ContactLock {
  private readonly provider: LockProvider;
  private readonly ttlMs: number;

  constructor(provider: LockProvider, ttlMs = 60_000) {
    this.provider = provider;
    this.ttlMs = ttlMs;
  }

  async acquire(accountId: string, contactPhone: string): Promise<boolean> {
    const key = `wa:lock:${accountId}:${contactPhone}`;
    return this.provider.acquire(key, this.ttlMs);
  }

  async release(accountId: string, contactPhone: string): Promise<void> {
    const key = `wa:lock:${accountId}:${contactPhone}`;
    return this.provider.release(key);
  }
}
```

- [ ] **Step 2: Create rate limiter**

Create `libs/whatsapp/src/concurrency/rate-limiter.ts`:

```typescript
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export class InMemoryRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async check(accountId: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const key = `wa:rate:${accountId}`;
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, resetAt: new Date(now + windowMs) };
    }

    if (existing.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: new Date(existing.resetAt) };
    }

    existing.count++;
    return { allowed: true, remaining: limit - existing.count, resetAt: new Date(existing.resetAt) };
  }
}
```

- [ ] **Step 3: Write the failing test for circuit breaker**

Create `libs/whatsapp/src/concurrency/circuit-breaker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
  });

  it('starts in closed state', () => {
    expect(breaker.isOpen()).toBe(false);
  });

  it('stays closed below failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it('opens after reaching failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it('resets failure count on success', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it('transitions to half-open after reset timeout', async () => {
    breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    expect(breaker.isOpen()).toBe(false); // half-open allows a try
  });

  it('re-opens on failure in half-open state', async () => {
    breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    breaker.recordFailure();
    await new Promise((r) => setTimeout(r, 60));

    expect(breaker.isOpen()).toBe(false); // half-open
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true); // re-opened
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/concurrency/circuit-breaker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Write circuit breaker implementation**

Create `libs/whatsapp/src/concurrency/circuit-breaker.ts`:

```typescript
export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

type State = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private state: State = 'closed';
  private failureCount = 0;
  private lastFailureAt = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  isOpen(): boolean {
    if (this.state === 'closed') return false;

    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureAt;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'half_open';
        return false;
      }
      return true;
    }

    // half_open — allow one attempt
    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();

    if (this.state === 'half_open' || this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/concurrency/circuit-breaker.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add libs/whatsapp/src/concurrency/
git commit -m "feat(whatsapp): add concurrency controls (lock, rate limiter, circuit breaker)

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 12: Message Processor (Orchestration)

**Files:**
- Create: `libs/whatsapp/src/processor/message-processor.ts`
- Create: `libs/whatsapp/src/processor/message-processor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/whatsapp/src/processor/message-processor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageProcessor } from './message-processor';

const mockPrisma = {
  whatsAppAccount: { findFirst: vi.fn() },
  whatsAppMessage: { findUnique: vi.fn(), create: vi.fn() },
  whatsAppSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  whatsAppRouting: { findUnique: vi.fn() },
  whatsAppRoutingRule: { findMany: vi.fn() },
};

const mockMetaClient = {
  sendTextMessage: vi.fn(),
  sendInteractiveMessage: vi.fn(),
};

const mockSessionManager = {
  findActiveSession: vi.fn(),
  createSession: vi.fn(),
  refreshWindow: vi.fn(),
  closeSession: vi.fn(),
  switchAgent: vi.fn(),
};

const mockAgentExecutor = {
  execute: vi.fn(),
};

const mockContactLock = {
  acquire: vi.fn(),
  release: vi.fn(),
};

const mockCircuitBreaker = {
  isOpen: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
};

describe('MessageProcessor', () => {
  let processor: MessageProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new MessageProcessor({
      prisma: mockPrisma as any,
      sessionManager: mockSessionManager as any,
      agentExecutor: mockAgentExecutor as any,
      contactLock: mockContactLock as any,
      circuitBreaker: mockCircuitBreaker as any,
      metaClientFactory: () => mockMetaClient as any,
    });
  });

  it('skips duplicate messages', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1' });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce({ id: 'existing' });

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.dup', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockSessionManager.findActiveSession).not.toHaveBeenCalled();
  });

  it('acquires contact lock before processing', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1' });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(false);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockContactLock.acquire).toHaveBeenCalledWith('acc_1', '15559876543');
    expect(mockAgentExecutor.execute).not.toHaveBeenCalled();
  });

  it('routes to existing session agent and executes', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1' });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockSessionManager.findActiveSession.mockResolvedValueOnce({ id: 'sess_1', agentId: 'agent_1', context: {} });
    mockAgentExecutor.execute.mockResolvedValueOnce({ text: 'Hello! How can I help?' });
    mockMetaClient.sendTextMessage.mockResolvedValueOnce({ messages: [{ id: 'wamid.out1' }] });
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.2', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockSessionManager.findActiveSession).toHaveBeenCalledWith('acc_1', '15559876543');
    expect(mockAgentExecutor.execute).toHaveBeenCalledWith('agent_1', expect.objectContaining({ text: 'Hi' }), {});
    expect(mockMetaClient.sendTextMessage).toHaveBeenCalledWith('15559876543', 'Hello! How can I help?');
    expect(mockSessionManager.refreshWindow).toHaveBeenCalledWith('sess_1');
    expect(mockContactLock.release).toHaveBeenCalledWith('acc_1', '15559876543');
  });

  it('rejects when circuit breaker is open', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1' });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(true);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.3', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockAgentExecutor.execute).not.toHaveBeenCalled();
    expect(mockContactLock.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/processor/message-processor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `libs/whatsapp/src/processor/message-processor.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import type { ParsedEvent } from '../webhook/types';
import type { SessionManager } from '../session/session-manager';
import type { ContactLock } from '../concurrency/contact-lock';
import type { CircuitBreaker } from '../concurrency/circuit-breaker';
import type { MetaWhatsAppClient } from '../client/meta-api';
import { CommandHandler } from '../session/command-handler';
import { createRouter } from '../router/factory';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('whatsapp-processor');

export interface AgentExecutor {
  execute(agentId: string, message: { text?: string; mediaUrl?: string; mediaType?: string }, context: Record<string, unknown>): Promise<{ text: string }>;
}

export interface MessageProcessorDeps {
  prisma: PrismaClient;
  sessionManager: SessionManager;
  agentExecutor: AgentExecutor;
  contactLock: ContactLock;
  circuitBreaker: CircuitBreaker;
  metaClientFactory: (accessToken: string, phoneNumberId: string) => MetaWhatsAppClient;
}

export class MessageProcessor {
  private readonly deps: MessageProcessorDeps;
  private readonly commandHandler = new CommandHandler();

  constructor(deps: MessageProcessorDeps) {
    this.deps = deps;
  }

  async processMessageEvent(event: Extract<ParsedEvent, { type: 'message' }>): Promise<void> {
    const { phoneNumberId, contact, message } = event;

    const account = await (this.deps.prisma as any).whatsAppAccount.findFirst({
      where: { phoneNumberId },
    });

    if (!account) {
      logger.warn({ phoneNumberId }, 'No WhatsApp account found for phone number ID');
      return;
    }

    // Deduplication
    const existing = await (this.deps.prisma as any).whatsAppMessage.findUnique({
      where: { waMessageId: message.id },
    });
    if (existing) {
      logger.debug({ waMessageId: message.id }, 'Duplicate message, skipping');
      return;
    }

    // Contact lock
    const lockAcquired = await this.deps.contactLock.acquire(account.id, contact.wa_id);
    if (!lockAcquired) {
      logger.warn({ accountId: account.id, contactPhone: contact.wa_id }, 'Could not acquire contact lock, skipping');
      return;
    }

    try {
      // Circuit breaker check
      if (this.deps.circuitBreaker.isOpen()) {
        logger.warn({ accountId: account.id }, 'Circuit breaker open, skipping message processing');
        return;
      }

      // Persist inbound message
      await (this.deps.prisma as any).whatsAppMessage.create({
        data: {
          accountId: account.id,
          waMessageId: message.id,
          direction: 'inbound',
          contactPhone: contact.wa_id,
          type: message.type,
          content: this.extractContent(message),
          status: 'received',
        },
      });

      // Check for commands
      const messageText = message.text?.body ?? '';
      const command = this.commandHandler.parse(messageText);
      if (command) {
        await this.handleCommand(command, account, contact.wa_id);
        return;
      }

      // Find or create session
      let session = await this.deps.sessionManager.findActiveSession(account.id, contact.wa_id);

      if (!session) {
        // Route to agent
        const routing = await (this.deps.prisma as any).whatsAppRouting.findUnique({
          where: { accountId: account.id },
        });

        if (!routing) {
          logger.error({ accountId: account.id }, 'No routing config found');
          return;
        }

        const rules = await (this.deps.prisma as any).whatsAppRoutingRule.findMany({
          where: { routingId: routing.id, isActive: true },
          orderBy: { priority: 'asc' },
        });

        const router = createRouter(routing.strategy);
        const routingResult = await router.route({
          message,
          contactPhone: contact.wa_id,
          contactName: contact.profile.name,
          accountId: account.id,
          routing: { strategy: routing.strategy, config: routing.config, fallbackAgentId: routing.fallbackAgentId },
          rules,
        });

        if (routingResult.type === 'prompt') {
          const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);
          await metaClient.sendInteractiveMessage(contact.wa_id, routingResult.interactiveMessage);
          return;
        }

        const agentId = routingResult.agentId;
        session = await this.deps.sessionManager.createSession({
          accountId: account.id,
          contactPhone: contact.wa_id,
          contactName: contact.profile.name,
          agentId,
        });
      }

      // Execute agent
      const agentResponse = await this.deps.agentExecutor.execute(
        session.agentId,
        { text: messageText },
        session.context ?? {},
      );

      // Send response
      const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);
      const sendResult = await metaClient.sendTextMessage(contact.wa_id, agentResponse.text);
      this.deps.circuitBreaker.recordSuccess();

      // Persist outbound message
      await (this.deps.prisma as any).whatsAppMessage.create({
        data: {
          accountId: account.id,
          sessionId: session.id,
          waMessageId: sendResult.messages[0].id,
          direction: 'outbound',
          contactPhone: contact.wa_id,
          type: 'text',
          content: { text: agentResponse.text },
          status: 'sent',
        },
      });

      // Refresh session window
      await this.deps.sessionManager.refreshWindow(session.id);

    } catch (error) {
      this.deps.circuitBreaker.recordFailure();
      logger.error({ error, accountId: account.id, waMessageId: message.id }, 'Error processing WhatsApp message');
    } finally {
      await this.deps.contactLock.release(account.id, contact.wa_id);
    }
  }

  async processStatusEvent(event: Extract<ParsedEvent, { type: 'status' }>): Promise<void> {
    const { status } = event;

    await (this.deps.prisma as any).whatsAppMessage.updateMany({
      where: { waMessageId: status.id },
      data: {
        status: status.status,
        statusTimestamp: new Date(parseInt(status.timestamp) * 1000),
        errorCode: status.errors?.[0]?.code?.toString(),
        errorMessage: status.errors?.[0]?.message,
      },
    });
  }

  private async handleCommand(
    command: { type: string; agentName?: string },
    account: { id: string; accessToken: string; phoneNumberId: string },
    contactPhone: string,
  ): Promise<void> {
    const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);

    switch (command.type) {
      case 'reset': {
        const session = await this.deps.sessionManager.findActiveSession(account.id, contactPhone);
        if (session) await this.deps.sessionManager.closeSession(session.id);
        await metaClient.sendTextMessage(contactPhone, 'Session reset. Send a message to start a new conversation.');
        break;
      }
      case 'help': {
        await metaClient.sendTextMessage(contactPhone, 'Available commands:\n/reset - Start a new conversation\n/switch <agent> - Switch to a different agent\n/help - Show this message');
        break;
      }
      case 'switch': {
        const session = await this.deps.sessionManager.findActiveSession(account.id, contactPhone);
        if (!session) {
          await metaClient.sendTextMessage(contactPhone, 'No active session. Send a message to start a new conversation.');
        } else if (!command.agentName) {
          await metaClient.sendTextMessage(contactPhone, 'Usage: /switch <agent-name>');
        } else {
          await metaClient.sendTextMessage(contactPhone, `Switched to agent: ${command.agentName}`);
        }
        break;
      }
    }
  }

  private extractContent(message: any): Record<string, unknown> {
    switch (message.type) {
      case 'text':
        return { text: message.text?.body };
      case 'image':
        return { mediaId: message.image?.id, mimeType: message.image?.mime_type, caption: message.image?.caption };
      case 'document':
        return { mediaId: message.document?.id, mimeType: message.document?.mime_type, filename: message.document?.filename, caption: message.document?.caption };
      case 'interactive':
        return { interactive: message.interactive };
      default:
        return { raw: message };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/processor/message-processor.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add libs/whatsapp/src/processor/
git commit -m "feat(whatsapp): add message processor orchestration layer

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 13: Webhook API Route

**Files:**
- Create: `apps/web-ui/app/api/webhooks/whatsapp/route.ts`

- [ ] **Step 1: Create the webhook route**

Create `apps/web-ui/app/api/webhooks/whatsapp/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@chatbot/whatsapp';
import { parseWebhookPayload } from '@chatbot/whatsapp';
import { createMessageProcessor } from '@chatbot/whatsapp';
import { createLogger } from '@chatbot/shared';
import { whatsappEnv } from '@chatbot/whatsapp';

const logger = createLogger('whatsapp-webhook');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === whatsappEnv.META_WEBHOOK_VERIFY_TOKEN) {
    logger.info('Webhook verification successful');
    return new NextResponse(challenge, { status: 200 });
  }

  logger.warn({ mode, token }, 'Webhook verification failed');
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256') ?? '';

  if (!verifyWebhookSignature(rawBody, signature, whatsappEnv.META_APP_SECRET)) {
    logger.warn('Invalid webhook signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const events = parseWebhookPayload(payload);

  if (events.length === 0) {
    return NextResponse.json({ status: 'ok' });
  }

  // Fire-and-forget processing via waitUntil
  const processingPromise = (async () => {
    const processor = createMessageProcessor();

    for (const event of events) {
      try {
        switch (event.type) {
          case 'message':
            await processor.processMessageEvent(event);
            break;
          case 'status':
            await processor.processStatusEvent(event);
            break;
          case 'error':
            logger.error({ error: event.error, phoneNumberId: event.phoneNumberId }, 'WhatsApp error event');
            break;
        }
      } catch (error) {
        logger.error({ error, eventType: event.type }, 'Failed to process WhatsApp event');
      }
    }
  })();

  // Use waitUntil if available (Next.js edge/node runtime)
  if (typeof globalThis !== 'undefined' && 'waitUntil' in globalThis) {
    (globalThis as any).waitUntil(processingPromise);
  } else {
    // Fallback: don't await, let it run in background
    processingPromise.catch((err) => logger.error({ err }, 'Background processing failed'));
  }

  return NextResponse.json({ status: 'ok' });
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `cd apps/web-ui && bunx tsc --noEmit --skipLibCheck 2>&1 | grep -i "webhooks/whatsapp" || echo "No type errors in webhook route"`
Expected: No type errors (or only errors from missing exports we'll wire up in Task 16)

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/webhooks/whatsapp/
git commit -m "feat(whatsapp): add webhook API route with signature verification and waitUntil

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 14: Embedded Signup Connect Endpoint

**Files:**
- Create: `apps/web-ui/app/api/whatsapp/connect/route.ts`
- Create: `apps/web-ui/app/api/whatsapp/disconnect/route.ts`
- Create: `apps/web-ui/app/api/whatsapp/accounts/route.ts`

- [ ] **Step 1: Create the connect route**

Create `apps/web-ui/app/api/whatsapp/connect/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { whatsappEnv } from '@chatbot/whatsapp';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-connect');

const connectSchema = z.object({
  code: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TenantConfig', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    // Exchange code for access token
    const tokenResponse = await fetch(
      `https://graph.facebook.com/${whatsappEnv.META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: whatsappEnv.META_APP_ID,
        client_secret: whatsappEnv.META_APP_SECRET,
        code: parsed.data.code,
      }),
    );

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      logger.error({ error }, 'Failed to exchange code for token');
      return NextResponse.json({ error: 'Failed to connect WhatsApp account' }, { status: 502 });
    }

    const { access_token } = await tokenResponse.json();

    // Fetch WABA details using debug_token or shared WABA info endpoint
    const wabaResponse = await fetch(
      `https://graph.facebook.com/${whatsappEnv.META_API_VERSION}/debug_token?input_token=${access_token}`,
      { headers: { Authorization: `Bearer ${whatsappEnv.META_APP_ID}|${whatsappEnv.META_APP_SECRET}` } },
    );

    // Get phone numbers for this WABA
    const phonesResponse = await fetch(
      `https://graph.facebook.com/${whatsappEnv.META_API_VERSION}/me/phone_numbers`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );

    if (!phonesResponse.ok) {
      logger.error('Failed to fetch phone numbers');
      return NextResponse.json({ error: 'Failed to fetch WhatsApp phone numbers' }, { status: 502 });
    }

    const phonesData = await phonesResponse.json();
    const phoneNumber = phonesData.data?.[0];

    if (!phoneNumber) {
      return NextResponse.json({ error: 'No phone number found in WhatsApp Business Account' }, { status: 400 });
    }

    // Encrypt access token
    const encryption = new EncryptionService();
    const encryptedToken = encryption.encrypt(access_token);

    // Create WhatsApp account record
    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.create({
      data: {
        tenantId,
        wabaId: phoneNumber.waba_id ?? 'pending',
        phoneNumberId: phoneNumber.id,
        displayPhone: phoneNumber.display_phone_number,
        displayName: phoneNumber.verified_name ?? '',
        accessToken: encryptedToken,
        webhookSecret: crypto.randomUUID(),
        status: 'active',
        qualityRating: phoneNumber.quality_rating ?? null,
        messagingLimit: phoneNumber.messaging_limit_tier ?? null,
      },
    });

    // Create default routing config
    await (prisma as any).whatsAppRouting.create({
      data: {
        accountId: account.id,
        strategy: 'keyword',
        config: {},
        fallbackAgentId: null,
      },
    });

    // Subscribe to webhooks
    await fetch(
      `https://graph.facebook.com/${whatsappEnv.META_API_VERSION}/${account.wabaId}/subscribed_apps`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );

    logger.info({ tenantId, accountId: account.id, phoneNumberId: phoneNumber.id }, 'WhatsApp account connected');

    return NextResponse.json({
      id: account.id,
      phoneNumberId: account.phoneNumberId,
      displayPhone: account.displayPhone,
      displayName: account.displayName,
      status: account.status,
    }, { status: 201 });

  } catch (error) {
    logger.error({ error }, 'Error connecting WhatsApp account');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the disconnect route**

Create `apps/web-ui/app/api/whatsapp/disconnect/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-disconnect');

const disconnectSchema = z.object({
  accountId: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'TenantConfig', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = disconnectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id: parsed.data.accountId, tenantId },
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    await (prisma as any).whatsAppAccount.update({
      where: { id: account.id },
      data: { status: 'disconnected' },
    });

    logger.info({ tenantId, accountId: account.id }, 'WhatsApp account disconnected');

    return NextResponse.json({ status: 'disconnected' });
  } catch (error) {
    logger.error({ error }, 'Error disconnecting WhatsApp account');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create the accounts list route**

Create `apps/web-ui/app/api/whatsapp/accounts/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('whatsapp-accounts');

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TenantConfig', authOptions);
    if (authError) return authError;

    const prisma = getPrismaClient();
    const accounts = await (prisma as any).whatsAppAccount.findMany({
      where: { tenantId, status: { not: 'disconnected' } },
      select: {
        id: true,
        phoneNumberId: true,
        displayPhone: true,
        displayName: true,
        status: true,
        qualityRating: true,
        messagingLimit: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(accounts);
  } catch (error) {
    logger.error({ error }, 'Error listing WhatsApp accounts');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/whatsapp/
git commit -m "feat(whatsapp): add connect, disconnect, and accounts API routes

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 15: Routing Config API Routes

**Files:**
- Create: `apps/web-ui/app/api/whatsapp/accounts/[id]/routing/route.ts`

- [ ] **Step 1: Create routing config route**

Create `apps/web-ui/app/api/whatsapp/accounts/[id]/routing/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-routing');

const updateRoutingSchema = z.object({
  strategy: z.enum(['menu', 'keyword', 'ai_intent', 'time_based']),
  config: z.record(z.unknown()).default({}),
  fallbackAgentId: z.string().nullable().optional(),
  rules: z.array(z.object({
    agentId: z.string().min(1),
    priority: z.number().int().min(0),
    condition: z.record(z.unknown()),
    isActive: z.boolean().default(true),
  })).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const routing = await (prisma as any).whatsAppRouting.findUnique({
      where: { accountId: id },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });

    return NextResponse.json(routing);
  } catch (error) {
    logger.error({ error }, 'Error fetching routing config');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateRoutingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Update routing config
    const routing = await (prisma as any).whatsAppRouting.upsert({
      where: { accountId: id },
      update: {
        strategy: parsed.data.strategy,
        config: parsed.data.config,
        fallbackAgentId: parsed.data.fallbackAgentId ?? null,
      },
      create: {
        accountId: id,
        strategy: parsed.data.strategy,
        config: parsed.data.config,
        fallbackAgentId: parsed.data.fallbackAgentId ?? null,
      },
    });

    // Replace rules if provided
    if (parsed.data.rules) {
      await (prisma as any).whatsAppRoutingRule.deleteMany({
        where: { routingId: routing.id },
      });

      await (prisma as any).whatsAppRoutingRule.createMany({
        data: parsed.data.rules.map((rule) => ({
          routingId: routing.id,
          agentId: rule.agentId,
          priority: rule.priority,
          condition: rule.condition,
          isActive: rule.isActive,
        })),
      });
    }

    const updated = await (prisma as any).whatsAppRouting.findUnique({
      where: { accountId: id },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });

    logger.info({ tenantId, accountId: id, strategy: parsed.data.strategy }, 'Routing config updated');

    return NextResponse.json(updated);
  } catch (error) {
    logger.error({ error }, 'Error updating routing config');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/api/whatsapp/accounts/\[id\]/
git commit -m "feat(whatsapp): add routing config GET/PUT API routes

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 16: Template Management API Routes

**Files:**
- Create: `apps/web-ui/app/api/whatsapp/accounts/[id]/templates/route.ts`
- Create: `apps/web-ui/app/api/whatsapp/accounts/[id]/templates/sync/route.ts`
- Create: `apps/web-ui/app/api/whatsapp/accounts/[id]/templates/send/route.ts`

- [ ] **Step 1: Create templates list route**

Create `apps/web-ui/app/api/whatsapp/accounts/[id]/templates/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('whatsapp-templates');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const templates = await (prisma as any).whatsAppTemplate.findMany({
      where: { accountId: id },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(templates);
  } catch (error) {
    logger.error({ error }, 'Error listing templates');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create template sync route**

Create `apps/web-ui/app/api/whatsapp/accounts/[id]/templates/sync/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { whatsappEnv } from '@chatbot/whatsapp';
import { authOptions } from '@/lib/auth';

const logger = createLogger('whatsapp-template-sync');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const encryption = new EncryptionService();
    const accessToken = encryption.decrypt(account.accessToken);

    // Fetch templates from Meta
    const response = await fetch(
      `https://graph.facebook.com/${whatsappEnv.META_API_VERSION}/${account.wabaId}/message_templates`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch templates from Meta');
      return NextResponse.json({ error: 'Failed to sync templates from Meta' }, { status: 502 });
    }

    const data = await response.json();
    const metaTemplates = data.data ?? [];

    let synced = 0;
    for (const tmpl of metaTemplates) {
      await (prisma as any).whatsAppTemplate.upsert({
        where: {
          accountId_name_language: {
            accountId: id,
            name: tmpl.name,
            language: tmpl.language,
          },
        },
        update: {
          category: tmpl.category,
          status: tmpl.status,
          components: tmpl.components,
        },
        create: {
          accountId: id,
          name: tmpl.name,
          language: tmpl.language,
          category: tmpl.category,
          status: tmpl.status,
          components: tmpl.components,
        },
      });
      synced++;
    }

    logger.info({ tenantId, accountId: id, synced }, 'Templates synced from Meta');

    return NextResponse.json({ synced });
  } catch (error) {
    logger.error({ error }, 'Error syncing templates');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create template send route**

Create `apps/web-ui/app/api/whatsapp/accounts/[id]/templates/send/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { MetaWhatsAppClient, whatsappEnv } from '@chatbot/whatsapp';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-template-send');

const sendTemplateSchema = z.object({
  to: z.string().min(1),
  templateName: z.string().min(1),
  languageCode: z.string().min(1),
  components: z.array(z.object({
    type: z.enum(['header', 'body', 'button']),
    parameters: z.array(z.record(z.unknown())),
    sub_type: z.string().optional(),
    index: z.number().optional(),
  })).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = sendTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const encryption = new EncryptionService();
    const accessToken = encryption.decrypt(account.accessToken);

    const client = new MetaWhatsAppClient({
      accessToken,
      phoneNumberId: account.phoneNumberId,
      apiVersion: whatsappEnv.META_API_VERSION,
    });

    const result = await client.sendTemplateMessage(
      parsed.data.to,
      parsed.data.templateName,
      parsed.data.languageCode,
      parsed.data.components as any,
    );

    // Persist outbound template message
    await (prisma as any).whatsAppMessage.create({
      data: {
        accountId: id,
        waMessageId: result.messages[0].id,
        direction: 'outbound',
        contactPhone: parsed.data.to,
        type: 'template',
        content: { templateName: parsed.data.templateName, languageCode: parsed.data.languageCode, components: parsed.data.components },
        status: 'sent',
      },
    });

    logger.info({ tenantId, accountId: id, to: parsed.data.to, template: parsed.data.templateName }, 'Template message sent');

    return NextResponse.json({ messageId: result.messages[0].id });
  } catch (error) {
    logger.error({ error }, 'Error sending template message');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/whatsapp/accounts/\[id\]/templates/
git commit -m "feat(whatsapp): add template list, sync, and send API routes

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 17: Library Exports & Factory Wiring

**Files:**
- Modify: `libs/whatsapp/src/index.ts`
- Create: `libs/whatsapp/src/factory.ts`

- [ ] **Step 1: Create the processor factory**

Create `libs/whatsapp/src/factory.ts`:

```typescript
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { MessageProcessor } from './processor/message-processor';
import { SessionManager } from './session/session-manager';
import { ContactLock, InMemoryLockProvider } from './concurrency/contact-lock';
import { CircuitBreaker } from './concurrency/circuit-breaker';
import { MetaWhatsAppClient } from './client/meta-api';
import { whatsappEnv } from './env';

const logger = createLogger('whatsapp-factory');

let processorInstance: MessageProcessor | null = null;

export function createMessageProcessor(): MessageProcessor {
  if (processorInstance) return processorInstance;

  const prisma = getPrismaClient();
  const sessionManager = new SessionManager(prisma);
  const lockProvider = new InMemoryLockProvider();
  const contactLock = new ContactLock(lockProvider, 60_000);
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  const encryption = new EncryptionService();

  const agentExecutor = {
    async execute(agentId: string, message: { text?: string }, context: Record<string, unknown>) {
      // TODO: Wire to agent-studio execution in Task 18
      logger.warn({ agentId }, 'Agent executor not yet wired — returning echo');
      return { text: `Echo: ${message.text ?? '(no text)'}` };
    },
  };

  const metaClientFactory = (accessToken: string, phoneNumberId: string) => {
    const decryptedToken = encryption.decrypt(accessToken);
    return new MetaWhatsAppClient({
      accessToken: decryptedToken,
      phoneNumberId,
      apiVersion: whatsappEnv.META_API_VERSION,
    });
  };

  processorInstance = new MessageProcessor({
    prisma,
    sessionManager,
    agentExecutor,
    contactLock,
    circuitBreaker,
    metaClientFactory,
  });

  return processorInstance;
}
```

- [ ] **Step 2: Update library exports**

Replace `libs/whatsapp/src/index.ts` with:

```typescript
// Env
export { whatsappEnv } from './env';

// Client
export { MetaWhatsAppClient } from './client/meta-api';
export type { MetaClientConfig } from './client/meta-api';
export type {
  SendMessageRequest,
  SendMessageResponse,
  InteractiveMessage,
  InteractiveAction,
  MediaUrlResponse,
  UploadMediaResponse,
} from './client/types';

// Webhook
export { verifyWebhookSignature } from './webhook/signature';
export { parseWebhookPayload } from './webhook/parser';
export type { WebhookPayload, ParsedEvent, WebhookInboundMessage } from './webhook/types';

// Router
export { createRouter } from './router/factory';
export type { WhatsAppRouter, RoutingContext, RoutingResult } from './router/router.interface';

// Session
export { SessionManager } from './session/session-manager';
export { CommandHandler } from './session/command-handler';

// Media
export { MediaDownloader } from './media/downloader';
export type { S3Uploader, DownloadResult } from './media/downloader';

// Concurrency
export { ContactLock, InMemoryLockProvider } from './concurrency/contact-lock';
export type { LockProvider } from './concurrency/contact-lock';
export { InMemoryRateLimiter } from './concurrency/rate-limiter';
export { CircuitBreaker } from './concurrency/circuit-breaker';

// Processor
export { MessageProcessor } from './processor/message-processor';
export type { AgentExecutor, MessageProcessorDeps } from './processor/message-processor';

// Factory
export { createMessageProcessor } from './factory';
```

- [ ] **Step 3: Verify library compiles**

Run: `cd libs/whatsapp && bunx tsc --noEmit --skipLibCheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add libs/whatsapp/src/index.ts libs/whatsapp/src/factory.ts
git commit -m "feat(whatsapp): add factory and wire all library exports

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 18: Agent Executor Integration

**Files:**
- Create: `libs/whatsapp/src/processor/agent-executor.ts`
- Create: `libs/whatsapp/src/processor/agent-executor.test.ts`
- Modify: `libs/whatsapp/src/factory.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/whatsapp/src/processor/agent-executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsAppAgentExecutor } from './agent-executor';

const mockPrisma = {
  agent: { findFirst: vi.fn() },
};

const mockLlmProvider = {
  chat: vi.fn(),
};

const mockProviderFactory = vi.fn();

describe('WhatsAppAgentExecutor', () => {
  let executor: WhatsAppAgentExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new WhatsAppAgentExecutor(mockPrisma as any, mockProviderFactory as any);
  });

  it('executes a simple agent with system prompt', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-sonnet-4-6', systemPrompt: 'You are a helpful assistant.', temperature: 0.7 },
    });
    mockProviderFactory.mockReturnValueOnce(mockLlmProvider);
    mockLlmProvider.chat.mockResolvedValueOnce({ text: 'Hello! How can I help?' });

    const result = await executor.execute('agent_1', { text: 'Hi there' }, {});

    expect(result.text).toBe('Hello! How can I help?');
    expect(mockLlmProvider.chat).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: 'You are a helpful assistant.' }),
        expect.objectContaining({ role: 'user', content: 'Hi there' }),
      ]),
    }));
  });

  it('includes conversation context in messages', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-sonnet-4-6', systemPrompt: 'Assistant', temperature: 0.7 },
    });
    mockProviderFactory.mockReturnValueOnce(mockLlmProvider);
    mockLlmProvider.chat.mockResolvedValueOnce({ text: 'Your order is on the way.' });

    const context = {
      messages: [
        { role: 'user', content: 'Where is my order?' },
        { role: 'assistant', content: 'Let me check. What is your order number?' },
      ],
    };

    const result = await executor.execute('agent_1', { text: 'Order #123' }, context);

    expect(result.text).toBe('Your order is on the way.');
    expect(mockLlmProvider.chat).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Where is my order?' }),
        expect.objectContaining({ role: 'assistant', content: 'Let me check. What is your order number?' }),
        expect.objectContaining({ role: 'user', content: 'Order #123' }),
      ]),
    }));
  });

  it('throws when agent not found', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce(null);
    await expect(executor.execute('nonexistent', { text: 'Hi' }, {})).rejects.toThrow('Agent not found: nonexistent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/whatsapp && bunx vitest run src/processor/agent-executor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `libs/whatsapp/src/processor/agent-executor.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import type { AgentExecutor } from './message-processor';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('whatsapp-agent-executor');

export type LlmProviderFactory = (config: { model: string; temperature?: number }) => {
  chat(params: { messages: Array<{ role: string; content: string }>; maxTokens?: number }): Promise<{ text: string }>;
};

export class WhatsAppAgentExecutor implements AgentExecutor {
  private readonly prisma: PrismaClient;
  private readonly providerFactory: LlmProviderFactory;

  constructor(prisma: PrismaClient, providerFactory: LlmProviderFactory) {
    this.prisma = prisma;
    this.providerFactory = providerFactory;
  }

  async execute(
    agentId: string,
    message: { text?: string; mediaUrl?: string; mediaType?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const agent = await (this.prisma as any).agent.findFirst({
      where: { id: agentId },
    });

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.type === 'simple') {
      return this.executeSimpleAgent(agent, message, context);
    }

    if (agent.type === 'graph') {
      return this.executeGraphAgent(agent, message, context);
    }

    throw new Error(`Unsupported agent type: ${agent.type}`);
  }

  private async executeSimpleAgent(
    agent: { id: string; config: any },
    message: { text?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const config = agent.config as { model: string; systemPrompt: string; temperature?: number; maxTokens?: number };

    const provider = this.providerFactory({ model: config.model, temperature: config.temperature });

    const messages: Array<{ role: string; content: string }> = [];

    // System prompt
    messages.push({ role: 'system', content: config.systemPrompt });

    // Conversation history from context
    const history = (context.messages as Array<{ role: string; content: string }>) ?? [];
    messages.push(...history);

    // Current message
    if (message.text) {
      messages.push({ role: 'user', content: message.text });
    }

    logger.debug({ agentId: agent.id, messageCount: messages.length }, 'Executing simple agent');

    const result = await provider.chat({ messages, maxTokens: config.maxTokens });

    return { text: result.text };
  }

  private async executeGraphAgent(
    agent: { id: string; config: any },
    message: { text?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    // Graph agent execution delegates to agent-studio's graph runner
    // For v1, we execute the entry LLM node with the message
    logger.info({ agentId: agent.id }, 'Executing graph agent (simplified v1)');

    const graphDef = agent.config as { nodes: any[]; edges: any[] };
    const entryNode = graphDef.nodes.find((n: any) => n.type === 'llm');

    if (!entryNode) {
      throw new Error(`Graph agent ${agent.id} has no LLM entry node`);
    }

    const nodeConfig = entryNode.config as { model: string; systemPrompt?: string; temperature?: number; maxTokens?: number };
    const provider = this.providerFactory({ model: nodeConfig.model, temperature: nodeConfig.temperature });

    const messages: Array<{ role: string; content: string }> = [];
    if (nodeConfig.systemPrompt) {
      messages.push({ role: 'system', content: nodeConfig.systemPrompt });
    }

    const history = (context.messages as Array<{ role: string; content: string }>) ?? [];
    messages.push(...history);

    if (message.text) {
      messages.push({ role: 'user', content: message.text });
    }

    const result = await provider.chat({ messages, maxTokens: nodeConfig.maxTokens });
    return { text: result.text };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/whatsapp && bunx vitest run src/processor/agent-executor.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Update factory to use real executor**

In `libs/whatsapp/src/factory.ts`, replace the stub `agentExecutor` with:

```typescript
import { WhatsAppAgentExecutor } from './processor/agent-executor';
import { createLLMProvider } from '@chatbot/ai';

// Replace the stub agentExecutor block with:
const agentExecutor = new WhatsAppAgentExecutor(prisma, (config) => {
  const provider = createLLMProvider({ provider: 'bedrock', chatModel: config.model });
  return {
    async chat(params) {
      const result = await provider.chat(params.messages, { maxTokens: params.maxTokens });
      return { text: result.text };
    },
  };
});
```

- [ ] **Step 6: Commit**

```bash
git add libs/whatsapp/src/processor/agent-executor.ts libs/whatsapp/src/processor/agent-executor.test.ts libs/whatsapp/src/factory.ts
git commit -m "feat(whatsapp): add agent executor with simple + graph agent support

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 19: Template Sender Service

**Files:**
- Create: `libs/whatsapp/src/templates/template-sync.ts`
- Create: `libs/whatsapp/src/templates/template-sender.ts`

- [ ] **Step 1: Create template sync service**

Create `libs/whatsapp/src/templates/template-sync.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import type { MetaWhatsAppClient } from '../client/meta-api';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('whatsapp-template-sync');

export class TemplateSyncService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async syncFromMeta(accountId: string, client: MetaWhatsAppClient, wabaId: string): Promise<number> {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates`,
      { headers: { Authorization: `Bearer ${(client as any).accessToken}` } },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch templates: ${response.status}`);
    }

    const data = await response.json();
    const templates = data.data ?? [];
    let synced = 0;

    for (const tmpl of templates) {
      await (this.prisma as any).whatsAppTemplate.upsert({
        where: {
          accountId_name_language: { accountId, name: tmpl.name, language: tmpl.language },
        },
        update: { category: tmpl.category, status: tmpl.status, components: tmpl.components },
        create: {
          accountId,
          name: tmpl.name,
          language: tmpl.language,
          category: tmpl.category,
          status: tmpl.status,
          components: tmpl.components,
        },
      });
      synced++;
    }

    logger.info({ accountId, synced }, 'Templates synced');
    return synced;
  }
}
```

- [ ] **Step 2: Create template sender service**

Create `libs/whatsapp/src/templates/template-sender.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import type { MetaWhatsAppClient } from '../client/meta-api';
import type { TemplateComponent } from '../client/types';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('whatsapp-template-sender');

export interface SendTemplateInput {
  accountId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[];
}

export class TemplateSender {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async send(input: SendTemplateInput, client: MetaWhatsAppClient): Promise<string> {
    // Verify template exists and is approved
    const template = await (this.prisma as any).whatsAppTemplate.findFirst({
      where: {
        accountId: input.accountId,
        name: input.templateName,
        language: input.languageCode,
        status: 'APPROVED',
      },
    });

    if (!template) {
      throw new Error(`Template "${input.templateName}" (${input.languageCode}) not found or not approved`);
    }

    const result = await client.sendTemplateMessage(
      input.to,
      input.templateName,
      input.languageCode,
      input.components,
    );

    const messageId = result.messages[0].id;

    // Persist outbound message
    await (this.prisma as any).whatsAppMessage.create({
      data: {
        accountId: input.accountId,
        waMessageId: messageId,
        direction: 'outbound',
        contactPhone: input.to,
        type: 'template',
        content: {
          templateName: input.templateName,
          languageCode: input.languageCode,
          components: input.components,
        },
        status: 'sent',
      },
    });

    logger.info({ accountId: input.accountId, to: input.to, template: input.templateName }, 'Template message sent');

    return messageId;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add libs/whatsapp/src/templates/
git commit -m "feat(whatsapp): add template sync and sender services

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 20: Media Uploader

**Files:**
- Create: `libs/whatsapp/src/media/uploader.ts`

- [ ] **Step 1: Create media uploader**

Create `libs/whatsapp/src/media/uploader.ts`:

```typescript
import type { MetaWhatsAppClient } from '../client/meta-api';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('whatsapp-media-uploader');

export interface MediaUploadInput {
  file: Buffer;
  mimeType: string;
  filename: string;
}

export class MediaUploader {
  private readonly client: MetaWhatsAppClient;

  constructor(client: MetaWhatsAppClient) {
    this.client = client;
  }

  async upload(input: MediaUploadInput): Promise<string> {
    const result = await this.client.uploadMedia(input.file, input.mimeType, input.filename);
    logger.debug({ mediaId: result.id, filename: input.filename }, 'Media uploaded to Meta');
    return result.id;
  }

  async sendImage(to: string, mediaId: string, caption?: string) {
    return this.client.sendImageMessage(to, mediaId, caption);
  }

  async sendDocument(to: string, mediaId: string, filename?: string, caption?: string) {
    return this.client.sendDocumentMessage(to, mediaId, filename, caption);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add libs/whatsapp/src/media/uploader.ts
git commit -m "feat(whatsapp): add media uploader for outbound images and documents

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 21: Integration Test — End-to-End Message Flow

**Files:**
- Create: `libs/whatsapp/src/processor/message-processor.integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `libs/whatsapp/src/processor/message-processor.integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageProcessor } from './message-processor';
import { SessionManager } from '../session/session-manager';
import { ContactLock, InMemoryLockProvider } from '../concurrency/contact-lock';
import { CircuitBreaker } from '../concurrency/circuit-breaker';

describe('MessageProcessor Integration', () => {
  let processor: MessageProcessor;
  const sentMessages: Array<{ to: string; text: string }> = [];

  const mockPrisma = {
    whatsAppAccount: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'acc_1',
        tenantId: 'tenant_1',
        accessToken: 'encrypted_token',
        phoneNumberId: 'PH1',
      }),
    },
    whatsAppMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    whatsAppSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sess_new', ...data })),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsAppRouting: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'routing_1',
        strategy: 'keyword',
        config: {},
        fallbackAgentId: 'agent_default',
      }),
    },
    whatsAppRoutingRule: {
      findMany: vi.fn().mockResolvedValue([
        { agentId: 'agent_sales', priority: 0, condition: { type: 'keyword', value: 'sales' }, isActive: true },
        { agentId: 'agent_support', priority: 1, condition: { type: 'keyword', value: 'support' }, isActive: true },
      ]),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sentMessages.length = 0;

    const sessionManager = new SessionManager(mockPrisma as any);
    const contactLock = new ContactLock(new InMemoryLockProvider());
    const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30000 });

    processor = new MessageProcessor({
      prisma: mockPrisma as any,
      sessionManager,
      agentExecutor: {
        async execute(agentId, message) {
          return { text: `[${agentId}] Response to: ${message.text}` };
        },
      },
      contactLock,
      circuitBreaker,
      metaClientFactory: () => ({
        sendTextMessage: vi.fn().mockImplementation(async (to, text) => {
          sentMessages.push({ to, text });
          return { messages: [{ id: `wamid.out_${Date.now()}` }] };
        }),
        sendInteractiveMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.interactive' }] }),
      }) as any,
    });
  });

  it('routes a new message through keyword router and executes agent', async () => {
    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'Alice' }, wa_id: '15551234567' },
      message: { from: '15551234567', id: 'wamid.new1', timestamp: '1700000000', type: 'text', text: { body: 'I need sales help' } },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].to).toBe('15551234567');
    expect(sentMessages[0].text).toContain('agent_sales');
    expect(sentMessages[0].text).toContain('I need sales help');
  });

  it('uses fallback agent when no keyword matches', async () => {
    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'Bob' }, wa_id: '15559999999' },
      message: { from: '15559999999', id: 'wamid.new2', timestamp: '1700000000', type: 'text', text: { body: 'Hello there' } },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain('agent_default');
  });

  it('reuses existing session on subsequent messages', async () => {
    mockPrisma.whatsAppSession.findFirst.mockResolvedValueOnce({
      id: 'sess_existing',
      agentId: 'agent_sales',
      context: {},
      windowExpiresAt: new Date(Date.now() + 86400000),
    });

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'Alice' }, wa_id: '15551234567' },
      message: { from: '15551234567', id: 'wamid.followup', timestamp: '1700000000', type: 'text', text: { body: 'Follow up question' } },
    });

    expect(sentMessages[0].text).toContain('agent_sales');
    expect(mockPrisma.whatsAppRouting.findUnique).not.toHaveBeenCalled();
  });

  it('handles status update events', async () => {
    await processor.processStatusEvent({
      type: 'status',
      phoneNumberId: 'PH1',
      status: { id: 'wamid.out1', status: 'delivered', timestamp: '1700000001', recipient_id: '15551234567' },
    });

    expect(mockPrisma.whatsAppMessage.updateMany).toHaveBeenCalledWith({
      where: { waMessageId: 'wamid.out1' },
      data: expect.objectContaining({ status: 'delivered' }),
    });
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd libs/whatsapp && bunx vitest run src/processor/message-processor.integration.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add libs/whatsapp/src/processor/message-processor.integration.test.ts
git commit -m "test(whatsapp): add end-to-end integration test for message flow

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 22: Run Full Test Suite & Final Verification

**Files:**
- No new files

- [ ] **Step 1: Run all whatsapp library tests**

Run: `cd libs/whatsapp && bunx vitest run`
Expected: All tests pass (signature, parser, meta-api, factory, keyword-router, session-manager, command-handler, circuit-breaker, media-downloader, message-processor, agent-executor, integration)

- [ ] **Step 2: Run type check across the monorepo**

Run: `bunx tsc --noEmit --skipLibCheck -p tsconfig.base.json 2>&1 | tail -20`
Expected: No errors (or only pre-existing unrelated errors)

- [ ] **Step 3: Run existing test suites to verify no regressions**

Run: `bun run test`
Expected: All existing tests still pass

- [ ] **Step 4: Commit any fixes if needed**

If any fixes were required:
```bash
git add -A
git commit -m "fix(whatsapp): resolve type/test issues from integration

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Summary

| Task | Component | Tests |
|------|-----------|-------|
| 1 | Prisma schema (6 models) | Migration |
| 2 | Library scaffolding | Compiles |
| 3 | Webhook signature verification | 4 tests |
| 4 | Webhook payload parser | 4 tests |
| 5 | Meta Graph API client | 4 tests |
| 6 | Router interface & factory | 5 tests |
| 7 | Keyword router | 7 tests |
| 8 | Session manager | 5 tests |
| 9 | Command handler | 8 tests |
| 10 | Media downloader | 2 tests |
| 11 | Concurrency controls | 6 tests |
| 12 | Message processor | 4 tests |
| 13 | Webhook API route | Compiles |
| 14 | Connect/disconnect/accounts routes | Compiles |
| 15 | Routing config API routes | Compiles |
| 16 | Template management API routes | Compiles |
| 17 | Library exports & factory | Compiles |
| 18 | Agent executor | 3 tests |
| 19 | Template services | Compiles |
| 20 | Media uploader | Compiles |
| 21 | Integration test | 4 tests |
| 22 | Full verification | All pass |

**Total: 22 tasks, ~56 unit/integration tests**
