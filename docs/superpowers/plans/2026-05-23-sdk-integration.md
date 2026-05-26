# SDK Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the StencilJS chat widget into the chatbot monorepo as `apps/sdk/`, add an interactive playground page, and create developer documentation.

**Architecture:** StencilJS web component in `apps/sdk/` with Nx build targets. Playground is a React page in the dashboard route group that loads the widget via script tag. Documentation lives in Fumadocs MDX under `content/docs/sdk/`.

**Tech Stack:** StencilJS 4, TypeScript, Next.js 15, Fumadocs, shadcn/ui, Nx

---

## File Structure

### New Files — apps/sdk/

| File | Responsibility |
|------|---------------|
| `apps/sdk/package.json` | Package config, stencil dependency |
| `apps/sdk/project.json` | Nx project targets (build, start, test) |
| `apps/sdk/stencil.config.ts` | Stencil build config (dist + www) |
| `apps/sdk/tsconfig.json` | TypeScript config for Stencil |
| `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx` | Main widget component |
| `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.css` | Widget styles |
| `apps/sdk/src/types/message.ts` | TypeScript interfaces |
| `apps/sdk/src/utils/sentence.ts` | Message formatting utilities |
| `apps/sdk/src/index.html` | Dev server test page |

### New Files — Playground

| File | Responsibility |
|------|---------------|
| `apps/web-ui/app/(dashboard)/playground/page.tsx` | Interactive configurator + live sandbox |

### New Files — Documentation

| File | Responsibility |
|------|---------------|
| `apps/web-ui/content/docs/sdk/meta.json` | Fumadocs page ordering for SDK section |
| `apps/web-ui/content/docs/sdk/index.mdx` | SDK overview page |
| `apps/web-ui/content/docs/sdk/getting-started.mdx` | Quick start guide |
| `apps/web-ui/content/docs/sdk/configuration.mdx` | Full props reference |
| `apps/web-ui/content/docs/sdk/api-reference.mdx` | Backend API contract |
| `apps/web-ui/content/docs/sdk/examples.mdx` | Framework integration examples |

### Modified Files

| File | Change |
|------|--------|
| `apps/web-ui/content/docs/meta.json` | Add "sdk" section to page list |
| `apps/web-ui/next.config.ts` | Add rewrite for SDK assets in dev |

---

## Task 1: Scaffold apps/sdk with Stencil

**Files:**
- Create: `apps/sdk/package.json`
- Create: `apps/sdk/project.json`
- Create: `apps/sdk/stencil.config.ts`
- Create: `apps/sdk/tsconfig.json`
- Create: `apps/sdk/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@chatbot/sdk",
  "version": "0.0.1",
  "description": "Embeddable chat widget — drop-in Web Component for any site",
  "main": "dist/index.cjs.js",
  "module": "dist/index.js",
  "types": "./dist/types/components.d.ts",
  "collection": "./dist/collection/collection-manifest.json",
  "scripts": {
    "build": "stencil build",
    "start": "stencil build --dev --watch --serve --port 3000",
    "test": "stencil test --spec"
  },
  "dependencies": {
    "@stencil/core": "^4.2.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  },
  "keywords": ["stencil", "chat", "widget", "web-component"],
  "license": "MIT"
}
```

- [ ] **Step 2: Create stencil.config.ts**

