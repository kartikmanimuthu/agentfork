# SDK Chat Widget Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp the embeddable chat widget SDK with zero-config embed (single `sdk-id` attribute), API-first architecture, and full-featured platform capabilities (streaming, rich messages, pre-chat forms, file uploads, KB suggestions, proactive triggers, CSAT).

**Architecture:** Widget fetches config via `GET /api/v1/sdk/:sdkId/config` (returns theme + API key), then uses the existing inference API directly. New endpoints for KB suggest, file upload, CSAT, and feedback are added under the inference session namespace. The SDK is a StencilJS Web Component rewrite with 17 modular components.

**Tech Stack:** StencilJS 4, @stencil/store, TypeScript, Prisma (PostgreSQL), Next.js API routes, SSE streaming, S3 (file uploads), Vercel AI SDK

---

## File Structure

### Database
- `prisma/schema.prisma` — Add SdkWidget, SdkSession, MessageFeedback, CsatResponse models; modify Agent, ApiKey, InferenceSession, InferenceSessionMessage relations

### Shared Services
- `libs/shared/src/services/sdk-widget-service.ts` — CRUD for SdkWidget model
- `libs/shared/src/services/sdk-widget-service.test.ts` — Tests
- `libs/shared/src/services/feedback-service.ts` — Message feedback persistence
- `libs/shared/src/services/feedback-service.test.ts` — Tests
- `libs/shared/src/services/csat-service.ts` — CSAT response persistence
- `libs/shared/src/services/csat-service.test.ts` — Tests

### API Routes (apps/web-ui/app/api/)
- `v1/sdk/[sdkId]/config/route.ts` — Public config bootstrap
- `v1/inference/sessions/[id]/kb/suggest/route.ts` — KB article suggestions
- `v1/inference/sessions/[id]/files/route.ts` — File upload
- `v1/inference/sessions/[id]/csat/route.ts` — CSAT submission
- `v1/inference/sessions/[id]/chat/feedback/route.ts` — Message feedback
- `v1/inference/route.ts` — Modify for SSE streaming format
- `v1/inference/sessions/route.ts` — Modify for visitor fields

### SDK Widget (apps/sdk/src/)
- `store/widget-store.ts` — Global state via @stencil/store
- `services/api.service.ts` — HTTP client with auth header injection
- `services/stream.service.ts` — SSE parsing and token accumulation
- `services/storage.service.ts` — localStorage wrapper
- `services/config.service.ts` — Config fetch + cache
- `services/proactive.service.ts` — Proactive rule evaluation
- `types/index.ts` — Shared interfaces
- `components/smc-chat-widget/` — Root component (boot layer)
- `components/smc-launcher/` — Floating button + proactive bubble
- `components/smc-chat-window/` — Main container
- `components/smc-header/` — Title, avatar, controls
- `components/smc-pre-chat-form/` — Dynamic form
- `components/smc-message-list/` — Scrollable message area
- `components/smc-message/` — Individual bubble
- `components/smc-markdown/` — Markdown rendering
- `components/smc-rich-card/` — Cards, buttons
- `components/smc-file-preview/` — File thumbnail
- `components/smc-feedback/` — Thumbs up/down
- `components/smc-typing-indicator/` — Streaming animation
- `components/smc-kb-suggestions/` — Article cards
- `components/smc-timestamp/` — Time separators
- `components/smc-quick-replies/` — Suggested chips
- `components/smc-input-bar/` — Input + file + send
- `components/smc-csat-survey/` — Rating survey
- `components/smc-proactive-engine/` — Trigger evaluator

### Dashboard (apps/web-ui/app/(dashboard)/sdks/)
- `chat-widget/designer/page.tsx` — Full rewrite with tabs
- `chat-widget/sandbox/page.tsx` — Simplified SDK ID-based testing

---

## Task 1: Prisma Schema — New Models + Relations

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add SdkWidget model**

Add after the `ApiKeyExecution` model (line ~492):

```prisma
model SdkWidget {
  id              String   @id @default(cuid())
  tenantId        String
  agentId         String
  apiKeyId        String
  name            String
  sdkId           String   @unique

  primaryColor    String   @default("#1a1a2e")
  secondaryColor  String   @default("#3b82f6")
  theme           String   @default("auto")
  position        String   @default("right")
  headerText      String   @default("Hey there!")
  headerIcon      String?
  botName         String   @default("AI Assistant")
  botAvatar       String?
  welcomeMessage  String   @default("How can I help you today?")
  inputPlaceholder String  @default("Write a message...")
  customCss       String?

  preChatForm     Json?
  quickReplies    Json?
  proactiveRules  Json?
  kbEnabled       Boolean  @default(false)
  fileUpload      Boolean  @default(false)
  csatEnabled     Boolean  @default(false)
  csatType        String   @default("thumbs")

  allowedOrigins  String[]
  rateLimitRpm    Int      @default(60)

  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  agent           Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  apiKey          ApiKey   @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)
  sessions        SdkSession[]
  csatResponses   CsatResponse[]

  @@index([tenantId])
  @@index([sdkId])
  @@index([agentId])
  @@map("sdk_widgets")
}
```

- [ ] **Step 2: Add SdkSession model**

```prisma
model SdkSession {
  id                  String   @id @default(cuid())
  sdkWidgetId         String
  inferenceSessionId  String
  visitorId           String
  visitorName         String?
  visitorEmail        String?
  metadata            Json?
  status              String   @default("active")
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  sdkWidget           SdkWidget        @relation(fields: [sdkWidgetId], references: [id], onDelete: Cascade)
  inferenceSession    InferenceSession  @relation(fields: [inferenceSessionId], references: [id], onDelete: Cascade)

  @@index([sdkWidgetId])
  @@index([visitorId])
  @@index([inferenceSessionId])
  @@map("sdk_sessions")
}
```

- [ ] **Step 3: Add MessageFeedback model**

```prisma
model MessageFeedback {
  id         String   @id @default(cuid())
  messageId  String
  sessionId  String
  rating     String
  comment    String?
  createdAt  DateTime @default(now())

  message    InferenceSessionMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  session    InferenceSession        @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([messageId, sessionId])
  @@index([sessionId])
  @@map("message_feedbacks")
}
```

- [ ] **Step 4: Add CsatResponse model**

```prisma
model CsatResponse {
  id          String   @id @default(cuid())
  sessionId   String   @unique
  sdkWidgetId String
  rating      Int
  comment     String?
  createdAt   DateTime @default(now())

  session     InferenceSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sdkWidget   SdkWidget        @relation(fields: [sdkWidgetId], references: [id], onDelete: Cascade)

  @@index([sdkWidgetId])
  @@map("csat_responses")
}
```

- [ ] **Step 5: Add relations to existing models**

In `Agent` model (line ~237), add to relations:
```prisma
  sdkWidgets         SdkWidget[]
```

In `ApiKey` model (line ~432), add to relations:
```prisma
  sdkWidget          SdkWidget?
```

In `InferenceSession` model (line ~510), add to relations:
```prisma
  sdkSession         SdkSession?
  feedbacks          MessageFeedback[]
  csatResponse       CsatResponse?
```

In `InferenceSessionMessage` model (line ~534), add to relations:
```prisma
  feedback           MessageFeedback?
```

In `Tenant` model (line ~13), add to relations:
```prisma
  sdkWidgets         SdkWidget[]
```

- [ ] **Step 6: Run migration**

```bash
bunx prisma migrate dev --name add_sdk_widget_models
```

Expected: Migration created and applied successfully.

- [ ] **Step 7: Regenerate Prisma client**

```bash
bunx prisma generate --schema=./prisma/schema.prisma
```

- [ ] **Step 8: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add SdkWidget, SdkSession, MessageFeedback, CsatResponse models

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 2: Shared Services — SdkWidgetService

**Files:**
- Create: `libs/shared/src/services/sdk-widget-service.ts`
- Create: `libs/shared/src/services/sdk-widget-service.test.ts`
- Modify: `libs/shared/src/index.ts` (export new service)

- [ ] **Step 1: Write the test file**

```typescript
// libs/shared/src/services/sdk-widget-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SdkWidgetService } from './sdk-widget-service';

const mockDb = {
  sdkWidget: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

describe('SdkWidgetService', () => {
  let service: SdkWidgetService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SdkWidgetService('tenant-1', mockDb as any);
  });

  describe('create', () => {
    it('generates a unique sdkId and creates widget', async () => {
      mockDb.sdkWidget.create.mockResolvedValue({ id: 'w1', sdkId: 'sdk_abc123' });

      const result = await service.create({
        agentId: 'agent-1',
        apiKeyId: 'key-1',
        name: 'Support Widget',
      });

      expect(mockDb.sdkWidget.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          agentId: 'agent-1',
          apiKeyId: 'key-1',
          name: 'Support Widget',
          sdkId: expect.stringMatching(/^sdk_[a-z0-9]{12}$/),
        }),
      });
      expect(result).toEqual({ id: 'w1', sdkId: 'sdk_abc123' });
    });
  });

  describe('findBySdkId', () => {
    it('returns widget with agent and apiKey included', async () => {
      mockDb.sdkWidget.findFirst.mockResolvedValue({ id: 'w1', sdkId: 'sdk_abc', status: 'active' });

      const result = await service.findBySdkId('sdk_abc');

      expect(mockDb.sdkWidget.findFirst).toHaveBeenCalledWith({
        where: { sdkId: 'sdk_abc', status: 'active' },
        include: { agent: true, apiKey: true },
      });
      expect(result).toEqual({ id: 'w1', sdkId: 'sdk_abc', status: 'active' });
    });

    it('returns null for non-existent sdkId', async () => {
      mockDb.sdkWidget.findFirst.mockResolvedValue(null);
      const result = await service.findBySdkId('sdk_nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates widget fields', async () => {
      mockDb.sdkWidget.update.mockResolvedValue({ id: 'w1', primaryColor: '#ff0000' });

      const result = await service.update('w1', { primaryColor: '#ff0000' });

      expect(mockDb.sdkWidget.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { primaryColor: '#ff0000' },
      });
      expect(result).toEqual({ id: 'w1', primaryColor: '#ff0000' });
    });
  });

  describe('listByTenant', () => {
    it('returns all widgets for tenant', async () => {
      mockDb.sdkWidget.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);

      const result = await service.listByTenant();

      expect(mockDb.sdkWidget.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp && bunx vitest run libs/shared/src/services/sdk-widget-service.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// libs/shared/src/services/sdk-widget-service.ts
import crypto from 'crypto';
import { createLogger } from '../logging/logger';

const logger = createLogger('sdk-widget-service');

export interface SdkWidgetDb {
  sdkWidget: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<unknown | null>;
    findMany(args: { where: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<unknown[]>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface CreateSdkWidgetInput {
  agentId: string;
  apiKeyId: string;
  name: string;
  primaryColor?: string;
  secondaryColor?: string;
  theme?: string;
  position?: string;
  headerText?: string;
  botName?: string;
  welcomeMessage?: string;
  inputPlaceholder?: string;
}

export class SdkWidgetService {
  constructor(
    private readonly tenantId: string,
    private readonly db: SdkWidgetDb
  ) {}

  private generateSdkId(): string {
    return `sdk_${crypto.randomBytes(6).toString('hex')}`;
  }

  async create(input: CreateSdkWidgetInput): Promise<unknown> {
    const sdkId = this.generateSdkId();
    logger.info({ tenantId: this.tenantId, agentId: input.agentId, sdkId }, 'Creating SDK widget');

    return this.db.sdkWidget.create({
      data: {
        tenantId: this.tenantId,
        sdkId,
        ...input,
      },
    });
  }

  async findBySdkId(sdkId: string): Promise<unknown | null> {
    return this.db.sdkWidget.findFirst({
      where: { sdkId, status: 'active' },
      include: { agent: true, apiKey: true },
    });
  }

  async findById(id: string): Promise<unknown | null> {
    return this.db.sdkWidget.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { agent: true, apiKey: true },
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<unknown> {
    logger.info({ tenantId: this.tenantId, widgetId: id }, 'Updating SDK widget');
    return this.db.sdkWidget.update({
      where: { id },
      data,
    });
  }

  async listByTenant(): Promise<unknown[]> {
    return this.db.sdkWidget.findMany({
      where: { tenantId: this.tenantId },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(id: string): Promise<unknown> {
    logger.info({ tenantId: this.tenantId, widgetId: id }, 'Deleting SDK widget');
    return this.db.sdkWidget.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp && bunx vitest run libs/shared/src/services/sdk-widget-service.test.ts
```

