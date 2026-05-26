# SMC Chat Widget SDK

Embeddable chat widget built with StencilJS. Drop a single script tag on any website to add a fully-featured chat interface.

## Prerequisites

- Bun 1.2+ (or Node.js 20+)
- The monorepo root dependencies installed (`bun install` from repo root)

## Local Development

### 1. Install SDK dependencies

```bash
cd apps/sdk
bun install
```

### 2. Build the SDK

```bash
bun run sdk:build
```

This produces the distributable bundle in `apps/sdk/dist/` and copies the JS files to `apps/web-ui/public/sdk-assets/` for the designer/sandbox pages.

### 3. Start the dev server (with hot reload)

```bash
bun run sdk:dev
```

The Stencil dev server starts at `http://localhost:3007`. It watches for file changes and rebuilds automatically.

Open `http://localhost:3007` to see the dev test page with the widget rendered.

### 4. Run the designer/sandbox (optional)

The designer page in web-ui lets you configure the widget interactively. Two approaches:

**Without live reload (static assets):**
```bash
bun run sdk:build    # Build once + copy to public/sdk-assets/
bun run dev          # Start Next.js — designer uses static files
```

Then open `http://localhost:3005/sdks/chat-widget/designer`.

**With live reload (proxied to Stencil dev server):**

```bash
# Terminal 1 — SDK dev server:
bun run sdk:dev

# Terminal 2 — Web UI with SDK proxy:
SDK_DEV=true bun run dev
```

Or run everything together:
```bash
bun run dev:all      # web-ui + workers + SDK dev server (SDK_DEV=true)
```

Then open `http://localhost:3005/sdks/chat-widget/designer`.

With `SDK_DEV=true`, Next.js rewrites `/sdk-assets/*` to the Stencil dev server at `localhost:3007`, so widget changes appear immediately without manual rebuilds.

## Project Structure

```
apps/sdk/
├── src/
│   ├── components/
│   │   └── smc-chat-widget/
│   │       ├── smc-chat-widget.tsx    # Main component
│   │       └── smc-chat-widget.css    # Scoped styles
│   ├── types/
│   │   └── message.ts                 # TypeScript interfaces
│   ├── utils/
│   │   └── sentence.ts                # Message formatting utilities
│   ├── components.d.ts                # Auto-generated type declarations
│   └── index.html                     # Dev server test page
├── dist/                              # Build output (gitignored)
├── stencil.config.ts                  # Stencil build configuration
├── project.json                       # Nx project targets
├── package.json
└── tsconfig.json
```

## Available Commands

From the monorepo root:

| Command | Description |
|---------|-------------|
| `bun run sdk:build` | Production build → `dist/` + copy to `web-ui/public/sdk-assets/` |
| `bun run sdk:dev` | Dev server with hot reload on port 3007 |
| `bun run dev:all` | Web-ui + workers + SDK dev server together |
| `bunx nx run sdk:build` | Production build → `dist/` (no copy) |
| `bunx nx run sdk:serve` | Dev server with hot reload on port 3007 |
| `bunx nx run sdk:test` | Run unit tests |

Or from inside `apps/sdk/`:

| Command | Description |
|---------|-------------|
| `bunx stencil build` | Production build |
| `bunx stencil build --dev --watch --serve --port 3007` | Dev server |
| `bunx stencil test --spec` | Unit tests |

## Testing the Widget

### Quick test with the dev server

1. Run `bun run sdk:dev`
2. Open `http://localhost:3007`
3. The widget renders with a floating chat button (bottom-right)
4. Click the button to open the chat panel
5. The widget won't connect to a real API (dev test page uses `http://localhost:8000/chat`), but the UI should be fully interactive

### Test with a real API

1. Start the web-ui: `bun run dev`
2. Open `http://localhost:3005/sdks/chat-widget/sandbox`
3. Enter your API URL and session config:

```json
{
  "x-platform-agent": "web",
  "x-prompt-session-attribute": {
    "oauthToken": "your-token",
    "clientCode": "your-client-code"
  },
  "x-session-attribute": {
    "oauthToken": "your-token",
    "clientCode": "your-client-code"
  },
  "x-api-key": "your-api-key"
}
```

4. Click "Connect" — the widget renders and communicates with your backend

### Test as a standalone script tag (simulates tenant integration)

Create an HTML file anywhere on your machine:

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="http://localhost:3007/build/smc-chat-widget.esm.js"></script>
</head>
<body>
  <h1>My App</h1>
  <smc-chat-widget
    api-url="https://your-api.example.com/chat"
    session='{"x-api-key":"your-key","x-platform-agent":"web"}'
    header-text="Support Chat"
    primary-color="#6366f1"
    position="right"
    welcome-message="Hello! How can I help?"
  ></smc-chat-widget>
</body>
</html>
```

Serve it with any HTTP server:

```bash
bunx serve .
```

Open the served URL. The chat widget should appear in the bottom-right corner.

## Widget Props

| Attribute | Type | Default | Required |
|-----------|------|---------|----------|
| `api-url` | string | — | Yes |
| `session` | string (JSON) | — | Yes |
| `user-name` | string | `"You"` | No |
| `bot-name` | string | `"Bot"` | No |
| `header-text` | string | `"Chat Assistant"` | No |
| `header-icon` | string | `""` | No |
| `welcome-message` | string | `"Welcome! How can I help you today?"` | No |
| `start-chat-logo` | string | *(default icon)* | No |
| `theme` | `"light"` \| `"dark"` | `"light"` | No |
| `position` | `"left"` \| `"right"` | `"right"` | No |
| `primary-color` | string | `"#2196f3"` | No |
| `secondary-color` | string | `"#1976d2"` | No |
| `input-placeholder` | string | `"Type your message..."` | No |
| `default-options` | string (JSON array) | `"[]"` | No |

## Backend API Contract

The widget expects your backend to implement:

- `POST {api-url}` — Send message. Body: `{ "inputText": "...", "role": "user" }`. Response: `{ "response": "..." }`
- `GET {api-url}/history` — Load chat history. Response: `{ "chatHistory": [...] }`
- `POST {api-url}` with `endSession: true` in session header — End session

See the full API reference in the docs: `http://localhost:3005/docs/sdk/api-reference`

## Deployment (CDN)

Build the production bundle:

```bash
bun run sdk:build
```

Upload the contents of `apps/sdk/dist/smc-chat-widget/` to your CDN (e.g., S3 bucket). Tenants then reference:

```html
<script type="module" src="https://your-cdn.com/sdk/smc-chat-widget.esm.js"></script>
```

## Troubleshooting

**Widget doesn't appear:**
- Check browser console for script loading errors
- Ensure the `api-url` and `session` props are set (both are required)
- Verify the script URL is accessible (try opening it directly in the browser)

**CORS errors:**
- The widget uses `credentials: "include"` and `mode: "cors"` for API requests
- Your backend must return appropriate CORS headers for the host domain

**Chat history not loading:**
- The widget calls `GET {api-url}/history` on open
- If this endpoint doesn't exist or fails, the widget falls back to showing the welcome message (no error shown to user)

**Styles leaking / conflicting:**
- The widget uses Shadow DOM — its styles are fully encapsulated
- If you see style issues, check that no global CSS is using `!important` on the `smc-chat-widget` element itself