```ts
import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'smc-chat-widget',
  devServer: {
    port: 3000,
    openBrowser: false,
    reloadStrategy: 'pageReload',
  },
  outputTargets: [
    {
      type: 'dist',
      esmLoaderPath: '../loader',
    },
    {
      type: 'dist-custom-elements',
    },
    {
      type: 'www',
      serviceWorker: null,
      copy: [{ src: 'index.html' }],
    },
  ],
};
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es2017",
    "module": "esnext",
    "moduleResolution": "node",
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "baseUrl": "src",
    "paths": {
      "@/*": ["*"]
    },
    "allowSyntheticDefaultImports": true,
    "allowUnreachableCode": false,
    "declaration": true,
    "experimentalDecorators": true,
    "lib": ["dom", "es2017"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create project.json (Nx)**

```json
{
  "name": "sdk",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/sdk/src",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "outputs": ["{projectRoot}/dist"],
      "options": {
        "command": "npx stencil build",
        "cwd": "apps/sdk"
      }
    },
    "serve": {
      "executor": "nx:run-commands",
      "continuous": true,
      "options": {
        "command": "npx stencil build --dev --watch --serve --port 3000",
        "cwd": "apps/sdk"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx stencil test --spec",
        "cwd": "apps/sdk"
      }
    }
  }
}
```

- [ ] **Step 5: Create .gitignore**

```
dist/
www/
loader/
.stencil/
node_modules/
```

- [ ] **Step 6: Install dependencies and verify build scaffolding**

Run:
```bash
cd apps/sdk && bun install
```

Expected: Dependencies installed, no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/sdk/package.json apps/sdk/project.json apps/sdk/stencil.config.ts apps/sdk/tsconfig.json apps/sdk/.gitignore apps/sdk/bun.lockb
git commit -m "feat(sdk): scaffold StencilJS app with Nx integration"
```

---

## Task 2: Port widget source code

**Files:**
- Create: `apps/sdk/src/types/message.ts`
- Create: `apps/sdk/src/utils/sentence.ts`
- Create: `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.css`
- Create: `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx`
- Create: `apps/sdk/src/index.html`

- [ ] **Step 1: Create types/message.ts**

```ts
export interface Message {
  content: string;
  sender: string;
  timestamp: string;
  isOptions?: boolean;
  status?: 'sending' | 'sent' | 'error';
}

export interface SessionConfig {
  [key: string]: string | Record<string, string>;
}

export interface ChatApiResponse {
  response: string;
  sessionId?: string;
  memoryId?: string | null;
}

export interface ChatHistoryResponse {
  chatHistory: {
    chatRole: 'user' | 'assistant';
    message: string;
    timestamp: string;
    createdAt: string;
  }[];
}
```

- [ ] **Step 2: Create utils/sentence.ts**

Copy from `stencil-js-widget-poc/src/utils/sentance.ts` (fix filename typo). The file contains `sentenceFormatting()` and helper functions for formatting bot messages (bold, italic, links, code blocks, bullet points, etc.). No changes needed to the logic — it's already framework-agnostic DOM manipulation.

Run:
```bash
cp /Users/kartik/Documents/stencil-js-widget-poc/src/utils/sentance.ts apps/sdk/src/utils/sentence.ts
```

- [ ] **Step 3: Create the CSS file**

Copy from the POC and keep as-is — it's already well-structured with CSS custom properties:

Run:
```bash
mkdir -p apps/sdk/src/components/smc-chat-widget
cp /Users/kartik/Documents/stencil-js-widget-poc/src/styles/chat.css apps/sdk/src/components/smc-chat-widget/smc-chat-widget.css
```

- [ ] **Step 4: Create the main component**

Copy from POC and make these changes:
1. Update styleUrl path to `./smc-chat-widget.css`
2. Update import path for sentence utility
3. Replace hardcoded `defaultOptions` with a `@Prop()` that accepts a JSON string array
4. Remove Stoxkart-specific default option strings
5. Make `SessionConfig` generic (already done in our types)

```ts
import { Component, h, Fragment, State, Prop, Element } from '@stencil/core';
import { sentenceFormatting } from '../../utils/sentence';
import { Message, ChatApiResponse, ChatHistoryResponse, SessionConfig } from '../../types/message';

@Component({
  tag: 'smc-chat-widget',
  styleUrl: './smc-chat-widget.css',
  shadow: true,
})
export class SmcChatWidget {
  @Prop() userName?: string = 'You';
  @Prop() theme?: 'light' | 'dark' = 'light';
  @Prop() position?: 'left' | 'right' = 'right';
  @Prop() headerText?: string = 'Chat Assistant';
  @Prop() welcomeMessage?: string = 'Welcome! How can I help you today?';
  @Prop() botName?: string = 'Bot';
  @Prop() headerIcon?: string = '';
  @Prop() startChatLogo?: string = 'https://cdn-icons-png.flaticon.com/512/4712/4712027.png';
  @Prop() primaryColor?: string = '#2196f3';
  @Prop() secondaryColor?: string = '#1976d2';
  @Prop() inputPlaceholder?: string = 'Type your message...';
  @Prop() defaultOptions?: string = '[]';

  @Prop() apiUrl!: string;
  @Prop() session!: SessionConfig | string;

  // ... rest of component logic from POC (unchanged)
}
```

