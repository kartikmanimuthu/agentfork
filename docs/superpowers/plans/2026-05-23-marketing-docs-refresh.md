# Marketing & Docs Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the landing page with a dark premium aesthetic in an isolated (marketing) route group, and rewrite all documentation with Fumadocs components.

**Architecture:** Separate `app/(marketing)/` route group with component-per-section pattern. Docs use existing Fumadocs setup with enhanced MDX content using Cards, Steps, Callout, Tabs, and Mermaid diagrams.

**Tech Stack:** Next.js 15, Framer Motion, Tailwind CSS, shadcn/ui, Lucide icons, Fumadocs v14

**Spec:** `docs/superpowers/specs/2026-05-23-marketing-docs-refresh-design.md`

---

## File Structure

```
app/(marketing)/
  layout.tsx
  page.tsx
  components/
    navbar.tsx
    hero.tsx
    social-proof.tsx
    feature-showcase.tsx
    feature-grid.tsx
    quick-start.tsx
    pricing.tsx
    cta-section.tsx
    footer.tsx
```

---

## Task 1: Create (marketing) route group and layout

**Files:**
- Delete: `apps/web-ui/app/page.tsx`
- Create: `apps/web-ui/app/(marketing)/layout.tsx`
- Create: `apps/web-ui/app/(marketing)/page.tsx`

- [ ] **Step 1: Delete the existing root page**

```bash
rm apps/web-ui/app/page.tsx
```

- [ ] **Step 2: Create the marketing layout**

Create `apps/web-ui/app/(marketing)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Chatbot — Open Source AI Agent Platform',
  description: 'Self-hosted, multi-tenant AI platform. Build agents, connect knowledge bases, integrate MCP tools, and deploy a chat widget.',
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="dark bg-[#09090b] min-h-screen text-[#fafafa]">{children}</div>;
}
```

- [ ] **Step 3: Create placeholder page**

Create `apps/web-ui/app/(marketing)/page.tsx`:

```tsx
export default function MarketingPage() {
  return <div className="text-center py-24">Marketing page — building sections</div>;
}
```

- [ ] **Step 4: Verify build**

Run: `cd apps/web-ui && npx next build`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(marketing): create (marketing) route group with dark layout"
```

---

## Task 2: Build Navbar

**Files:**
- Create: `apps/web-ui/app/(marketing)/components/navbar.tsx`

- [ ] **Step 1: Create navbar component**

Sticky nav with backdrop blur, gradient logo "Chatbot", nav links (Features, Pricing, Docs, GitHub icon), Sign in link, Get Started button (indigo). Border-bottom `#27272a`.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(marketing): add sticky navbar with gradient logo"
```

---

## Task 3: Build Hero

**Files:**
- Create: `apps/web-ui/app/(marketing)/components/hero.tsx`

- [ ] **Step 1: Create hero component**

Elements:
- Badge pill: "Open Source · MIT Licensed · Self-Hosted"
- Gradient headline: "The AI Agent Platform / You Can Own" (white→indigo gradient)
- Subtitle: platform description
- CTAs: "Deploy Free →" (filled #6366f1), "Star on GitHub" (outline)
- Product screenshot: macOS window frame with traffic light dots, indigo glow border, wireframe dashboard (sidebar + agent cards grid)
- Background: radial gradient from top center
- Framer Motion stagger reveal

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(marketing): add hero with product screenshot mockup"
```

---

## Task 4: Build Social Proof bar

**Files:**
- Create: `apps/web-ui/app/(marketing)/components/social-proof.tsx`

- [ ] **Step 1: Create social proof component**

4 stats with count-up animation: "12+" Core Features, "MIT" Licensed, "100%" Self-Hosted, "∞" No Usage Limits. Use Framer Motion useInView + animate. Borders top/bottom `#1f1f23`.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(marketing): add social proof stats bar"
```

---

## Task 5: Build Feature Showcase

**Files:**
- Create: `apps/web-ui/app/(marketing)/components/feature-showcase.tsx`

- [ ] **Step 1: Create feature showcase**

4 alternating left/right sections with scroll-triggered fade-in:
1. Agent Studio — "Build agents visually, test instantly"
2. Knowledge Bases — "RAG that just works"
3. MCP Servers — "Connect any tool"
4. Analytics — "Know what's happening"

Each: uppercase accent label, bold heading, description, CSS mockup placeholder.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(marketing): add feature deep-dive showcase"
```

---

## Task 6: Build Feature Grid

**Files:**
- Create: `apps/web-ui/app/(marketing)/components/feature-grid.tsx`

- [ ] **Step 1: Create feature grid**

3-column grid, 6 cards: Multi-Tenant, RBAC & Security, Audit Logs, Background Jobs, Cognito Auth, Chat Widget SDK. Lucide icons, hover lift + border glow, stagger reveal.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(marketing): add compact feature grid"
```

---

## Task 7: Build Quick-Start Terminal

**Files:**
- Create: `apps/web-ui/app/(marketing)/components/quick-start.tsx`

- [ ] **Step 1: Create quick-start section**

Heading "Up and running in 60 seconds", subtitle, dark code block with:
```
# Clone and install
$ git clone github.com/kartikmanimuthu/chatbot
$ cd chatbot && bun install
# Start everything
$ bun run dev:all
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(marketing): add quick-start terminal section"
```

---

## Task 8: Build Pricing

**Files:**
- Create: `apps/web-ui/app/(marketing)/components/pricing.tsx`

- [ ] **Step 1: Create pricing section**

3 cards: Self-Hosted ($0, indigo border, "Popular" badge, feature list, "Deploy Now" CTA), Cloud (Coming soon, dimmed), Enterprise (Custom, dimmed). Hover scale on active card.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(marketing): add pricing section"
```

