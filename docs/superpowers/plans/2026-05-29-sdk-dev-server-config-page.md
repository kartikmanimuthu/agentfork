# SDK Dev Server Configuration Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare SDK dev server page with a JSON-driven configuration panel supporting mock and live modes for rapid widget iteration.

**Architecture:** Add a `mockConfig` prop to the widget component that bypasses the API fetch when present. Rewrite `index.html` with a two-mode UI (mock/live) where mock mode feeds a JSON textarea value directly into the widget.

**Tech Stack:** StencilJS (existing), plain HTML + vanilla JS for the dev page

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx` | Modify | Add `mockConfig` prop, branch boot logic |
| `apps/sdk/src/index.html` | Rewrite | Full config panel with mock/live modes |

---

### Task 1: Add `mockConfig` prop and branch boot logic

**Files:**
- Modify: `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx:14-82`

- [ ] **Step 1: Add the `mockConfig` prop declaration**

Add after line 15 (`@Prop() apiUrl?: string;`):

```typescript
@Prop() mockConfig?: string;
```

- [ ] **Step 2: Add mock config parsing at the start of `componentWillLoad()`**

Replace the current `componentWillLoad()` method (lines 33-82) with this version that branches on `mockConfig`:

```typescript
async componentWillLoad() {
  const baseUrl = this.getBaseUrl();
  console.log('[smc-widget] Boot started', { sdkId: this.sdkId, baseUrl });
  this.storage = new StorageService(this.sdkId);

  try {
    let config;

    if (this.mockConfig) {
      console.log('[smc-widget] Using mock config');
      config = JSON.parse(this.mockConfig);
    } else {
      const configService = new ConfigService(baseUrl);
      console.log('[smc-widget] Fetching config...');
      config = await configService.fetchConfig(this.sdkId);
      console.log('[smc-widget] Config loaded', config);
    }

    setConfig(config);
    setApiKey(config.apiKeyPrefix);
    setBaseUrl(baseUrl);

    this.apiService = new ApiService(baseUrl, config.apiKeyPrefix);

    const existingSessionId = this.storage.getSessionId();
    if (existingSessionId) {
      console.log('[smc-widget] Resuming session', { sessionId: existingSessionId });
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
        console.log('[smc-widget] Session resumed', { messageCount: messages.length });
      } else {
        console.log('[smc-widget] Session expired, clearing');
        this.storage.clearSession();
        this.storage.setPreChatDone(false);
      }
    }

    if (this.storage.getPreChatDone()) {
      setPreChatDone(true);
    }

    this.ready = true;
    console.log('[smc-widget] Boot complete, widget ready');
  } catch (err) {
    this.bootError = err instanceof Error ? err.message : 'Failed to load widget';
    console.error('[smc-widget] Boot failed', this.bootError, err);
  }
}
```

- [ ] **Step 3: Verify the SDK builds**

Run: `cd apps/sdk && npx stencil build 2>&1 | tail -20`
Expected: Build succeeds with no type errors

- [ ] **Step 4: Commit**

```bash
git add apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx
git commit -m "feat(sdk): add mockConfig prop to bypass API fetch in dev mode"
```

---

### Task 2: Rewrite the dev server page

**Files:**
- Rewrite: `apps/sdk/src/index.html`

- [ ] **Step 1: Replace `index.html` with the full config panel**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SMC Chat Widget — Dev</title>
  <script type="module" src="/build/smc-chat-widget.esm.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .dev-panel {
      max-width: 720px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
      color: #fff;
    }
    .subtitle {
      font-size: 0.875rem;
      color: #8b8fa3;
      margin-bottom: 1.5rem;
    }
    .mode-toggle {
      display: flex;
      gap: 0;
      margin-bottom: 1.5rem;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #2d2d44;
    }
    .mode-btn {
      flex: 1;
      padding: 0.625rem 1rem;
      border: none;
      background: #2d2d44;
      color: #8b8fa3;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .mode-btn.active {
      background: #6366f1;
      color: #fff;
    }
    .mode-btn:hover:not(.active) {
      background: #3d3d5c;
    }
    .panel-section {
      margin-bottom: 1.5rem;
    }
    .panel-section label {
      display: block;
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #8b8fa3;
      margin-bottom: 0.5rem;
    }
    textarea {
      width: 100%;
      min-height: 360px;
      padding: 1rem;
      background: #16162a;
      border: 1px solid #2d2d44;
      border-radius: 8px;
      color: #e0e0e0;
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
      line-height: 1.6;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s;
    }
    textarea:focus {
      border-color: #6366f1;
    }
    textarea.error {
      border-color: #ef4444;
    }
    .error-msg {
      color: #ef4444;
      font-size: 0.75rem;
      margin-top: 0.375rem;
      display: none;
    }
    .error-msg.visible {
      display: block;
    }
    .btn-row {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }
    .btn:active { transform: scale(0.97); }
    .btn-primary {
      background: #6366f1;
      color: #fff;
    }
    .btn-primary:hover { background: #5558e6; }
    .btn-secondary {
      background: #2d2d44;
      color: #e0e0e0;
    }
    .btn-secondary:hover { background: #3d3d5c; }
    .live-inputs {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .live-inputs .field {
      flex: 1;
      min-width: 200px;
    }
    .live-inputs input {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: #16162a;
      border: 1px solid #2d2d44;
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s;
    }
    .live-inputs input:focus {
      border-color: #6366f1;
    }
    .live-inputs input::placeholder {
      color: #555;
    }
    #widget-container {
      margin-top: 2rem;
      padding: 1rem;
      border: 1px dashed #2d2d44;
      border-radius: 8px;
      min-height: 80px;
      position: relative;
    }
    .container-label {
      position: absolute;
      top: -0.6rem;
      left: 1rem;
      background: #1a1a2e;
      padding: 0 0.5rem;
      font-size: 0.6875rem;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  </style>
</head>
<body>
  <div class="dev-panel">
    <h1>SDK Dev Server</h1>
    <p class="subtitle">Configure and preview the chat widget locally.</p>

    <div class="mode-toggle">
      <button class="mode-btn active" id="btn-mock" onclick="switchMode('mock')">Mock Config</button>
      <button class="mode-btn" id="btn-live" onclick="switchMode('live')">Live API</button>
    </div>

    <!-- Mock Mode -->
    <div id="mock-panel">
      <div class="panel-section">
        <label for="config-json">Bootstrap Config JSON</label>
        <textarea id="config-json"></textarea>
        <p class="error-msg" id="json-error">Invalid JSON — fix syntax errors before applying.</p>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="applyMockConfig()">Apply Config</button>
        <button class="btn btn-secondary" onclick="resetDefaults()">Reset to Defaults</button>
      </div>
    </div>

    <!-- Live Mode -->
    <div id="live-panel" style="display:none;">
      <div class="panel-section">
        <div class="live-inputs">
          <div class="field">
            <label for="sdk-id-input">SDK ID</label>
            <input type="text" id="sdk-id-input" placeholder="sdk_678c172fc868" />
          </div>
          <div class="field">
            <label for="api-url-input">API URL</label>
            <input type="text" id="api-url-input" placeholder="http://localhost:3005" />
          </div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="connectLive()">Connect</button>
      </div>
    </div>

    <div id="widget-container">
      <span class="container-label">Widget Preview</span>
    </div>
  </div>

  <script>
    const DEFAULT_CONFIG = {
      agentId: 'agent_demo_001',
      apiKeyPrefix: 'sk_demo',
      theme: 'light',
      primaryColor: '#6366f1',
      secondaryColor: '#e0e7ff',
      position: 'right',
      headerText: 'Chat with us',
      headerIcon: null,
      botName: 'Assistant',
      botAvatar: null,
      welcomeMessage: 'Hello! How can I help you today?',
      inputPlaceholder: 'Type your message...',
      preChatForm: null,
      quickReplies: ['What can you do?', 'Help me get started'],
      proactiveRules: null,
      kbEnabled: false,
      fileUpload: false,
      csatEnabled: false,
      csatType: 'thumbs',
    };

    const textarea = document.getElementById('config-json');
    const errorMsg = document.getElementById('json-error');
    const container = document.getElementById('widget-container');

    textarea.value = JSON.stringify(DEFAULT_CONFIG, null, 2);

    function switchMode(mode) {
      document.getElementById('btn-mock').classList.toggle('active', mode === 'mock');
      document.getElementById('btn-live').classList.toggle('active', mode === 'live');
      document.getElementById('mock-panel').style.display = mode === 'mock' ? 'block' : 'none';
      document.getElementById('live-panel').style.display = mode === 'live' ? 'block' : 'none';
      clearWidget();
    }

    function clearWidget() {
      const existing = container.querySelector('smc-chat-widget');
      if (existing) existing.remove();
    }

    function applyMockConfig() {
      const raw = textarea.value.trim();
      try {
        JSON.parse(raw);
        textarea.classList.remove('error');
        errorMsg.classList.remove('visible');
      } catch (e) {
        textarea.classList.add('error');
        errorMsg.classList.add('visible');
        return;
      }

      clearWidget();
      const widget = document.createElement('smc-chat-widget');
      widget.setAttribute('sdk-id', 'dev_mock');
      widget.setAttribute('mock-config', raw);
      container.appendChild(widget);
    }

    function connectLive() {
      const sdkId = document.getElementById('sdk-id-input').value.trim();
      const apiUrl = document.getElementById('api-url-input').value.trim() || 'http://localhost:3005';
      if (!sdkId) return;

      clearWidget();
      const widget = document.createElement('smc-chat-widget');
      widget.setAttribute('sdk-id', sdkId);
      widget.setAttribute('api-url', apiUrl);
      container.appendChild(widget);
    }

    function resetDefaults() {
      textarea.value = JSON.stringify(DEFAULT_CONFIG, null, 2);
      textarea.classList.remove('error');
      errorMsg.classList.remove('visible');
    }

    // Boot with mock config on page load
    applyMockConfig();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the dev server serves the new page**

Run: `cd apps/sdk && npx stencil build --dev 2>&1 | tail -10`
Expected: Build succeeds, `www/index.html` is generated

- [ ] **Step 3: Commit**

```bash
git add apps/sdk/src/index.html
git commit -m "feat(sdk): rewrite dev server page with mock/live config panel"
```

---

### Task 3: Smoke test the full flow

- [ ] **Step 1: Start the SDK dev server**

Run: `cd apps/sdk && npx stencil build --dev --serve`
Open: `http://localhost:3007`

- [ ] **Step 2: Verify mock mode**

- Page loads with "Mock Config" tab active
- JSON textarea is pre-filled with the default config
- Widget renders in the preview area (may show boot error since mock mode won't have a real session — that's fine, the config should be parsed and applied)
- Edit a value (e.g., change `primaryColor` to `#ef4444`), click "Apply Config" — widget re-renders with new color

- [ ] **Step 3: Verify live mode**

- Click "Live API" tab
- Enter a valid SDK ID from your local DB and `http://localhost:3005`
- Click "Connect" — widget boots against the real API

- [ ] **Step 4: Verify reset**

- Switch back to Mock mode
- Modify the JSON
- Click "Reset to Defaults" — textarea restores to original default JSON
