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
bunx nx run sdk:build
```

This produces the distributable bundle in `apps/sdk/dist/`. The key output file is `dist/smc-chat-widget/smc-chat-widget.esm.js`.

### 3. Start the dev server (with hot reload)

```bash
bunx nx run sdk:serve
```

The Stencil dev server starts at `http://localhost:3000`. It watches for file changes and rebuilds automatically.

Open `http://localhost:3000` to see the dev test page with the widget rendered.

### 4. Run the playground (optional)

The playground page in the web-ui lets you configure the widget interactively. You need both servers running:

**Terminal 1 — SDK dev server:**
```bash
bunx nx run sdk:serve
```

**Terminal 2 — Web UI dev server:**
```bash
bunx nx run web-ui:serve
```

Then open `http://localhost:3001/playground` in your browser.

The playground loads the widget from `/sdk-assets/smc-chat-widget.esm.js`, which is proxied to the Stencil dev server via a Next.js rewrite.

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

| Command | Description |
|---------|-------------|
| `bunx nx run sdk:build` | Production build → `dist/` |
| `bunx nx run sdk:serve` | Dev server with hot reload on port 3000 |
| `bunx nx run sdk:test` | Run unit tests |

Or from inside `apps/sdk/`:

| Command | Description |
|---------|-------------|
| `bunx stencil build` | Production build |
| `bunx stencil build --dev --watch --serve --port 3000` | Dev server |
| `bunx stencil test --spec` | Unit tests |

## Testing the Widget

### Quick test with the dev server

1. Run `bunx nx run sdk:serve`
2. Open `http://localhost:3000`
3. The widget renders with a floating chat button (bottom-right)
4. Click the button to open the chat panel
5. The widget won't connect to a real API (dev test page uses `http://localhost:8000/chat`), but the UI should be fully interactive

### Test with a real API

1. Start the SDK dev server: `bunx nx run sdk:serve`
2. Start the web-ui: `bunx nx run web-ui:serve`
3. Open `http://localhost:3001/playground`
4. Go to the "Live Sandbox" tab
5. Enter your API URL and session config:

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

6. Click "Connect" — the widget renders and communicates with your backend

### Test as a standalone script tag (simulates tenant integration)

Create an HTML file anywhere on your machine:

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="http://localhost:3000/build/smc-chat-widget.esm.js"></script>
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

See the full API reference in the docs: `http://localhost:3001/docs/sdk/api-reference`

## Deployment (CDN)

Build the production bundle:

```bash
bunx nx run sdk:build
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
