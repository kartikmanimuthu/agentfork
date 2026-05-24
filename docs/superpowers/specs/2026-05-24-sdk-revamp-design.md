# SDK Chat Widget Revamp — Design Spec

**Date:** 2026-05-24
**Status:** Approved
**Branch:** sdk-revamp

## Overview

Full revamp of the embeddable chat widget SDK. Replaces the current monolithic StencilJS component with a modular, feature-rich widget that operates on a single `sdk-id` attribute — zero configuration in the embed code. All visual and behavioral config is fetched dynamically from the backend at runtime.

### Goals

- Zero-config embed: `<smc-chat-widget sdk-id="sdk_xxx"></smc-chat-widget>`
- API-first: SDK is decoupled from the widget — any custom SDK can consume the same APIs
- Full-featured platform widget: streaming, rich messages, pre-chat forms, file uploads, KB suggestions, proactive triggers, CSAT surveys
- Warm conversational visual style: rounded, emoji-friendly, quick reply chips
- 1 SDK = 1 Agent model: each SdkWidget maps to exactly one agent
- Reuse existing inference API — no duplicate inference logic

### Non-Goals

- Multi-agent routing within a single widget
- Agent handoff to human operators
- Real-time WebSocket (SSE streaming is sufficient)
- Mobile native SDKs (web only for now)

---

## Architecture

### API-First Design

The widget is one consumer of a generic inference API. Any client (custom React app, mobile SDK, Postman) can use the same endpoints. Only the config bootstrap is SDK-specific.

```
Widget boots  → GET /api/v1/sdk/:sdkId/config           (SDK-specific, returns config + apiKey)
Chat          → POST /api/v1/inference                   (existing, API key auth, SSE streaming)
Session       → POST /api/v1/inference/sessions          (existing)
History       → GET /api/v1/inference/sessions/:id       (existing)
KB suggest    → GET /api/v1/inference/sessions/:id/kb/suggest    (new)
File upload   → POST /api/v1/inference/sessions/:id/files       (new)
CSAT          → POST /api/v1/inference/sessions/:id/csat        (new)
Feedback      → POST /api/v1/inference/sessions/:id/chat/feedback (new)
```

The SDK Gateway (`/api/v1/sdk/:sdkId/config`) is the only SDK-specific route. It returns all configuration plus the API key. From that point, the widget uses the standard inference API directly.

### Security Model

- **SDK ID** — public, safe to expose in HTML. Config endpoint validates Origin against `allowedOrigins`.
- **API Key** — returned by /config, scoped to `inference:read`, rate-limited per SdkWidget settings.
- **CORS** — config endpoint validates request Origin. Blocks unauthorized domains.
- **Rate limiting** — existing per-API-key limits, plus per-widget RPM override.
- **Input validation** — server-side message length limits, content filtering on inference API.

---

## Data Model

### New: SdkWidget

```prisma
model SdkWidget {
  id              String   @id @default(cuid())
  tenantId        String
  agentId         String
  apiKeyId        String
  name            String
  sdkId           String   @unique

  // Theme & Appearance
  primaryColor    String   @default("#1a1a2e")
  secondaryColor  String   @default("#3b82f6")
  theme           String   @default("auto")       // light | dark | auto
  position        String   @default("right")      // left | right
  headerText      String   @default("Hey there! 👋")
  headerIcon      String?
  botName         String   @default("AI Assistant")
  botAvatar       String?
  welcomeMessage  String   @default("How can I help you today?")
  inputPlaceholder String  @default("Write a message...")
  customCss       String?

  // Behavior
  preChatForm     Json?
  quickReplies    Json?
  proactiveRules  Json?
  kbEnabled       Boolean  @default(false)
  fileUpload      Boolean  @default(false)
  csatEnabled     Boolean  @default(false)
  csatType        String   @default("thumbs")     // thumbs | stars | nps

  // Security
  allowedOrigins  String[]
  rateLimitRpm    Int      @default(60)

  // Status
  status          String   @default("active")     // active | paused | archived
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relations
  tenant          Tenant   @relation(fields: [tenantId], references: [id])
  agent           Agent    @relation(fields: [agentId], references: [id])
  apiKey          ApiKey   @relation(fields: [apiKeyId], references: [id])
  sessions        SdkSession[]
  csatResponses   CsatResponse[]

  @@map("sdk_widgets")
}
```

