# SDK Integration Design Spec

## Overview

Integrate the StencilJS chat widget (`smc-chat-widget`) into the chatbot monorepo as a dedicated app (`apps/sdk/`), with an interactive playground and developer documentation in the web-ui.

## Goals

- Provide tenants a drop-in embeddable chat widget distributed via CDN (script tag)
- Offer a live playground in the web-ui for testing and configuring the widget
- Provide developer-friendly documentation via Fumadocs
- Keep the widget backend-agnostic — tenants configure their own API endpoints and auth headers

## Non-Goals

- npm publishing or framework-specific wrappers (React/Angular/Vue packages) — CDN only for now
- Tight coupling to the chatbot monorepo's API or NextAuth sessions
- Streaming/SSE support (standard request/response for now)

---

## Architecture

### Repository Structure

```
apps/
  sdk/                              # StencilJS chat widget
    src/
      components/
        smc-chat-widget/
          smc-chat-widget.tsx       # Main component
          smc-chat-widget.css       # Scoped styles
      types/
        message.ts                  # Message, SessionConfig types
      utils/
        sentence.ts                 # Message formatting utilities
      index.html                    # Stencil dev server test page
      components.d.ts               # Auto-generated types
    stencil.config.ts               # Build config (dist + www targets)
    package.json                    # name: @chatbot/sdk
    tsconfig.json
    project.json                    # Nx project config
  web-ui/
    app/
      (docs)/docs/sdk/              # Documentation (MDX)
        getting-started.mdx
        configuration.mdx
        api-reference.mdx
        examples.mdx
      (dashboard)/playground/       # Interactive playground (React page)
        page.tsx
```

### Distribution

- **Build output**: `apps/sdk/dist/` — ESM bundle (`smc-chat-widget.esm.js`) + CSS
- **CDN**: Deploy built assets to S3 (existing pattern: `stencil-sdk.s3.ap-south-1.amazonaws.com`)
- **Local dev**: Served from `apps/sdk/dist/` via Next.js rewrite/static serving

### Widget Loading in Playground

The playground loads the widget via script tag injection (mirrors real tenant usage):

```tsx
useEffect(() => {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = sdkUrl; // local: '/sdk-assets/smc-chat-widget.esm.js', prod: CDN URL
  document.head.appendChild(script);
  return () => script.remove();
}, []);
```

Widget is rendered by setting innerHTML on a container ref with the custom element and its attributes.

---

## Component API

### Props (HTML Attributes)

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `api-url` | string | — | Yes | Backend endpoint for chat messages |
| `session` | string (JSON) | — | Yes | Custom headers/auth config |
| `user-name` | string | `"You"` | No | Display name for user messages |
| `bot-name` | string | `"Bot"` | No | Display name for bot messages |
| `header-text` | string | `"Chat Assistant"` | No | Header title |
| `header-icon` | string | `""` | No | Header logo URL or base64 |
| `welcome-message` | string | `"Welcome! How can I help?"` | No | Initial bot message |
| `start-chat-logo` | string | `"https://cdn-icons-png.flaticon.com/512/4712/4712027.png"` | No | FAB button icon URL |
| `default-options` | string (JSON array) | `"[]"` | No | Quick reply button labels (e.g., `'["Option 1","Option 2"]'`) |
| `theme` | `"light" \| "dark"` | `"light"` | No | Color scheme |
| `position` | `"left" \| "right"` | `"right"` | No | Widget screen position |
| `primary-color` | string | `"#2196f3"` | No | Brand color |
| `secondary-color` | string | `"#1976d2"` | No | Hover/accent color |
| `input-placeholder` | string | `"Type your message..."` | No | Input field placeholder |

### Backend API Contract

The widget expects the backend to implement these endpoints:

**Send message:**
```
POST {apiUrl}
Headers: Content-Type: application/json + session headers
Body: { "inputText": string, "role": "user" }
Response: { "response": string }
```

**Load chat history:**
```
GET {apiUrl}/history
Headers: Content-Type: application/json + session headers
Response: { "chatHistory": [{ "chatRole": "user"|"assistant", "message": string, "timestamp": string, "createdAt": string }] }
```

**End session:**
```
POST {apiUrl}
Headers: session headers with x-session-attribute containing endSession: true
Body: { "inputText": "end", "role": "user" }
```

### Session Config Format

```json
{
  "x-platform-agent": "web",
  "x-prompt-session-attribute": { "oauthToken": "...", "clientCode": "..." },
  "x-session-attribute": { "oauthToken": "...", "clientCode": "..." },
  "x-api-key": "..."
}
```