Expected: PASS

- [ ] **Step 5: Export from shared index**

Add to `libs/shared/src/index.ts`:
```typescript
export { SdkWidgetService } from './services/sdk-widget-service';
export type { CreateSdkWidgetInput, SdkWidgetDb } from './services/sdk-widget-service';
```

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/services/sdk-widget-service.ts libs/shared/src/services/sdk-widget-service.test.ts libs/shared/src/index.ts
git commit -m "feat(shared): add SdkWidgetService for widget CRUD

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 3: Shared Services — FeedbackService + CsatService

**Files:**
- Create: `libs/shared/src/services/feedback-service.ts`
- Create: `libs/shared/src/services/feedback-service.test.ts`
- Create: `libs/shared/src/services/csat-service.ts`
- Create: `libs/shared/src/services/csat-service.test.ts`
- Modify: `libs/shared/src/index.ts`

- [ ] **Step 1: Write FeedbackService test**

```typescript
// libs/shared/src/services/feedback-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackService } from './feedback-service';

const mockDb = {
  messageFeedback: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
};

describe('FeedbackService', () => {
  let service: FeedbackService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FeedbackService(mockDb as any);
  });

  it('upserts feedback for a message', async () => {
    mockDb.messageFeedback.upsert.mockResolvedValue({ id: 'f1', rating: 'up' });

    const result = await service.submit({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      rating: 'up',
      comment: 'Great answer',
    });

    expect(mockDb.messageFeedback.upsert).toHaveBeenCalledWith({
      where: { messageId_sessionId: { messageId: 'msg-1', sessionId: 'sess-1' } },
      create: { messageId: 'msg-1', sessionId: 'sess-1', rating: 'up', comment: 'Great answer' },
      update: { rating: 'up', comment: 'Great answer' },
    });
    expect(result).toEqual({ id: 'f1', rating: 'up' });
  });

  it('lists feedback for a session', async () => {
    mockDb.messageFeedback.findMany.mockResolvedValue([{ id: 'f1' }]);

    const result = await service.listBySession('sess-1');

    expect(mockDb.messageFeedback.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
    });
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Write FeedbackService implementation**

```typescript
// libs/shared/src/services/feedback-service.ts
import { createLogger } from '../logging/logger';

const logger = createLogger('feedback-service');

export interface FeedbackDb {
  messageFeedback: {
    upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown> }): Promise<unknown[]>;
  };
}

export interface SubmitFeedbackInput {
  messageId: string;
  sessionId: string;
  rating: 'up' | 'down';
  comment?: string;
}

export class FeedbackService {
  constructor(private readonly db: FeedbackDb) {}

  async submit(input: SubmitFeedbackInput): Promise<unknown> {
    logger.info({ messageId: input.messageId, sessionId: input.sessionId, rating: input.rating }, 'Submitting message feedback');

    return this.db.messageFeedback.upsert({
      where: { messageId_sessionId: { messageId: input.messageId, sessionId: input.sessionId } },
      create: { messageId: input.messageId, sessionId: input.sessionId, rating: input.rating, comment: input.comment },
      update: { rating: input.rating, comment: input.comment },
    });
  }

  async listBySession(sessionId: string): Promise<unknown[]> {
    return this.db.messageFeedback.findMany({ where: { sessionId } });
  }
}
```

- [ ] **Step 3: Write CsatService test**

```typescript
// libs/shared/src/services/csat-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CsatService } from './csat-service';

const mockDb = {
  csatResponse: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
};

describe('CsatService', () => {
  let service: CsatService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CsatService(mockDb as any);
  });

  it('submits CSAT rating for a session', async () => {
    mockDb.csatResponse.upsert.mockResolvedValue({ id: 'c1', rating: 5 });

    const result = await service.submit({
      sessionId: 'sess-1',
      sdkWidgetId: 'w1',
      rating: 5,
      comment: 'Excellent',
    });

    expect(mockDb.csatResponse.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: { sessionId: 'sess-1', sdkWidgetId: 'w1', rating: 5, comment: 'Excellent' },
      update: { rating: 5, comment: 'Excellent' },
    });
    expect(result).toEqual({ id: 'c1', rating: 5 });
  });

  it('finds CSAT by session', async () => {
    mockDb.csatResponse.findUnique.mockResolvedValue({ id: 'c1', rating: 4 });

    const result = await service.findBySession('sess-1');

    expect(result).toEqual({ id: 'c1', rating: 4 });
  });
});
```

- [ ] **Step 4: Write CsatService implementation**

```typescript
// libs/shared/src/services/csat-service.ts
import { createLogger } from '../logging/logger';

const logger = createLogger('csat-service');

export interface CsatDb {
  csatResponse: {
    upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
    findUnique(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<unknown[]>;
  };
}

export interface SubmitCsatInput {
  sessionId: string;
  sdkWidgetId: string;
  rating: number;
  comment?: string;
}

export class CsatService {
  constructor(private readonly db: CsatDb) {}

  async submit(input: SubmitCsatInput): Promise<unknown> {
    logger.info({ sessionId: input.sessionId, rating: input.rating }, 'Submitting CSAT response');

    return this.db.csatResponse.upsert({
      where: { sessionId: input.sessionId },
      create: { sessionId: input.sessionId, sdkWidgetId: input.sdkWidgetId, rating: input.rating, comment: input.comment },
      update: { rating: input.rating, comment: input.comment },
    });
  }

  async findBySession(sessionId: string): Promise<unknown | null> {
    return this.db.csatResponse.findUnique({ where: { sessionId } });
  }

  async listByWidget(sdkWidgetId: string): Promise<unknown[]> {
    return this.db.csatResponse.findMany({ where: { sdkWidgetId } });
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp && bunx vitest run libs/shared/src/services/feedback-service.test.ts libs/shared/src/services/csat-service.test.ts
```

Expected: PASS

- [ ] **Step 6: Export from shared index**

Add to `libs/shared/src/index.ts`:
```typescript
export { FeedbackService } from './services/feedback-service';
export type { SubmitFeedbackInput } from './services/feedback-service';
export { CsatService } from './services/csat-service';
export type { SubmitCsatInput } from './services/csat-service';
```

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/services/feedback-service.ts libs/shared/src/services/feedback-service.test.ts libs/shared/src/services/csat-service.ts libs/shared/src/services/csat-service.test.ts libs/shared/src/index.ts
git commit -m "feat(shared): add FeedbackService and CsatService

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 4: API Route — SDK Config Bootstrap

**Files:**
- Create: `apps/web-ui/app/api/v1/sdk/[sdkId]/config/route.ts`

- [ ] **Step 1: Create the config route**

```typescript
// apps/web-ui/app/api/v1/sdk/[sdkId]/config/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger } from '@chatbot/shared';

const logger = createLogger('api:sdk:config');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sdkId: string }> }
) {
  const { sdkId } = await params;

  try {
    const db = getPrismaClient();
    const widget = await db.sdkWidget.findFirst({
      where: { sdkId, status: 'active' },
      include: {
        apiKey: { select: { keyHash: false, keyPrefix: true, id: true, status: true } },
      },
    });

    if (!widget) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Widget not found or inactive' } },
        { status: 404 }
      );
    }

    // CORS origin validation
    const origin = req.headers.get('origin');
    if (widget.allowedOrigins.length > 0 && origin) {
      const allowed = widget.allowedOrigins.some(
        (o: string) => o === '*' || o === origin || origin.endsWith(o.replace('*.', '.'))
      );
      if (!allowed) {
        logger.warn({ sdkId, origin, allowedOrigins: widget.allowedOrigins }, 'Origin not allowed');
        return NextResponse.json(
          { error: { type: 'forbidden', message: 'Origin not allowed' } },
          { status: 403 }
        );
      }
    }

    // Retrieve the raw API key for the widget to return to the client
    // The widget needs this to call /api/v1/inference directly
    const apiKeyRecord = await db.apiKey.findFirst({
      where: { id: widget.apiKeyId, status: 'active' },
    });

    if (!apiKeyRecord) {
      logger.error({ sdkId, apiKeyId: widget.apiKeyId }, 'Linked API key not found or inactive');
      return NextResponse.json(
        { error: { type: 'configuration_error', message: 'Widget API key is invalid' } },
        { status: 500 }
      );
    }

    const config = {
      agentId: widget.agentId,
      apiKeyPrefix: apiKeyRecord.keyPrefix,
      theme: widget.theme,
      primaryColor: widget.primaryColor,
      secondaryColor: widget.secondaryColor,
      position: widget.position,
      headerText: widget.headerText,
      headerIcon: widget.headerIcon,
      botName: widget.botName,
      botAvatar: widget.botAvatar,
      welcomeMessage: widget.welcomeMessage,
      inputPlaceholder: widget.inputPlaceholder,
      preChatForm: widget.preChatForm,
      quickReplies: widget.quickReplies,
      proactiveRules: widget.proactiveRules,
      kbEnabled: widget.kbEnabled,
      fileUpload: widget.fileUpload,
      csatEnabled: widget.csatEnabled,
      csatType: widget.csatType,
    };

    const headers: Record<string, string> = {
      'Cache-Control': 'public, max-age=300',
    };

    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
    }

    return NextResponse.json(config, { headers });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sdkId }, 'Failed to fetch SDK config');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to fetch config' } },
      { status: 500 }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
```

Note: The API key itself is NOT returned in the config response for security. Instead, the widget will need a separate mechanism to obtain the key. See Task 5 for the session creation flow that handles auth.

**Revised approach:** Since the spec says the config returns the API key, and the current system already exposes keys in HTML attributes, we include it. However, we need to store the raw key somewhere retrievable. The current system only stores the hash. 

**Resolution:** Add a `rawKeyEncrypted` field to ApiKey, or have the SdkWidget store the raw key encrypted. For now, we'll store the raw key (AES-encrypted) on the SdkWidget itself during widget creation. This is set once when the user links an API key in the designer.

Update the route to return the decrypted key from `widget.apiKeyEncrypted` field. This will be addressed in the designer task where the key is stored.

- [ ] **Step 2: Verify route loads**

```bash
bun run build
```

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/v1/sdk/
git commit -m "feat(api): add GET /api/v1/sdk/:sdkId/config endpoint

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 5: API Routes — KB Suggest, Files, CSAT, Feedback

**Files:**
- Create: `apps/web-ui/app/api/v1/inference/sessions/[id]/kb/suggest/route.ts`
- Create: `apps/web-ui/app/api/v1/inference/sessions/[id]/files/route.ts`
- Create: `apps/web-ui/app/api/v1/inference/sessions/[id]/csat/route.ts`
- Create: `apps/web-ui/app/api/v1/inference/sessions/[id]/chat/feedback/route.ts`

- [ ] **Step 1: Create KB suggest route**

```typescript
// apps/web-ui/app/api/v1/inference/sessions/[id]/kb/suggest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../../lib/auth';

