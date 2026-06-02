# Marketing Landing Page & Documentation Refresh — Design Spec

**Date:** 2026-05-23
**Status:** Approved

---

## Overview

Complete overhaul of the marketing landing page and full documentation rewrite. The landing page moves from a generic SaaS template to a dark premium aesthetic (Vercel/Linear style) with product-led storytelling. Documentation gets a full content rewrite with Fumadocs components, diagrams, and better information architecture.

## Decisions

- **Visual direction:** Dark premium (Vercel/Linear inspired)
- **Hero style:** Product screenshot with gradient headline
- **Architecture:** Separate `(marketing)` route group for isolation and future growth
- **Page goal:** Hybrid developer adoption + product showcase
- **No competitor comparison table**
- **Keep pricing section** (3 tiers: self-hosted free, cloud coming soon, enterprise custom)
- **Docs:** Full MDX content rewrite with Fumadocs components

---

## Phase 1: Landing Page

### Architecture

```
app/
  (marketing)/
    layout.tsx              # Dark theme, marketing nav + footer
    page.tsx                # Composes section components
    components/
      navbar.tsx            # Logo, links, GitHub, Sign in, Get Started
      hero.tsx              # Badge, gradient headline, CTAs, product screenshot
      social-proof.tsx      # Stats bar (features, MIT, self-hosted, no limits)
      feature-showcase.tsx  # Alternating left/right deep-dive sections
      feature-grid.tsx      # Compact grid for remaining features
      quick-start.tsx       # Terminal code block
      pricing.tsx           # 3-tier pricing cards
      cta-section.tsx       # Final call-to-action
      footer.tsx            # Minimal footer with links
  page.tsx                  # DELETE — (marketing)/page.tsx serves at / via route group
```

### Visual Design System

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#09090b` | Page background |
| Surface | `#111113` | Cards, code blocks |
| Border | `#27272a` | Subtle borders |
| Border hover | `#3f3f46` | Interactive borders |
| Text primary | `#fafafa` | Headings |
| Text secondary | `#a1a1aa` | Body text |
| Text muted | `#71717a` | Captions, labels |
| Accent | `#6366f1` | CTAs, highlights |
| Accent light | `#a5b4fc` | Gradient endpoints, hover states |
| Glow | `rgba(99, 102, 241, 0.08)` | Radial background gradients |

Typography:
- Font: Geist Sans (already configured via CSS vars)
- Hero heading: 56-64px, font-weight 800, letter-spacing -1.5px, gradient text
- Section headings: 32-36px, font-weight 700, letter-spacing -0.5px
- Body: 15-16px, line-height 1.7, text-secondary color
- Labels: 11px, uppercase, letter-spacing 1px, accent color

### Section Specifications

#### 1. Navbar

- Fixed/sticky on scroll with backdrop blur
- Left: Logo (gradient text "Chatbot"), nav links (Features, Pricing, Docs, GitHub icon)
- Right: "Sign in" text link, "Get Started" indigo button
- Border-bottom with subtle border color
- Mobile: Hamburger menu (future — not in initial scope)

#### 2. Hero

- Top badge pill: "Open Source · MIT Licensed · Self-Hosted" with border
- Headline: Two-line gradient text. Line 1: white→indigo. Line 2: indigo→deep indigo
- Suggested copy: "The AI Agent Platform / You Can Own"
- Subtitle: One sentence describing the platform (text-secondary)
- CTAs: "Deploy Free →" (filled indigo), "Star on GitHub" (outline with star icon)
- Below: Product screenshot in a macOS-style window frame with:
  - Traffic light dots
  - Indigo glow border (gradient border effect)
  - Stylized dashboard wireframe showing sidebar + agent cards
- Background: Radial gradient from top center (subtle indigo glow)

#### 3. Social Proof Bar

- Horizontal strip with border-top and border-bottom
- 4 stats centered: "12+" Core Features, "MIT" Licensed, "100%" Self-Hosted, "∞" No Usage Limits
- Animated count-up on scroll into view (keep existing CountUp component)

#### 4. Feature Deep-Dives (3-4 sections)

Alternating left-right layout. Each section:
- Label: Uppercase accent-colored category (e.g., "AGENT STUDIO")
- Heading: Bold feature title
- Description: 2-3 sentences explaining the value
- Visual: Stylized screenshot/mockup of that feature's UI

Sections:
1. **Agent Studio** — "Build agents visually, test instantly" + playground screenshot
2. **Knowledge Bases** — "RAG that just works" + document upload/search screenshot
3. **MCP Servers** — "Connect any tool" + MCP connection diagram/screenshot
4. **Analytics** — "Know what's happening" + analytics dashboard screenshot

#### 5. Feature Grid

