# Multimodal Inference Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the inference pipeline to support file attachments (images, PDFs, Word docs, text) alongside text messages, powered by a unified content-parts format.

**Architecture:** Content-Parts Extension — messages carry a `content: ContentPart[]` array. Files are stored in S3 (existing upload endpoint), referenced by fileId in a JSON `attachments` field on `InferenceSessionMessage`. A `ContentResolver` service fetches and processes files at inference time, building Vercel AI SDK multimodal messages.

**Tech Stack:** Prisma (migration), Vercel AI SDK (`CoreMessage`, `ImagePart`, `TextPart`), `pdf-parse`, `mammoth`, S3Service, React (shadcn/ui), Zod

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `prisma/schema.prisma` | Add `attachments` JSON field to `InferenceSessionMessage` |
| Create | `libs/ai/src/content-resolver.ts` | Resolve file references → LLM-ready content parts |
| Create | `libs/ai/src/content-resolver.test.ts` | Unit tests for ContentResolver |
| Modify | `libs/ai/src/index.ts` | Export ContentResolver |
| Modify | `libs/shared/src/services/inference-session-service.ts` | Accept attachments in `appendMessage` |
| Modify | `apps/web-ui/app/api/v1/inference/route.ts` | Accept content-parts format, pass attachments through |
| Modify | `apps/web-ui/app/api/v1/inference/sessions/[id]/files/route.ts` | Return s3Key in response |
| Create | `libs/ai/src/multimodal-types.ts` | Shared types: ContentPart, MessageAttachment |
| Modify | `apps/web-ui/components/chat/chat-input.tsx` | Add file attachment UI |
| Create | `apps/web-ui/components/chat/file-chip.tsx` | File attachment chip component |

---

### Task 1: Shared Multimodal Types

**Files:**
- Create: `libs/ai/src/multimodal-types.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// libs/ai/src/multimodal-types.ts
import { z } from 'zod';

export const textContentPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
});

export const fileContentPartSchema = z.object({
  type: z.literal('file'),
  fileId: z.string().min(1),
});

export const contentPartSchema = z.discriminatedUnion('type', [
  textContentPartSchema,
  fileContentPartSchema,
]);

export const contentPartsMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.union([
    z.string(),
    z.array(contentPartSchema),
  ]),
});

export type TextContentPart = z.infer<typeof textContentPartSchema>;
export type FileContentPart = z.infer<typeof fileContentPartSchema>;
export type ContentPart = z.infer<typeof contentPartSchema>;
export type ContentPartsMessage = z.infer<typeof contentPartsMessageSchema>;

export interface MessageAttachment {
  fileId: string;
  s3Key: string;
  mimeType: string;
  fileName: string;
  size: number;
}

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_EXTRACTED_TEXT_LENGTH = 50_000;
```

- [ ] **Step 2: Export from AI library index**

Add to `libs/ai/src/index.ts`:

```typescript
export {
  contentPartSchema,
  contentPartsMessageSchema,
  type ContentPart,
  type ContentPartsMessage,
  type MessageAttachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_EXTRACTED_TEXT_LENGTH,
} from './multimodal-types';
```

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add libs/ai/src/multimodal-types.ts libs/ai/src/index.ts
git commit -m "feat(ai): add shared multimodal content-parts types and Zod schemas"
```

---

### Task 2: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma` (line 536, after `content` field)

- [ ] **Step 1: Add attachments field to InferenceSessionMessage**

In `prisma/schema.prisma`, add after line 536 (`content String @db.Text`):

```prisma
  attachments Json?     @default("[]")
```

The full model becomes:

```prisma
model InferenceSessionMessage {
  id          String                       @id @default(cuid())
  sessionId   String
  role        String
  content     String                       @db.Text
  attachments Json?                        @default("[]")
  tokenCount  Int?
  embedding   Unsupported("vector(1024)")?
  createdAt   DateTime                     @default(now())

  session InferenceSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  feedback MessageFeedback?

  @@index([sessionId])
  @@index([sessionId, createdAt])
  @@map("inference_session_messages")
}
```

- [ ] **Step 2: Generate Prisma client**

Run: `bunx prisma generate --schema=./prisma/schema.prisma`
Expected: "Generated Prisma Client"