The full component body is identical to the POC's `chat-widget.tsx` with the above prop changes. Copy it and apply the diff.

Run:
```bash
cp /Users/kartik/Documents/stencil-js-widget-poc/src/components/chat-widget/chat-widget.tsx apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx
```

Then apply edits:
- Change `styleUrl` from `../../styles/chat.css` to `./smc-chat-widget.css`
- Change import from `../../utils/sentance` to `../../utils/sentence`
- Change `SessionConfig` import path to `../../types/message`
- Replace hardcoded `defaultOptions` state with a parsed prop:

```ts
// Replace this:
@State() defaultOptions: string[] = [
  "Tell me something about stoxkart?",
  "Tell me my fund balance",
  "How to do stoxkart kyc",
  "Give me my stocks holdings"
];

// With this:
@Prop() defaultOptions?: string = '[]';

// And in the render/usage, parse it:
private getDefaultOptions(): string[] {
  try {
    return JSON.parse(this.defaultOptions || '[]');
  } catch {
    return [];
  }
}
```

Update `renderMessage` to use `this.getDefaultOptions()` instead of `this.defaultOptions`.

- [ ] **Step 5: Create src/index.html (dev test page)**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SMC Chat Widget — Dev</title>
  <script type="module" src="/build/smc-chat-widget.esm.js"></script>
</head>
<body>
  <h1 style="text-align:center; margin-top:2rem;">SDK Dev Server</h1>
  <smc-chat-widget
    api-url="http://localhost:8000/chat"
    session='{"x-api-key":"dev-key","x-platform-agent":"web"}'
    header-text="Dev Chat"
    primary-color="#6366f1"
    position="right"
    welcome-message="Hello! This is the dev test page."
  ></smc-chat-widget>
</body>
</html>
```

- [ ] **Step 6: Build and verify**

Run:
```bash
cd apps/sdk && npx stencil build
```

Expected: Build succeeds, `dist/` directory created with `smc-chat-widget.esm.js`.

- [ ] **Step 7: Commit**

```bash
git add apps/sdk/src/
git commit -m "feat(sdk): port chat widget component from stencil-js-widget-poc"
```

---

## Task 3: Wire up Next.js asset serving for playground

**Files:**
- Modify: `apps/web-ui/next.config.ts`

- [ ] **Step 1: Add SDK rewrite to next.config.ts**

Add a `rewrites` function to serve SDK build assets from the Stencil dev server during local development:

```ts
// In nextConfig, add:
async rewrites() {
  return [
    {
      source: '/sdk-assets/:path*',
      destination: 'http://localhost:3000/build/:path*',
    },
  ];
},
```

The full modified config:

```ts
import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';
import './lib/env';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@chatbot/shared', '@chatbot/ai', '@chatbot/knowledge-base', '@t3-oss/env-nextjs', '@t3-oss/env-core'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pino', 'thread-stream', '@ai-sdk/openai', '@ai-sdk/cohere', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', 'pdf-parse', 'mammoth', 'xlsx', 'umap-js'],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: { workerThreads: false, cpus: 1 },
  async rewrites() {
    return [
      {
        source: '/sdk-assets/:path*',
        destination: 'http://localhost:3000/build/:path*',
      },
    ];
  },
};

export default withMDX(nextConfig);
```

- [ ] **Step 2: Verify rewrite works**

Run both servers:
```bash
nx run sdk:serve &
nx run web-ui:serve
```

Then open `http://localhost:3001/sdk-assets/smc-chat-widget.esm.js` in a browser.

Expected: The Stencil ESM bundle is served.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/next.config.ts
git commit -m "feat(web-ui): add SDK asset rewrite for playground dev"
```

---

## Task 4: Build the playground page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/playground/page.tsx`

- [ ] **Step 1: Create the playground page**