const logger = createLogger('api:inference:sessions:kb-suggest');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { id: sessionId } = await params;
  const { agentId, tenantId } = authResult.auth;

  const query = req.nextUrl.searchParams.get('q');
  if (!query || query.length < 3) {
    return NextResponse.json(
      { error: { type: 'validation_error', message: 'Query must be at least 3 characters' } },
      { status: 400 }
    );
  }

  try {
    const db = getPrismaClient();

    // Verify session exists and belongs to this API key
    const session = await db.inferenceSession.findFirst({
      where: { id: sessionId, apiKeyId: authResult.auth.apiKeyId },
    });
    if (!session) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    // Find KB attachments for this agent
    const attachments = await db.agentKnowledgeBase.findMany({
      where: { agentId },
      include: { knowledgeBase: true },
    });

    if (!attachments || attachments.length === 0) {
      return NextResponse.json({ articles: [] });
    }

    const { RetrievalService } = await import('@chatbot/knowledge-base');
    const retrieval = new RetrievalService(tenantId);

    const articles: Array<{ id: string; title: string; snippet: string }> = [];

    for (const att of attachments) {
      const kb = att.knowledgeBase as { id: string; name: string; status: string };
      if (kb.status !== 'active') continue;

      try {
        const results = await retrieval.query(query, {
          knowledgeBaseId: kb.id,
          topK: 3,
        });

        for (const r of results) {
          articles.push({
            id: (r as any).id ?? crypto.randomUUID(),
            title: kb.name,
            snippet: ((r as any).content ?? '').slice(0, 200),
          });
        }
      } catch (err) {
        logger.warn({ err, kbId: kb.id }, 'KB retrieval failed');
      }
    }

    return NextResponse.json({ articles: articles.slice(0, 5) });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sessionId }, 'KB suggest failed');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to fetch suggestions' } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Create file upload route**

```typescript
// apps/web-ui/app/api/v1/inference/sessions/[id]/files/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger, S3Service } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../../lib/auth';

const logger = createLogger('api:inference:sessions:files');

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { id: sessionId } = await params;
  const { tenantId, apiKeyId } = authResult.auth;

  try {
    const db = getPrismaClient();

    // Verify session
    const session = await db.inferenceSession.findFirst({
      where: { id: sessionId, apiKeyId },
    });
    if (!session) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'No file provided' } },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'File exceeds 10MB limit' } },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: { type: 'validation_error', message: `File type ${file.type} not allowed` } },
        { status: 400 }
      );
    }

    const s3 = new S3Service();
    const fileId = crypto.randomUUID();
    const key = `sdk-uploads/${tenantId}/${sessionId}/${fileId}-${file.name}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.upload(key, buffer, file.type);
    const url = await s3.getDownloadUrl(key);

    logger.info({ sessionId, fileId, fileName: file.name, size: file.size }, 'File uploaded');

    return NextResponse.json({
      fileId,
      url,
      mimeType: file.type,
      fileName: file.name,
      size: file.size,
    }, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sessionId }, 'File upload failed');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'File upload failed' } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create CSAT route**

```typescript
// apps/web-ui/app/api/v1/inference/sessions/[id]/csat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger, CsatService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../../lib/auth';

const logger = createLogger('api:inference:sessions:csat');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { id: sessionId } = await params;
  const { apiKeyId } = authResult.auth;

  try {
    const db = getPrismaClient();

    const session = await db.inferenceSession.findFirst({
      where: { id: sessionId, apiKeyId },
    });
    if (!session) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { rating, comment } = body as { rating: number; comment?: string };

    if (typeof rating !== 'number' || rating < 0 || rating > 5) {
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'Rating must be 0-5' } },
        { status: 400 }
      );
    }

    // Find the SdkWidget linked to this session's API key
    const widget = await db.sdkWidget.findFirst({
      where: { apiKeyId },
    });

    if (!widget) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'No widget linked to this API key' } },
        { status: 404 }
      );
    }

    const csatService = new CsatService(db);
    const result = await csatService.submit({
      sessionId,
      sdkWidgetId: widget.id,
      rating,
      comment,
    });

    logger.info({ sessionId, rating }, 'CSAT submitted');
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sessionId }, 'CSAT submission failed');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'CSAT submission failed' } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Create feedback route**

```typescript
// apps/web-ui/app/api/v1/inference/sessions/[id]/chat/feedback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger, FeedbackService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../../../lib/auth';

const logger = createLogger('api:inference:sessions:feedback');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { id: sessionId } = await params;
  const { apiKeyId } = authResult.auth;

  try {
    const db = getPrismaClient();

    const session = await db.inferenceSession.findFirst({
      where: { id: sessionId, apiKeyId },
    });
    if (!session) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { messageId, rating, comment } = body as {
      messageId: string;
      rating: 'up' | 'down';
      comment?: string;
    };

    if (!messageId || !['up', 'down'].includes(rating)) {
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'messageId and rating (up|down) required' } },
        { status: 400 }
      );
    }

    // Verify message belongs to this session
    const message = await db.inferenceSessionMessage.findFirst({
      where: { id: messageId, sessionId },
    });
    if (!message) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Message not found in this session' } },
        { status: 404 }
      );
    }

    const feedbackService = new FeedbackService(db);
    const result = await feedbackService.submit({ messageId, sessionId, rating, comment });

    logger.info({ sessionId, messageId, rating }, 'Feedback submitted');
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sessionId }, 'Feedback submission failed');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Feedback submission failed' } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Verify build**

```bash
bun run build
```

Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/sessions/\[id\]/kb/ apps/web-ui/app/api/v1/inference/sessions/\[id\]/files/ apps/web-ui/app/api/v1/inference/sessions/\[id\]/csat/ apps/web-ui/app/api/v1/inference/sessions/\[id\]/chat/
git commit -m "feat(api): add KB suggest, file upload, CSAT, and feedback endpoints

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 6: Modify Inference API — SSE Streaming Format

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/route.ts`
- Modify: `apps/web-ui/app/api/v1/inference/sessions/route.ts`

- [ ] **Step 1: Add SSE streaming response path**

The existing inference route already supports streaming via `result.toUIMessageStreamResponse()` (Vercel AI SDK format). We need to add a simpler SSE format for the SDK widget that doesn't depend on the Vercel AI SDK client.

Add a new query parameter `format=sse` that returns plain SSE events instead of the Vercel AI SDK stream format.

In `apps/web-ui/app/api/v1/inference/route.ts`, inside the `if (stream)` block (around line 331), add before the existing stream return:

```typescript
    // Check if client wants plain SSE format (for SDK widget / custom clients)
    const sseFormat = req.nextUrl.searchParams.get('format') === 'sse';

    if (stream && sseFormat) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            const result = streamChat({
              provider,
              messages: coreMessages,
              model: effectiveModel,
              system: effectiveSystem,
              temperature: effectiveTemperature,
              maxOutputTokens: effectiveMaxTokens,
              ...(hasMcpTools ? { tools: mcpTools, maxSteps: 5 } : {}),
            });

            let fullText = '';
            for await (const chunk of result.textStream) {
              fullText += chunk;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`)
              );
            }

            const usage = await Promise.resolve(result.usage).catch(() => undefined);
            const tokenUsage = usage
              ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) }
              : undefined;

            await mcpCleanup();
            const completedAt = new Date();
            const latencyMs = completedAt.getTime() - startedAt.getTime();

            if (tokenUsage) await quotaService.incrementUsage(tokenUsage.totalTokens);
            if (cacheEligible) await cacheService.set(cacheKey, { text: fullText, usage: tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });

            // Get the message ID if we persisted to session
            let messageId: string | undefined;
            if (sessionId) {
              const msg = await sessionService.appendMessage(sessionId, {
                role: 'assistant',
                content: fullText,
                tokenCount: tokenUsage?.outputTokens,
              });
              messageId = (msg as any)?.id;
            }

            await db.apiKeyExecution.update({
              where: { id: executionId },
              data: { status: 'completed', output: { text: fullText }, tokenUsage: (tokenUsage ?? null) as any, cacheHit: false, latencyMs, completedAt },
            });

            await deliverWebhook('completed', { text: fullText }, undefined, tokenUsage, latencyMs);

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'done', content: fullText, messageId, usage: tokenUsage })}\n\n`)
            );
            controller.close();
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`)
            );
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Execution-Id': executionId,
          ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
        },
      });
    }
```

- [ ] **Step 2: Add visitor fields to session creation**

In `apps/web-ui/app/api/v1/inference/sessions/route.ts`, extend the POST body parsing:

```typescript
    const { name, channel, channelMetadata, idleMinutes, visitorId, visitorName, visitorEmail, metadata } = body as {
      name?: string;
      channel?: string;
      channelMetadata?: Record<string, unknown> | null;
      idleMinutes?: number;
      visitorId?: string;
      visitorName?: string;
      visitorEmail?: string;
      metadata?: Record<string, unknown>;
    };
```

And pass visitor data as channelMetadata if provided:

```typescript
    const effectiveChannelMetadata = channelMetadata ?? (visitorId ? { visitorId, visitorName, visitorEmail, ...metadata } : null);
    const effectiveChannel = channel ?? (visitorId ? 'SDK' : 'API');

    const session = await service.create({
      apiKeyId,
      tenantId,
      agentId,
      name: name ?? visitorName,
      channel: effectiveChannel,
      channelMetadata: effectiveChannelMetadata,
      idleMinutes,
    });
```

- [ ] **Step 3: Verify build and existing tests pass**

```bash
bun run build && bun run test
```

Expected: Build succeeds, existing tests pass (streaming change is additive, gated by `format=sse` param)

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/route.ts apps/web-ui/app/api/v1/inference/sessions/route.ts
git commit -m "feat(api): add SSE streaming format and visitor fields to inference API

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 7: SDK Widget — Store, Services, Types

**Files:**
- Create: `apps/sdk/src/types/index.ts`
- Create: `apps/sdk/src/store/widget-store.ts`
- Create: `apps/sdk/src/services/storage.service.ts`
- Create: `apps/sdk/src/services/config.service.ts`
- Create: `apps/sdk/src/services/api.service.ts`
- Create: `apps/sdk/src/services/stream.service.ts`
- Create: `apps/sdk/src/services/proactive.service.ts`
- Modify: `apps/sdk/package.json` (add @stencil/store)

- [ ] **Step 1: Install @stencil/store**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk && bun add @stencil/store
```

- [ ] **Step 2: Create types**

```typescript
// apps/sdk/src/types/index.ts
export interface SdkWidgetConfig {
  agentId: string;
  apiKeyPrefix: string;
  theme: 'light' | 'dark' | 'auto';
  primaryColor: string;
  secondaryColor: string;
  position: 'left' | 'right';
  headerText: string;
  headerIcon: string | null;
  botName: string;
  botAvatar: string | null;
  welcomeMessage: string;
  inputPlaceholder: string;
  preChatForm: PreChatField[] | null;
  quickReplies: string[] | null;
  proactiveRules: ProactiveRule[] | null;
  kbEnabled: boolean;
  fileUpload: boolean;
  csatEnabled: boolean;
  csatType: 'thumbs' | 'stars' | 'nps';
}

export interface PreChatField {
  field: string;
  type: 'text' | 'email' | 'phone' | 'select';
  label?: string;
  required: boolean;
  options?: string[];
}

export interface ProactiveRule {
  trigger: 'time' | 'scroll' | 'url';
  delay?: number;
  scrollPercent?: number;
  urlPattern?: string;
  message: string;
}

export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: string;
  status?: 'sending' | 'sent' | 'error' | 'streaming';
  fileAttachment?: FileAttachment | null;
}

export interface FileAttachment {
  fileId: string;
  url: string;
  mimeType: string;
  fileName: string;
  size: number;
}

export interface KbArticle {
  id: string;
  title: string;
  snippet: string;
}

export interface StreamEvent {
  type: 'token' | 'done' | 'error';
  content?: string;
  messageId?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  message?: string;
}

export interface SessionInfo {
  id: string;
  status: string;
  visitorId: string;
}