- [ ] **Step 3: Create migration**

Run: `bunx prisma migrate dev --name add_attachments_to_inference_session_messages`
Expected: Migration created and applied

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add attachments JSON field to InferenceSessionMessage"
```

---

### Task 3: Update Session Service to Accept Attachments

**Files:**
- Modify: `libs/shared/src/services/inference-session-service.ts`

- [ ] **Step 1: Update SessionMessageInput interface**

Change the `SessionMessageInput` interface (around line 13):

```typescript
export interface SessionMessageInput {
  role: string;
  content: string;
  tokenCount?: number;
  attachments?: Array<{
    fileId: string;
    s3Key: string;
    mimeType: string;
    fileName: string;
    size: number;
  }>;
}
```

- [ ] **Step 2: Update SessionMessageRecord interface**

Add `attachments` to `SessionMessageRecord`:

```typescript
export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  attachments: unknown;
  tokenCount: number | null;
  createdAt: Date;
}
```

- [ ] **Step 3: Update appendMessage to persist attachments**

In the `appendMessage` method (around line 164), update the `create` call:

```typescript
const created = await this.db.inferenceSessionMessage.create({
  data: {
    sessionId: id,
    role: message.role,
    content: message.content,
    attachments: message.attachments ?? [],
    tokenCount: message.tokenCount ?? null,
  },
});
```

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/services/inference-session-service.ts
git commit -m "feat(shared): accept attachments in session appendMessage"
```

---

### Task 4: Install Document Processing Dependencies

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Install pdf-parse and mammoth**

Run: `bun add pdf-parse mammoth`
Expected: Packages added to dependencies

- [ ] **Step 2: Install type definitions**

Run: `bun add -d @types/pdf-parse`
Expected: Types added to devDependencies (mammoth ships its own types)

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "feat(deps): add pdf-parse and mammoth for document text extraction"
```

---

### Task 5: ContentResolver Service

**Files:**
- Create: `libs/ai/src/content-resolver.ts`
- Create: `libs/ai/src/content-resolver.test.ts`
- Modify: `libs/ai/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/ai/src/content-resolver.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentResolver } from './content-resolver';
import type { MessageAttachment } from './multimodal-types';

const mockDownloadAsBuffer = vi.fn();
const mockS3Service = { downloadAsBuffer: mockDownloadAsBuffer } as any;