This is a `'use client'` page with two tabs: Configurator and Live Sandbox.

```tsx
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Check, Play } from 'lucide-react';

const SDK_SCRIPT_URL = '/sdk-assets/smc-chat-widget.esm.js';

interface WidgetConfig {
  apiUrl: string;
  session: string;
  userName: string;
  botName: string;
  headerText: string;
  headerIcon: string;
  welcomeMessage: string;
  startChatLogo: string;
  theme: 'light' | 'dark';
  position: 'left' | 'right';
  primaryColor: string;
  secondaryColor: string;
  inputPlaceholder: string;
  defaultOptions: string;
}

const DEFAULT_CONFIG: WidgetConfig = {
  apiUrl: 'https://your-api.example.com/chat',
  session: JSON.stringify({ 'x-api-key': 'your-api-key', 'x-platform-agent': 'web' }, null, 2),
  userName: 'You',
  botName: 'Bot',
  headerText: 'Chat Assistant',
  headerIcon: '',
  welcomeMessage: 'Welcome! How can I help you today?',
  startChatLogo: 'https://cdn-icons-png.flaticon.com/512/4712/4712027.png',
  theme: 'light',
  position: 'right',
  primaryColor: '#2196f3',
  secondaryColor: '#1976d2',
  inputPlaceholder: 'Type your message...',
  defaultOptions: '[]',
};

function generateEmbedCode(config: WidgetConfig): string {
  const attrs = [
    `api-url="${config.apiUrl}"`,
    `session='${config.session.replace(/\n/g, '').replace(/\s{2,}/g, '')}'`,
    config.userName !== 'You' ? `user-name="${config.userName}"` : '',
    config.botName !== 'Bot' ? `bot-name="${config.botName}"` : '',
    config.headerText !== 'Chat Assistant' ? `header-text="${config.headerText}"` : '',
    config.headerIcon ? `header-icon="${config.headerIcon}"` : '',
    config.welcomeMessage !== 'Welcome! How can I help you today?' ? `welcome-message="${config.welcomeMessage}"` : '',
    config.theme !== 'light' ? `theme="${config.theme}"` : '',
    config.position !== 'right' ? `position="${config.position}"` : '',
    config.primaryColor !== '#2196f3' ? `primary-color="${config.primaryColor}"` : '',
    config.secondaryColor !== '#1976d2' ? `secondary-color="${config.secondaryColor}"` : '',
    config.inputPlaceholder !== 'Type your message...' ? `input-placeholder="${config.inputPlaceholder}"` : '',
    config.defaultOptions !== '[]' ? `default-options='${config.defaultOptions}'` : '',
  ].filter(Boolean);

  return `<script type="module" src="https://your-cdn.com/sdk/smc-chat-widget.esm.js"></script>\n<smc-chat-widget\n  ${attrs.join('\n  ')}\n></smc-chat-widget>`;
}

export default function PlaygroundPage() {
  const [config, setConfig] = useState<WidgetConfig>(DEFAULT_CONFIG);
  const [copied, setCopied] = useState(false);
  const [sandboxConfig, setSandboxConfig] = useState({ apiUrl: '', session: '' });
  const [sandboxActive, setSandboxActive] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = SDK_SCRIPT_URL;
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);

  const renderWidget = useCallback((container: HTMLDivElement | null, widgetConfig: WidgetConfig) => {
    if (!container) return;
    container.innerHTML = '';
    const widget = document.createElement('smc-chat-widget');
    widget.setAttribute('api-url', widgetConfig.apiUrl);
    widget.setAttribute('session', widgetConfig.session.replace(/\n/g, '').replace(/\s{2,}/g, ''));
    widget.setAttribute('user-name', widgetConfig.userName);
    widget.setAttribute('bot-name', widgetConfig.botName);
    widget.setAttribute('header-text', widgetConfig.headerText);
    if (widgetConfig.headerIcon) widget.setAttribute('header-icon', widgetConfig.headerIcon);
    widget.setAttribute('welcome-message', widgetConfig.welcomeMessage);
    widget.setAttribute('start-chat-logo', widgetConfig.startChatLogo);
    widget.setAttribute('theme', widgetConfig.theme);
    widget.setAttribute('position', widgetConfig.position);
    widget.setAttribute('primary-color', widgetConfig.primaryColor);
    widget.setAttribute('secondary-color', widgetConfig.secondaryColor);
    widget.setAttribute('input-placeholder', widgetConfig.inputPlaceholder);
    if (widgetConfig.defaultOptions !== '[]') widget.setAttribute('default-options', widgetConfig.defaultOptions);
    container.appendChild(widget);
  }, []);

  useEffect(() => {
    renderWidget(previewRef.current, config);
  }, [config, renderWidget]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generateEmbedCode(config));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSandboxConnect = () => {
    setSandboxActive(true);
    renderWidget(sandboxRef.current, {
      ...DEFAULT_CONFIG,
      apiUrl: sandboxConfig.apiUrl,
      session: sandboxConfig.session,
    });
  };

  const updateConfig = (key: keyof WidgetConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">SDK Playground</h1>
        <p className="text-muted-foreground">Configure and test the chat widget before integrating</p>
      </div>

      <Tabs defaultValue="configurator">
        <TabsList>
          <TabsTrigger value="configurator">Interactive Configurator</TabsTrigger>
          <TabsTrigger value="sandbox">Live Sandbox</TabsTrigger>
        </TabsList>

        <TabsContent value="configurator" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="headerText">Header Text</Label>
                    <Input id="headerText" value={config.headerText} onChange={e => updateConfig('headerText', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="botName">Bot Name</Label>
                    <Input id="botName" value={config.botName} onChange={e => updateConfig('botName', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="primaryColor">Primary Color</Label>
                    <div className="flex gap-2">
                      <input type="color" value={config.primaryColor} onChange={e => updateConfig('primaryColor', e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
                      <Input value={config.primaryColor} onChange={e => updateConfig('primaryColor', e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secondaryColor">Secondary Color</Label>
                    <div className="flex gap-2">
                      <input type="color" value={config.secondaryColor} onChange={e => updateConfig('secondaryColor', e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
                      <Input value={config.secondaryColor} onChange={e => updateConfig('secondaryColor', e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme">Theme</Label>
                    <Select value={config.theme} onValueChange={v => updateConfig('theme', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="position">Position</Label>
                    <Select value={config.position} onValueChange={v => updateConfig('position', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="right">Right</SelectItem>
                        <SelectItem value="left">Left</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="welcomeMessage">Welcome Message</Label>
                  <Input id="welcomeMessage" value={config.welcomeMessage} onChange={e => updateConfig('welcomeMessage', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inputPlaceholder">Input Placeholder</Label>
                  <Input id="inputPlaceholder" value={config.inputPlaceholder} onChange={e => updateConfig('inputPlaceholder', e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Live Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div ref={previewRef} className="relative min-h-[400px] border rounded-lg bg-muted/30" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Embed Code</CardTitle>
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                    {generateEmbedCode(config)}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sandbox" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Live Sandbox</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Test the widget against your real API. Enter your endpoint and session config below.
              </p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sandboxApiUrl">API URL</Label>
                  <Input
                    id="sandboxApiUrl"
                    placeholder="https://your-api.example.com/chat"
                    value={sandboxConfig.apiUrl}
                    onChange={e => setSandboxConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sandboxSession">Session Config (JSON)</Label>
                  <Textarea
                    id="sandboxSession"
                    rows={6}
                    placeholder='{"x-api-key": "your-key", "x-platform-agent": "web"}'
                    value={sandboxConfig.session}
                    onChange={e => setSandboxConfig(prev => ({ ...prev, session: e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
                <Button onClick={handleSandboxConnect} disabled={!sandboxConfig.apiUrl || !sandboxConfig.session}>
                  <Play className="h-4 w-4 mr-2" /> Connect
                </Button>
              </div>
              {sandboxActive && (
                <div ref={sandboxRef} className="relative min-h-[500px] border rounded-lg bg-muted/30 mt-4" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Verify the page renders**

Run:
```bash
nx run sdk:serve &
nx run web-ui:serve
```

Open `http://localhost:3001/playground` in a browser.