Compact 3-4 column grid for remaining features. Each card:
- Icon (Lucide, in accent color on dark surface)
- Title
- One-line description
- Subtle hover: lift + border glow

Features: Multi-Tenant, RBAC & Security, Audit Logs, Background Jobs, Cognito Auth, Chat Widget SDK

#### 6. Quick-Start Terminal

- Centered section with heading: "Up and running in 60 seconds"
- Subtitle: "Three commands. That's it."
- Dark code block (surface background, monospace font)
- Content:
  ```
  # Clone and install
  $ git clone github.com/kartikmanimuthu/chatbot
  $ cd chatbot && bun install

  # Start everything
  $ bun run dev:all
  ```
- Optional: Copy button in top-right corner

#### 7. Pricing

- Heading: "Free forever. No catch."
- Subtitle: "Self-host and own your data. No usage limits, no vendor lock-in."
- 3 cards side by side:
  - **Self-Hosted** (highlighted): $0 forever, indigo border, "Popular" badge, features list, "Deploy Now" CTA
  - **Cloud**: "Coming soon", dimmed, features list, no CTA
  - **Enterprise**: "Custom", dimmed, features list, no CTA
- Self-hosted card features: All features included, Unlimited users, Unlimited agents, Community support
- Cloud features: Zero infrastructure, Automatic updates, Priority support
- Enterprise features: SLA guarantees, Custom integrations, On-premise option, Dedicated support

#### 8. Final CTA

- Heading: "Ready to build your AI agents?"
- Subtitle: "Deploy in under 5 minutes. Free, open source, self-hosted."
- Single CTA button: "Get Started Free →"
- Background: Radial gradient from bottom (subtle indigo glow)

#### 9. Footer

- Border-top separator
- Left: "Chatbot · MIT License · Built with Next.js & AWS Bedrock"
- Right: Links — Docs, GitHub, Getting Started
- Minimal, single row

### Animations (Framer Motion)

- Hero: Stagger reveal (badge → headline → subtitle → CTAs → screenshot)
- Stats: Count-up animation on scroll
- Feature deep-dives: Fade-in + slide from side on scroll
- Feature grid: Stagger reveal on scroll
- Cards: Hover lift (y: -4) with spring transition
- Pricing highlight: Subtle scale on hover (1.02)

### Dependencies

- `framer-motion` (already installed)
- `lucide-react` (already installed)
- shadcn/ui components: Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Separator (already installed)
- No new dependencies required

---

## Phase 2: Documentation Rewrite

### Index Page (`content/docs/index.mdx`)

Replace the plain feature table with a card-based layout using Fumadocs Cards component:

```mdx
---
title: Chatbot Documentation
description: Open-source, multi-tenant AI agent platform
---

import { Cards, Card } from 'fumadocs-ui/components/card';

## Get Started

<Cards>
  <Card title="Quick Start" href="/docs/user-guide/getting-started" description="Deploy your first agent in 5 minutes" />
  <Card title="Installation" href="/docs/dev-guide/installation" description="Docker, Pulumi, and manual setup" />
  <Card title="Architecture" href="/docs/dev-guide/architecture" description="System design and data flow" />
</Cards>

## User Guide

<Cards>
  <Card title="Agents" href="/docs/user-guide/agents" />
  <Card title="Knowledge Bases" href="/docs/user-guide/knowledge-bases" />
  <Card title="MCP Servers" href="/docs/user-guide/mcp-servers" />
  <Card title="LLM Providers" href="/docs/user-guide/llm-providers" />
  <Card title="Sessions" href="/docs/user-guide/sessions" />
  <Card title="Analytics" href="/docs/user-guide/analytics" />
</Cards>

## Developer Guide & API

<Cards>
  <Card title="Configuration" href="/docs/dev-guide/configuration" />
  <Card title="API Reference" href="/docs/api" />
  <Card title="FAQ" href="/docs/dev-guide/faq" />
</Cards>
```

### User Guide Rewrites

#### `getting-started.mdx`
- Add "What you'll build" intro with a screenshot
- Use Fumadocs `<Steps>` component for the setup flow
- Add `<Callout type="info">` for prerequisites
- Add `<Callout type="tip">` for common gotchas
- End with "Next steps" cards linking to feature guides

#### `agents.mdx`
- Intro explaining what agents are in this platform
- Mermaid diagram: Agent lifecycle (create → configure → test → publish)
- Sections: Creating an agent, System prompts, Attaching knowledge bases, Connecting MCP tools, Playground testing, Versioning
- Use `<Tabs>` for showing different model configurations
- Screenshots of key UI states

#### `knowledge-bases.mdx`
- Intro explaining RAG in plain terms
- Mermaid diagram: RAG pipeline (Upload → Chunk → Embed → Store → Query → Retrieve → Generate)
- Sections: Creating a KB, Uploading documents, Web source sync, Testing retrieval, Connecting to agents
- Use `<Callout type="warning">` for size limits and supported formats
- Include embedding model configuration