describe('ContentResolver', () => {
  let resolver: ContentResolver;

  beforeEach(() => {
    resolver = new ContentResolver(mockS3Service);
    vi.clearAllMocks();
  });

  describe('resolve', () => {
    it('returns text-only messages unchanged', async () => {
      const messages = [
        { role: 'user' as const, content: 'Hello', attachments: [] },
      ];

      const result = await resolver.resolve(messages, 0);

      expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('resolves image attachments on current turn as base64 ImagePart', async () => {
      const pngBuffer = Buffer.from('fake-png-data');
      mockDownloadAsBuffer.mockResolvedValue(pngBuffer);

      const attachments: MessageAttachment[] = [
        { fileId: 'f1', s3Key: 'uploads/f1-test.png', mimeType: 'image/png', fileName: 'test.png', size: 1024 },
      ];
      const messages = [
        { role: 'user' as const, content: 'What is this?', attachments },
      ];

      const result = await resolver.resolve(messages, 0);

      expect(result[0].role).toBe('user');
      expect(result[0].content).toEqual([
        { type: 'text', text: 'What is this?' },
        { type: 'image', image: pngBuffer.toString('base64'), mimeType: 'image/png' },
      ]);
      expect(mockDownloadAsBuffer).toHaveBeenCalledWith('uploads/f1-test.png');
    });

    it('resolves text file attachments as TextPart', async () => {
      const textBuffer = Buffer.from('Hello from file');
      mockDownloadAsBuffer.mockResolvedValue(textBuffer);

      const attachments: MessageAttachment[] = [
        { fileId: 'f2', s3Key: 'uploads/f2-readme.txt', mimeType: 'text/plain', fileName: 'readme.txt', size: 15 },
      ];
      const messages = [
        { role: 'user' as const, content: 'Summarize this', attachments },
      ];

      const result = await resolver.resolve(messages, 0);

      expect(result[0].content).toEqual([
        { type: 'text', text: 'Summarize this' },
        { type: 'text', text: '--- readme.txt ---\nHello from file' },
      ]);
    });

    it('replaces attachments with placeholder for history turns', async () => {
      const attachments: MessageAttachment[] = [
        { fileId: 'f1', s3Key: 'uploads/f1-doc.pdf', mimeType: 'application/pdf', fileName: 'doc.pdf', size: 5000 },
      ];
      const messages = [
        { role: 'user' as const, content: 'Check this', attachments },
        { role: 'assistant' as const, content: 'I see a document', attachments: [] },
        { role: 'user' as const, content: 'What about page 2?', attachments: [] },
      ];

      const result = await resolver.resolve(messages, 2);

      expect(result[0].content).toBe('Check this\n\n[Attached: doc.pdf]');
      expect(mockDownloadAsBuffer).not.toHaveBeenCalled();
    });

    it('substitutes placeholder when S3 fetch fails', async () => {
      mockDownloadAsBuffer.mockRejectedValue(new Error('S3 timeout'));

      const attachments: MessageAttachment[] = [
        { fileId: 'f1', s3Key: 'uploads/f1-img.png', mimeType: 'image/png', fileName: 'img.png', size: 1024 },
      ];
      const messages = [
        { role: 'user' as const, content: 'Look at this', attachments },
      ];

      const result = await resolver.resolve(messages, 0);

      expect(result[0].content).toEqual([
        { type: 'text', text: 'Look at this' },
        { type: 'text', text: '[File unavailable: img.png]' },
      ]);
    });

    it('truncates extracted text exceeding MAX_EXTRACTED_TEXT_LENGTH', async () => {
      const longText = 'x'.repeat(60_000);
      mockDownloadAsBuffer.mockResolvedValue(Buffer.from(longText));

      const attachments: MessageAttachment[] = [
        { fileId: 'f1', s3Key: 'uploads/f1-big.txt', mimeType: 'text/plain', fileName: 'big.txt', size: 60_000 },
      ];
      const messages = [
        { role: 'user' as const, content: 'Read this', attachments },
      ];

      const result = await resolver.resolve(messages, 0);

      const parts = result[0].content as Array<{ type: string; text: string }>;
      const filePart = parts[1];
      expect(filePart.text).toContain('[Document truncated');
      expect(filePart.text.length).toBeLessThan(60_000);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run libs/ai/src/content-resolver.test.ts`
Expected: FAIL — cannot find module `./content-resolver`

- [ ] **Step 3: Implement ContentResolver**

Create `libs/ai/src/content-resolver.ts`:

```typescript
import type { S3Service } from '@chatbot/shared';
import type { MessageAttachment } from './multimodal-types';
import { MAX_EXTRACTED_TEXT_LENGTH } from './multimodal-types';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('content-resolver');

type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface StoredMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments: MessageAttachment[];
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType: ImageMimeType };

export type ResolvedContent = string | ContentPart[];

export interface ResolvedMessage {
  role: 'user' | 'assistant' | 'system';
  content: ResolvedContent;
}

export class ContentResolver {
  constructor(private s3Service: S3Service) {}

  async resolve(
    messages: StoredMessage[],
    currentTurnIndex: number,
  ): Promise<ResolvedMessage[]> {
    const resolved: ResolvedMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isCurrentTurn = i === currentTurnIndex;
      const attachments = msg.attachments ?? [];

      if (attachments.length === 0) {
        resolved.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (!isCurrentTurn) {
        const placeholders = attachments.map((a) => `[Attached: ${a.fileName}]`).join('\n');
        const content = msg.content
          ? `${msg.content}\n\n${placeholders}`
          : placeholders;
        resolved.push({ role: msg.role, content });
        continue;
      }

      const parts: ContentPart[] = [];
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }

      for (const attachment of attachments) {
        const part = await this.resolveAttachment(attachment);
        parts.push(part);
      }

      resolved.push({ role: msg.role, content: parts });
    }

    return resolved;
  }

  private async resolveAttachment(attachment: MessageAttachment): Promise<ContentPart> {
    try {
      const buffer = await this.s3Service.downloadAsBuffer(attachment.s3Key);
      return await this.processBuffer(buffer, attachment);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn({ fileId: attachment.fileId, fileName: attachment.fileName, err: err.message }, 'Failed to fetch file from S3');
      return { type: 'text', text: `[File unavailable: ${attachment.fileName}]` };
    }
  }

  private async processBuffer(buffer: Buffer, attachment: MessageAttachment): Promise<ContentPart> {
    const { mimeType, fileName } = attachment;

    if (mimeType.startsWith('image/')) {
      return {
        type: 'image',
        image: buffer.toString('base64'),
        mimeType: mimeType as ImageMimeType,
      };
    }

    if (mimeType === 'text/plain') {
      const text = buffer.toString('utf-8');
      return { type: 'text', text: this.wrapExtractedText(fileName, text) };
    }

    if (mimeType === 'application/pdf') {
      return await this.extractPdf(buffer, fileName);
    }

    if (
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return await this.extractWord(buffer, fileName);
    }

    return { type: 'text', text: `[Unsupported file type: ${fileName}]` };
  }

  private async extractPdf(buffer: Buffer, fileName: string): Promise<ContentPart> {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      return { type: 'text', text: this.wrapExtractedText(fileName, result.text) };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ fileName, err: err.message }, 'PDF extraction failed');
      return { type: 'text', text: `[Could not read: ${fileName}]` };
    }
  }

  private async extractWord(buffer: Buffer, fileName: string): Promise<ContentPart> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { type: 'text', text: this.wrapExtractedText(fileName, result.value) };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ fileName, err: err.message }, 'Word extraction failed');
      return { type: 'text', text: `[Could not read: ${fileName}]` };
    }
  }

  private wrapExtractedText(fileName: string, text: string): string {
    const truncated = text.length > MAX_EXTRACTED_TEXT_LENGTH
      ? `${text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)}\n\n[Document truncated — showing first ${MAX_EXTRACTED_TEXT_LENGTH} characters]`
      : text;
    return `--- ${fileName} ---\n${truncated}`;
  }
}
```

- [ ] **Step 4: Export ContentResolver from index**

Add to `libs/ai/src/index.ts`:

```typescript
export { ContentResolver, type StoredMessage, type ResolvedMessage, type ResolvedContent } from './content-resolver';
```

- [ ] **Step 5: Run tests**

Run: `bunx vitest run libs/ai/src/content-resolver.test.ts`
Expected: All 6 tests pass

- [ ] **Step 6: Commit**

```bash
git add libs/ai/src/content-resolver.ts libs/ai/src/content-resolver.test.ts libs/ai/src/index.ts
git commit -m "feat(ai): add ContentResolver service for multimodal file processing"
```

---

### Task 6: Update File Upload Endpoint to Return s3Key

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/sessions/[id]/files/route.ts`