Expected: Page renders with configurator form and live preview panel. Widget loads in the preview area.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/playground/page.tsx
git commit -m "feat(web-ui): add SDK playground with configurator and live sandbox"
```

---

## Task 5: Add SDK documentation (Fumadocs MDX)

**Files:**
- Create: `apps/web-ui/content/docs/sdk/meta.json`
- Create: `apps/web-ui/content/docs/sdk/index.mdx`
- Create: `apps/web-ui/content/docs/sdk/getting-started.mdx`
- Create: `apps/web-ui/content/docs/sdk/configuration.mdx`
- Create: `apps/web-ui/content/docs/sdk/api-reference.mdx`
- Create: `apps/web-ui/content/docs/sdk/examples.mdx`
- Modify: `apps/web-ui/content/docs/meta.json`

- [ ] **Step 1: Create sdk/meta.json**

```json
{
  "title": "SDK",
  "pages": [
    "index",
    "getting-started",
    "configuration",
    "api-reference",
    "examples"
  ]
}
```

- [ ] **Step 2: Create sdk/index.mdx**

```mdx
---
title: Chat Widget SDK
description: Drop-in embeddable chat widget for any website.
---

## Overview

The SMC Chat Widget is a Web Component that adds a fully-featured chat interface to any website with a single script tag. It works with any backend that implements the expected API contract.