export interface WidgetState {
  config: SdkWidgetConfig | null;
  apiKey: string | null;
  session: SessionInfo | null;
  messages: Message[];
  uiState: { open: boolean; minimized: boolean; hidden: boolean };
  streaming: { active: boolean; currentTokens: string };
  preChatDone: boolean;
  unreadCount: number;
  kbSuggestions: KbArticle[];
  error: string | null;
}
```

- [ ] **Step 3: Create widget store**

```typescript
// apps/sdk/src/store/widget-store.ts
import { createStore } from '@stencil/store';
import type { WidgetState, Message, KbArticle, SdkWidgetConfig, SessionInfo } from '../types';

const { state, onChange, reset } = createStore<WidgetState>({
  config: null,
  apiKey: null,
  session: null,
  messages: [],
  uiState: { open: false, minimized: false, hidden: false },
  streaming: { active: false, currentTokens: '' },
  preChatDone: false,
  unreadCount: 0,
  kbSuggestions: [],
  error: null,
});

export { state, onChange, reset };

export function setConfig(config: SdkWidgetConfig) {
  state.config = config;
}

export function setApiKey(key: string) {
  state.apiKey = key;
}

export function setSession(session: SessionInfo) {
  state.session = session;
}

export function addMessage(message: Message) {
  state.messages = [...state.messages, message];
}

export function updateLastMessage(content: string) {
  const msgs = [...state.messages];
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') {
    msgs[msgs.length - 1] = { ...last, content, status: 'streaming' };
    state.messages = msgs;
  }
}

export function finalizeLastMessage(messageId: string) {
  const msgs = [...state.messages];
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') {
    msgs[msgs.length - 1] = { ...last, id: messageId, status: 'sent' };
    state.messages = msgs;
  }
}

export function setMessages(messages: Message[]) {
  state.messages = messages;
}

export function setStreaming(active: boolean, currentTokens = '') {
  state.streaming = { active, currentTokens };
}

export function setUiState(partial: Partial<WidgetState['uiState']>) {
  state.uiState = { ...state.uiState, ...partial };
}

export function setPreChatDone(done: boolean) {
  state.preChatDone = done;
}

export function incrementUnread() {
  state.unreadCount = state.unreadCount + 1;
}

export function clearUnread() {
  state.unreadCount = 0;
}

export function setKbSuggestions(articles: KbArticle[]) {
  state.kbSuggestions = articles;
}

export function setError(error: string | null) {
  state.error = error;
}
```

- [ ] **Step 4: Create storage service**

```typescript
// apps/sdk/src/services/storage.service.ts
const PREFIX = 'smc_widget_';

export class StorageService {
  private readonly sdkId: string;

  constructor(sdkId: string) {
    this.sdkId = sdkId;
  }

  private key(name: string): string {
    return `${PREFIX}${this.sdkId}_${name}`;
  }

  getVisitorId(): string {
    const existing = localStorage.getItem(this.key('visitor_id'));
    if (existing) return existing;

    const id = `v_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    localStorage.setItem(this.key('visitor_id'), id);
    return id;
  }

  getSessionId(): string | null {
    return localStorage.getItem(this.key('session_id'));
  }

  setSessionId(id: string): void {
    localStorage.setItem(this.key('session_id'), id);
  }

  clearSession(): void {
    localStorage.removeItem(this.key('session_id'));
  }

  getTheme(): string | null {
    return localStorage.getItem(this.key('theme'));
  }

  setTheme(theme: string): void {
    localStorage.setItem(this.key('theme'), theme);
  }

  getPreChatDone(): boolean {
    return localStorage.getItem(this.key('prechat_done')) === 'true';
  }

  setPreChatDone(done: boolean): void {
    localStorage.setItem(this.key('prechat_done'), String(done));
  }
}
```

- [ ] **Step 5: Create config service**

```typescript
// apps/sdk/src/services/config.service.ts
import type { SdkWidgetConfig } from '../types';

export class ConfigService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async fetchConfig(sdkId: string): Promise<SdkWidgetConfig> {
    const res = await fetch(`${this.baseUrl}/api/v1/sdk/${sdkId}/config`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(err.error?.message ?? `Config fetch failed: ${res.status}`);
    }

    return res.json();
  }
}
```

- [ ] **Step 6: Create API service**

```typescript
// apps/sdk/src/services/api.service.ts
import type { Message, KbArticle, FileAttachment } from '../types';

export class ApiService {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createSession(params: {
    visitorId: string;
    visitorName?: string;
    visitorEmail?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/inference/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        channel: 'SDK',
        ...params,
      }),
    });

    if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
    return res.json();
  }

  async getSession(sessionId: string): Promise<{ id: string; status: string; messages: Array<{ id: string; role: string; content: string; createdAt: string }> } | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}`, {
      headers: this.headers(),
    });

    if (res.status === 410) return null;
    if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
    return res.json();
  }

  async sendMessage(sessionId: string, content: string): Promise<Response> {
    return fetch(`${this.baseUrl}/api/v1/inference?format=sse`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        messages: [{ role: 'user', content }],
        sessionId,
        stream: true,
      }),
    });
  }

  async submitFeedback(sessionId: string, messageId: string, rating: 'up' | 'down'): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}/chat/feedback`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ messageId, rating }),
    });
  }

  async submitCsat(sessionId: string, rating: number, comment?: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}/csat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ rating, comment }),
    });
  }

  async suggestKb(sessionId: string, query: string): Promise<KbArticle[]> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/inference/sessions/${sessionId}/kb/suggest?q=${encodeURIComponent(query)}`,
      { headers: this.headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.articles ?? [];
  }

  async uploadFile(sessionId: string, file: File): Promise<FileAttachment> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!res.ok) throw new Error(`File upload failed: ${res.status}`);
    return res.json();
  }

  async endSession(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/inference/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
  }
}
```

- [ ] **Step 7: Create stream service**

```typescript
// apps/sdk/src/services/stream.service.ts
import type { StreamEvent } from '../types';

export class StreamService {
  async *parseSSE(response: Response): AsyncGenerator<StreamEvent> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: StreamEvent = JSON.parse(line.slice(6));
            yield event;
          } catch {
            // skip malformed events
          }
        }
      }
    }
  }
}
```

- [ ] **Step 8: Create proactive service**

```typescript
// apps/sdk/src/services/proactive.service.ts
import type { ProactiveRule } from '../types';

export class ProactiveService {
  private timers: number[] = [];
  private scrollHandler: (() => void) | null = null;

  evaluate(rules: ProactiveRule[], onTrigger: (message: string) => void): void {
    this.cleanup();

    for (const rule of rules) {
      switch (rule.trigger) {
        case 'time':
          if (rule.delay) {
            const timer = window.setTimeout(() => onTrigger(rule.message), rule.delay);
            this.timers.push(timer);
          }
          break;

        case 'scroll':
          if (rule.scrollPercent) {
            const threshold = rule.scrollPercent;
            this.scrollHandler = () => {
              const scrolled = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
              if (scrolled >= threshold) {
                onTrigger(rule.message);
                if (this.scrollHandler) {
                  window.removeEventListener('scroll', this.scrollHandler);
                  this.scrollHandler = null;
                }
              }
            };
            window.addEventListener('scroll', this.scrollHandler, { passive: true });
          }
          break;

        case 'url':
          if (rule.urlPattern) {
            const regex = new RegExp(rule.urlPattern);
            if (regex.test(window.location.href)) {
              window.setTimeout(() => onTrigger(rule.message), 1000);
            }
          }
          break;
      }
    }
  }

  cleanup(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
  }
}
```

- [ ] **Step 9: Verify SDK builds**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk && bun run build
```

Expected: Build succeeds

- [ ] **Step 10: Commit**

```bash
git add apps/sdk/src/types/ apps/sdk/src/store/ apps/sdk/src/services/ apps/sdk/package.json
git commit -m "feat(sdk): add store, services, and types for widget revamp

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 8: SDK Widget — Core Components (Root, Launcher, Window, Header)

**Files:**
- Delete: `apps/sdk/src/components/smc-chat-widget/` (old monolithic component)
- Create: `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx`
- Create: `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.css`
- Create: `apps/sdk/src/components/smc-launcher/smc-launcher.tsx`
- Create: `apps/sdk/src/components/smc-launcher/smc-launcher.css`
- Create: `apps/sdk/src/components/smc-chat-window/smc-chat-window.tsx`
- Create: `apps/sdk/src/components/smc-chat-window/smc-chat-window.css`
- Create: `apps/sdk/src/components/smc-header/smc-header.tsx`
- Create: `apps/sdk/src/components/smc-header/smc-header.css`

- [ ] **Step 1: Remove old component**

```bash
rm -rf /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk/src/components/smc-chat-widget
rm -f /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk/src/utils/sentence.ts
rm -f /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk/src/types/message.ts
```

- [ ] **Step 2: Create root component**

```typescript
// apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx
import { Component, Prop, h, State, Watch } from '@stencil/core';
import { state, setConfig, setApiKey, setSession, setMessages, setPreChatDone, setUiState } from '../../store/widget-store';
import { ConfigService } from '../../services/config.service';
import { ApiService } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';
import type { Message } from '../../types';

@Component({
  tag: 'smc-chat-widget',
  styleUrl: 'smc-chat-widget.css',
  shadow: true,
})
export class SmcChatWidget {
  @Prop() sdkId!: string;
  @Prop() apiUrl?: string;

  @State() ready = false;
  @State() bootError: string | null = null;

  private storage: StorageService;
  private apiService: ApiService;

  private getBaseUrl(): string {
    if (this.apiUrl) return this.apiUrl;
    const script = document.querySelector('script[src*="smc-chat-widget"]') as HTMLScriptElement;
    if (script) {
      const url = new URL(script.src);
      return url.origin;
    }
    return window.location.origin;
  }

  async componentWillLoad() {
    const baseUrl = this.getBaseUrl();
    this.storage = new StorageService(this.sdkId);

    try {
      const configService = new ConfigService(baseUrl);
      const config = await configService.fetchConfig(this.sdkId);
      setConfig(config);

      // For now, apiKey is the prefix — full key delivery TBD in designer
      setApiKey(config.apiKeyPrefix);

      this.apiService = new ApiService(baseUrl, config.apiKeyPrefix);

      // Check for existing session
      const existingSessionId = this.storage.getSessionId();
      if (existingSessionId) {
        const session = await this.apiService.getSession(existingSessionId);
        if (session && session.status === 'active') {
          setSession({ id: session.id, status: session.status, visitorId: this.storage.getVisitorId() });
          const messages: Message[] = session.messages.map((m) => ({
            id: m.id,
            content: m.content,
            role: m.role as 'user' | 'assistant',
            timestamp: m.createdAt,
            status: 'sent',
          }));
          setMessages(messages);
          setPreChatDone(true);
        } else {
          this.storage.clearSession();
        }
      }

      if (this.storage.getPreChatDone()) {
        setPreChatDone(true);
      }

      this.ready = true;
    } catch (err) {
      this.bootError = err instanceof Error ? err.message : 'Failed to load widget';
    }
  }

  render() {
    if (this.bootError || !this.ready) return null;

    const config = state.config;
    if (!config) return null;

    const cssVars = {
      '--smc-primary': config.primaryColor,
      '--smc-secondary': config.secondaryColor,
    };

    return (
      <div class={`smc-root position-${config.position}`} style={cssVars}>
        <smc-proactive-engine></smc-proactive-engine>
        {state.uiState.open && !state.uiState.minimized ? (
          <smc-chat-window></smc-chat-window>
        ) : null}
        <smc-launcher></smc-launcher>
      </div>
    );
  }
}
```

- [ ] **Step 3: Create root CSS**

```css
/* apps/sdk/src/components/smc-chat-widget/smc-chat-widget.css */
:host {
  --smc-primary: #1a1a2e;
  --smc-secondary: #3b82f6;
  --smc-bg: #ffffff;
  --smc-bg-dark: #1a1a2e;
  --smc-text: #374151;
  --smc-text-light: #6b7280;
  --smc-bubble-user: var(--smc-primary);
  --smc-bubble-bot: #f8f9fa;
  --smc-radius: 18px;
  --smc-font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  font-family: var(--smc-font);
  font-size: 14px;
  line-height: 1.5;
  position: fixed;
  z-index: 2147483647;
  bottom: 20px;
}