- [ ] **Step 1: Add s3Key to the response**

In the file upload route, the response currently returns `{ fileId, url, mimeType, fileName, size }`. Add `s3Key` so the client can include it when composing content-parts:

Change the response (around line 72) from:

```typescript
return NextResponse.json({
  fileId,
  url,
  mimeType: file.type,
  fileName: file.name,
  size: file.size,
}, { status: 201 });
```

To:

```typescript
return NextResponse.json({
  fileId,
  s3Key: key,
  url,
  mimeType: file.type,
  fileName: file.name,
  size: file.size,
}, { status: 201 });
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/sessions/[id]/files/route.ts
git commit -m "feat(api): return s3Key in file upload response for content-parts linking"
```

---

### Task 7: Update Inference Route to Accept Content-Parts

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/route.ts`

- [ ] **Step 1: Add imports for multimodal types and ContentResolver**

At the top of the file, add:

```typescript
import {
  ContentResolver,
  contentPartsMessageSchema,
  type ContentPart,
  type MessageAttachment,
} from '@chatbot/ai';
import { S3Service } from '@chatbot/shared';
import { z } from 'zod';
```

- [ ] **Step 2: Update the request body parsing**

The client sends full attachment metadata (received from the upload endpoint) alongside the message. This avoids needing to look up file metadata at inference time.

Replace the body type assertion (lines 72-93) with:

```typescript
const body = await req.json();