### Features

- Zero dependencies — single script tag integration
- Shadow DOM encapsulation — no CSS conflicts with host page
- Fully configurable — colors, position, branding, messages
- Light and dark theme support
- Chat history persistence
- Session management
- Quick reply options
- Message feedback (thumbs up/down)
- Responsive design (mobile-friendly)

### Quick Example

```html
<script type="module" src="https://your-cdn.com/sdk/smc-chat-widget.esm.js"></script>
<smc-chat-widget
  api-url="https://your-api.com/chat"
  session='{"x-api-key":"your-key"}'
  header-text="Support Chat"
  primary-color="#6366f1"
></smc-chat-widget>
```

[Try it in the Playground →](/playground)
```

- [ ] **Step 3: Create sdk/getting-started.mdx**

```mdx
---
title: Getting Started
description: Add the chat widget to your site in under 2 minutes.
---

## Installation

Add the SDK script tag to your HTML page, just before the closing `</body>` tag:

```html
<script type="module" src="https://your-cdn.com/sdk/smc-chat-widget.esm.js"></script>
```

## Basic Usage

Add the widget element anywhere in your page body:

```html
<smc-chat-widget
  api-url="https://your-api.example.com/chat"
  session='{"x-api-key":"your-api-key","x-platform-agent":"web"}'
></smc-chat-widget>
```

That's it. The widget renders a floating chat button in the bottom-right corner. Click it to open the chat panel.

## Required Props

| Prop | Description |
|------|-------------|
| `api-url` | Your backend chat endpoint URL |
| `session` | JSON string with authentication headers |

## Next Steps

- [Configuration](/docs/sdk/configuration) — customize appearance and behavior
- [API Reference](/docs/sdk/api-reference) — backend contract your API must implement
- [Examples](/docs/sdk/examples) — framework-specific integration guides
- [Playground](/playground) — try it live
```

- [ ] **Step 4: Create sdk/configuration.mdx**

```mdx
---
title: Configuration
description: Full reference for all widget properties.
---

## Props Reference

All props are set as HTML attributes on the `<smc-chat-widget>` element.

### Required

| Attribute | Type | Description |
|-----------|------|-------------|
| `api-url` | string | Backend endpoint for sending/receiving messages |
| `session` | string (JSON) | Authentication headers sent with every request |

### Appearance

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `header-text` | string | `"Chat Assistant"` | Title shown in the chat header |
| `header-icon` | string | — | URL or base64 image for the header logo |
| `start-chat-logo` | string | *(chat icon)* | Image for the floating action button |
| `primary-color` | string | `"#2196f3"` | Main brand color (header, send button, user messages) |
| `secondary-color` | string | `"#1976d2"` | Hover/accent color |
| `theme` | `"light"` \| `"dark"` | `"light"` | Color scheme |
| `position` | `"left"` \| `"right"` | `"right"` | Screen position of the widget |