The widget passes top-level keys as HTTP headers. Keys `x-prompt-session-attribute` and `x-session-attribute` are automatically JSON-stringified before being sent. All other keys are passed as-is. Tenants must follow this structure if their backend expects these specific headers; otherwise they can add arbitrary keys that will be sent as plain string headers.

---

## Playground Page

Located at `apps/web-ui/app/(dashboard)/playground/page.tsx`.

### Tab 1: Interactive Configurator

- **Left panel**: Form controls for every prop (color pickers, select dropdowns, text inputs)
- **Right panel**: Live preview — actual `<smc-chat-widget>` rendered with current prop values
- **Bottom**: Auto-generated embed code snippet (HTML) that updates in real-time. Copy button.

### Tab 2: Live Sandbox

- Form fields: API URL input, session config JSON editor
- "Connect" button that renders the widget with the tenant's real backend config
- Widget sends/receives real messages against their API
- Validates backend integration before deployment

### Implementation Notes

- Widget loaded via script tag (same as tenant experience)
- Props set by manipulating DOM attributes on the custom element via React ref
- Uses shadcn/ui components for the configurator form (consistent with web-ui)
- Protected by auth middleware (dashboard route group)

---

## Documentation (Fumadocs MDX)

Four pages under `(docs)/docs/sdk/`:

### getting-started.mdx
- One-paragraph description of the SDK
- Quick start: script tag + minimal `<smc-chat-widget>` example (5 lines)
- Link to playground

### configuration.mdx
- Full props table with types, defaults, descriptions
- Theming guide (colors, light/dark mode)
- Positioning (left/right)
- Custom branding (logos, header text, bot name)

### api-reference.mdx
- Backend API contract (endpoints, request/response shapes)
- Session config format and examples
- Widget lifecycle (load → history fetch → ready)
- Error handling behavior

### examples.mdx
- Integration patterns: plain HTML, React, Next.js, Angular, Vue
- Multi-tenant setup (different configs per tenant)
- Dynamic token refresh (updating session attribute at runtime)

---

## Nx Integration

### project.json targets

```json
{
  "build": { "executor": "nx:run-commands", "options": { "command": "stencil build", "cwd": "apps/sdk" } },
  "start": { "executor": "nx:run-commands", "options": { "command": "stencil build --dev --watch --serve --port 3000", "cwd": "apps/sdk" } },
  "test": { "executor": "nx:run-commands", "options": { "command": "stencil test", "cwd": "apps/sdk" } }
}
```

### Dev Workflow

```bash
nx run sdk:build          # Build SDK once
nx run sdk:start          # Dev server with hot reload (port 3000)
nx run web-ui:dev         # Next.js dev server (port 3001)
```

### Asset Serving (Dev)

Next.js config adds a rewrite rule to serve SDK assets locally:

```ts
// next.config.ts
rewrites: async () => [
  { source: '/sdk-assets/:path*', destination: 'http://localhost:3000/build/:path*' }
]
```

In production, the playground points to the CDN URL.

---

## Migration from stencil-js-widget-poc

1. Copy `src/` directory as-is into `apps/sdk/src/`
2. Copy `stencil.config.ts`, `tsconfig.json`, `package.json`
3. Remove React/Angular output targets from stencil.config.ts (CDN-only for now)
4. Remove hardcoded Stoxkart defaults (API keys, logos, option strings)
5. Make `defaultOptions` a configurable prop (`default-options`, JSON array string) instead of hardcoded values
6. Add `project.json` for Nx integration
7. Update root `nx.json` to include the new project

---

## Changes Required

| Area | Change |
|------|--------|
| `apps/sdk/` | New — StencilJS widget ported from stencil-js-widget-poc |
| `apps/web-ui/app/(dashboard)/playground/` | New — Interactive playground page |
| `apps/web-ui/app/(docs)/docs/sdk/` | New — 4 MDX documentation pages |
| `apps/web-ui/next.config.ts` | Add rewrite for SDK assets in dev |
| `nx.json` | Register new sdk project |
| Root `package.json` | Add stencil dev dependency (or keep in apps/sdk only) |

---

## Open Questions (Resolved)

- ~~npm publishing?~~ → CDN only for now
- ~~Framework wrappers?~~ → Not needed, CDN script tag
- ~~Backend coupling?~~ → Generic, tenants bring their own API
- ~~Playground location?~~ → Dashboard route, not MDX