// Normalize: support both legacy string content and new content-parts format
const rawMessages: Array<{ role: string; content?: string | ContentPart[]; attachments?: MessageAttachment[] }> = body.messages ?? [];

const messages: Array<{ role: string; content: string; attachments: MessageAttachment[] }> = rawMessages.map((msg) => {
  if (typeof msg.content === 'string' || msg.content === undefined) {
    return {
      role: msg.role,
      content: msg.content ?? '',
      attachments: msg.attachments ?? [],
    };
  }

  // content-parts format: extract text and file references
  const textParts: string[] = [];
  const fileAttachments: MessageAttachment[] = msg.attachments ?? [];

  for (const part of msg.content) {
    if (part.type === 'text') {
      textParts.push(part.text);
    }
  }

  return {
    role: msg.role,
    content: textParts.join('\n'),
    attachments: fileAttachments,
  };
});

const {
  sessionId,
  systemPrompt,
  temperature,
  maxTokens,
  stream = true,
  noCache = false,
  alias,
  versionId: requestedVersionId,
} = body as {
  sessionId?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  noCache?: boolean;
  alias?: string;
  versionId?: string;
};
```

- [ ] **Step 3: Update session message persistence to include attachments**

In the session loading block (around line 178), update the appendMessage call:

```typescript
// Append the inbound user turn(s) to the session before invoking the model
for (const msg of messages) {
  if (msg.role === 'user') {
    await sessionService.appendMessage(sessionId, {
      role: 'user',
      content: msg.content,
      attachments: msg.attachments.length > 0 ? msg.attachments : undefined,
    });
  }
}
```

- [ ] **Step 4: Update prior messages loading to include attachments**

Update the priorMessages mapping (around line 164):

```typescript
priorMessages = (session.messages ?? []).map((m) => ({
  role: m.role,
  content: m.content,
  attachments: (m.attachments as MessageAttachment[]) ?? [],
}));
```

And update the type of `priorMessages`:

```typescript
let priorMessages: Array<{ role: string; content: string; attachments: MessageAttachment[] }> = [];
```

- [ ] **Step 5: Add ContentResolver before LLM invocation**

Before the `streamChat` call in the simple agent execution block (around line 248), add content resolution:

```typescript
// Resolve multimodal content for the current turn
const s3Service = new S3Service();
const contentResolver = new ContentResolver(s3Service);

const allMessages = sessionId ? [...priorMessages, ...messages] : messages;
const currentTurnIndex = allMessages.length - 1;

const storedMessages = allMessages.map((m) => ({
  role: m.role as 'user' | 'assistant' | 'system',
  content: m.content,
  attachments: m.attachments ?? [],
}));

const resolvedMessages = await contentResolver.resolve(storedMessages, currentTurnIndex);
```

Then pass `resolvedMessages` to `streamChat` instead of the raw `sessionMessages`.

- [ ] **Step 6: Verify build**

Run: `bun run build`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/route.ts
git commit -m "feat(api): accept content-parts format in inference route with multimodal resolution"
```

---

### Task 8: File Chip Component

**Files:**
- Create: `apps/web-ui/components/chat/file-chip.tsx`

- [ ] **Step 1: Create the FileChip component**

Create `apps/web-ui/components/chat/file-chip.tsx`:

```typescript
'use client';

import { X, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type FileChipStatus = 'uploading' | 'uploaded' | 'failed';

interface FileChipProps {
  fileName: string;
  size: number;
  mimeType: string;
  status: FileChipStatus;
  previewUrl?: string;
  onRemove: () => void;
  onRetry?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return ImageIcon;
  return FileText;
}

export function FileChip({ fileName, size, mimeType, status, previewUrl, onRemove, onRetry }: FileChipProps) {
  const Icon = getFileIcon(mimeType);
  const isImage = mimeType.startsWith('image/');

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
      {isImage && previewUrl ? (
        <img
          src={previewUrl}
          alt={fileName}
          className="h-8 w-8 rounded object-cover"
        />
      ) : (
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {status === 'uploading' && 'Uploading...'}
          {status === 'uploaded' && formatFileSize(size)}
          {status === 'failed' && (
            <span className="text-destructive">
              Failed{' '}
              {onRetry && (
                <button onClick={onRetry} className="underline">
                  Retry
                </button>
              )}
            </span>
          )}
        </p>
      </div>

      {status === 'uploading' && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/chat/file-chip.tsx
git commit -m "feat(ui): add FileChip component for attachment display"
```