### Content

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `user-name` | string | `"You"` | Display name for user messages |
| `bot-name` | string | `"Bot"` | Display name for bot messages |
| `welcome-message` | string | `"Welcome! How can I help you today?"` | First message shown when chat opens |
| `input-placeholder` | string | `"Type your message..."` | Placeholder text in the input field |
| `default-options` | string (JSON array) | `"[]"` | Quick reply buttons shown after bot responses |

## Theming

The widget uses CSS custom properties internally. Set `primary-color` and `secondary-color` to match your brand:

```html
<smc-chat-widget
  primary-color="#6366f1"
  secondary-color="#4f46e5"
  theme="dark"
></smc-chat-widget>
```

## Quick Reply Options

Pass a JSON array of strings to show clickable quick-reply buttons after each bot response:

```html
<smc-chat-widget
  default-options='["What are your hours?", "Talk to a human", "Pricing info"]'
></smc-chat-widget>
```

## Dynamic Updates

You can update props at runtime by setting attributes on the element:

```js
const widget = document.querySelector('smc-chat-widget');
widget.setAttribute('primary-color', '#10b981');
widget.setAttribute('theme', 'dark');
```
```

- [ ] **Step 5: Create sdk/api-reference.mdx**

```mdx
---
title: API Reference
description: Backend contract your API must implement for the widget.
---

## Overview

The widget communicates with your backend via three HTTP endpoints. All requests include the headers defined in the `session` prop.

## Endpoints

### Send Message

```
POST {api-url}
```

**Request Headers:**
```
Content-Type: application/json
{...session headers}
```

Note: `x-prompt-session-attribute` and `x-session-attribute` values are automatically JSON-stringified before sending.

**Request Body:**
```json
{
  "inputText": "user's message here",
  "role": "user"
}
```

**Expected Response:**
```json
{
  "response": "Bot's reply message"
}
```

### Load Chat History

```
GET {api-url}/history
```

**Request Headers:**
```
Content-Type: application/json
{...session headers}
```

**Expected Response:**
```json
{
  "chatHistory": [
    {
      "chatRole": "user",
      "message": "{\"message\": \"Hello\"}",
      "timestamp": "1716422400000",
      "createdAt": "2026-05-23T00:00:00.000Z"
    },
    {
      "chatRole": "assistant",
      "message": "{\"message\": \"Hi! How can I help?\"}",
      "timestamp": "1716422401000",
      "createdAt": "2026-05-23T00:00:01.000Z"
    }
  ]
}
```

### End Session

```
POST {api-url}
```

Triggered when the user clicks "End Session" in the widget.

**Request Headers:**
```
Content-Type: application/json
{...session headers with x-session-attribute containing endSession: true}
```

**Request Body:**
```json
{
  "inputText": "end",
  "role": "user"
}
```

## Session Config Format

The `session` prop accepts a JSON string. All top-level keys become HTTP headers:

```json
{
  "x-platform-agent": "web",
  "x-prompt-session-attribute": {
    "oauthToken": "user-token",
    "clientCode": "client-123"
  },
  "x-session-attribute": {
    "oauthToken": "user-token",
    "clientCode": "client-123"
  },
  "x-api-key": "your-api-key"
}
```

## Error Handling

- If the API returns a non-2xx status, the widget shows: "Sorry, I encountered an error processing your request."
- If chat history fails to load, the widget falls back to showing the welcome message.
- Network errors are caught and displayed as error messages in the chat.
```

- [ ] **Step 6: Create sdk/examples.mdx**

```mdx
---
title: Examples
description: Integration guides for popular frameworks.
---

## Plain HTML

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
</head>
<body>
  <h1>My Application</h1>

  <script type="module" src="https://your-cdn.com/sdk/smc-chat-widget.esm.js"></script>
  <smc-chat-widget
    api-url="https://api.example.com/chat"
    session='{"x-api-key":"key-123","x-platform-agent":"web"}'
    header-text="Support"
    primary-color="#0ca750"
  ></smc-chat-widget>
</body>
</html>
```

## React / Next.js

```tsx
'use client';

import { useEffect } from 'react';