.smc-root.position-right {
  right: 20px;
}

.smc-root.position-left {
  left: 20px;
}

@media (max-width: 480px) {
  :host {
    bottom: 0;
    right: 0;
    left: 0;
  }
}
```

- [ ] **Step 4: Create launcher component**

```typescript
// apps/sdk/src/components/smc-launcher/smc-launcher.tsx
import { Component, h, State } from '@stencil/core';
import { state, setUiState, clearUnread } from '../../store/widget-store';

@Component({
  tag: 'smc-launcher',
  styleUrl: 'smc-launcher.css',
  shadow: true,
})
export class SmcLauncher {
  @State() proactiveMessage: string | null = null;

  private handleClick = () => {
    if (state.uiState.open) {
      setUiState({ open: false, minimized: false });
    } else {
      setUiState({ open: true, minimized: false });
      clearUnread();
      this.proactiveMessage = null;
    }
  };

  render() {
    const config = state.config;
    if (!config) return null;

    const isOpen = state.uiState.open;
    const unread = state.unreadCount;

    return (
      <div class="launcher-container">
        {this.proactiveMessage && !isOpen ? (
          <div class="proactive-bubble" onClick={this.handleClick}>
            <p>{this.proactiveMessage}</p>
            <button class="proactive-close" onClick={(e) => { e.stopPropagation(); this.proactiveMessage = null; }}>
              &times;
            </button>
          </div>
        ) : null}
        <button
          class={`launcher-btn ${isOpen ? 'open' : ''}`}
          onClick={this.handleClick}
          aria-label={isOpen ? 'Close chat' : 'Open chat'}
        >
          {isOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          )}
          {unread > 0 && !isOpen ? <span class="badge">{unread}</span> : null}
        </button>
      </div>
    );
  }
}
```

- [ ] **Step 5: Create launcher CSS**

```css
/* apps/sdk/src/components/smc-launcher/smc-launcher.css */
.launcher-container {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.proactive-bubble {
  background: var(--smc-bg, #fff);
  border-radius: 16px 16px 4px 16px;
  padding: 12px 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  max-width: 260px;
  cursor: pointer;
  position: relative;
  animation: slideUp 0.3s ease-out;
}

.proactive-bubble p {
  margin: 0;
  font-size: 13px;
  color: var(--smc-text, #374151);
}

.proactive-close {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: #e5e7eb;
  color: #6b7280;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.launcher-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: var(--smc-primary, #1a1a2e);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.launcher-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
}

.launcher-btn.open {
  background: #6b7280;
}

.badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #ef4444;
  color: white;
  font-size: 11px;
  font-weight: 600;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 6: Create header component**

```typescript
// apps/sdk/src/components/smc-header/smc-header.tsx
import { Component, h } from '@stencil/core';
import { state, setUiState } from '../../store/widget-store';

@Component({
  tag: 'smc-header',
  styleUrl: 'smc-header.css',
  shadow: true,
})
export class SmcHeader {
  private handleMinimize = () => {
    setUiState({ open: false, minimized: true });
  };

  private handleClose = () => {
    setUiState({ open: false, minimized: false, hidden: true });
  };

  render() {
    const config = state.config;
    if (!config) return null;

    return (
      <div class="header">
        <div class="header-left">
          {config.botAvatar ? (
            <img class="avatar" src={config.botAvatar} alt={config.botName} />
          ) : (
            <div class="avatar-placeholder">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </div>
          )}
          <div class="header-info">
            <span class="header-title">{config.headerText}</span>
            <span class="header-status">Online</span>
          </div>
        </div>
        <div class="header-actions">
          <button class="action-btn" onClick={this.handleMinimize} aria-label="Minimize">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button class="action-btn" onClick={this.handleClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 7: Create header CSS**

```css
/* apps/sdk/src/components/smc-header/smc-header.css */
.header {
  background: var(--smc-primary, #1a1a2e);
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 20px 20px 0 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.header-info {
  display: flex;
  flex-direction: column;
}

.header-title {
  color: white;
  font-weight: 600;
  font-size: 14px;
}

.header-status {
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}
```

- [ ] **Step 8: Create chat window component**

```typescript
// apps/sdk/src/components/smc-chat-window/smc-chat-window.tsx
import { Component, h } from '@stencil/core';
import { state } from '../../store/widget-store';

@Component({
  tag: 'smc-chat-window',
  styleUrl: 'smc-chat-window.css',
  shadow: true,
})
export class SmcChatWindow {
  render() {
    const config = state.config;
    if (!config) return null;

    const showPreChat = config.preChatForm && config.preChatForm.length > 0 && !state.preChatDone;

    return (
      <div class="chat-window">
        <smc-header></smc-header>
        <div class="chat-body">
          {showPreChat ? (
            <smc-pre-chat-form></smc-pre-chat-form>
          ) : (
            [
              <smc-message-list></smc-message-list>,
              state.kbSuggestions.length > 0 ? <smc-kb-suggestions></smc-kb-suggestions> : null,
              <smc-quick-replies></smc-quick-replies>,
              <smc-input-bar></smc-input-bar>,
            ]
          )}
        </div>
        {state.config?.csatEnabled && state.session?.status === 'ended' ? (
          <smc-csat-survey></smc-csat-survey>
        ) : null}
      </div>
    );
  }
}
```

- [ ] **Step 9: Create chat window CSS**

```css
/* apps/sdk/src/components/smc-chat-window/smc-chat-window.css */
.chat-window {
  width: 380px;
  height: 600px;
  background: var(--smc-bg, #ffffff);
  border-radius: 20px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: windowSlideUp 0.3s ease-out;
  margin-bottom: 12px;
}

.chat-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@keyframes windowSlideUp {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 480px) {
  .chat-window {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    margin-bottom: 0;
  }
}
```

- [ ] **Step 10: Verify SDK builds**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk && bun run build
```

Expected: Build succeeds (child components not yet created — Stencil handles missing custom elements gracefully)

- [ ] **Step 11: Commit**

```bash
git add apps/sdk/src/components/
git commit -m "feat(sdk): add core components — root, launcher, window, header

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 9: SDK Widget — Message Components (List, Message, Markdown, Typing, Timestamp)

**Files:**
- Create: `apps/sdk/src/components/smc-message-list/smc-message-list.tsx`
- Create: `apps/sdk/src/components/smc-message-list/smc-message-list.css`
- Create: `apps/sdk/src/components/smc-message/smc-message.tsx`
- Create: `apps/sdk/src/components/smc-message/smc-message.css`
- Create: `apps/sdk/src/components/smc-markdown/smc-markdown.tsx`
- Create: `apps/sdk/src/components/smc-markdown/smc-markdown.css`
- Create: `apps/sdk/src/components/smc-typing-indicator/smc-typing-indicator.tsx`
- Create: `apps/sdk/src/components/smc-typing-indicator/smc-typing-indicator.css`
- Create: `apps/sdk/src/components/smc-timestamp/smc-timestamp.tsx`
- Create: `apps/sdk/src/components/smc-timestamp/smc-timestamp.css`
- Create: `apps/sdk/src/components/smc-feedback/smc-feedback.tsx`
- Create: `apps/sdk/src/components/smc-feedback/smc-feedback.css`

- [ ] **Step 1: Create message-list component**

```typescript
// apps/sdk/src/components/smc-message-list/smc-message-list.tsx
import { Component, h, Element } from '@stencil/core';
import { state, onChange } from '../../store/widget-store';

@Component({
  tag: 'smc-message-list',
  styleUrl: 'smc-message-list.css',
  shadow: true,
})
export class SmcMessageList {
  @Element() el: HTMLElement;
  private listEl: HTMLDivElement;

  componentDidLoad() {
    this.scrollToBottom();
    onChange('messages', () => {
      requestAnimationFrame(() => this.scrollToBottom());
    });
  }

  private scrollToBottom() {
    if (this.listEl) {
      this.listEl.scrollTop = this.listEl.scrollHeight;
    }
  }

  render() {
    const messages = state.messages;
    const config = state.config;

    return (
      <div class="message-list" ref={(el) => (this.listEl = el)}>
        {config?.welcomeMessage && messages.length === 0 ? (
          <smc-message
            content={config.welcomeMessage}
            role="assistant"
            timestamp={new Date().toISOString()}
            messageId="welcome"
          ></smc-message>
        ) : null}
        {messages.map((msg, i) => {
          const showTimestamp = i === 0 || this.shouldShowTimestamp(messages[i - 1]?.timestamp, msg.timestamp);
          return [
            showTimestamp ? <smc-timestamp timestamp={msg.timestamp}></smc-timestamp> : null,
            <smc-message
              content={msg.content}
              role={msg.role}
              timestamp={msg.timestamp}
              messageId={msg.id}
              status={msg.status}
            ></smc-message>,
          ];
        })}
        {state.streaming.active ? <smc-typing-indicator></smc-typing-indicator> : null}
      </div>
    );
  }

  private shouldShowTimestamp(prev: string | undefined, current: string): boolean {
    if (!prev) return true;
    const diff = new Date(current).getTime() - new Date(prev).getTime();
    return diff > 5 * 60 * 1000; // 5 minutes
  }
}
```

- [ ] **Step 2: Create message-list CSS**

```css
/* apps/sdk/src/components/smc-message-list/smc-message-list.css */
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scroll-behavior: smooth;
}

.message-list::-webkit-scrollbar {
  width: 4px;
}

.message-list::-webkit-scrollbar-track {
  background: transparent;
}

.message-list::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 2px;
}
```

- [ ] **Step 3: Create message component**

```typescript
// apps/sdk/src/components/smc-message/smc-message.tsx
import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-message',
  styleUrl: 'smc-message.css',
  shadow: true,
})
export class SmcMessage {
  @Prop() content: string;
  @Prop() role: 'user' | 'assistant';
  @Prop() timestamp: string;
  @Prop() messageId: string;
  @Prop() status?: string;

  render() {
    const isUser = this.role === 'user';

    return (
      <div class={`message ${isUser ? 'user' : 'bot'}`}>
        <div class="bubble">
          {isUser ? (
            <span class="text">{this.content}</span>
          ) : (
            <smc-markdown content={this.content}></smc-markdown>
          )}
        </div>
        {!isUser && this.messageId && this.messageId !== 'welcome' && this.status === 'sent' ? (
          <smc-feedback messageId={this.messageId}></smc-feedback>
        ) : null}
      </div>
    );
  }
}
```

- [ ] **Step 4: Create message CSS**

```css
/* apps/sdk/src/components/smc-message/smc-message.css */
.message {
  display: flex;
  flex-direction: column;
  animation: fadeIn 0.2s ease-out;
}

.message.user {
  align-items: flex-end;
}

.message.bot {
  align-items: flex-start;
}

.bubble {
  max-width: 80%;
  padding: 10px 16px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.5;
  word-wrap: break-word;
}

.message.user .bubble {
  background: var(--smc-primary, #1a1a2e);
  color: white;
  border-radius: 18px 18px 4px 18px;
}

.message.bot .bubble {
  background: var(--smc-bubble-bot, #f8f9fa);
  color: var(--smc-text, #374151);
  border-radius: 18px 18px 18px 4px;
}

.text {
  white-space: pre-wrap;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 5: Create markdown component**

```typescript
// apps/sdk/src/components/smc-markdown/smc-markdown.tsx
import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-markdown',
  styleUrl: 'smc-markdown.css',
  shadow: true,
})
export class SmcMarkdown {
  @Prop() content: string;

  private renderMarkdown(text: string): string {
    let html = this.escapeHtml(text);

    // Code blocks (```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Unordered lists
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  render() {
    return <div class="markdown" innerHTML={this.renderMarkdown(this.content)}></div>;
  }
}
```

- [ ] **Step 6: Create markdown CSS**

```css
/* apps/sdk/src/components/smc-markdown/smc-markdown.css */
.markdown {
  font-size: 14px;
  line-height: 1.6;
}

.markdown code {
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 5px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.markdown pre {
  background: #1a1a2e;
  color: #e0e0e0;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.markdown pre code {
  background: none;
  padding: 0;
  color: inherit;
  font-size: 12px;
}

.markdown strong {
  font-weight: 600;
}

.markdown a {
  color: var(--smc-secondary, #3b82f6);
  text-decoration: none;
}

.markdown a:hover {
  text-decoration: underline;
}

.markdown ul, .markdown ol {
  padding-left: 20px;
  margin: 4px 0;
}

.markdown li {
  margin: 2px 0;
}
```

- [ ] **Step 7: Create typing indicator**

```typescript
// apps/sdk/src/components/smc-typing-indicator/smc-typing-indicator.tsx
import { Component, h } from '@stencil/core';

@Component({
  tag: 'smc-typing-indicator',
  styleUrl: 'smc-typing-indicator.css',
  shadow: true,
})
export class SmcTypingIndicator {
  render() {
    return (
      <div class="typing">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    );
  }
}
```

- [ ] **Step 8: Create typing indicator CSS**

```css
/* apps/sdk/src/components/smc-typing-indicator/smc-typing-indicator.css */
.typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  background: var(--smc-bubble-bot, #f8f9fa);
  border-radius: 18px 18px 18px 4px;
  width: fit-content;
}

.dot {
  width: 6px;
  height: 6px;
  background: #9ca3af;
  border-radius: 50%;
  animation: bounce 1.2s infinite;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}
```

- [ ] **Step 9: Create timestamp component**

```typescript
// apps/sdk/src/components/smc-timestamp/smc-timestamp.tsx
import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-timestamp',
  styleUrl: 'smc-timestamp.css',
  shadow: true,
})
export class SmcTimestamp {
  @Prop() timestamp: string;

  private formatTime(ts: string): string {
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  render() {
    return (
      <div class="timestamp">
        <span>{this.formatTime(this.timestamp)}</span>
      </div>
    );
  }
}
```

- [ ] **Step 10: Create timestamp CSS**

```css
/* apps/sdk/src/components/smc-timestamp/smc-timestamp.css */
.timestamp {
  text-align: center;
  padding: 8px 0;
}

.timestamp span {
  background: #f3f4f6;
  color: #6b7280;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 10px;
}
```

- [ ] **Step 11: Create feedback component**

```typescript
// apps/sdk/src/components/smc-feedback/smc-feedback.tsx
import { Component, Prop, h, State } from '@stencil/core';
import { state } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';

@Component({
  tag: 'smc-feedback',
  styleUrl: 'smc-feedback.css',
  shadow: true,
})
export class SmcFeedback {
  @Prop() messageId: string;
  @State() selected: 'up' | 'down' | null = null;

  private async handleFeedback(rating: 'up' | 'down') {
    if (this.selected === rating) return;
    this.selected = rating;

    if (state.session && state.apiKey) {
      const baseUrl = window.location.origin;
      const api = new ApiService(baseUrl, state.apiKey);
      await api.submitFeedback(state.session.id, this.messageId, rating);
    }
  }

  render() {
    return (
      <div class="feedback">
        <button
          class={`fb-btn ${this.selected === 'up' ? 'active' : ''}`}
          onClick={() => this.handleFeedback('up')}
          aria-label="Helpful"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={this.selected === 'up' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
          </svg>
        </button>
        <button
          class={`fb-btn ${this.selected === 'down' ? 'active' : ''}`}
          onClick={() => this.handleFeedback('down')}
          aria-label="Not helpful"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={this.selected === 'down' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
          </svg>
        </button>
      </div>
    );
  }
}
```

- [ ] **Step 12: Create feedback CSS**

```css
/* apps/sdk/src/components/smc-feedback/smc-feedback.css */
.feedback {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  padding-left: 4px;
}

.fb-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.fb-btn:hover {
  background: #f3f4f6;
  color: #6b7280;
}

.fb-btn.active {
  color: var(--smc-secondary, #3b82f6);
  background: rgba(59, 130, 246, 0.08);
}
```

- [ ] **Step 13: Verify SDK builds**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk && bun run build
```

- [ ] **Step 14: Commit**

```bash
git add apps/sdk/src/components/smc-message-list/ apps/sdk/src/components/smc-message/ apps/sdk/src/components/smc-markdown/ apps/sdk/src/components/smc-typing-indicator/ apps/sdk/src/components/smc-timestamp/ apps/sdk/src/components/smc-feedback/
git commit -m "feat(sdk): add message display components — list, bubble, markdown, typing, timestamp, feedback

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 10: SDK Widget — Input Bar, Quick Replies, Pre-chat Form

**Files:**
- Create: `apps/sdk/src/components/smc-input-bar/smc-input-bar.tsx`
- Create: `apps/sdk/src/components/smc-input-bar/smc-input-bar.css`
- Create: `apps/sdk/src/components/smc-quick-replies/smc-quick-replies.tsx`
- Create: `apps/sdk/src/components/smc-quick-replies/smc-quick-replies.css`
- Create: `apps/sdk/src/components/smc-pre-chat-form/smc-pre-chat-form.tsx`
- Create: `apps/sdk/src/components/smc-pre-chat-form/smc-pre-chat-form.css`

- [ ] **Step 1: Create input bar component**

```typescript
// apps/sdk/src/components/smc-input-bar/smc-input-bar.tsx
import { Component, h, State, Element } from '@stencil/core';
import { state, addMessage, setStreaming, updateLastMessage, finalizeLastMessage, setKbSuggestions } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';
import { StreamService } from '../../services/stream.service';

@Component({
  tag: 'smc-input-bar',
  styleUrl: 'smc-input-bar.css',
  shadow: true,
})
export class SmcInputBar {
  @State() text = '';
  @State() sending = false;
  @Element() el: HTMLElement;

  private textareaEl: HTMLTextAreaElement;
  private kbDebounce: ReturnType<typeof setTimeout> | null = null;

  private handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    this.text = target.value;
    this.autoResize(target);

    // KB suggestions debounce
    if (state.config?.kbEnabled && state.session && state.apiKey) {
      if (this.kbDebounce) clearTimeout(this.kbDebounce);
      if (this.text.length >= 3) {
        this.kbDebounce = setTimeout(async () => {
          const baseUrl = window.location.origin;
          const api = new ApiService(baseUrl, state.apiKey!);
          const articles = await api.suggestKb(state.session!.id, this.text);
          setKbSuggestions(articles);
        }, 300);
      } else {
        setKbSuggestions([]);
      }
    }
  };

  private autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  };

  private async send() {
    const content = this.text.trim();
    if (!content || this.sending || !state.session || !state.apiKey) return;

    this.text = '';
    this.sending = true;
    setKbSuggestions([]);

    if (this.textareaEl) {
      this.textareaEl.style.height = 'auto';
    }

    const userMsg = {
      id: `temp_${Date.now()}`,
      content,
      role: 'user' as const,
      timestamp: new Date().toISOString(),
      status: 'sent' as const,
    };
    addMessage(userMsg);

    // Add placeholder for assistant response
    addMessage({
      id: `stream_${Date.now()}`,
      content: '',
      role: 'assistant',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    });

    setStreaming(true);

    try {
      const baseUrl = window.location.origin;
      const api = new ApiService(baseUrl, state.apiKey);
      const response = await api.sendMessage(state.session.id, content);

      const streamService = new StreamService();
      let fullContent = '';

      for await (const event of streamService.parseSSE(response)) {
        if (event.type === 'token' && event.content) {
          fullContent += event.content;
          updateLastMessage(fullContent);
        } else if (event.type === 'done') {
          finalizeLastMessage(event.messageId ?? `msg_${Date.now()}`);
        } else if (event.type === 'error') {
          updateLastMessage('Sorry, something went wrong. Please try again.');
          finalizeLastMessage(`err_${Date.now()}`);
        }
      }
    } catch {
      updateLastMessage('Connection error. Please try again.');
      finalizeLastMessage(`err_${Date.now()}`);
    } finally {
      setStreaming(false);
      this.sending = false;
    }
  }

  private handleFileClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.doc,.docx,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !state.session || !state.apiKey) return;

      const baseUrl = window.location.origin;
      const api = new ApiService(baseUrl, state.apiKey);
      try {
        await api.uploadFile(state.session.id, file);
      } catch {
        // File upload error handled silently
      }
    };
    input.click();
  };

  render() {
    const config = state.config;

    return (
      <div class="input-bar">
        {config?.fileUpload ? (
          <button class="attach-btn" onClick={this.handleFileClick} aria-label="Attach file">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
            </svg>
          </button>
        ) : null}
        <textarea
          ref={(el) => (this.textareaEl = el)}
          class="input-field"
          placeholder={config?.inputPlaceholder ?? 'Write a message...'}
          value={this.text}
          onInput={this.handleInput}
          onKeyDown={this.handleKeyDown}
          rows={1}
          disabled={this.sending}
        ></textarea>
        <button
          class={`send-btn ${this.text.trim() ? 'active' : ''}`}
          onClick={() => this.send()}
          disabled={!this.text.trim() || this.sending}
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="19" x2="12" y2="5"></line>
            <polyline points="5 12 12 5 19 12"></polyline>
          </svg>
        </button>
      </div>
    );
  }
}
```

- [ ] **Step 2: Create input bar CSS**

```css
/* apps/sdk/src/components/smc-input-bar/smc-input-bar.css */
.input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
  background: var(--smc-bg, #fff);
}

.attach-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.attach-btn:hover {
  background: #f3f4f6;
  color: #6b7280;
}

.input-field {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  padding: 8px 0;
  color: var(--smc-text, #374151);
  background: transparent;
  max-height: 120px;
}

.input-field::placeholder {
  color: #9ca3af;
}

.send-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: #e5e7eb;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}

.send-btn.active {
  background: var(--smc-primary, #1a1a2e);
  color: white;
}

.send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
```

- [ ] **Step 3: Create quick replies component**

```typescript
// apps/sdk/src/components/smc-quick-replies/smc-quick-replies.tsx
import { Component, h } from '@stencil/core';
import { state } from '../../store/widget-store';

@Component({
  tag: 'smc-quick-replies',
  styleUrl: 'smc-quick-replies.css',
  shadow: true,
})
export class SmcQuickReplies {
  private handleClick = (text: string) => {
    const inputBar = document.querySelector('smc-chat-widget')
      ?.shadowRoot?.querySelector('smc-chat-window')
      ?.shadowRoot?.querySelector('smc-input-bar');

    if (inputBar) {
      const event = new CustomEvent('smc-quick-reply', { detail: { text }, bubbles: true, composed: true });
      inputBar.dispatchEvent(event);
    }
  };

  render() {
    const replies = state.config?.quickReplies;
    if (!replies || replies.length === 0 || state.messages.length > 0) return null;

    return (
      <div class="quick-replies">
        {replies.map((text) => (
          <button class="chip" onClick={() => this.handleClick(text)}>
            {text}
          </button>
        ))}
      </div>
    );
  }
}
```

- [ ] **Step 4: Create quick replies CSS**

```css
/* apps/sdk/src/components/smc-quick-replies/smc-quick-replies.css */
.quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
}

.chip {
  background: rgba(59, 130, 246, 0.06);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 16px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--smc-secondary, #3b82f6);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.chip:hover {
  background: rgba(59, 130, 246, 0.12);
  border-color: var(--smc-secondary, #3b82f6);
}
```

- [ ] **Step 5: Create pre-chat form component**

```typescript
// apps/sdk/src/components/smc-pre-chat-form/smc-pre-chat-form.tsx
import { Component, h, State } from '@stencil/core';
import { state, setPreChatDone, setSession } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';

@Component({
  tag: 'smc-pre-chat-form',
  styleUrl: 'smc-pre-chat-form.css',
  shadow: true,
})
export class SmcPreChatForm {
  @State() values: Record<string, string> = {};
  @State() errors: Record<string, string> = {};
  @State() submitting = false;

  private handleInput = (field: string, value: string) => {
    this.values = { ...this.values, [field]: value };
    if (this.errors[field]) {
      const newErrors = { ...this.errors };
      delete newErrors[field];
      this.errors = newErrors;
    }
  };

  private async handleSubmit(e: Event) {
    e.preventDefault();
    const fields = state.config?.preChatForm ?? [];

    // Validate
    const errors: Record<string, string> = {};
    for (const field of fields) {
      if (field.required && !this.values[field.field]?.trim()) {
        errors[field.field] = 'Required';
      }
      if (field.type === 'email' && this.values[field.field]) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(this.values[field.field])) {
          errors[field.field] = 'Invalid email';
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      this.errors = errors;
      return;
    }

    this.submitting = true;

    try {
      const sdkId = (document.querySelector('smc-chat-widget') as any)?.sdkId;
      const storage = new StorageService(sdkId);
      const visitorId = storage.getVisitorId();
      const baseUrl = window.location.origin;
      const api = new ApiService(baseUrl, state.apiKey!);

      const session = await api.createSession({
        visitorId,
        visitorName: this.values['name'],
        visitorEmail: this.values['email'],
        metadata: this.values,
      });

      storage.setSessionId(session.id);
      storage.setPreChatDone(true);
      setSession({ id: session.id, status: 'active', visitorId });
      setPreChatDone(true);
    } catch {
      this.errors = { _form: 'Failed to start chat. Please try again.' };
    } finally {
      this.submitting = false;
    }
  }

  render() {
    const fields = state.config?.preChatForm ?? [];

    return (
      <div class="pre-chat">
        <div class="pre-chat-header">
          <h3>{state.config?.welcomeMessage ?? 'Welcome!'}</h3>
          <p>Please fill in your details to start chatting.</p>
        </div>
        <form onSubmit={(e) => this.handleSubmit(e)}>
          {fields.map((field) => (
            <div class="field">
              <label>{field.label ?? field.field}</label>
              {field.type === 'select' ? (
                <select
                  onInput={(e) => this.handleInput(field.field, (e.target as HTMLSelectElement).value)}
                >
                  <option value="">Select...</option>
                  {(field.options ?? []).map((opt) => (
                    <option value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                  placeholder={field.label ?? field.field}
                  value={this.values[field.field] ?? ''}
                  onInput={(e) => this.handleInput(field.field, (e.target as HTMLInputElement).value)}
                />
              )}
              {this.errors[field.field] ? <span class="error">{this.errors[field.field]}</span> : null}
            </div>
          ))}
          {this.errors['_form'] ? <div class="form-error">{this.errors['_form']}</div> : null}
          <button type="submit" class="submit-btn" disabled={this.submitting}>
            {this.submitting ? 'Starting...' : 'Start Chat'}
          </button>
        </form>
      </div>
    );
  }
}
```

- [ ] **Step 6: Create pre-chat form CSS**

```css
/* apps/sdk/src/components/smc-pre-chat-form/smc-pre-chat-form.css */
.pre-chat {
  flex: 1;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.pre-chat-header {
  margin-bottom: 20px;
}

.pre-chat-header h3 {
  margin: 0 0 4px;
  font-size: 16px;
  color: var(--smc-text, #374151);
}

.pre-chat-header p {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
}

form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field label {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  text-transform: capitalize;
}

.field input, .field select {
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.field input:focus, .field select:focus {
  border-color: var(--smc-secondary, #3b82f6);
}

.error {
  font-size: 11px;
  color: #ef4444;
}

.form-error {
  font-size: 12px;
  color: #ef4444;
  text-align: center;
  padding: 8px;
  background: #fef2f2;
  border-radius: 6px;
}

.submit-btn {
  margin-top: 8px;
  padding: 12px;
  background: var(--smc-primary, #1a1a2e);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s;
}

.submit-btn:hover {
  opacity: 0.9;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 7: Verify SDK builds**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk && bun run build
```

- [ ] **Step 8: Commit**

```bash
git add apps/sdk/src/components/smc-input-bar/ apps/sdk/src/components/smc-quick-replies/ apps/sdk/src/components/smc-pre-chat-form/
git commit -m "feat(sdk): add input bar, quick replies, and pre-chat form components

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 11: SDK Widget — KB Suggestions, CSAT Survey, Rich Card, File Preview, Proactive Engine

**Files:**
- Create: `apps/sdk/src/components/smc-kb-suggestions/smc-kb-suggestions.tsx`
- Create: `apps/sdk/src/components/smc-kb-suggestions/smc-kb-suggestions.css`
- Create: `apps/sdk/src/components/smc-csat-survey/smc-csat-survey.tsx`
- Create: `apps/sdk/src/components/smc-csat-survey/smc-csat-survey.css`
- Create: `apps/sdk/src/components/smc-rich-card/smc-rich-card.tsx`
- Create: `apps/sdk/src/components/smc-rich-card/smc-rich-card.css`
- Create: `apps/sdk/src/components/smc-file-preview/smc-file-preview.tsx`
- Create: `apps/sdk/src/components/smc-file-preview/smc-file-preview.css`
- Create: `apps/sdk/src/components/smc-proactive-engine/smc-proactive-engine.tsx`

- [ ] **Step 1: Create KB suggestions component**

```typescript
// apps/sdk/src/components/smc-kb-suggestions/smc-kb-suggestions.tsx
import { Component, h } from '@stencil/core';
import { state, setKbSuggestions } from '../../store/widget-store';

@Component({
  tag: 'smc-kb-suggestions',
  styleUrl: 'smc-kb-suggestions.css',
  shadow: true,
})
export class SmcKbSuggestions {
  private handleDismiss = () => {
    setKbSuggestions([]);
  };

  render() {
    const articles = state.kbSuggestions;
    if (!articles || articles.length === 0) return null;

    return (
      <div class="kb-suggestions">
        <div class="kb-header">
          <span>Related articles</span>
          <button class="dismiss" onClick={this.handleDismiss}>&times;</button>
        </div>
        <div class="kb-list">
          {articles.map((article) => (
            <div class="kb-card">
              <div class="kb-title">{article.title}</div>
              <div class="kb-snippet">{article.snippet}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 2: Create KB suggestions CSS**

```css
/* apps/sdk/src/components/smc-kb-suggestions/smc-kb-suggestions.css */
.kb-suggestions {
  padding: 8px 16px;
  border-top: 1px solid #f0f0f0;
}

.kb-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.kb-header span {
  font-size: 11px;
  font-weight: 500;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dismiss {
  border: none;
  background: none;
  color: #9ca3af;
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
}

.kb-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kb-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.kb-card:hover {
  border-color: var(--smc-secondary, #3b82f6);
}

.kb-title {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}

.kb-snippet {
  font-size: 11px;
  color: #6b7280;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Create CSAT survey component**

```typescript
// apps/sdk/src/components/smc-csat-survey/smc-csat-survey.tsx
import { Component, h, State } from '@stencil/core';
import { state } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';

@Component({
  tag: 'smc-csat-survey',
  styleUrl: 'smc-csat-survey.css',
  shadow: true,
})
export class SmcCsatSurvey {
  @State() rating: number | null = null;
  @State() submitted = false;

  private async handleRate(value: number) {
    this.rating = value;

    if (state.session && state.apiKey) {
      const baseUrl = window.location.origin;
      const api = new ApiService(baseUrl, state.apiKey);
      await api.submitCsat(state.session.id, value);
      this.submitted = true;
    }
  }

  render() {
    const config = state.config;
    if (!config?.csatEnabled) return null;

    if (this.submitted) {
      return (
        <div class="csat">
          <p class="thanks">Thank you for your feedback!</p>
        </div>
      );
    }

    return (
      <div class="csat">
        <p class="csat-prompt">How was your experience?</p>
        {config.csatType === 'thumbs' ? (
          <div class="thumbs">
            <button class={`thumb ${this.rating === 1 ? 'active' : ''}`} onClick={() => this.handleRate(1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={this.rating === 1 ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
              </svg>
            </button>
            <button class={`thumb ${this.rating === 0 ? 'active' : ''}`} onClick={() => this.handleRate(0)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={this.rating === 0 ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
                <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
              </svg>
            </button>
          </div>
        ) : (
          <div class="stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                class={`star ${this.rating && star <= this.rating ? 'active' : ''}`}
                onClick={() => this.handleRate(star)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={this.rating && star <= this.rating ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
}
```

- [ ] **Step 4: Create CSAT survey CSS**

```css
/* apps/sdk/src/components/smc-csat-survey/smc-csat-survey.css */
.csat {
  padding: 16px 20px;
  border-top: 1px solid #f0f0f0;
  text-align: center;
  background: #fafbfc;
}

.csat-prompt {
  margin: 0 0 12px;
  font-size: 13px;
  color: #374151;
  font-weight: 500;
}

.thanks {
  margin: 0;
  font-size: 13px;
  color: #16a34a;
}

.thumbs, .stars {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.thumb, .star {
  width: 40px;
  height: 40px;
  border: 1px solid #e5e7eb;
  background: white;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  transition: all 0.15s;
}

.thumb:hover, .star:hover {
  border-color: var(--smc-secondary, #3b82f6);
  color: var(--smc-secondary, #3b82f6);
}

.thumb.active, .star.active {
  background: rgba(59, 130, 246, 0.08);
  border-color: var(--smc-secondary, #3b82f6);
  color: var(--smc-secondary, #3b82f6);
}
```

- [ ] **Step 5: Create rich card component (placeholder for structured responses)**

```typescript
// apps/sdk/src/components/smc-rich-card/smc-rich-card.tsx
import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-rich-card',
  styleUrl: 'smc-rich-card.css',
  shadow: true,
})
export class SmcRichCard {
  @Prop() cardData: string;

  render() {
    let data: { title?: string; description?: string; buttons?: Array<{ label: string; url?: string }> };
    try {
      data = JSON.parse(this.cardData);
    } catch {
      return null;
    }

    return (
      <div class="rich-card">
        {data.title ? <div class="card-title">{data.title}</div> : null}
        {data.description ? <div class="card-desc">{data.description}</div> : null}
        {data.buttons?.length ? (
          <div class="card-buttons">
            {data.buttons.map((btn) => (
              <a class="card-btn" href={btn.url} target="_blank" rel="noopener">
                {btn.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
}
```

- [ ] **Step 6: Create rich card CSS**

```css
/* apps/sdk/src/components/smc-rich-card/smc-rich-card.css */
.rich-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px 16px;
  margin-top: 6px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #111;
  margin-bottom: 4px;
}

.card-desc {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 10px;
}

.card-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.card-btn {
  padding: 6px 12px;
  border: 1px solid var(--smc-secondary, #3b82f6);
  border-radius: 6px;
  font-size: 12px;
  color: var(--smc-secondary, #3b82f6);
  text-decoration: none;
  transition: all 0.15s;
}

.card-btn:hover {
  background: var(--smc-secondary, #3b82f6);
  color: white;
}
```

- [ ] **Step 7: Create file preview component**

```typescript
// apps/sdk/src/components/smc-file-preview/smc-file-preview.tsx
import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'smc-file-preview',
  styleUrl: 'smc-file-preview.css',
  shadow: true,
})
export class SmcFilePreview {
  @Prop() fileName: string;
  @Prop() fileUrl: string;
  @Prop() mimeType: string;
  @Prop() fileSize: number;

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private isImage(): boolean {
    return this.mimeType?.startsWith('image/');
  }

  render() {
    return (
      <div class="file-preview">
        {this.isImage() ? (
          <img class="preview-img" src={this.fileUrl} alt={this.fileName} loading="lazy" />
        ) : (
          <div class="file-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
        )}
        <div class="file-info">
          <a class="file-name" href={this.fileUrl} target="_blank" rel="noopener">{this.fileName}</a>
          <span class="file-size">{this.formatSize(this.fileSize)}</span>
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 8: Create file preview CSS**

```css
/* apps/sdk/src/components/smc-file-preview/smc-file-preview.css */
.file-preview {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  margin-top: 6px;
  max-width: 220px;
}

.preview-img {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  display: block;
}

.file-icon {
  padding: 16px;
  background: #f9fafb;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}

.file-info {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-name {
  font-size: 12px;
  color: var(--smc-secondary, #3b82f6);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-name:hover {
  text-decoration: underline;
}

.file-size {
  font-size: 10px;
  color: #9ca3af;
}
```

- [ ] **Step 9: Create proactive engine component**

```typescript
// apps/sdk/src/components/smc-proactive-engine/smc-proactive-engine.tsx
import { Component, h } from '@stencil/core';
import { state, incrementUnread } from '../../store/widget-store';
import { ProactiveService } from '../../services/proactive.service';

@Component({
  tag: 'smc-proactive-engine',
  shadow: true,
})
export class SmcProactiveEngine {
  private proactiveService = new ProactiveService();

  componentDidLoad() {
    const rules = state.config?.proactiveRules;
    if (rules && rules.length > 0 && !state.uiState.open) {
      this.proactiveService.evaluate(rules, (message) => {
        if (!state.uiState.open) {
          incrementUnread();
          const launcher = document.querySelector('smc-chat-widget')
            ?.shadowRoot?.querySelector('smc-launcher');
          if (launcher) {
            (launcher as any).proactiveMessage = message;
          }
        }
      });
    }
  }

  disconnectedCallback() {
    this.proactiveService.cleanup();
  }

  render() {
    return null;
  }
}
```

- [ ] **Step 10: Verify SDK builds**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk && bun run build
```

- [ ] **Step 11: Commit**

```bash
git add apps/sdk/src/components/smc-kb-suggestions/ apps/sdk/src/components/smc-csat-survey/ apps/sdk/src/components/smc-rich-card/ apps/sdk/src/components/smc-file-preview/ apps/sdk/src/components/smc-proactive-engine/
git commit -m "feat(sdk): add KB suggestions, CSAT survey, rich card, file preview, proactive engine

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 12: Designer Page Revamp

**Files:**
- Rewrite: `apps/web-ui/app/(dashboard)/sdks/chat-widget/designer/page.tsx`
- Rewrite: `apps/web-ui/app/(dashboard)/sdks/chat-widget/sandbox/page.tsx`
- Create: `apps/web-ui/app/api/v1/sdk-widgets/route.ts` (internal CRUD for dashboard)
- Create: `apps/web-ui/app/api/v1/sdk-widgets/[id]/route.ts`

- [ ] **Step 1: Create internal SDK widget CRUD API (dashboard use)**

```typescript
// apps/web-ui/app/api/v1/sdk-widgets/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger, SdkWidgetService } from '@chatbot/shared';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const logger = createLogger('api:sdk-widgets');

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 });

  try {
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widgets = await service.listByTenant();
    return NextResponse.json(widgets);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to list widgets');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 });

  try {
    const body = await req.json();
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.create(body);
    return NextResponse.json(widget, { status: 201 });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to create widget');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create widget detail API**

```typescript
// apps/web-ui/app/api/v1/sdk-widgets/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger, SdkWidgetService } from '@chatbot/shared';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const logger = createLogger('api:sdk-widgets:detail');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 });

  const { id } = await params;

  try {
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.findById(id);
    if (!widget) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(widget);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get widget');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 });

  const { id } = await params;

  try {
    const body = await req.json();
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.update(id, body);
    return NextResponse.json(widget);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to update widget');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 });

  const { id } = await params;

  try {
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    await service.delete(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to delete widget');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Rewrite designer page**

The designer page is a large React component with tabs. Due to its size, implement it as a client component with the following structure:

```typescript
// apps/web-ui/app/(dashboard)/sdks/chat-widget/designer/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';

interface WidgetConfig {
  id?: string;
  sdkId?: string;
  agentId: string;
  apiKeyId: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  theme: string;
  position: string;
  headerText: string;
  headerIcon: string;
  botName: string;
  botAvatar: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  preChatForm: Array<{ field: string; type: string; required: boolean; label?: string }> | null;
  quickReplies: string[] | null;
  proactiveRules: Array<{ trigger: string; delay?: number; scrollPercent?: number; urlPattern?: string; message: string }> | null;
  kbEnabled: boolean;
  fileUpload: boolean;
  csatEnabled: boolean;
  csatType: string;
  allowedOrigins: string[];
}

export default function DesignerPage() {
  const [config, setConfig] = useState<WidgetConfig>(/* default values */);
  const [agents, setAgents] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [saving, setSaving] = useState(false);
  const [widgetId, setWidgetId] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch existing widget or create new
  useEffect(() => { /* load widget list, agents, api keys */ }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const method = widgetId ? 'PATCH' : 'POST';
      const url = widgetId ? `/api/v1/sdk-widgets/${widgetId}` : '/api/v1/sdk-widgets';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const data = await res.json();
      if (!widgetId) setWidgetId(data.id);
      toast({ title: 'Saved', description: 'Widget configuration saved.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [config, widgetId]);

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Widget Designer</h1>
          <p className="text-muted-foreground">
            Configure and preview your chat widget
            {config.sdkId && <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">{config.sdkId}</code>}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Publish Changes'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Configuration tabs */}
        <Card>
          <Tabs defaultValue="appearance">
            <TabsList className="w-full">
              <TabsTrigger value="appearance">Appearance</TabsTrigger>
              <TabsTrigger value="behavior">Behavior</TabsTrigger>
              <TabsTrigger value="prechat">Pre-chat</TabsTrigger>
              <TabsTrigger value="proactive">Proactive</TabsTrigger>
              <TabsTrigger value="kb">Knowledge Base</TabsTrigger>
              <TabsTrigger value="embed">Embed</TabsTrigger>
            </TabsList>

            <TabsContent value="appearance">
              {/* Agent selector, colors, theme, position, bot name/avatar, header, welcome */}
            </TabsContent>
            <TabsContent value="behavior">
              {/* Quick replies, file upload, CSAT, input placeholder, allowed origins */}
            </TabsContent>
            <TabsContent value="prechat">
              {/* Dynamic field builder */}
            </TabsContent>
            <TabsContent value="proactive">
              {/* Rule builder */}
            </TabsContent>
            <TabsContent value="kb">
              {/* KB toggle, KB selector */}
            </TabsContent>
            <TabsContent value="embed">
              {/* Embed code snippet, SDK ID */}
            </TabsContent>
          </Tabs>
        </Card>

        {/* Right: Live preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              <span>Live Preview</span>
              {/* Mobile/desktop toggle */}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-100 rounded-lg p-4 min-h-[500px] flex items-end justify-end">
              <iframe
                src={`/sdks/chat-widget/sandbox?sdkId=${config.sdkId ?? ''}&preview=true`}
                className="w-[380px] h-[600px] border-0 rounded-2xl shadow-lg"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

Note: This is a structural outline. The full implementation will fill in each TabsContent with the appropriate form fields using shadcn/ui components. Each field updates `config` state, which auto-saves on change.

- [ ] **Step 4: Rewrite sandbox page**

```typescript
// apps/web-ui/app/(dashboard)/sdks/chat-widget/sandbox/page.tsx
'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SandboxPage() {
  const [sdkId, setSdkId] = useState('');
  const [connected, setConnected] = useState(false);

  const handleConnect = () => {
    if (sdkId.trim()) setConnected(true);
  };

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-bold mb-2">Widget Sandbox</h1>
      <p className="text-muted-foreground mb-6">Test your widget with a live SDK ID</p>

      <div className="flex gap-4 mb-6">
        <Input
          placeholder="Enter SDK ID (e.g., sdk_a1b2c3d4)"
          value={sdkId}
          onChange={(e) => setSdkId(e.target.value)}
          className="max-w-md"
        />
        <Button onClick={handleConnect}>Connect</Button>
      </div>

      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>Live Widget</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-50 rounded-lg p-8 min-h-[600px] relative">
              <iframe
                srcDoc={`
                  <!DOCTYPE html>
                  <html>
                  <head><meta charset="utf-8"></head>
                  <body style="margin:0;min-height:100vh;">
                    <script type="module" src="/sdk-assets/smc-chat-widget.esm.js"></script>
                    <smc-chat-widget sdk-id="${sdkId}" api-url="${window.location.origin}"></smc-chat-widget>
                  </body>
                  </html>
                `}
                className="w-full h-[600px] border-0"
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
bun run build
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui/app/api/v1/sdk-widgets/ apps/web-ui/app/\(dashboard\)/sdks/
git commit -m "feat(dashboard): revamp designer page with tab-based config and sandbox

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Task 13: Integration Testing & SDK Build Pipeline

**Files:**
- Modify: `apps/sdk/stencil.config.ts` (ensure all new components are included)
- Modify: `apps/web-ui/public/sdk-assets/` (rebuild output)
- Modify: `package.json` (root — verify sdk:build script)

- [ ] **Step 1: Update stencil.config.ts if needed**

Verify the config auto-discovers components from `src/components/`. StencilJS does this by default, so no changes should be needed. Confirm:

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp/apps/sdk && cat stencil.config.ts
```

- [ ] **Step 2: Full SDK build**

```bash
bun run sdk:build
```

Expected: Build succeeds, files copied to `apps/web-ui/public/sdk-assets/`

- [ ] **Step 3: Run all unit tests**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp && bun run test
```

Expected: All tests pass (shared services + existing tests)

- [ ] **Step 4: Start dev server and verify widget loads**

```bash
cd /Users/kartik/.superset/worktrees/chatbot/sdk-revamp && bun run dev:all
```

Manual verification:
1. Open http://localhost:3005
2. Navigate to SDKs > Chat Widget > Designer
3. Create a new widget (select an agent, API key)
4. Copy the SDK ID
5. Navigate to Sandbox, paste SDK ID, click Connect
6. Verify widget renders with correct theme/colors
7. Verify launcher button appears
8. Click to open — verify chat window opens
9. If pre-chat form configured — verify form shows
10. Send a message — verify streaming response

- [ ] **Step 5: Verify CORS and config endpoint**

```bash
curl -H "Origin: http://localhost:3005" http://localhost:3005/api/v1/sdk/SDK_ID_HERE/config
```

Expected: Returns JSON config with theme, colors, etc.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat(sdk): complete SDK widget revamp — integration verified

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Prisma schema — new models + relations | None |
| 2 | SdkWidgetService | Task 1 |
| 3 | FeedbackService + CsatService | Task 1 |
| 4 | SDK config bootstrap API route | Tasks 1, 2 |
| 5 | KB suggest, files, CSAT, feedback API routes | Tasks 1, 3 |
| 6 | Modify inference API — SSE streaming + visitor fields | Task 1 |
| 7 | SDK store, services, types | None (parallel with 1-6) |
| 8 | SDK core components — root, launcher, window, header | Task 7 |
| 9 | SDK message components — list, bubble, markdown, typing, timestamp, feedback | Task 8 |
| 10 | SDK input bar, quick replies, pre-chat form | Task 8 |
| 11 | SDK KB suggestions, CSAT, rich card, file preview, proactive engine | Task 8 |
| 12 | Designer page revamp + internal CRUD API | Tasks 1, 2 |
| 13 | Integration testing & SDK build pipeline | All above |

**Parallelization:** Tasks 7-11 (SDK widget) can be developed in parallel with Tasks 2-6 (backend) since they have no code dependencies — only runtime dependencies at integration time (Task 13).