---

### Task 9: Update Chat Input with File Upload

**Files:**
- Modify: `apps/web-ui/components/chat/chat-input.tsx`

- [ ] **Step 1: Rewrite chat-input.tsx with file attachment support**

Replace the full content of `apps/web-ui/components/chat/chat-input.tsx`:

```typescript
'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SendHorizontal, Paperclip } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { FileChip, type FileChipStatus } from './file-chip';
import type { MessageAttachment } from '@chatbot/ai';

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

interface PendingFile {
  id: string;
  file: File;
  status: FileChipStatus;
  previewUrl?: string;
  attachment?: MessageAttachment;
}

export interface ContentPart {
  type: 'text' | 'file';
  text?: string;
  fileId?: string;
}

interface ChatInputProps {
  onSend: (content: string, attachments: MessageAttachment[]) => void;
  isLoading: boolean;
  sessionId?: string;
  onUploadFile?: (file: File) => Promise<MessageAttachment>;
}

export function ChatInput({ onSend, isLoading, sessionId, onUploadFile }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUploading = pendingFiles.some((f) => f.status === 'uploading');
  const canSend = (input.trim() || pendingFiles.some((f) => f.status === 'uploaded')) && !isLoading && !isUploading;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;

    const attachments = pendingFiles
      .filter((f) => f.status === 'uploaded' && f.attachment)
      .map((f) => f.attachment!);

    onSend(input.trim(), attachments);
    setInput('');
    setPendingFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        const attachments = pendingFiles
          .filter((f) => f.status === 'uploaded' && f.attachment)
          .map((f) => f.attachment!);

        onSend(input.trim(), attachments);
        setInput('');
        setPendingFiles([]);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = '';

    const availableSlots = MAX_FILES - pendingFiles.length;
    const filesToAdd = files.slice(0, availableSlots);

    for (const file of filesToAdd) {
      if (!ALLOWED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_SIZE) continue;

      const id = crypto.randomUUID();
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;

      const pending: PendingFile = { id, file, status: 'uploading', previewUrl };
      setPendingFiles((prev) => [...prev, pending]);

      if (onUploadFile) {
        try {
          const attachment = await onUploadFile(file);
          setPendingFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, status: 'uploaded' as const, attachment } : f))
          );
        } catch {
          setPendingFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, status: 'failed' as const } : f))
          );
        }
      }
    }
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const retryFile = async (id: string) => {
    const pending = pendingFiles.find((f) => f.id === id);
    if (!pending || !onUploadFile) return;

    setPendingFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'uploading' as const } : f))
    );

    try {
      const attachment = await onUploadFile(pending.file);
      setPendingFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: 'uploaded' as const, attachment } : f))
      );
    } catch {
      setPendingFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: 'failed' as const } : f))
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t bg-background/80 px-4 py-3 backdrop-blur-sm">
      {pendingFiles.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
          {pendingFiles.map((f) => (
            <FileChip
              key={f.id}
              fileName={f.file.name}
              size={f.file.size}
              mimeType={f.file.type}
              status={f.status}
              previewUrl={f.previewUrl}
              onRemove={() => removeFile(f.id)}
              onRetry={() => retryFile(f.id)}
            />
          ))}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-muted/40 p-2 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-background focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={ALLOWED_TYPES.join(',')}
          multiple
          onChange={handleFileSelect}
        />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl"
                disabled={isLoading || pendingFiles.length >= MAX_FILES}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent side="top">
            <p>Attach file (max {MAX_FILES})</p>
          </TooltipContent>
        </Tooltip>

        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder={isLoading ? 'Assistant is typing...' : 'Type a message...'}
          disabled={isLoading}
          rows={1}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed placeholder:text-muted-foreground/60"
        />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="submit"
                size="icon"
                disabled={!canSend}
                className="h-9 w-9 shrink-0 rounded-xl transition-all disabled:opacity-40"
              >
                {isLoading ? (
                  <Spinner />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
              </Button>
            }
          />
          <TooltipContent side="top">
            <p>{isLoading ? 'Sending...' : 'Send message'}</p>
            <p className="text-[10px] text-muted-foreground">Shift + Enter for new line</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
        Press Enter to send, Shift + Enter for a new line
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Update all consumers of ChatInput**

Find all files that use `<ChatInput` and update the `onSend` prop signature. The old signature was `(content: string) => void`. The new signature is `(content: string, attachments: MessageAttachment[]) => void`.

Search: `grep -r "onSend" apps/web-ui/components/chat/ apps/web-ui/app/`

For each consumer, update the handler to accept the second `attachments` parameter and include it in the API request body.

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/components/chat/chat-input.tsx
git commit -m "feat(ui): add file attachment support to ChatInput component"
```