#### `mcp-servers.mdx`
- Intro explaining Model Context Protocol
- Mermaid diagram: MCP connection flow (Agent → MCP Server → External Tool/API)
- Sections: What is MCP, Adding a server, Configuration options, Testing connections, Using tools in agents
- Use `<Tabs>` for different transport types (stdio, HTTP)

#### `llm-providers.mdx`
- Intro explaining multi-provider support
- Table: Provider comparison (Bedrock vs OpenAI-compatible)
- Sections: Default Bedrock setup, Adding custom providers, Model selection, Cost tracking
- Use `<Tabs>` for Bedrock vs OpenAI config examples

#### `sessions.mdx`
- Explain session concept (conversation thread with an agent)
- Sections: Viewing sessions, Session history, Token usage, Conversation summaries
- Include how background workers generate summaries

#### `analytics.mdx`
- Dashboard overview with screenshot
- Sections: Inference tracking, Token costs, Session metrics, Date range filtering
- Explain what each metric means and how to use it

### Developer Guide Rewrites

#### `installation.mdx`
- Use `<Tabs>` for: Docker Compose | Manual | Pulumi
- Each tab has complete step-by-step instructions
- Use `<Steps>` within each tab
- Add `<Callout type="warning">` for common pitfalls (pgvector extension, Bedrock access)

#### `architecture.mdx`
- Full system Mermaid diagram showing all components
- Sections: Frontend (Next.js), Backend (API routes), Workers (pg-boss), Database (PostgreSQL + pgvector), AI (Bedrock), Auth (NextAuth + Cognito)
- Data flow diagrams for key operations: chat message, document upload, embedding generation
- Component responsibility matrix

#### `configuration.mdx`
- Group env vars by service using `<Tabs>`: Core | Auth | AI | Workers
- Use Fumadocs `<TypeTable>` for structured env var documentation
- Each var: name, type, required/optional, default, description
- Add `<Callout type="danger">` for security-sensitive vars

#### `faq.mdx`
- Expand to 15-20 real questions
- Group by category: Setup, Agents, Knowledge Bases, Auth, Deployment
- Include troubleshooting for common errors
- Link to relevant docs sections

### API Reference Rewrites

Each endpoint doc (`agents-api.mdx`, `knowledge-base-api.mdx`, etc.) gets:
- Endpoint summary table (method, path, auth required)
- Request body schema with `<TypeTable>`
- Use `<Tabs>` for request/response examples (cURL, JavaScript)
- Error codes table
- `<Callout type="info">` for rate limits or special behavior

### Fumadocs Components Used

| Component | Usage |
|-----------|-------|
| `Cards` / `Card` | Index page navigation, "next steps" sections |
| `Steps` | Sequential setup instructions |
| `Callout` | Info, tips, warnings, danger notices |
| `Tabs` | Alternative configs, multi-language examples |
| `TypeTable` | Env vars, API schemas, config options |
| Mermaid (code blocks) | Architecture diagrams, data flow, lifecycles |

---

## Out of Scope

- Mobile responsive nav (hamburger menu) — future iteration
- Blog / changelog pages — future addition to `(marketing)` route group
- Inquiry / contact form — future addition
- Real product screenshots (using CSS mockups initially)
- Dark mode toggle on marketing page (it's always dark)
- i18n / translations
- SEO meta tags optimization (basic meta is fine)
- OpenAPI JSON spec file
- Interactive API playground in docs
- Versioned documentation

---

## Implementation Order

1. Create `(marketing)` route group structure
2. Build layout (dark theme, nav, footer)
3. Build hero section with product screenshot mockup
4. Build social proof bar
5. Build feature deep-dive sections
6. Build feature grid
7. Build quick-start terminal section
8. Build pricing section
9. Build final CTA
10. Wire up root `page.tsx`
11. Rewrite docs index page
12. Rewrite user guide docs (6 files)
13. Rewrite developer guide docs (4 files)
14. Rewrite API reference docs (6 files)
15. Verify build passes and test in browser

---

## Verification Checklist

- [ ] Marketing page renders without errors in dark theme
- [ ] All sections visible and properly animated
- [ ] Product screenshot mockup displays correctly
- [ ] Nav links work (Features, Pricing scroll; Docs, GitHub navigate)
- [ ] CTAs link to correct destinations
- [ ] All docs pages load without 404
- [ ] Sidebar navigation reflects grouped structure
- [ ] Cross-links between pages work
- [ ] Fumadocs components render (Cards, Steps, Callout, Tabs)
- [ ] Mermaid diagrams render in docs
- [ ] Build passes (`bun run build`)