### New: SdkSession

```prisma
model SdkSession {
  id                  String   @id @default(cuid())
  sdkWidgetId         String
  inferenceSessionId  String
  visitorId           String
  visitorName         String?
  visitorEmail        String?
  metadata            Json?
  status              String   @default("active")  // active | ended
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  // Relations
  sdkWidget           SdkWidget        @relation(fields: [sdkWidgetId], references: [id])
  inferenceSession    InferenceSession  @relation(fields: [inferenceSessionId], references: [id])

  @@map("sdk_sessions")
}
```

### New: MessageFeedback

```prisma
model MessageFeedback {
  id         String   @id @default(cuid())
  messageId  String
  sessionId  String
  rating     String                              // up | down
  comment    String?
  createdAt  DateTime @default(now())

  message    InferenceSessionMessage @relation(fields: [messageId], references: [id])
  session    InferenceSession        @relation(fields: [sessionId], references: [id])

  @@unique([messageId, sessionId])
  @@map("message_feedbacks")
}
```

### New: CsatResponse

```prisma
model CsatResponse {
  id         String   @id @default(cuid())
  sessionId  String
  sdkWidgetId String
  rating     Int                                 // 1-5 for stars/NPS, 1 or 0 for thumbs
  comment    String?
  createdAt  DateTime @default(now())

  session    InferenceSession @relation(fields: [sessionId], references: [id])
  sdkWidget  SdkWidget        @relation(fields: [sdkWidgetId], references: [id])

  @@unique([sessionId])
  @@map("csat_responses")
}
```

### Modified Models

- **Agent** — add `sdkWidgets SdkWidget[]` relation
- **ApiKey** — add `sdkWidget SdkWidget?` relation
- **InferenceSession** — add `sdkSession SdkSession?`, `feedbacks MessageFeedback[]`, `csatResponse CsatResponse?` relations
- **InferenceSessionMessage** — add `feedback MessageFeedback?` relation

---

## API Endpoints

### GET /api/v1/sdk/:sdkId/config

Public endpoint. Returns widget configuration for bootstrap.

**Auth:** None (CORS origin validation only)
**Cache:** CDN-friendly, 5-minute TTL

**Response:**
```json
{
  "agentId": "clx...",
  "apiKey": "sk_live_...",
  "theme": "auto",
  "primaryColor": "#1a1a2e",
  "secondaryColor": "#3b82f6",
  "position": "right",
  "headerText": "Hey there! 👋",
  "botName": "AI Assistant",
  "botAvatar": "https://...",
  "welcomeMessage": "How can I help you today?",
  "inputPlaceholder": "Write a message...",
  "preChatForm": [
    { "field": "name", "type": "text", "required": true },
    { "field": "email", "type": "email", "required": true }
  ],
  "quickReplies": ["Pricing plans", "Refund policy", "Talk to support"],
  "proactiveRules": [
    { "trigger": "time", "delay": 5000, "message": "Need help? I'm here!" }
  ],
  "kbEnabled": true,
  "fileUpload": true,
  "csatEnabled": true,
  "csatType": "thumbs"
}
```

### GET /api/v1/inference/sessions/:id/kb/suggest

Returns KB articles matching a query for deflection.

**Auth:** API key (Authorization: Bearer)
**Query:** `?q=billing+issue`

**Response:**
```json
{
  "articles": [
    { "id": "...", "title": "Billing FAQ", "snippet": "...", "url": "..." },
    { "id": "...", "title": "Refund Policy", "snippet": "...", "url": "..." }
  ]
}
```

### POST /api/v1/inference/sessions/:id/files

Upload a file attachment.