export function ChatWidget() {
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = 'https://your-cdn.com/sdk/smc-chat-widget.esm.js';
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{
        __html: `<smc-chat-widget
          api-url="https://api.example.com/chat"
          session='{"x-api-key":"key-123"}'
          header-text="Support"
        ></smc-chat-widget>`
      }}
    />
  );
}
```

## Angular

```typescript
// app.module.ts
import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@NgModule({
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class AppModule {}
```

```html
<!-- index.html -->
<script type="module" src="https://your-cdn.com/sdk/smc-chat-widget.esm.js"></script>
```

```html
<!-- app.component.html -->
<smc-chat-widget
  api-url="https://api.example.com/chat"
  [attr.session]="sessionConfig"
  header-text="Support"
></smc-chat-widget>
```

## Vue

```vue
<script setup>
import { onMounted } from 'vue';

onMounted(() => {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = 'https://your-cdn.com/sdk/smc-chat-widget.esm.js';
  document.head.appendChild(script);
});
</script>

<template>
  <smc-chat-widget
    api-url="https://api.example.com/chat"
    :session="JSON.stringify({ 'x-api-key': 'key-123' })"
    header-text="Support"
  />
</template>

<script>
export default {
  compilerOptions: {
    isCustomElement: (tag) => tag === 'smc-chat-widget'
  }
};
</script>
```

## Dynamic Token Refresh

If your auth tokens expire, update the session attribute at runtime:

```js
function refreshSession(newToken) {
  const widget = document.querySelector('smc-chat-widget');
  const session = {
    'x-api-key': 'your-key',
    'x-platform-agent': 'web',
    'x-session-attribute': {
      oauthToken: newToken,
      clientCode: 'client-123'
    }
  };
  widget.setAttribute('session', JSON.stringify(session));
}
```
```

- [ ] **Step 7: Update root docs meta.json to include SDK section**

Modify `apps/web-ui/content/docs/meta.json`:

```json
{
  "title": "Documentation",
  "pages": [
    "index",
    "getting-started",
    "installation",
    "configuration",
    "api-reference",
    "architecture",
    "kb-worker-testing",
    "faq",
    "---",
    "...sdk"
  ]
}
```

The `"---"` adds a separator and `"...sdk"` includes the SDK folder as a nested section.

- [ ] **Step 8: Verify docs render**

Run:
```bash
nx run web-ui:serve
```

Open `http://localhost:3001/docs/sdk` in a browser.

Expected: SDK documentation section appears in the sidebar with all 5 pages. Content renders correctly.

- [ ] **Step 9: Commit**

```bash
git add apps/web-ui/content/docs/sdk/ apps/web-ui/content/docs/meta.json
git commit -m "docs(sdk): add getting started, configuration, API reference, and examples"
```

---

## Task 6: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Build the SDK**

Run:
```bash
nx run sdk:build
```

Expected: Clean build, `apps/sdk/dist/` contains `smc-chat-widget.esm.js` and related files.

- [ ] **Step 2: Start both servers**

Run:
```bash
nx run sdk:serve &
nx run web-ui:serve
```

- [ ] **Step 3: Verify playground configurator**

Open `http://localhost:3001/playground`.

Expected:
- Configurator tab shows form controls
- Changing color/theme/position updates the live preview
- Embed code updates in real-time
- Copy button works

- [ ] **Step 4: Verify live sandbox**

In the Sandbox tab:
- Enter a valid API URL and session JSON
- Click Connect
- Widget appears and can send/receive messages

- [ ] **Step 5: Verify documentation**

Open `http://localhost:3001/docs/sdk`.

Expected:
- Sidebar shows SDK section with all pages
- All code examples render correctly
- Links between pages work
- Link to playground works

- [ ] **Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(sdk): address integration issues found during verification"
```

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|---------------|
| 1 | Scaffold apps/sdk with Stencil + Nx | 10 min |
| 2 | Port widget source code | 15 min |
| 3 | Wire up Next.js asset serving | 5 min |
| 4 | Build playground page | 20 min |
| 5 | Add SDK documentation (MDX) | 15 min |
| 6 | End-to-end verification | 10 min |

**Total: ~75 minutes**