---

## Task 9: Build CTA and Footer

**Files:**
- Create: `apps/web-ui/app/(marketing)/components/cta-section.tsx`
- Create: `apps/web-ui/app/(marketing)/components/footer.tsx`

- [ ] **Step 1: Create CTA section**

"Ready to build your AI agents?" + subtitle + "Get Started Free →" button. Radial glow from bottom.

- [ ] **Step 2: Create footer**

Single row: Left "Chatbot · MIT License · Built with Next.js & AWS Bedrock", Right: Docs, GitHub, Getting Started links.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(marketing): add CTA section and footer"
```

---

## Task 10: Compose full marketing page

**Files:**
- Modify: `apps/web-ui/app/(marketing)/page.tsx`

- [ ] **Step 1: Wire up all components**

Import and compose: Navbar → Hero → SocialProof → FeatureShowcase → FeatureGrid → QuickStart → Pricing → CtaSection → Footer.

- [ ] **Step 2: Verify build and test in browser**

```bash
cd apps/web-ui && npx next build && bun run dev
```

Open http://localhost:3001 — verify all sections render with dark theme and animations.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(marketing): compose full landing page"
```

---

## Task 11: Rewrite docs index page

**Files:**
- Modify: `apps/web-ui/content/docs/index.mdx`

- [ ] **Step 1: Replace with card-based navigation**

Use Fumadocs Cards component. Group into: Get Started (3 cards), User Guide (6 cards), Developer Guide & API (3 cards).

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "docs: rewrite index with card-based navigation"
```

---

## Task 12: Rewrite User Guide docs (6 files)

**Files:**
- Modify: `apps/web-ui/content/docs/user-guide/getting-started.mdx`
- Modify: `apps/web-ui/content/docs/user-guide/agents.mdx`
- Modify: `apps/web-ui/content/docs/user-guide/knowledge-bases.mdx`
- Modify: `apps/web-ui/content/docs/user-guide/mcp-servers.mdx`
- Modify: `apps/web-ui/content/docs/user-guide/llm-providers.mdx`
- Modify: `apps/web-ui/content/docs/user-guide/sessions.mdx`
- Modify: `apps/web-ui/content/docs/user-guide/analytics.mdx`

- [ ] **Step 1: Rewrite getting-started.mdx** — Add Callout for prerequisites, Steps component, "What you'll build" intro, Cards for next steps.
- [ ] **Step 2: Rewrite agents.mdx** — Add Mermaid diagram (agent lifecycle), Tabs for model configs, expand playground/versioning/publishing.
- [ ] **Step 3: Rewrite knowledge-bases.mdx** — Add Mermaid diagram (RAG pipeline), Callout for formats, expand upload/sync sections.
- [ ] **Step 4: Rewrite mcp-servers.mdx** — Add Mermaid diagram (MCP flow), Tabs for stdio vs HTTP.
- [ ] **Step 5: Rewrite llm-providers.mdx** — Provider comparison table, Tabs for Bedrock vs OpenAI config.
- [ ] **Step 6: Rewrite sessions.mdx** — Session lifecycle, expand usage aggregation.
- [ ] **Step 7: Rewrite analytics.mdx** — Expand metrics explanation, filtering examples.
- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "docs: rewrite user guide with Fumadocs components and diagrams"
```

---

## Task 13: Rewrite Developer Guide docs (4 files)

**Files:**
- Modify: `apps/web-ui/content/docs/dev-guide/installation.mdx`
- Modify: `apps/web-ui/content/docs/dev-guide/architecture.mdx`
- Modify: `apps/web-ui/content/docs/dev-guide/configuration.mdx`
- Modify: `apps/web-ui/content/docs/dev-guide/faq.mdx`

- [ ] **Step 1: Rewrite installation.mdx** — Tabs (Docker | Manual | Pulumi), Steps within each, Callout warnings.
- [ ] **Step 2: Rewrite architecture.mdx** — Full Mermaid system diagram, data flow diagrams, component matrix.
- [ ] **Step 3: Rewrite configuration.mdx** — Tabs (Core | Auth | AI | Workers), Callout danger for secrets, expand RBAC.
- [ ] **Step 4: Rewrite faq.mdx** — Expand to 15-20 questions, group by category, troubleshooting.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: rewrite developer guide with tabs, diagrams, expanded content"
```

---

## Task 14: Rewrite API Reference docs (6 files)

**Files:**
- Modify: `apps/web-ui/content/docs/api/index.mdx`
- Modify: `apps/web-ui/content/docs/api/agents-api.mdx`
- Modify: `apps/web-ui/content/docs/api/knowledge-base-api.mdx`
- Modify: `apps/web-ui/content/docs/api/mcp-api.mdx`
- Modify: `apps/web-ui/content/docs/api/inference-api.mdx`
- Modify: `apps/web-ui/content/docs/api/analytics-api.mdx`
- Modify: `apps/web-ui/content/docs/api/user-api.mdx`

- [ ] **Step 1: Rewrite api/index.mdx** — Auth overview, base URL, content-type, error format, rate limiting.
- [ ] **Step 2: Rewrite each API doc** — Endpoint summary table, Tabs for cURL/JS examples, error codes, Callout for special behavior.
- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: rewrite API reference with tabs, examples, error codes"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run full build**

```bash
cd apps/web-ui && npx next build
```

- [ ] **Step 2: Test in browser**

Verify: marketing page at `/`, all docs pages load, sidebar navigation, Mermaid diagrams, cross-links.

- [ ] **Step 3: Commit fixes if needed**

```bash
git add -A && git commit -m "fix: address build/render issues from verification"
```