**Auth:** API key
**Content-Type:** multipart/form-data
**Limits:** 10MB max, allowed types: image/*, .pdf, .doc, .docx, .txt

**Response:**
```json
{
  "fileId": "...",
  "url": "https://s3.../...",
  "mimeType": "image/png",
  "fileName": "screenshot.png",
  "size": 245000
}
```

### POST /api/v1/inference/sessions/:id/csat

Submit satisfaction rating after session ends.

**Auth:** API key
**Body:**
```json
{
  "rating": 1,
  "comment": "Very helpful!"
}
```

### POST /api/v1/inference/sessions/:id/chat/feedback

Submit per-message feedback.

**Auth:** API key
**Body:**
```json
{
  "messageId": "clx...",
  "rating": "up",
  "comment": "Great answer"
}
```

### Modified: POST /api/v1/inference

Add SSE streaming response format. When `stream: true`:

**Response (text/event-stream):**
```
data: {"type":"token","content":"Hello"}
data: {"type":"token","content":" there"}
data: {"type":"done","content":"Hello there","messageId":"clx...","usage":{"inputTokens":10,"outputTokens":5}}
```

### Modified: POST /api/v1/inference/sessions

Accept additional fields for SDK visitors:

**Body additions:**
```json
{
  "visitorId": "v_abc123",
  "visitorName": "John",
  "visitorEmail": "john@example.com",
  "metadata": { "page": "/pricing", "referrer": "google" }
}
```

---

## Widget Component Architecture

StencilJS rewrite with modular component tree. Shadow DOM for style isolation.

### Component Tree

```
<smc-chat-widget sdk-id="...">
├── <smc-launcher>              — Floating button + proactive bubble + unread badge
├── <smc-chat-window>           — Main container (open/minimized/hidden)
│   ├── <smc-header>            — Title, avatar, status indicator, minimize/close
│   ├── <smc-pre-chat-form>     — Dynamic form fields from config
│   ├── <smc-message-list>      — Scrollable message area
│   │   ├── <smc-message>       — Individual bubble (user or bot)
│   │   │   ├── <smc-markdown>  — Markdown rendering
│   │   │   ├── <smc-rich-card> — Cards, buttons, carousels
│   │   │   ├── <smc-file-preview> — File thumbnail
│   │   │   └── <smc-feedback>  — Thumbs up/down (bot messages only)
│   │   ├── <smc-typing-indicator> — Animated dots during streaming
│   │   ├── <smc-kb-suggestions>   — Article cards
│   │   └── <smc-timestamp>     — Grouped time separators
│   ├── <smc-quick-replies>     — Suggested response chips
│   ├── <smc-input-bar>         — Textarea + file attach + send button
│   └── <smc-csat-survey>       — End-of-session rating
└── <smc-proactive-engine>      — Evaluates trigger rules client-side
```

### State Management

Global store via `@stencil/store`:

```typescript
interface WidgetState {
  config: SdkWidgetConfig | null;
  apiKey: string | null;
  session: { id: string; status: string; visitorId: string } | null;
  messages: Message[];
  uiState: { open: boolean; minimized: boolean; hidden: boolean };
  streaming: { active: boolean; currentTokens: string };
  preChatDone: boolean;
  unreadCount: number;
}
```

Persistence: `visitorId` + `sessionId` in localStorage. On mount, resume existing session if active.

### Services Layer

```
src/services/
├── api.service.ts        — HTTP client, auth header injection
├── stream.service.ts     — SSE parsing, token accumulation
├── storage.service.ts    — localStorage wrapper (visitorId, sessionId, theme)
├── proactive.service.ts  — Rule evaluation (time, scroll, URL)
└── config.service.ts     — Fetch + cache /config response
```

### Design Principles

- **Single prop entry** — only `sdk-id` needed
- **Lazy loading** — heavy components (file preview, CSAT) loaded on demand
- **Shadow DOM** — full style isolation, CSS custom properties for theming
- **Event-driven** — components communicate via CustomEvents
- **Offline-resilient** — messages queued locally if network drops
- **Accessible** — ARIA roles, keyboard navigation, screen reader announcements

---

## Visual Design

**Style:** Warm Conversational
- Rounded corners (16-20px on containers, 14-18px on bubbles)
- Emoji-friendly header and messages
- Quick reply chips with pill shape
- Subtle shadows, no hard borders
- Gradient accents on bot avatar
- Smooth animations: slide-up open, fade-in messages, bounce typing indicator
- Dark mode support via CSS custom properties

**Responsive:**
- Desktop: 380px wide, 600px tall, fixed position
- Mobile (<480px): full-screen overlay
- Minimized: just the launcher button

**Theming via CSS custom properties:**
```css
--smc-primary: #1a1a2e;
--smc-secondary: #3b82f6;
--smc-bg: #ffffff;
--smc-text: #374151;
--smc-bubble-user: var(--smc-primary);
--smc-bubble-bot: #f8f9fa;
--smc-radius: 18px;
--smc-font: system-ui, -apple-system, sans-serif;
```

---

## Designer Page

Tab-based configuration UI in the dashboard. Persists to SdkWidget model.

### Tabs

1. **Appearance** — Colors, theme mode, position, bot name/avatar, header text, welcome message, custom CSS
2. **Behavior** — Quick replies editor, file upload toggle, CSAT toggle + type, input placeholder, allowed origins
3. **Pre-chat Form** — Field builder (name, email, phone, custom text/select/checkbox)
4. **Proactive Messages** — Rule builder: trigger condition (time on page, scroll %, URL match) → message text
5. **Knowledge Base** — Toggle KB suggestions, select which KB, configure deflection behavior
6. **Embed Code** — Copy-paste snippet, SDK ID display, CDN URL, allowed origins summary

### Key Features

- **Agent selector** — pick which agent this widget connects to
- **Live preview** — real widget in iframe with current config
- **Mobile/desktop toggle** — preview responsive behavior
- **Publish workflow** — changes drafted until explicitly published
- **Auto-save** — drafts saved on every change
- **SDK ID visible** — always shown in page header for reference

---

## Widget Lifecycle

1. Page loads → widget script initializes
2. `GET /config` → fetch theme, behavior, API key
3. Show launcher button (apply position, colors)
4. Evaluate proactive rules → show bubble if triggered
5. User clicks open → show chat window
6. If pre-chat form configured and not completed → show form
7. User submits form → `POST /inference/sessions` with visitor data
8. If existing session (localStorage) → `GET /sessions/:id` for history
9. Show chat with history + welcome message
10. User types → if KB enabled, `GET /kb/suggest` with 300ms debounce (min 3 chars) for deflection
11. User sends message → `POST /inference` with `stream: true`
12. Render SSE tokens in real-time
13. Bot message complete → show feedback buttons
14. User ends session → if CSAT enabled, show survey
15. Submit CSAT → `POST /csat`
16. Close session → `DELETE /sessions/:id`

### Session Resumption

- `visitorId` generated on first visit (UUID), stored in localStorage
- On next page load: check localStorage for visitorId + sessionId
- If found → `GET /sessions/:id` → if active (200), resume with history
- If expired (410) → create new session
- Cross-tab: same visitorId = same session on same domain

---

## Implementation Scope

### Files Changed

| Area | Action | Files |
|------|--------|-------|
| Prisma | New models | `prisma/schema.prisma` |
| API | New route | `app/api/v1/sdk/[sdkId]/config/route.ts` |
| API | New route | `app/api/v1/inference/sessions/[id]/kb/suggest/route.ts` |
| API | New route | `app/api/v1/inference/sessions/[id]/files/route.ts` |
| API | New route | `app/api/v1/inference/sessions/[id]/csat/route.ts` |
| API | New route | `app/api/v1/inference/sessions/[id]/chat/feedback/route.ts` |
| API | Modify | `app/api/v1/inference/route.ts` (SSE streaming) |
| API | Modify | `app/api/v1/inference/sessions/route.ts` (visitor fields) |
| SDK | Full rewrite | `apps/sdk/src/` (17 components + services + store) |
| Dashboard | Rewrite | `app/(dashboard)/sdks/chat-widget/designer/page.tsx` |
| Dashboard | Rewrite | `app/(dashboard)/sdks/chat-widget/sandbox/page.tsx` |
| Shared | New service | `libs/shared/src/services/sdk-widget.service.ts` |
| Shared | New service | `libs/shared/src/services/feedback.service.ts` |
| Shared | New service | `libs/shared/src/services/csat.service.ts` |

### Risk Assessment

| Area | Effort | Risk | Mitigation |
|------|--------|------|------------|
| Prisma schema + migration | Small | Low | Additive changes only |
| New API routes (5) | Medium | Low | Independent, no existing code affected |
| Modify inference API (streaming) | Medium | Medium | Backward-compatible: stream only when `stream: true` |
| SDK widget rewrite (17 components) | Large | Medium | Clean slate, no migration needed |
| Designer page revamp | Medium | Low | Replaces existing page entirely |
| Shared services (3) | Small | Low | New files, no existing code modified |