---

### Task 10: Integration Test — End-to-End Multimodal Flow

**Files:**
- Create: `libs/ai/src/content-resolver.integration.test.ts`

- [ ] **Step 1: Write integration test for the full flow**

Create `libs/ai/src/content-resolver.integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ContentResolver } from './content-resolver';
import type { MessageAttachment } from './multimodal-types';

describe('ContentResolver integration', () => {
  it('handles a mixed conversation with text and image attachments', async () => {
    const mockS3 = {
      downloadAsBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image-bytes')),
    } as any;

    const resolver = new ContentResolver(mockS3);

    const messages = [
      {
        role: 'user' as const,
        content: 'Hello',
        attachments: [] as MessageAttachment[],
      },
      {
        role: 'assistant' as const,
        content: 'Hi! How can I help?',
        attachments: [] as MessageAttachment[],
      },
      {
        role: 'user' as const,
        content: 'What is in this image?',
        attachments: [
          {
            fileId: 'img-1',
            s3Key: 'sdk-uploads/tenant1/session1/img-1-photo.png',
            mimeType: 'image/png',
            fileName: 'photo.png',
            size: 2048,
          },
        ],
      },
    ];

    const result = await resolver.resolve(messages, 2);

    // First two messages are text-only
    expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(result[1]).toEqual({ role: 'assistant', content: 'Hi! How can I help?' });

    // Third message (current turn) has image content part
    expect(result[2].role).toBe('user');
    expect(Array.isArray(result[2].content)).toBe(true);
    const parts = result[2].content as Array<{ type: string }>;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'text', text: 'What is in this image?' });
    expect(parts[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('handles history messages with attachments as placeholders', async () => {
    const mockS3 = { downloadAsBuffer: vi.fn() } as any;
    const resolver = new ContentResolver(mockS3);

    const messages = [
      {
        role: 'user' as const,
        content: 'Check this doc',
        attachments: [
          {
            fileId: 'doc-1',
            s3Key: 'sdk-uploads/t/s/doc-1-report.pdf',
            mimeType: 'application/pdf',
            fileName: 'report.pdf',
            size: 5000,
          },
        ],
      },
      {
        role: 'assistant' as const,
        content: 'I see a report about Q4 earnings.',
        attachments: [] as MessageAttachment[],
      },
      {
        role: 'user' as const,
        content: 'Summarize page 3',
        attachments: [] as MessageAttachment[],
      },
    ];

    const result = await resolver.resolve(messages, 2);

    // History turn with attachment gets placeholder
    expect(result[0].content).toBe('Check this doc\n\n[Attached: report.pdf]');
    // S3 was never called (history turns don't fetch)
    expect(mockS3.downloadAsBuffer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bunx vitest run libs/ai/src/content-resolver.integration.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add libs/ai/src/content-resolver.integration.test.ts
git commit -m "test(ai): add integration tests for multimodal ContentResolver"
```

---

### Task 11: Verify Full Build and Run Tests

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All unit tests pass across shared, ai, and workers

- [ ] **Step 2: Run full build**

Run: `bun run build`
Expected: All projects build successfully

- [ ] **Step 3: Manual verification**

Start the dev server and verify:
1. The playground chat input shows a paperclip attachment button
2. Clicking it opens a file picker filtered to allowed types
3. Selecting a file shows a chip above the input
4. Sending a message with an attachment includes it in the API request

Run: `bun run dev`

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address build/test issues from multimodal integration"
```

---
