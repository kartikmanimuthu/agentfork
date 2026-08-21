# Netcore WhatsApp Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing WhatsApp webhook understand Netcore's contract (alongside Meta's, unchanged), so inbound messages from the already-connected Netcore number stop being rejected, and replies can be sent back through Netcore.

**Architecture:** Adapter pattern at the boundary — a Netcore-specific parser and client normalize into the exact shapes `MessageProcessor` already consumes from Meta, so the shared core (`MessageProcessor`, `SessionManager`, routers) is never touched. Meta's client/parser/signature files are untouched and isolated.

**Tech Stack:** Next.js App Router (apps/web-ui), Prisma/PostgreSQL, Vitest, Zod, Pino, shadcn/ui.

## Global Constraints

- Do not modify `libs/whatsapp/src/client/meta-api.ts`, `libs/whatsapp/src/webhook/parser.ts`, or `libs/whatsapp/src/webhook/signature.ts` — Meta's path must stay byte-for-byte unchanged.
- No signature/HMAC verification for Netcore webhooks — confirmed empirically that none exists. Do not invent one.
- Netcore media *sending* (image/document) and *template* sending are explicitly out of scope — throw a clear, intentional error instead of attempting them.
- Every new/modified file must use Pino (`createLogger`) and Zod at any request boundary, per repo convention — match the exact patterns already in the files being modified.
- Reference: `docs/superpowers/specs/2026-06-24-netcore-whatsapp-integration-design.md` for the full payload reference and rationale.

---

### Task 1: Schema — add `provider` to `WhatsAppAccount`

**Files:**
- Modify: `prisma/schema.prisma` (the `WhatsAppAccount` model, currently lines 719–741)
- Create: `prisma/migrations/20260624000000_add_whatsapp_account_provider/migration.sql`

**Interfaces:**
- Produces: `WhatsAppAccount.provider: string` (Prisma client field), default `"meta"`, values `"meta" | "netcore"` — every later task that reads/writes a `WhatsAppAccount` relies on this field existing on the generated Prisma client.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, find:

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
```

Replace with:

```prisma
model WhatsAppAccount {
  id             String   @id @default(cuid())
  tenantId       String
  provider       String   @default("meta")
  wabaId         String
  phoneNumberId  String   @unique
  displayPhone   String
  displayName    String
  accessToken    String
  webhookSecret  String
  status         String   @default("active")
```

(Everything below `status` in the model — `qualityRating` through the closing `@@map("whatsapp_accounts")` — stays exactly as-is.)

- [ ] **Step 2: Write the migration SQL by hand** (faster and safer here than `prisma migrate dev` against a live local DB connection you may not have configured)

Create `prisma/migrations/20260624000000_add_whatsapp_account_provider/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'meta';
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `bunx prisma generate --schema=./prisma/schema.prisma`
Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 4: Apply the migration to your local DB** (skip if you don't have `docker compose up -d` running locally — later tasks' unit tests don't need a live DB, only real manual verification in Task 15 does)

Run: `bunx prisma migrate deploy`
Expected: `1 migration found... Applied`. If there's no local DB running, this step can be deferred to whenever the engineer has one available — it doesn't block any other task.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260624000000_add_whatsapp_account_provider/
git commit -m "feat(whatsapp): add provider field to WhatsAppAccount"
```

---

### Task 2: Extend shared webhook types for video/audio/location/reaction

**Files:**
- Modify: `libs/whatsapp/src/webhook/types.ts:18-26` (the `WebhookInboundMessage` interface)

**Interfaces:**
- Consumes: nothing new.
- Produces: `WebhookInboundMessage.type` now includes `'video' | 'audio' | 'location' | 'reaction'`; new optional fields `video`, `audio`, `location`, `reaction` — Task 4's parser constructs objects of this exact shape.

This is purely additive — Meta's existing parser never produces these new type values or fields, so nothing about Meta's behavior changes.

- [ ] **Step 1: Edit the type**

Find:

```ts
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
```

Replace with:

```ts
export interface WebhookInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'interactive' | 'button' | 'video' | 'audio' | 'location' | 'reaction';
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  document?: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { text: string; payload: string };
  video?: { id: string; mime_type: string; sha256: string; caption?: string };
  audio?: { id: string; mime_type: string; sha256: string; voice?: boolean };
  location?: { latitude: string; longitude: string; name?: string; address?: string; url?: string };
  reaction?: { emoji: string };
}
```

- [ ] **Step 2: Verify nothing else broke**

Run: `bunx vitest run libs/whatsapp/src/webhook/parser.test.ts`
Expected: all existing tests still PASS (this confirms the additive change didn't disturb Meta's parser or its tests).

- [ ] **Step 3: Commit**

```bash
git add libs/whatsapp/src/webhook/types.ts
git commit -m "feat(whatsapp): extend WebhookInboundMessage for video/audio/location/reaction"
```

---

### Task 3: Add `NETCORE_DEFAULT_SOURCE` env var

**Files:**
- Modify: `libs/whatsapp/src/env.ts`

**Interfaces:**
- Produces: `whatsappEnv.NETCORE_DEFAULT_SOURCE: string` — Task 5's `NetcoreWhatsAppClient` reads this.

Context for whoever implements this: Netcore's send API requires a `source` field whose exact semantics were never fully confirmed (docs call it "source ID of the origin"; error code `8006` suggests it may need to match something pre-registered). The one value empirically confirmed to work for this account, via a real successful send during development, was the literal string `"new_swe"`. This is captured as a configurable default rather than hardcoded, in case a future Netcore account needs a different value — but don't build per-account configuration for it speculatively; this env var is the whole mechanism for now.

- [ ] **Step 1: Edit the env file**

Read the current file first (it was recently modified to add `META_WHATSAPP_CONFIG_ID` — don't revert that). Find the `server: { ... }` block and add one line after `META_WHATSAPP_CONFIG_ID`:

```ts
    META_WHATSAPP_CONFIG_ID: z.string().optional(),
    NETCORE_DEFAULT_SOURCE: z.string().default("new_swe"),
    WHATSAPP_MEDIA_S3_BUCKET: z.string().default("chatbot-whatsapp-media"),
```

- [ ] **Step 2: Commit**

```bash
git add libs/whatsapp/src/env.ts
git commit -m "feat(whatsapp): add NETCORE_DEFAULT_SOURCE env var"
```

---

### Task 4: Netcore webhook parser

**Files:**
- Create: `libs/whatsapp/src/webhook/netcore-parser.ts`
- Create: `libs/whatsapp/src/webhook/netcore-parser.test.ts`

**Interfaces:**
- Consumes: `ParsedEvent`, `WebhookContact`, `WebhookInboundMessage` from `./types` (Task 2's extended version).
- Produces: `parseNetcoreWebhookPayload(payload: NetcoreWebhookPayload): ParsedEvent[]` — Task 7's webhook route calls this exactly like it calls Meta's `parseWebhookPayload`.

- [ ] **Step 1: Write the failing tests**

Create `libs/whatsapp/src/webhook/netcore-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseNetcoreWebhookPayload } from './netcore-parser';

