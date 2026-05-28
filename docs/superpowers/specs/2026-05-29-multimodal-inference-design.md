# Multimodal Inference Layer Design

## Overview

Extend the chatbot's inference pipeline to support file attachments (images, PDFs, Word docs, plain text) alongside text messages. This is a unified layer that powers all current modules (inference API, playground) and future channels (WhatsApp, Telegram, SDK).

**Approach:** Content-Parts Extension — a unified content-parts message format with S3 file references, resolved at inference time by a ContentResolver service.

## Unified Message Format

### Input Contract

All channels normalize their input into this format before calling the inference API:

```typescript
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; fileId: string }

interface InferenceRequest {
  sessionId?: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: ContentPart[];
  }>;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  noCache?: boolean;
  alias?: string;
  versionId?: string;
}
```

### Backward Compatibility

If a message has `content: string` (old format), treat it as `[{ type: 'text', text: content }]`. Existing integrations continue to work without changes.

### Database Storage

The `InferenceSessionMessage` model gets a new JSON field for file metadata. The `content` field continues to hold the text portion for searchability and embedding generation.

```prisma
model InferenceSessionMessage {
  // ...existing fields
  content     String    @db.Text          // text portion only (for search/embeddings)
  attachments Json?     @default("[]")    // [{fileId, s3Key, mimeType, fileName, size}]
}
```

Attachment schema:

```typescript
interface MessageAttachment {
  fileId: string;
  s3Key: string;
  mimeType: string;
  fileName: string;
  size: number;
}
```

## ContentResolver Service

A new service in `libs/ai/src/` that resolves file references into LLM-ready content at inference time.

### Responsibilities

1. Fetch file bytes from S3 by s3Key
2. Route by mimeType:
   - **Images** (jpeg, png, gif, webp) → base64-encode, pass as `ImagePart`
   - **PDF** → extract text via `pdf-parse`
   - **Word docs** → extract text via `mammoth`
   - **Plain text** → read directly as string
3. Build Vercel AI SDK `CoreMessage[]` with appropriate content parts
4. For history messages (not the current turn), replace file attachments with placeholder text: `[Attached: filename.pdf]`

### Interface

```typescript
interface ResolvedMessage {
  role: 'user' | 'assistant' | 'system';
  content: CoreMessageContent;
}

class ContentResolver {
  constructor(private s3Service: S3Service) {}

  async resolve(
    messages: StoredMessage[],
    currentTurnIndex: number
  ): Promise<ResolvedMessage[]>
}
```

### Processing Rules

- **Current turn files:** Fully resolved (fetched, extracted/encoded, included as content parts)
- **History turn files:** Replaced with `[Attached: filename.pdf]` text placeholder
- **Token budget:** Extracted text truncated at 50,000 characters with note: `[Document truncated — showing first N characters]`
- **Error fallback:** Failed files substituted with `[File unavailable: filename.pdf]` — never block the request

## Channel Adapters

Each channel translates its native input into the unified content-parts format.

### Web Playground / SDK

Simplest path — frontend composes content-parts directly:

1. User selects file → uploads to `POST /api/v1/inference/sessions/{id}/files` → gets `fileId`
2. User sends message → payload includes `content: [{type: 'text', ...}, {type: 'file', fileId}]`

### WhatsApp Adapter

```typescript
class WhatsAppChannelAdapter {
  async normalize(message: WebhookInboundMessage): Promise<ContentPart[]> {
    const parts: ContentPart[] = [];

    if (message.type === 'text') {
      parts.push({ type: 'text', text: message.text.body });
    }

    if (message.type === 'image' || message.type === 'document') {
      // Download media from Meta API → upload to S3 → get fileId
      const fileId = await this.downloadAndStore(message);
      parts.push({ type: 'file', fileId });

      if (caption) {
        parts.push({ type: 'text', text: caption });
      }
    }

    return parts;
  }
}
```

### Future Channels (Telegram, etc.)

Same pattern: download media from provider API → upload to S3 → normalize to content-parts. The inference layer never knows which channel originated the message.

## Frontend File Upload UX

### Interaction Flow

1. User clicks paperclip icon next to text input
2. File picker opens — filtered to allowed types
3. File uploads immediately to the session files endpoint
4. Chip appears above input showing filename, size, remove button
5. Multiple files allowed (max 5 per message)
6. On send, message includes text + file content-parts

### UI States

- **Uploading** — progress indicator, send button disabled
- **Uploaded** — chip with filename + size, removable
- **Failed** — error state with retry option

### Component Changes

- `chat-input.tsx` — add attachment button, manage pending files, compose content-parts
- New `file-chip.tsx` — attached file display with status/remove
- `onSend` signature changes from `(content: string)` to `(parts: ContentPart[])`

### Constraints

- Max 5 files per message
- Max 10MB per file
- Allowed types: JPEG, PNG, GIF, WebP, PDF, Word (.doc/.docx), plain text
- Images show thumbnail preview; documents show icon + filename

## Error Handling

| Scenario | Behavior |
|----------|----------|
| File not found in S3 | Substitute `[File unavailable: name]`, log warning, continue |
| Text extraction fails (corrupt PDF) | Substitute `[Could not read: name]`, log error, continue |
| File exceeds token budget | Truncate with note, log info |
| Upload in progress when user sends | Block send button until complete |
| Invalid fileId in request | Return 400 with validation error |
| S3 timeout | Retry once (1s timeout), then substitute placeholder |

**Principle:** A failed file attachment never blocks the entire inference request. Degrade gracefully.

## Supported File Types

| Type | MIME Types | Processing |
|------|-----------|------------|
| Images | image/jpeg, image/png, image/gif, image/webp | Base64 encode → ImagePart |
| PDF | application/pdf | Text extraction via pdf-parse |
| Word | application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document | Text extraction via mammoth |
| Plain text | text/plain | Read directly |

## Dependencies

New packages:
- `pdf-parse` — PDF text extraction
- `mammoth` — Word document text extraction

Existing infrastructure leveraged:
- S3Service (file storage)
- File upload endpoint (already validates types/size)
- Vercel AI SDK (supports `ImagePart`, `TextPart` in `CoreMessage[]`)

## Out of Scope

- Audio/video file support
- OCR for scanned PDFs (text extraction only)
- File preview/rendering in conversation history UI (show chip only)
- Real-time collaborative file editing
- File versioning