describe('parseNetcoreWebhookPayload', () => {
  it('parses a text message', () => {
    const payload = {
      incoming_message: [{
        received_at: '1782241255',
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Test User',
        to: '919711750243',
        message_type: 'TEXT',
        text_type: { text: 'Hello' },
        message_id: 'wamid.abc123',
        from: '917020184728',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message',
      phoneNumberId: '919711750243',
      contact: { profile: { name: 'Test User' }, wa_id: '917020184728' },
      message: { from: '917020184728', id: 'wamid.abc123', timestamp: '1782241255', type: 'text', text: { body: 'Hello' } },
    });
  });

  it('parses an image message', () => {
    const payload = {
      incoming_message: [{
        to: '919711750243',
        message_type: 'IMAGE',
        image_type: { mime_type: 'image/jpeg', sha256: 'abc==', id: '12345' },
        message_id: 'wamid.img1',
        from: '918287240391',
        received_at: '1782274577',
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Image Sender',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message',
      phoneNumberId: '919711750243',
      contact: { profile: { name: 'Image Sender' }, wa_id: '918287240391' },
      message: { from: '918287240391', id: 'wamid.img1', timestamp: '1782274577', type: 'image', image: { id: '12345', mime_type: 'image/jpeg', sha256: 'abc==' } },
    });
  });

  it('parses a video message', () => {
    const payload = {
      incoming_message: [{
        to: '919711750243',
        message_type: 'VIDEO',
        video_type: { mime_type: 'video/mp4', sha256: 'xyz==', id: '67890' },
        message_id: 'wamid.vid1',
        from: '918826603017',
        received_at: '1782282621',
        context: { message_id: '', ncmessage_id: '' },
        from_name: 'Video Sender',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events[0].type).toBe('message');
    expect((events[0] as any).message.type).toBe('video');
    expect((events[0] as any).message.video).toEqual({ id: '67890', mime_type: 'video/mp4', sha256: 'xyz==' });
  });

  it('parses an audio (voice note) message', () => {
    const payload = {
      incoming_message: [{
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Voice Sender',
        to: '919711750243',
        message_type: 'AUDIO',
        audio_type: { mime_type: 'audio/ogg; codecs=opus', sha256: 'aaa==', id: '111', voice: true },
        message_id: 'wamid.aud1',
        from: '918826603017',
        received_at: '1782282927',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect((events[0] as any).message.audio).toEqual({ id: '111', mime_type: 'audio/ogg; codecs=opus', sha256: 'aaa==', voice: true });
  });

  it('parses a document message', () => {
    const payload = {
      incoming_message: [{
        to: '919711750243',
        message_type: 'DOCUMENT',
        document_type: { filename: 'report.pdf', mime_type: 'application/pdf', sha256: 'bbb==', id: '222' },
        message_id: 'wamid.doc1',
        from: '918826603017',
        received_at: '1782282698',
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Doc Sender',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect((events[0] as any).message.document).toEqual({ id: '222', mime_type: 'application/pdf', sha256: 'bbb==', filename: 'report.pdf' });
  });

  it('parses a location message', () => {
    const payload = {
      incoming_message: [{
        location_type: { latitude: '28.64', longitude: '77.18', name: 'Place', address: '123 St', url: 'https://example.com' },
        message_id: 'wamid.loc1',
        from: '918826603017',
        received_at: '1782282727',
        context: { ncmessage_id: '', message_id: '' },
        from_name: 'Location Sender',
        to: '919711750243',
        message_type: 'LOCATION',
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect((events[0] as any).message.location).toEqual({ latitude: '28.64', longitude: '77.18', name: 'Place', address: '123 St', url: 'https://example.com' });
  });

  it('parses a reaction message', () => {
    const payload = {
      incoming_message: [{
        from_name: 'Reactor',
        message_type: 'REACTION',
        to: '919711750243',
        reaction_type: { emoji: '👍' },
        message_id: 'wamid.react1',
        from: '919413001085',
        received_at: '1782281169',
        context: { ncmessage_id: 'e693eb1d-347e', message_id: 'wamid.original', 'x-apiheader': '' },
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect((events[0] as any).message.reaction).toEqual({ emoji: '👍' });
  });

  it('skips a message with no recognized message_type instead of throwing', () => {
    const payload = {
      incoming_message: [{
        from_name: 'Omar Hussain',
        to: '919711750243',
        message_id: 'wamid.unknown1',
        from: '918826603017',
        received_at: '1782282738',
        context: { ncmessage_id: '', message_id: '' },
      }],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events).toHaveLength(0);
  });

  it('returns empty array when incoming_message is missing', () => {
    const events = parseNetcoreWebhookPayload({});
    expect(events).toHaveLength(0);
  });

  it('handles multiple messages in one payload', () => {
    const payload = {
      incoming_message: [
        { to: '919711750243', message_type: 'TEXT', text_type: { text: 'Hi' }, message_id: 'wamid.1', from: '91111', received_at: '1' },
        { to: '919711750243', message_type: 'TEXT', text_type: { text: 'Hello' }, message_id: 'wamid.2', from: '91222', received_at: '2' },
      ],
    };

    const events = parseNetcoreWebhookPayload(payload);
    expect(events).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run libs/whatsapp/src/webhook/netcore-parser.test.ts`
Expected: FAIL with "Cannot find module './netcore-parser'" (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `libs/whatsapp/src/webhook/netcore-parser.ts`:

```ts
import type { ParsedEvent, WebhookContact, WebhookInboundMessage } from './types';

interface NetcoreIncomingMessage {
  message_id: string;
  from: string;
  to: string;
  from_name?: string;
  received_at: string;
  message_type?: string;
  text_type?: { text: string };
  image_type?: { id: string; mime_type: string; sha256: string };
  video_type?: { id: string; mime_type: string; sha256: string };
  audio_type?: { id: string; mime_type: string; sha256: string; voice?: boolean };
  document_type?: { id: string; mime_type: string; sha256: string; filename?: string };
  location_type?: { latitude: string; longitude: string; name?: string; address?: string; url?: string };
  reaction_type?: { emoji: string };
}

export interface NetcoreWebhookPayload {
  incoming_message?: NetcoreIncomingMessage[];
}

export function parseNetcoreWebhookPayload(payload: NetcoreWebhookPayload): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const raw of payload.incoming_message ?? []) {
    const message = buildMessage(raw);
    if (!message) continue;

    const contact: WebhookContact = { profile: { name: raw.from_name ?? '' }, wa_id: raw.from };
    events.push({ type: 'message', phoneNumberId: raw.to, contact, message });
  }

  return events;
}

function buildMessage(raw: NetcoreIncomingMessage): WebhookInboundMessage | null {
  const base = { from: raw.from, id: raw.message_id, timestamp: raw.received_at };
  const type = raw.message_type?.toLowerCase();

  switch (type) {
    case 'text':
      return raw.text_type ? { ...base, type: 'text', text: { body: raw.text_type.text } } : null;
    case 'image':
      return raw.image_type ? { ...base, type: 'image', image: raw.image_type } : null;
    case 'video':
      return raw.video_type ? { ...base, type: 'video', video: raw.video_type } : null;
    case 'audio':
      return raw.audio_type ? { ...base, type: 'audio', audio: raw.audio_type } : null;
    case 'document':
      return raw.document_type ? { ...base, type: 'document', document: raw.document_type } : null;
    case 'location':
      return raw.location_type ? { ...base, type: 'location', location: raw.location_type } : null;
    case 'reaction':
      return raw.reaction_type ? { ...base, type: 'reaction', reaction: raw.reaction_type } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run libs/whatsapp/src/webhook/netcore-parser.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/whatsapp/src/webhook/netcore-parser.ts libs/whatsapp/src/webhook/netcore-parser.test.ts
git commit -m "feat(whatsapp): add Netcore webhook payload parser"
```

---

### Task 5: `NetcoreWhatsAppClient`

**Files:**
- Create: `libs/whatsapp/src/client/netcore-api.ts`
- Create: `libs/whatsapp/src/client/netcore-api.test.ts`

**Interfaces:**
- Consumes: `SendMessageResponse` from `./types`; `whatsappEnv.NETCORE_DEFAULT_SOURCE` from `../env` (Task 3).
- Produces: `NetcoreWhatsAppClient` class with `sendTextMessage(to: string, text: string): Promise<SendMessageResponse>` (works) and `sendInteractiveMessage(...): Promise<SendMessageResponse>` (always throws — required so the class structurally satisfies the `WhatsAppSendClient` interface Task 8 defines, which needs both methods present) — Tasks 8 and 9 construct and call this exactly like `MetaWhatsAppClient`.

- [ ] **Step 1: Write the failing tests**

Create `libs/whatsapp/src/client/netcore-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetcoreWhatsAppClient } from './netcore-api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NetcoreWhatsAppClient', () => {
  let client: NetcoreWhatsAppClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new NetcoreWhatsAppClient({
      accessToken: 'test-api-key',
      phoneNumberId: '919711750243',
    });
  });

  describe('sendTextMessage', () => {
    it('sends a text message with Bearer auth and returns a normalized message id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          message: 'Request received successfully.',
          data: { id: '6132367d-c37e-4e32-a9a2-d0e9d64d6708' },
        }),
      });

      const result = await client.sendTextMessage('918826603017', 'Hello!');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cpaaswa.netcorecloud.net/api/v2/message/nc/priority',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody.message[0]).toEqual(expect.objectContaining({
        recipient_whatsapp: '918826603017',
        recipient_type: 'individual',
        message_type: 'text',
        type_text: [{ content: 'Hello!' }],
      }));

      expect(result).toEqual({
        messaging_product: 'whatsapp',
        contacts: [],
        messages: [{ id: '6132367d-c37e-4e32-a9a2-d0e9d64d6708' }],
      });
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden', message: 'Access Denied', status: 403 }),
      });

      await expect(client.sendTextMessage('918826603017', 'Hi')).rejects.toThrow('Access Denied');
    });
  });

  describe('sendInteractiveMessage', () => {
    it('throws a clear not-yet-supported error', async () => {
      await expect(
        client.sendInteractiveMessage('918826603017', { type: 'button', body: { text: 'Choose' }, action: {} } as any),
      ).rejects.toThrow('not yet supported for Netcore');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run libs/whatsapp/src/client/netcore-api.test.ts`
Expected: FAIL with "Cannot find module './netcore-api'".

- [ ] **Step 3: Write the implementation**

Create `libs/whatsapp/src/client/netcore-api.ts`:

```ts
import type { SendMessageResponse } from './types';
import { whatsappEnv } from '../env';

export interface NetcoreClientConfig {
  accessToken: string;
  phoneNumberId: string;
}

interface NetcoreSendResponse {
  status: string;
  message: string;
  data: { id: string };
}

interface NetcoreErrorResponse {
  error?: string;
  message: string;
  status: number;
}

export class NetcoreWhatsAppClient {
  private readonly baseUrl = 'https://cpaaswa.netcorecloud.net/api/v2/message';
  private readonly accessToken: string;
  private readonly phoneNumberId: string;

  constructor(config: NetcoreClientConfig) {
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
  }

  async sendTextMessage(to: string, text: string): Promise<SendMessageResponse> {
    const response = await this.send('/nc/priority', {
      message: [{
        recipient_whatsapp: to,
        recipient_type: 'individual',
        message_type: 'text',
        source: whatsappEnv.NETCORE_DEFAULT_SOURCE,
        type_text: [{ content: text }],
      }],
    });

    return {
      messaging_product: 'whatsapp',
      contacts: [],
      messages: [{ id: response.data.id }],
    };
  }

  async sendInteractiveMessage(): Promise<SendMessageResponse> {
    throw new Error('Interactive (menu/button) messages are not yet supported for Netcore accounts');
  }

  private async send(path: string, body: Record<string, unknown>): Promise<NetcoreSendResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as NetcoreErrorResponse;
      throw new Error(error.message ?? `Netcore API error: ${response.status}`);
    }

    return response.json() as Promise<NetcoreSendResponse>;
  }
}
```

Note: `phoneNumberId` is accepted in the config (matching `MetaWhatsAppClient`'s constructor shape, since Task 8/9 construct both classes the same way) but isn't used in the request body today — Netcore's send API identifies the sending number via the account tied to the API key, not a request parameter. Keep the field for shape-compatibility; don't remove it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run libs/whatsapp/src/client/netcore-api.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/whatsapp/src/client/netcore-api.ts libs/whatsapp/src/client/netcore-api.test.ts
git commit -m "feat(whatsapp): add NetcoreWhatsAppClient"
```

---

### Task 6: Export new symbols from `libs/whatsapp`

**Files:**
- Modify: `libs/whatsapp/src/index.ts`

**Interfaces:**
- Produces: `@chatbot/whatsapp` now exports `NetcoreWhatsAppClient`, `NetcoreClientConfig`, `parseNetcoreWebhookPayload`, `NetcoreWebhookPayload` — Tasks 7, 9, 10 import these from `@chatbot/whatsapp`.

- [ ] **Step 1: Edit the index file**

Find:

```ts
export { MetaWhatsAppClient } from './client/meta-api';
export type { MetaClientConfig } from './client/meta-api';
```

Replace with:

```ts
export { MetaWhatsAppClient } from './client/meta-api';
export type { MetaClientConfig } from './client/meta-api';
export { NetcoreWhatsAppClient } from './client/netcore-api';
export type { NetcoreClientConfig } from './client/netcore-api';
```

Find:

```ts
export { verifyWebhookSignature } from './webhook/signature';
export { parseWebhookPayload } from './webhook/parser';
export type { WebhookPayload, ParsedEvent, WebhookInboundMessage } from './webhook/types';
```

Replace with:

```ts
export { verifyWebhookSignature } from './webhook/signature';
export { parseWebhookPayload } from './webhook/parser';
export { parseNetcoreWebhookPayload } from './webhook/netcore-parser';
export type { NetcoreWebhookPayload } from './webhook/netcore-parser';
export type { WebhookPayload, ParsedEvent, WebhookInboundMessage } from './webhook/types';
```

- [ ] **Step 2: Verify the package still builds**

Run: `cd libs/whatsapp && bunx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If this project doesn't have its own `tsconfig.json` at that path, run `bun run build` from the repo root instead and confirm no new errors related to `libs/whatsapp`.)

- [ ] **Step 3: Commit**

```bash
git add libs/whatsapp/src/index.ts
git commit -m "feat(whatsapp): export Netcore client and parser from package index"
```

---

### Task 7: Wire the webhook route to detect and dispatch Netcore payloads

**Files:**
- Modify: `apps/web-ui/app/api/webhooks/whatsapp/route.ts` (the `POST` handler)

**Interfaces:**
- Consumes: `parseNetcoreWebhookPayload` from `@chatbot/whatsapp` (Task 6).
- Produces: nothing new for later tasks — this is a leaf wiring change.

This file currently has temporary diagnostic logging (raw body + headers on signature failure) from earlier investigation work — keep it. The change here is to check the payload shape *before* deciding whether Meta's signature check even applies, so Netcore traffic no longer falls into that branch at all.

- [ ] **Step 1: Read the current file and confirm its exact state**

Run: `cat apps/web-ui/app/api/webhooks/whatsapp/route.ts`

Confirm the `POST` function currently reads `rawBody`, then checks the signature, then does `JSON.parse(rawBody)`. If it looks different from that, stop and reconcile before proceeding — don't apply the diff below blind.

- [ ] **Step 2: Replace the POST handler**

Replace the entire `export async function POST(...)` function with:

```ts
export async function POST(req: NextRequest): Promise<NextResponse> {
  let rawBody: string | undefined;
  try {
    rawBody = await req.text();
    const payload = JSON.parse(rawBody);

    let events;

    if (payload.object === 'whatsapp_business_account') {
      const signature = req.headers.get('x-hub-signature-256') ?? '';

      if (!verifyWebhookSignature(rawBody, signature, whatsappEnv.META_APP_SECRET)) {
        logger.warn(
          { headers: Object.fromEntries(req.headers.entries()), rawBody },
          'Invalid webhook signature',
        );
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }

      events = parseWebhookPayload(payload);
    } else if (Array.isArray(payload.incoming_message)) {
      events = parseNetcoreWebhookPayload(payload);
    } else if (Array.isArray(payload.delivery_status)) {
      logger.warn({ rawBody }, 'Netcore delivery_status event received - not yet supported');
      return NextResponse.json({ status: 'ok' });
    } else {
      logger.warn({ rawBody }, 'Unrecognized webhook payload shape');
      return NextResponse.json({ status: 'ok' });
    }

    if (events.length === 0) {
      return NextResponse.json({ status: 'ok' });
    }

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

    processingPromise.catch((err) => logger.error({ err }, 'Background processing failed'));

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    logger.error({ error, rawBody }, 'Webhook handler error');
    return NextResponse.json({ status: 'ok' });
  }
}
```

- [ ] **Step 3: Update the import line**

Find:

```ts
import { verifyWebhookSignature, parseWebhookPayload, createMessageProcessor, whatsappEnv } from '@chatbot/whatsapp';
```

Replace with:

```ts
import { verifyWebhookSignature, parseWebhookPayload, parseNetcoreWebhookPayload, createMessageProcessor, whatsappEnv } from '@chatbot/whatsapp';
```

- [ ] **Step 4: Verify the GET handler is untouched**

Run: `cat apps/web-ui/app/api/webhooks/whatsapp/route.ts` and confirm the `GET` function above `POST` is identical to before this task — this task only touches `POST`.

- [ ] **Step 5: Manual sanity check (no automated test exists for this route — matches existing repo convention, no other `apps/web-ui/app/api/**` route has a test file either)**

Run: `bun run dev` (from repo root, or `cd apps/web-ui && bun run dev` per the project's normal dev workflow), then in another terminal:

```bash
curl -i -X POST http://localhost:3005/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"incoming_message":[{"to":"919711750243","message_type":"TEXT","text_type":{"text":"test"},"message_id":"wamid.test1","from":"910000000000","received_at":"1700000000","context":{"ncmessage_id":"","message_id":""},"from_name":"Test"}]}'
```

Expected: `200 {"status":"ok"}` (not `401`). Check the dev server console — it should show no "Invalid webhook signature" warning for this request, and `MessageProcessor` will look up a `WhatsAppAccount` with `phoneNumberId: "919711750243"` (which won't exist locally, so processing logs a normal "account not found, returning" — that's expected and fine; the point of this check is confirming the request no longer gets rejected before reaching that logic).

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui/app/api/webhooks/whatsapp/route.ts
git commit -m "feat(whatsapp): detect and dispatch Netcore webhook payloads"
```

---

### Task 8: Generalize the client factory (Meta vs. Netcore) in `MessageProcessor`

**Files:**
- Modify: `libs/whatsapp/src/processor/message-processor.ts` (the `MessageProcessorDeps` interface and 3 call sites)
- Modify: `libs/whatsapp/src/processor/message-processor.test.ts:51` (the mock)
- Modify: `libs/whatsapp/src/factory.ts`

**Interfaces:**
- Consumes: `NetcoreWhatsAppClient` from `@chatbot/whatsapp` (well, from `./client/netcore-api` directly within `libs/whatsapp` itself — `factory.ts` is inside the package).
- Produces: `MessageProcessorDeps.clientFactory(account: { accessToken: string; phoneNumberId: string; provider: string }) => MetaWhatsAppClient | NetcoreWhatsAppClient` — replaces the old `metaClientFactory(accessToken, phoneNumberId)`.

This is the one place where shared, currently-only-mock-tested core code changes. Read carefully before editing — the goal is a rename + signature widening, not a logic change.

- [ ] **Step 1: Update the `MessageProcessorDeps` interface**

In `libs/whatsapp/src/processor/message-processor.ts`, find:

```ts
export interface MessageProcessorDeps {
  prisma: PrismaClient;
  sessionManager: SessionManager;
  agentExecutor: AgentExecutor;
  contactLock: ContactLock;
  circuitBreaker: CircuitBreaker;
  metaClientFactory: (accessToken: string, phoneNumberId: string) => MetaWhatsAppClient;
}
```

Replace with:

```ts
export interface WhatsAppSendClient {
  sendTextMessage(to: string, text: string): Promise<{ messages: Array<{ id: string }> }>;
  sendInteractiveMessage(to: string, interactive: InteractiveMessage): Promise<{ messages: Array<{ id: string }> }>;
}

export interface MessageProcessorDeps {
  prisma: PrismaClient;
  sessionManager: SessionManager;
  agentExecutor: AgentExecutor;
  contactLock: ContactLock;
  circuitBreaker: CircuitBreaker;
  clientFactory: (account: { accessToken: string; phoneNumberId: string; provider: string }) => WhatsAppSendClient;
}
```

This needs `InteractiveMessage` imported. Find the import line:

```ts
import type { MetaWhatsAppClient } from '../client/meta-api';
```

Replace with:

```ts
import type { InteractiveMessage } from '../client/types';
```

(`MetaWhatsAppClient` is no longer referenced by type in this file — `WhatsAppSendClient` is a duck-typed interface both `MetaWhatsAppClient` and `NetcoreWhatsAppClient` satisfy structurally, without either needing to declare `implements`.)

- [ ] **Step 2: Update the 3 call sites**

There are exactly 3 places in this file that call `this.deps.metaClientFactory(account.accessToken, account.phoneNumberId)`. Find each and replace the call (the variable name `metaClient` can stay — renaming it isn't required and keeps the diff smaller, but the factory call itself must change):

Find (appears once, inside `processMessageEvent`, in the routing-prompt branch):
```ts
          const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);
          await metaClient.sendInteractiveMessage(contact.wa_id, routingResult.interactiveMessage);
```
Replace:
```ts
          const metaClient = this.deps.clientFactory(account);
          await metaClient.sendInteractiveMessage(contact.wa_id, routingResult.interactiveMessage);
```

Find (inside `processMessageEvent`, the main reply branch):
```ts
      if (agentResponse.text) {
        const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);
        const sendResult = await metaClient.sendTextMessage(contact.wa_id, agentResponse.text);
```
Replace:
```ts
      if (agentResponse.text) {
        const metaClient = this.deps.clientFactory(account);
        const sendResult = await metaClient.sendTextMessage(contact.wa_id, agentResponse.text);
```

Find (inside `handleCommand`):
```ts
  private async handleCommand(
    command: { type: string; agentName?: string },
    account: { id: string; accessToken: string; phoneNumberId: string },
    contactPhone: string,
  ): Promise<void> {
    const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);
```
Replace:
```ts
  private async handleCommand(
    command: { type: string; agentName?: string },
    account: { id: string; accessToken: string; phoneNumberId: string; provider: string },
    contactPhone: string,
  ): Promise<void> {
    const metaClient = this.deps.clientFactory(account);
```

- [ ] **Step 3: Check the `handleCommand` call site passes a `provider` field**

Find where `handleCommand` is called (inside `processMessageEvent`, in the command-handling branch):
```ts
      if (command) {
        await this.handleCommand(command, account, contact.wa_id);
        return;
      }
```
This already passes the full `account` object fetched from `prisma.whatsAppAccount.findFirst(...)` earlier in the function — since that query has no `select` clause restricting fields, `account.provider` is already present on it after Task 1's migration. No change needed here, just confirm by reading the surrounding ~10 lines that this is in fact the case before moving on.

- [ ] **Step 4: Update `factory.ts`**

Replace the entire contents of `libs/whatsapp/src/factory.ts`:

```ts
import { getPrismaClient } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { MessageProcessor } from './processor/message-processor';
import { SessionManager } from './session/session-manager';
import { ContactLock, InMemoryLockProvider } from './concurrency/contact-lock';
import { CircuitBreaker } from './concurrency/circuit-breaker';
import { MetaWhatsAppClient } from './client/meta-api';
import { NetcoreWhatsAppClient } from './client/netcore-api';
import { WhatsAppAgentExecutor } from './processor/agent-executor';
import { whatsappEnv } from './env';

let processorInstance: MessageProcessor | null = null;

export function createMessageProcessor(): MessageProcessor {
  if (processorInstance) return processorInstance;

  const prisma = getPrismaClient();
  const sessionManager = new SessionManager(prisma);
  const lockProvider = new InMemoryLockProvider();
  const contactLock = new ContactLock(lockProvider, 60_000);
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  const encryption = new EncryptionService();

  const agentExecutor = new WhatsAppAgentExecutor(prisma, (config) => {
    return {
      async chat(params) {
        // Placeholder: wire to actual LLM provider in production
        return { text: `[Agent response to: ${params.messages[params.messages.length - 1]?.content}]` };
      },
    };
  });

  const clientFactory = (account: { accessToken: string; phoneNumberId: string; provider: string }) => {
    const decryptedToken = encryption.decrypt(account.accessToken);

    if (account.provider === 'netcore') {
      return new NetcoreWhatsAppClient({
        accessToken: decryptedToken,
        phoneNumberId: account.phoneNumberId,
      });
    }

    return new MetaWhatsAppClient({
      accessToken: decryptedToken,
      phoneNumberId: account.phoneNumberId,
      apiVersion: whatsappEnv.META_API_VERSION,
    });
  };

  processorInstance = new MessageProcessor({
    prisma,
    sessionManager,
    agentExecutor,
    contactLock,
    circuitBreaker,
    clientFactory,
  });

  return processorInstance;
}
```

- [ ] **Step 5: Update the existing unit test mock**

In `libs/whatsapp/src/processor/message-processor.test.ts`, find:

```ts
      metaClientFactory: () => mockMetaClient as any,
```

Replace with:

```ts
      clientFactory: () => mockMetaClient as any,
```

This is the only change needed in this test file — `mockMetaClient` is already defined as a zero-argument-aware mock (the existing factory lambda already ignores whatever arguments it's called with), so it works unchanged with the new single-`account`-argument call signature.

- [ ] **Step 6: Run the full existing test suite for this package to confirm no regressions**

Run: `bunx vitest run libs/whatsapp`
Expected: all tests PASS, including every pre-existing `message-processor.test.ts` and `message-processor.integration.test.ts` case — this is the regression guard proving the shared core's behavior is unchanged for Meta.

- [ ] **Step 7: Commit**

```bash
git add libs/whatsapp/src/processor/message-processor.ts libs/whatsapp/src/processor/message-processor.test.ts libs/whatsapp/src/factory.ts
git commit -m "feat(whatsapp): generalize client factory to support Netcore alongside Meta"
```

---

### Task 9: Agent Studio `whatsapp_send` node — Netcore text support

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts`
- Modify: `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts`

**Interfaces:**
- Consumes: `NetcoreWhatsAppClient` from `@chatbot/whatsapp` (Task 6).
- Produces: nothing new for later tasks.

This is the executor behind the tenant's actual configured reply graph (`[WhatsApp Trigger] → [LLM] → [WhatsApp Send]`), found by checking every direct consumer of `MetaWhatsAppClient` in the repo — it's a separate code path from `MessageProcessor`/`factory.ts` (Task 8) and must be updated too, or Netcore replies via this graph node would silently never work even after Task 8 ships.

- [ ] **Step 1: Update the test mock to include `NetcoreWhatsAppClient`, and add new test cases**

In `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts`, find:

```ts
const mockSendTextMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.abc' }] });
const mockSendImageMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.img' }] });
const mockSendDocumentMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.doc' }] });

vi.mock('@chatbot/whatsapp', () => ({
  MetaWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTextMessage: mockSendTextMessage,
    sendImageMessage: mockSendImageMessage,
    sendDocumentMessage: mockSendDocumentMessage,
  })),
}));
```

Replace with:

```ts
const mockSendTextMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.abc' }] });
const mockSendImageMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.img' }] });
const mockSendDocumentMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.doc' }] });
const mockNetcoreSendTextMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.netcore' }] });

vi.mock('@chatbot/whatsapp', () => ({
  MetaWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTextMessage: mockSendTextMessage,
    sendImageMessage: mockSendImageMessage,
    sendDocumentMessage: mockSendDocumentMessage,
  })),
  NetcoreWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTextMessage: mockNetcoreSendTextMessage,
  })),
}));
```

Then find the `makeCtx` helper's mock account (it has no `provider` field today — add one with a default so existing Meta-path tests keep working unchanged):

```ts
  const mockPrisma = {
    whatsAppAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc_1',
        accessToken: 'encrypted-token',
        phoneNumberId: 'phone_123',
        apiVersion: 'v22.0',
      }),
    },
  };
```

Replace with (note the new optional `account` parameter — this lets the new tests override the mocked account without duplicating the whole helper):

```ts
  const mockPrisma = {
    whatsAppAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc_1',
        accessToken: 'encrypted-token',
        phoneNumberId: 'phone_123',
        apiVersion: 'v22.0',
        provider: 'meta',
        ...account,
      }),
    },
  };
```

This requires adding `account?: Record<string, unknown>` as a third parameter to `makeCtx`. Find the function signature:

```ts
function makeCtx(channels: Record<string, unknown>, config: Record<string, unknown> = {}): NodeExecutionContext {
```

Replace with:

```ts
function makeCtx(channels: Record<string, unknown>, config: Record<string, unknown> = {}, account: Record<string, unknown> = {}): NodeExecutionContext {
```

Finally, add these two new test cases at the end of the `describe('WhatsAppSendNodeExecutor', ...)` block, right before the closing `});`:

```ts
  it('sends via Netcore when account.provider is netcore', async () => {
    const ctx = makeCtx({ llm_output: 'Hello via Netcore' }, {}, { provider: 'netcore' });
    const result = await executor.execute(ctx);
    expect(mockNetcoreSendTextMessage).toHaveBeenCalledWith('919876543210', 'Hello via Netcore');
    expect(result.stateUpdates['wa_last_sent_message_id']).toBe('wamid.netcore');
  });

  it('throws a clear error for non-text messageType on a Netcore account', async () => {
    const ctx = makeCtx({ llm_output: 'caption' }, { messageType: 'image' }, { provider: 'netcore' });
    await expect(executor.execute(ctx)).rejects.toThrow('not yet supported for Netcore');
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts`
Expected: the two new tests FAIL (executor doesn't branch on provider yet); all pre-existing tests still PASS (confirms the mock/helper changes alone didn't break anything before touching the implementation).

- [ ] **Step 3: Update the implementation**

In `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts`, update the import:

Find:
```ts
import { MetaWhatsAppClient } from '@chatbot/whatsapp';
```
Replace:
```ts
import { MetaWhatsAppClient, NetcoreWhatsAppClient } from '@chatbot/whatsapp';
```

Find:
```ts
      const accessToken = new EncryptionService().decrypt(account.accessToken);

      const client = new MetaWhatsAppClient({
        accessToken,
        phoneNumberId: account.phoneNumberId,
        apiVersion: account.apiVersion ?? 'v22.0',
      });

      const to = String(senderId);
      let sentMessageId: string;

      if (config.messageType === 'text') {
        const response = await client.sendTextMessage(to, String(messageContent));
        sentMessageId = response.messages[0].id;
      } else if (config.messageType === 'image') {
        const mediaId = String(channels[config.mediaIdChannel ?? ''] ?? '');
        const caption = String(messageContent);
        const response = await client.sendImageMessage(to, mediaId, caption);
        sentMessageId = response.messages[0].id;
      } else if (config.messageType === 'document') {
        const mediaId = String(channels[config.mediaIdChannel ?? ''] ?? '');
        const filename = config.filenameChannel ? String(channels[config.filenameChannel] ?? '') : undefined;
        const caption = String(messageContent);
        const response = await client.sendDocumentMessage(to, mediaId, filename, caption);
        sentMessageId = response.messages[0].id;
      } else {
        throw new Error(`Unsupported messageType: ${config.messageType}`);
      }
```

Replace:
```ts
      const accessToken = new EncryptionService().decrypt(account.accessToken);
      const to = String(senderId);
      let sentMessageId: string;

      if (account.provider === 'netcore') {
        if (config.messageType !== 'text') {
          throw new Error(`WhatsApp Send node: messageType "${config.messageType}" is not yet supported for Netcore accounts`);
        }
        const netcoreClient = new NetcoreWhatsAppClient({ accessToken, phoneNumberId: account.phoneNumberId });
        const response = await netcoreClient.sendTextMessage(to, String(messageContent));
        sentMessageId = response.messages[0].id;
      } else {
        const client = new MetaWhatsAppClient({
          accessToken,
          phoneNumberId: account.phoneNumberId,
          apiVersion: account.apiVersion ?? 'v22.0',
        });

        if (config.messageType === 'text') {
          const response = await client.sendTextMessage(to, String(messageContent));
          sentMessageId = response.messages[0].id;
        } else if (config.messageType === 'image') {
          const mediaId = String(channels[config.mediaIdChannel ?? ''] ?? '');
          const caption = String(messageContent);
          const response = await client.sendImageMessage(to, mediaId, caption);
          sentMessageId = response.messages[0].id;
        } else if (config.messageType === 'document') {
          const mediaId = String(channels[config.mediaIdChannel ?? ''] ?? '');
          const filename = config.filenameChannel ? String(channels[config.filenameChannel] ?? '') : undefined;
          const caption = String(messageContent);
          const response = await client.sendDocumentMessage(to, mediaId, filename, caption);
          sentMessageId = response.messages[0].id;
        } else {
          throw new Error(`Unsupported messageType: ${config.messageType}`);
        }
      }
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts`
Expected: all PASS, including the 2 new tests and every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts
git commit -m "feat(agent-studio): support Netcore text replies in WhatsApp Send node"
```

---

### Task 10: Guard the `whatsapp_send_template` node against Netcore accounts

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.ts`
- Modify: `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

Template sending for Netcore is explicitly out of scope (per the design spec — the request shape is docs-only/unconfirmed). Without this guard, hitting this node with a Netcore account would silently construct a `MetaWhatsAppClient` using a Netcore API key and fail with a confusing Meta-API auth error instead of a clear one.

- [ ] **Step 1: Add a failing test**

In `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts`, find the `makeCtx` helper's mocked account (same pattern as Task 9) and give it the same `account` override parameter:

Find:
```ts
function makeCtx(channels: Record<string, unknown> = {}, config: Record<string, unknown> = {}): NodeExecutionContext {
  const mockPrisma = {
    whatsAppAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc_1',
        accessToken: 'encrypted-token',
        phoneNumberId: 'phone_123',
        apiVersion: 'v22.0',
      }),
    },
  };
```

Replace:
```ts
function makeCtx(channels: Record<string, unknown> = {}, config: Record<string, unknown> = {}, account: Record<string, unknown> = {}): NodeExecutionContext {
  const mockPrisma = {
    whatsAppAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc_1',
        accessToken: 'encrypted-token',
        phoneNumberId: 'phone_123',
        apiVersion: 'v22.0',
        provider: 'meta',
        ...account,
      }),
    },
  };
```

Add this test case at the end of the `describe(...)` block, before the closing `});`:

```ts
  it('throws a clear error when the account provider is netcore', async () => {
    const ctx = makeCtx({}, {}, { provider: 'netcore' });
    await expect(executor.execute(ctx)).rejects.toThrow('does not yet support Netcore');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts`
Expected: the new test FAILS (no guard exists yet); all pre-existing tests still PASS.

- [ ] **Step 3: Add the guard**

In `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.ts`, find:

```ts
      const account = await ctx.services.prisma.whatsAppAccount.findUnique({
        where: { id: String(accountId) },
      });
      if (!account) {
        throw new Error(`WhatsAppAccount not found: ${accountId}`);
      }

      const accessToken = new EncryptionService().decrypt(account.accessToken);
```

Replace:

```ts
      const account = await ctx.services.prisma.whatsAppAccount.findUnique({
        where: { id: String(accountId) },
      });
      if (!account) {
        throw new Error(`WhatsAppAccount not found: ${accountId}`);
      }

      if (account.provider === 'netcore') {
        throw new Error('WhatsApp Send Template node does not yet support Netcore accounts');
      }

      const accessToken = new EncryptionService().decrypt(account.accessToken);
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.ts libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts
git commit -m "fix(agent-studio): guard WhatsApp Send Template node against Netcore accounts"
```

---

### Task 11: Guard the manual template-send API route against Netcore accounts

**Files:**
- Modify: `apps/web-ui/app/api/whatsapp/accounts/[id]/templates/send/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

Same rationale as Task 10 — this is the Settings UI's "send a template manually" feature, a separate code path from the graph node.

- [ ] **Step 1: Add the guard**

Find:

```ts
    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const encryption = new EncryptionService();
```

Replace:

```ts
    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    if (account.provider === 'netcore') {
      return NextResponse.json({ error: 'Template sending is not yet supported for Netcore accounts' }, { status: 400 });
    }

    const encryption = new EncryptionService();
```

- [ ] **Step 2: Manual sanity check**

There's no existing test file for this route (matches repo convention — no `apps/web-ui/app/api/**` route has one). Run: `bunx tsc --noEmit` (or `bun run build`) from the repo root and confirm no new type errors introduced by this change.

- [ ] **Step 3: Commit**

```bash
git add "apps/web-ui/app/api/whatsapp/accounts/[id]/templates/send/route.ts"
git commit -m "fix(web-ui): guard manual template-send route against Netcore accounts"
```

---

### Task 12: Netcore connect API route

**Files:**
- Create: `apps/web-ui/app/api/whatsapp/connect/netcore/route.ts`

**Interfaces:**
- Consumes: `EncryptionService`, `getSessionTenantId`, `authorize`, `getPrismaClient`, `createLogger` from `@chatbot/shared`; `authOptions` from `@/lib/auth`.
- Produces: `POST /api/whatsapp/connect/netcore` accepting `{ displayName, wabaId, phoneNumber, apiKey }`, returning `201 { id, phoneNumberId, displayPhone, displayName, status }` — Task 14's frontend calls this exact endpoint and shape.

- [ ] **Step 1: Create the route**

Create `apps/web-ui/app/api/whatsapp/connect/netcore/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, EncryptionService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-connect-netcore');

const connectNetcoreSchema = z.object({
  displayName: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumber: z.string().regex(/^\d{10,15}$/, 'Phone number must be digits only, with country code, no + or spaces'),
  apiKey: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TenantConfig', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = connectNetcoreSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const encryption = new EncryptionService();
    const encryptedApiKey = encryption.encrypt(parsed.data.apiKey);

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.create({
      data: {
        tenantId,
        provider: 'netcore',
        wabaId: parsed.data.wabaId,
        phoneNumberId: parsed.data.phoneNumber,
        displayPhone: parsed.data.phoneNumber,
        displayName: parsed.data.displayName,
        accessToken: encryptedApiKey,
        webhookSecret: crypto.randomUUID(),
        status: 'active',
      },
    });

    await (prisma as any).whatsAppRouting.create({
      data: {
        accountId: account.id,
        strategy: 'keyword',
        config: {},
        fallbackAgentId: null,
      },
    });

    logger.info({ tenantId, accountId: account.id, phoneNumberId: account.phoneNumberId }, 'Netcore WhatsApp account connected');

    return NextResponse.json({
      id: account.id,
      phoneNumberId: account.phoneNumberId,
      displayPhone: account.displayPhone,
      displayName: account.displayName,
      status: account.status,
    }, { status: 201 });

  } catch (error) {
    logger.error({ error }, 'Error connecting Netcore WhatsApp account');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manual sanity check**

Run: `bun run dev`, then (with a valid session cookie — easiest done by logging into the app in a browser and copying the session cookie into the request, or by testing through the UI once Task 14 is done instead of via raw curl):

```bash
curl -i -X POST http://localhost:3005/api/whatsapp/connect/netcore \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"displayName":"Test","wabaId":"123","phoneNumber":"919711750243","apiKey":"test-key"}'
```

Expected: `201` with the account JSON, or `400` with Zod validation details if a field is malformed (e.g. try `"phoneNumber":"+91 971"` and confirm you get a clear 400, not a 500). If full manual testing through a real session is awkward right now, it's fine to defer full verification of this route to Task 14, once there's a UI button to click instead of hand-crafting cookies.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/whatsapp/connect/netcore/route.ts
git commit -m "feat(web-ui): add Netcore WhatsApp connect API route"
```

---

### Task 13: Expose `provider` from the accounts list API

**Files:**
- Modify: `apps/web-ui/app/api/whatsapp/accounts/route.ts`

**Interfaces:**
- Produces: `GET /api/whatsapp/accounts` response items now include `provider: string` — Task 14's frontend reads this field.

- [ ] **Step 1: Add the field to the select clause**

Find:

```ts
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
```

Replace:

```ts
      select: {
        id: true,
        provider: true,
        phoneNumberId: true,
        displayPhone: true,
        displayName: true,
        status: true,
        qualityRating: true,
        messagingLimit: true,
        createdAt: true,
      },
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/api/whatsapp/accounts/route.ts
git commit -m "feat(web-ui): expose provider field from WhatsApp accounts API"
```

---

### Task 14: Frontend — Provider column and Netcore connect form

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/page.tsx`

**Interfaces:**
- Consumes: `POST /api/whatsapp/connect/netcore` (Task 12), `GET /api/whatsapp/accounts` now returning `provider` (Task 13).
- Produces: nothing further downstream — this is the final user-facing piece.

This task changes one file in several places. Apply them in order; each step alone leaves the file in a working (if incomplete) state if you need to stop partway and resume later — except Step 5, which depends on Steps 1–4 all being in place first.

- [ ] **Step 1: Add the `z` import and the Netcore form schema**

Find the import block at the top of the file:

```ts
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { ArrowLeft, Trash2, Settings, MessageSquare, Plus, Loader2 } from 'lucide-react';
```

Replace with:

```ts
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { ArrowLeft, Trash2, Settings, MessageSquare, Plus, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { z } from 'zod';

const netcoreConnectSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  wabaId: z.string().min(1, 'WABA ID is required'),
  phoneNumber: z.string().regex(/^\d{10,15}$/, 'Digits only, with country code, no + or spaces'),
  apiKey: z.string().min(1, 'API key is required'),
});
```

- [ ] **Step 2: Add `provider` to the `WhatsAppAccount` interface and new state**

Find:

```ts
interface WhatsAppAccount {
  id: string;
  phoneNumberId: string;
  displayPhone: string;
  displayName: string;
  status: string;
  qualityRating: string | null;
  messagingLimit: string | null;
  createdAt: string;
}
```

Replace:

```ts
interface WhatsAppAccount {
  id: string;
  provider: string;
  phoneNumberId: string;
  displayPhone: string;
  displayName: string;
  status: string;
  qualityRating: string | null;
  messagingLimit: string | null;
  createdAt: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  meta: 'Meta',
  netcore: 'Netcore',
};
```

Find:

```ts
  const [connectOpen, setConnectOpen] = useState(false);
  const [metaConfig, setMetaConfig] = useState<{ appId: string; apiVersion: string } | null>(null);
  const [fbReady, setFbReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
```

Replace:

```ts
  const [connectOpen, setConnectOpen] = useState(false);
  const [metaConfig, setMetaConfig] = useState<{ appId: string; apiVersion: string } | null>(null);
  const [fbReady, setFbReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [provider, setProvider] = useState<'meta' | 'netcore' | null>(null);
  const [netcoreForm, setNetcoreForm] = useState({ displayName: '', wabaId: '', phoneNumber: '', apiKey: '' });
  const [netcoreErrors, setNetcoreErrors] = useState<Record<string, string>>({});
  const [netcoreSubmitting, setNetcoreSubmitting] = useState(false);
```

- [ ] **Step 3: Add the Netcore submit handler**

Find the end of `launchEmbeddedSignup` (it ends with the closing of the `FB.login(...)` call — look for the line `}, []);` that closes that `useCallback`). Add this new function right after it, before `const handleDisconnect = ...`:

```ts
  const handleNetcoreConnect = async () => {
    const parsed = netcoreConnectSchema.safeParse(netcoreForm);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[String(issue.path[0])] = issue.message;
      }
      setNetcoreErrors(fieldErrors);
      return;
    }
    setNetcoreErrors({});
    setNetcoreSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/connect/netcore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) throw new Error('Connection failed');
      toast.success('WhatsApp account connected successfully');
      setConnectOpen(false);
      setProvider(null);
      setNetcoreForm({ displayName: '', wabaId: '', phoneNumber: '', apiKey: '' });
      fetchAccounts();
    } catch {
      toast.error('Failed to connect WhatsApp account');
    } finally {
      setNetcoreSubmitting(false);
    }
  };
```

- [ ] **Step 4: Add the Provider column to the table**

Find the `columns` array's first entry (the `displayName` column definition) and the start of the `status` column:

```ts
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
```

Insert a new column definition directly before it:

```ts
      {
        accessorKey: 'provider',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Provider" />,
        cell: ({ row }) => (
          <Badge variant="outline">{PROVIDER_LABEL[row.original.provider] ?? row.original.provider}</Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
```

- [ ] **Step 5: Replace the dialog body with a provider picker + both flows**

Find the entire `{/* Connect Account Dialog */}` block:

```tsx
      {/* Connect Account Dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect WhatsApp Account</DialogTitle>
            <DialogDescription>
              Use Meta Embedded Signup to connect your WhatsApp Business account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!fbReady ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
                      <WhatsAppIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Meta Embedded Signup</p>
                      <p className="text-xs text-muted-foreground">App ID: {metaConfig?.appId}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You will be redirected to Meta to authorize access to your WhatsApp Business account.
                  </p>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={launchEmbeddedSignup}
                  disabled={connecting}
                >
                  {connecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <WhatsAppIcon className="mr-2 h-4 w-4" />
                      Launch Meta Embedded Signup
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectOpen(false)} disabled={connecting}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

Replace the whole block with:

```tsx
      {/* Connect Account Dialog */}
      <Dialog
        open={connectOpen}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) {
            setProvider(null);
            setNetcoreForm({ displayName: '', wabaId: '', phoneNumber: '', apiKey: '' });
            setNetcoreErrors({});
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect WhatsApp Account</DialogTitle>
            <DialogDescription>
              {provider === null
                ? 'Choose how this WhatsApp Business account is managed.'
                : provider === 'meta'
                  ? 'Use Meta Embedded Signup to connect your WhatsApp Business account.'
                  : 'Connect a WhatsApp number managed through Netcore Cloud.'}
            </DialogDescription>
          </DialogHeader>

          {provider === null && (
            <div className="grid grid-cols-2 gap-3 py-4">
              <button
                type="button"
                onClick={() => setProvider('meta')}
                className="rounded-lg border p-4 text-left space-y-1 hover:border-primary transition-colors"
              >
                <p className="text-sm font-medium">Meta Embedded Signup</p>
                <p className="text-xs text-muted-foreground">Connect directly via Meta.</p>
              </button>
              <button
                type="button"
                onClick={() => setProvider('netcore')}
                className="rounded-lg border p-4 text-left space-y-1 hover:border-primary transition-colors"
              >
                <p className="text-sm font-medium">Netcore</p>
                <p className="text-xs text-muted-foreground">Connect a number managed via Netcore Cloud.</p>
              </button>
            </div>
          )}

          {provider === 'meta' && (
            <div className="space-y-4 py-4">
              {!fbReady ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
                        <WhatsAppIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Meta Embedded Signup</p>
                        <p className="text-xs text-muted-foreground">App ID: {metaConfig?.appId}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You will be redirected to Meta to authorize access to your WhatsApp Business account.
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={launchEmbeddedSignup}
                    disabled={connecting}
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <WhatsAppIcon className="mr-2 h-4 w-4" />
                        Launch Meta Embedded Signup
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          )}

          {provider === 'netcore' && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="netcore-display-name">Display Name</Label>
                <Input
                  id="netcore-display-name"
                  value={netcoreForm.displayName}
                  onChange={(e) => setNetcoreForm((f) => ({ ...f, displayName: e.target.value }))}
                />
                {netcoreErrors.displayName && <p className="text-xs text-destructive">{netcoreErrors.displayName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="netcore-waba-id">WABA ID</Label>
                <Input
                  id="netcore-waba-id"
                  value={netcoreForm.wabaId}
                  onChange={(e) => setNetcoreForm((f) => ({ ...f, wabaId: e.target.value }))}
                />
                {netcoreErrors.wabaId && <p className="text-xs text-destructive">{netcoreErrors.wabaId}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="netcore-phone-number">Phone Number</Label>
                <Input
                  id="netcore-phone-number"
                  placeholder="919711750243"
                  value={netcoreForm.phoneNumber}
                  onChange={(e) => setNetcoreForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                />
                {netcoreErrors.phoneNumber && <p className="text-xs text-destructive">{netcoreErrors.phoneNumber}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="netcore-api-key">API Key</Label>
                <Input
                  id="netcore-api-key"
                  type="password"
                  value={netcoreForm.apiKey}
                  onChange={(e) => setNetcoreForm((f) => ({ ...f, apiKey: e.target.value }))}
                />
                {netcoreErrors.apiKey && <p className="text-xs text-destructive">{netcoreErrors.apiKey}</p>}
              </div>
              <Button className="w-full" onClick={handleNetcoreConnect} disabled={netcoreSubmitting}>
                {netcoreSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect Netcore Account'
                )}
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectOpen(false)} disabled={connecting || netcoreSubmitting}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: Verify the project builds**

Run: `cd apps/web-ui && bunx tsc --noEmit` (or `bun run build` from repo root)
Expected: no new type errors. Pay particular attention to `Input`/`Label` import paths actually existing at `@/components/ui/input` and `@/components/ui/label` — confirmed present in this repo, but verify the build itself to be sure.

- [ ] **Step 7: Manual UI check**

Run: `bun run dev`, navigate to `/settings/channels/whatsapp`, click **Connect Account**. Confirm:
- You see two cards: "Meta Embedded Signup" and "Netcore".
- Clicking "Netcore" shows the 4-field form.
- Submitting with an empty field shows the corresponding inline error and does not call the API.
- Submitting a valid form (with a throwaway test API key — it'll just fail server-side against Netcore's real API, which is fine for this check) shows either a success or failure toast, and the dialog/form state resets correctly when reopened.
- The accounts table shows a "Provider" column.

- [ ] **Step 8: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/settings/channels/whatsapp/page.tsx"
git commit -m "feat(web-ui): add Netcore connect form and Provider column"
```

---

### Task 15: Full regression run and real-traffic verification

**Files:** none — verification only.

- [ ] **Step 1: Run the full unit test suite**

Run: `bun run test`
Expected: all PASS — this exercises every test touched or added in Tasks 1–13, plus the entire pre-existing suite (shared, ai, workers, whatsapp, agent-studio, knowledge-base, telegram).

- [ ] **Step 2: Run a full build**

Run: `bun run build`
Expected: succeeds with no new errors.

- [ ] **Step 3: When ready to deploy (on your own schedule, per the constraint discussed earlier — not something to do standalone just for this)**

Deploy to `chatflow-nonprod` per `infra/CHATFLOW_NONPROD_DEPLOYMENT.md`. After it's live, check CloudWatch for the existing connected Netcore number's traffic:

```bash
AWS_PROFILE=omar-testing-saas-chatbot aws logs filter-log-events \
  --region us-east-1 \
  --log-group-name "/ecs/chatflow-nonprod-web-ui" \
  --filter-pattern "whatsapp-webhook" \
  --start-time $(($(date +%s)*1000 - 30*60*1000)) \
  --query "events[*].message" --output json
```

Expected: real inbound messages on the connected number no longer show `"Invalid webhook signature"` — they should show normal `MessageProcessor` processing logs instead (or silence, if no real customer happens to message during your check — in which case, message the connected number yourself from a phone to trigger one, the same way real-traffic verification was done during the original investigation).

- [ ] **Step 4: Final commit (if anything was left uncommitted)**

```bash
git status
```
Confirm clean tree — everything should already be committed task-by-task.
