# Product Requirements Document (PRD)

## No-Code AI Agent Builder Platform

**Document Version:** 1.0  
**Date:** 2026-05-03  
**Author:** Product Owner  
**Status:** Draft for Review

---

## 1. Executive Summary

We are building a **multi-tenant, no-code AI agent builder platform** that enables businesses to visually design, test, deploy, and monitor LLM-powered AI agents without writing code. The platform positions itself as the "Figma for AI backends" — democratizing agent development for product teams, operations leaders, and developers who want to move fast.

**Immediate Goal:** Ship a competitive no-code agent builder that rivals Langflow and Flowise, but with superior multi-tenancy, enterprise RBAC, and integrated voice/analytics extensibility baked in from day one.

**Long-Term Vision:** Evolve the platform into a full-service **Voice Agent & Analytics Suite** purpose-built for **Customer Support** and **Sales Operations** — allowing enterprises to deploy autonomous voice and chat agents that handle inbound/outbound customer interactions, with deep analytics dashboards measuring resolution rates, sentiment, conversion, and agent performance.

The product will be built on top of our existing **multi-tenant AI chatbot infrastructure** (Next.js 15, Nx monorepo, Prisma/PostgreSQL, Vercel AI SDK + Bedrock, Workers, RBAC, Audit Logging), leveraging our auth, tenant isolation, and AI SDK foundation to accelerate delivery.

---

## 2. Problem Statement

### 2.1 Market Pain Points

| Pain Point | Evidence | Impact |
|---|---|---|
| **Technical barrier to AI agents** | Building LangChain/LlamaIndex flows requires Python/TS expertise | Only engineering teams can prototype; business users are blocked |
| **Fragmented tooling** | Teams stitch together vector DBs, prompt managers, API gateways, observability | High integration cost, slow iteration, brittle pipelines |
| **Poor multi-tenancy in open-source tools** | Langflow/Flowise are single-tenant by default | Agencies and SaaS startups cannot resell or isolate client data |
| **No native voice or analytics** | Existing tools stop at text chat; no call handling or business metrics | Cannot address customer service/sales use cases end-to-end |
| **Deployment friction** | Exporting flows as APIs requires manual DevOps | Slow time-to-production, versioning chaos |

### 2.2 User Jobs-to-be-Done

1. **As a support manager**, I want to build a refund-handling agent so that Tier-1 tickets are resolved autonomously without engineering help.
2. **As a sales ops lead**, I want to create a lead-qualification agent that calls prospects and books meetings so that SDR productivity doubles.
3. **As a SaaS founder**, I want to embed white-label agents into my product for my tenants so that I can offer AI features without rebuilding infrastructure.
4. **As an AI engineer**, I want to prototype multi-agent orchestration visually so that I can validate architectures before writing production code.

---

## 3. Product Vision

> **"Every team should be able to build and deploy intelligent agents in minutes, not months."**

We will deliver a **visual canvas** where users assemble agents from pre-built components (LLMs, tools, memory, vector stores, conditional logic), test them in an interactive playground, and deploy them as APIs, chat widgets, or voice endpoints — all within a secure, multi-tenant workspace with full audit trails.

### 3.1 Differentiation vs. Incumbents

| Dimension | Langflow | Flowise | **Our Platform** |
|---|---|---|---|
| **Multi-tenancy** | Single-tenant OSS | Single-tenant OSS | **Native tenant isolation, orgs, RBAC** |
| **Auth & Enterprise** | Basic | Basic SSO | **NextAuth + RBAC + Audit logs + Invitations** |
| **Voice** | None | None | **Native voice pipeline (Twilio/Exotel integration planned)** |
| **Analytics** | Basic traces | Basic metrics | **Business-level analytics (resolution, sentiment, conversion)** |
| **Deployment** | Manual export | API + widget | **One-click deploy + versioned environments (dev/staging/prod)** |
| **White-label** | Not supported | Not supported | **Tenant-scoped theming + embeddable widgets** |
| **Open Source Model** | OSS (Datastax) | OSS (Workday) | **Open-core: OSS builder + Enterprise analytics/voice** |

---

## 4. Target Users & Personas

### Persona A: Maya — Support Operations Manager
- **Profile:** Non-technical. Manages a 20-person support team at a D2C e-commerce brand.
- **Goal:** Reduce ticket volume by 40% using an autonomous refund/status agent.
- **Behavior:** Uses templates, needs pre-built Shopify/Zendesk connectors, wants analytics on resolution rates.
- **Key Feature:** One-click template deployment, human-in-the-loop approval for refunds.

### Persona B: Rahul — SaaS Founder (Technical)
- **Profile:** Full-stack developer building a legal-tech SaaS. Wants to add AI features.
- **Goal:** Embed a document-analysis agent into his product for each of his 50 tenants.
- **Behavior:** Needs API endpoints, tenant isolation, usage quotas, white-label embedding.
- **Key Feature:** Multi-tenant agent deployment, REST API with tenant-scoped keys, embeddable widget.

### Persona C: Elena — AI Engineer at Enterprise
- **Profile:** Works in a bank's AI center of excellence. Prototypes before production.
- **Goal:** Visually prototype a multi-agent KYC verification pipeline.
- **Behavior:** Uses custom Python tools, needs observability, version control, guardrails.
- **Key Feature:** Custom tool import, execution traces, approval gates, environment promotion.

### Persona D: Vikram — Sales Ops Lead
- **Profile:** Runs outbound sales for a B2B SaaS. Non-technical.
- **Goal:** Deploy a voice agent that calls leads, qualifies them, and books demos.
- **Behavior:** Uploads lead lists, listens to call recordings, wants conversion dashboards.
- **Key Feature:** Voice agent builder, CRM sync (HubSpot/Salesforce), call analytics.

---

## 5. Competitive Analysis

### 5.1 Langflow (Datastax)

**Strengths:**
- Mature component ecosystem (hundreds of pre-built nodes)
- Strong community, open-source
- Agentic components, MCP support, knowledge bases
- AI-assisted component generation (Langflow Assistant)

**Weaknesses:**
- Single-tenant architecture; no native org/workspace isolation
- Weak enterprise auth (no granular RBAC, audit logs)
- No voice capabilities
- Limited business analytics (only technical traces)
- Deployment requires manual DevOps; no environment management

### 5.2 Flowise (Acquired by Workday, Aug 2025)

**Strengths:**
- Three visual builders (Assistant, Chatflow, Agentflow V2)
- 100+ integrations (LLMs, vector DBs, APIs)
- Multi-agent orchestration with routing and loops
- Human-in-the-loop support
- Auto-generated APIs + embeddable widget

**Weaknesses:**
- Single-tenant OSS core
- No native voice pipeline
- Analytics are technical, not business-oriented
- Post-acquisition roadmap uncertainty (enterprise vs. community)
- Limited white-label or multi-tenant resale support

### 5.3 Niche / Adjacent Competitors

| Competitor | Focus | Gap We Fill |
|---|---|---|
| **Voiceflow** | Conversational AI for chat/voice | Weak LLM agent orchestration; no visual multi-agent builder |
| **Retool** | Internal tools + AI workflows | Not purpose-built for agent deployment or voice |
| **Botpress** | Chatbot builder | Lacks advanced multi-agent orchestration and voice |
| **CrewAI** | Multi-agent framework | Code-only, no visual builder |

---

## 6. Product Features

### 6.1 Core Platform (Phase 1 — MVP)

#### F1: Visual Agent Builder Canvas
- **Description:** An infinite canvas where users drag, drop, and connect nodes to build agent workflows.
- **Nodes:** LLM, Prompt, Tool, Memory, Conditional Router, Loop, Parallel Split, Merge, Input/Output, API Call, Vector Store Retriever, Document Loader.
- **Connections:** Directed edges with data flow visualization; type-safe port matching.
- **Sub-flows:** Ability to collapse a group of nodes into a reusable "Component" that appears in the library.
- **Undo/Redo, Zoom, Pan, Mini-map.**
- **Keyboard shortcuts:** Delete, duplicate, CMD+K quick-add.

#### F2: Component Library & Marketplace
- **Categories:** LLMs, Embeddings, Vector Stores, Document Loaders, Tools, Logic, Agents, Chat, Voice.
- **Pre-built integrations:** OpenAI, Anthropic, Bedrock, Groq, Ollama, Pinecone, Qdrant, Weaviate, pgvector, Serper, Zapier, GitHub, Slack, Notion.
- **Custom Tool Builder:** UI for wrapping any REST API or Python/TypeScript function as a reusable node.
- **Templates:** "Customer Support Agent", "Lead Qualifier", "RAG Document Q&A", "SQL Analyst". One-click clone and modify.
- **Marketplace (future):** Community-contributed components rated by usage.

#### F3: Agent Execution Engine
- **Runtime:** Executes flows server-side with dependency graph resolution.
- **Modes:**
  - **Synchronous:** REST API call, returns final output.
  - **Asynchronous:** Webhook or worker queue for long-running flows.
  - **Streaming:** SSE for real-time token/chunk streaming to UI.
- **State Management:** Persistent execution state for long-running or human-in-the-loop flows.
- **Error Handling:** Retry with backoff, fallback LLM, dead-letter queue with visibility in UI.
- **Observability:** Per-step execution trace with inputs, outputs, token count, latency, and cost.

#### F4: Interactive Playground
- **Description:** In-product chat interface to test agents before deployment.
- **Features:**
  - Threaded conversation with reset/clear.
  - Side-by-side trace inspector (see which nodes fired, what data passed through).
  - Token usage and estimated cost per run.
  - Version compare: test two agent versions side-by-side.
  - Shareable playground links (with expiry) for stakeholder review.

#### F5: Deployment & Environment Management
- **Deployment Targets:**
  - **REST API:** Auto-generated OpenAPI spec, rate-limited per tenant.
  - **Chat Widget:** Embeddable JS snippet, themable per tenant.
  - **Webhook:** Trigger flows from external events (Stripe, Zendesk, etc.).
  - **Scheduled:** Cron-triggered agent runs.
- **Environments:** Dev / Staging / Prod per tenant.
  - Promote flows between environments with version pinning.
  - Environment-specific variables (API keys, endpoints).
- **Versioning:** Git-like versioning for flows — branch, tag, rollback.

#### F6: Multi-Tenant Workspace & RBAC
- **Organizations:** Each tenant is an isolated workspace with its own agents, knowledge bases, users, and usage quotas.
- **Roles:**
  - **Owner:** Full access, billing, deletion.
  - **Admin:** Manage members, agents, environments.
  - **Editor:** Create/modify agents, cannot delete org or manage billing.
  - **Viewer:** Read-only + playground access.
  - **Agent Runner:** API key scope limited to invoking specific agents.
- **Audit Logs:** Who created/modified/deployed what agent when. Exportable.
- **Invitations:** Email-based invites with role pre-selection.

#### F7: Knowledge Base / RAG
- **Document Ingestion:** Upload PDF, DOCX, TXT, CSV, or sync from Google Drive / Notion.
- **Chunking Strategies:** Fixed-size, semantic, recursive, markdown-aware.
- **Vector Store:** pgvector (leveraging existing infrastructure) with tenant-scoped namespaces.
- **Retrieval Modes:** Similarity search, MMR (Max Marginal Relevance), hybrid (sparse + dense).
- **Metadata Filtering:** Filter chunks by metadata fields (e.g., `department=legal`).

#### F8: LLM Provider Management
- **Global Provider Setup:** Configure API keys once per organization; reuse across all agents.
- **Supported Providers:** OpenAI, Anthropic, Azure OpenAI, AWS Bedrock (existing), Groq, Mistral, Ollama (self-hosted), Cohere.
- **Fallbacks:** If primary provider fails, auto-fallback to secondary provider.
- **Cost Tracking:** Per-tenant spend tracking by provider and model.

---

### 6.2 Advanced Orchestration (Phase 2)

#### F9: Multi-Agent Orchestration
- **Agent Teams:** Define a team of agents with roles (e.g., `researcher`, `writer`, `critic`).
- **Routing:** LLM-based or rule-based router decides which agent handles the next step.
- **Handoffs:** Agents can delegate to other agents and receive results back.
- **Parallel Execution:** Fan-out to multiple agents concurrently, merge results.
- **Loops:** Iterative refinement loops with exit conditions.

#### F10: Human-in-the-Loop (HITL)
- **Approval Gates:** Pause flow execution and send approval request (email / in-app / Slack).
- **Input Requests:** Ask a human for missing information mid-flow.
- **Correction:** Allow operators to edit agent outputs before continuing.
- **Escalation:** Auto-escalate to human after N failed attempts or negative sentiment.

#### F11: Guardrails & Safety
- **Content Moderation:** Built-in PII detection, profanity filter, topic blocklists.
- **Output Validation:** JSON schema validation, regex matching, custom validator nodes.
- **Rate Limiting:** Per-agent, per-tenant, and per-user rate limits.
- **Cost Caps:** Max spend per run / per day / per tenant.

#### F12: MCP & External Tool Ecosystem
- **MCP Client:** Connect to any Model Context Protocol server as a tool source.
- **MCP Server Export:** Expose any agent flow as an MCP server for Claude Desktop, Cursor, etc.
- **Zapier/Make Integration:** 5,000+ app connections via no-code automation platforms.

---

### 6.3 Voice Agent Suite (Phase 3)

#### F13: Voice Agent Builder
- **Description:** Specialized canvas variant for building voice conversation flows.
- **Voice Nodes:** Speech-to-Text (Deepgram, AssemblyAI, Whisper), LLM, Text-to-Speech (ElevenLabs, Play.ht, AWS Polly), Call Control (transfer, hangup, hold).
- **Telephony Integrations:** Twilio, Exotel, Plivo, Telnyx. Inbound IVR and outbound dialer.
- **Conversation Memory:** Maintain context across a phone call session.
- **Call Recording:** Record and transcribe calls; store with tenant isolation.

#### F14: Outbound Campaign Manager
- **Lead List Upload:** CSV upload or CRM sync (HubSpot, Salesforce, Zoho).
- **Dialer Modes:** Predictive, power, preview.
- **Scheduling:** Timezone-aware calling windows, retry logic (busy, no-answer).
- **Compliance:** DNC (Do-Not-Call) list checking, opt-out handling, TCPA/GDPR consent tracking.

#### F15: Real-Time Voice Intelligence
- **Live Agent Assist:** Human agents see real-time transcription + suggested responses + knowledge retrieval.
- **Sentiment Analysis:** Real-time emotion detection; auto-escalate on anger/frustration.
- **Talk Ratio / Interruption Detection:** Coaching metrics for QA teams.

---

### 6.4 Analytics & Business Intelligence (Phase 4)

#### F16: Agent Performance Dashboard
- **Metrics:**
  - Total conversations / calls
  - Resolution rate (autonomous vs. escalated)
  - Average handling time (AHT)
  - CSAT / NPS (post-interaction surveys)
  - Cost per conversation
  - Token usage by model
- **Visualizations:** Time-series charts, funnel views, comparison tables.
- **Drill-down:** Click from aggregate metric to individual conversation trace.

#### F17: Voice Analytics
- **Call Metrics:** Connect rate, average call duration, voicemail drop rate, conversion rate.
- **Conversation Quality:** Sentiment trajectory, silence detection, script adherence.
- **Recording Library:** Searchable by date, agent, outcome, sentiment.

#### F18: Customer & Sales Intelligence
- **Unified Contact View:** Timeline of all interactions (chat + voice + email) per customer.
- **Lead Scoring:** Auto-score leads based on conversation engagement and intent.
- **Pipeline Integration:** Sync opportunity creation and stage changes to CRM.
- **Revenue Attribution:** Track which agent/campaign sourced which closed-won deals.

#### F19: Custom Reports & Alerts
- **Report Builder:** Drag-and-drop metrics into custom dashboards.
- **Scheduled Reports:** Daily/weekly email summaries.
- **Alerts:** Webhook or email when resolution rate drops below threshold, cost spikes, or error rate exceeds limit.

---

## 7. User Flows & Journeys

### 7.1 First-Time User: Build First Agent (Maya)

```
1. Sign up → Create organization → Invite team (optional)
2. Dashboard: "Create your first agent" CTA
3. Template picker: "Customer Support Agent" → Clone
4. Canvas: Pre-populated with RAG + LLM + Zendesk ticket node
5. Connect knowledge base: Upload FAQ PDF → Auto-chunk + embed
6. Playground: Test with "What's your return policy?"
7. Trace inspector: Verify correct retrieval + accurate answer
8. Deploy: Choose "Chat Widget" → Copy embed code
9. Analytics: After 1 week, view resolution rate dashboard
```

### 7.2 AI Engineer: Multi-Agent Prototype (Elena)

```
1. Create new flow from scratch
2. Add Router node → Connect 3 Agent nodes (KYC-Doc, KYC-Face, KYC-DB)
3. Import custom Python tool: "liveness_check.py"
4. Set approval gate before final "Approve Account" node
5. Run in playground with test payload
6. Review trace for token usage and latency
7. Tag version v0.1 → Promote to Staging
8. API tab: Copy curl command for integration testing
```

### 7.3 Sales Ops: Launch Voice Campaign (Vikram)

```
1. Navigate to "Voice Campaigns" → New Campaign
2. Upload leads CSV (name, phone, company)
3. Select voice agent: "Demo Booker" (pre-built)
4. Configure dialer: Predictive, 9am-6pm IST, max 3 retries
5. Connect HubSpot: Map "booked meeting" → create calendar event + opportunity
6. Launch campaign (approval from admin required)
7. Live dashboard: Connect rate, conversations in progress, conversions
8. Post-call: Listen to recordings, mark outcomes, view transcripts
```

---

## 8. Technical Architecture

### 8.1 Leveraging Existing Infrastructure

We will build the agent builder on top of our current **multi-tenant AI chatbot monorepo** to maximize velocity and reuse:

| Existing Asset | How We Reuse It |
|---|---|
| **Next.js 15 + App Router** | Host the visual canvas (React Flow), playground, dashboards |
| **Nx Monorepo** | Add `apps/agent-builder/` and `libs/agent-runtime/` libraries |
| **Prisma + PostgreSQL + pgvector** | Store flow definitions, execution states, knowledge bases, vector embeddings |
| **NextAuth v4 + RBAC** | Org-scoped auth, roles, audit logs — extend for agent-level permissions |
| **Vercel AI SDK + Bedrock** | LLM invocation layer inside execution engine |
| **Workers (Bull/Boss pattern)** | Async flow execution, document ingestion, embedding jobs |
| **Audit Service** | Log all agent deployments, executions, approvals |
| **Tenant Middleware** | `x-tenant-id` isolation extended to agent runtime and vector stores |

### 8.2 New Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Web UI (Next.js)                        │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌─────────────┐  │
│  │  Canvas  │ │ Playground│ │ Dashboards │ │  Settings   │  │
│  │(ReactFlow)│ │  (Chat)   │ │(Analytics) │ │(RBAC/Billing│  │
│  └────┬─────┘ └────┬─────┘ └─────┬──────┘ └──────┬──────┘  │
└───────┼────────────┼─────────────┼───────────────┼─────────┘
        │            │             │               │
        └────────────┴─────────────┴───────────────┘
                          │
                   ┌──────▼──────┐
                   │  API Layer   │
                   │  (tRPC/REST) │
                   └──────┬───────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   ┌────▼────┐      ┌─────▼─────┐      ┌────▼────┐
   │ Flow    │      │ Agent     │      │ Voice   │
   │ Editor  │      │ Runtime   │      │ Gateway │
   │ Service │      │ Service   │      │ (Twilio)│
   └────┬────┘      └─────┬─────┘      └────┬────┘
        │                 │                 │
   ┌────▼─────────────────▼─────────────────▼────┐
   │              Data Layer                        │
   │  PostgreSQL  │  Redis  │  S3 (recordings/docs) │
   │  (Prisma)    │(Queues) │                       │
   └───────────────────────────────────────────────┘
```

#### Agent Runtime Service (`libs/agent-runtime`)
- **Flow Parser:** Converts JSON flow definitions into executable DAGs.
- **Executor:** Topological sort + parallel execution of independent branches.
- **Node Registry:** Pluggable node implementations (LLMNode, ToolNode, VectorStoreNode, etc.).
- **Context Manager:** Maintains execution state, variables, and memory across nodes.
- **Streaming Handler:** SSE output for real-time UX.

#### Flow Editor Service
- **CRUD for flows:** Draft, version, publish.
- **Validation:** Cyclic graph detection, type mismatch on ports, required field checks.
- **Export/Import:** JSON (native), Langflow JSON (import), Flowise JSON (import).

#### Voice Gateway
- **WebSocket Handler:** Real-time audio streaming from telephony providers.
- **Pipeline:** STT → LLM → TTS with sub-500ms latency target.
- **Call State Machine:** Manage hold, transfer, conference, hangup.

### 8.3 Database Schema Extensions (Prisma)

New tables (tenant-scoped via `@@map` and relations):

- **Flow:** `id`, `tenantId`, `name`, `description`, `definition` (JSON), `version`, `status` (draft/published/archived), `createdBy`, timestamps.
- **FlowExecution:** `id`, `flowId`, `tenantId`, `status`, `input`, `output`, `trace` (JSON), `tokenCount`, `cost`, `latencyMs`, `createdAt`.
- **NodeDefinition:** `id`, `type`, `category`, `configSchema` (JSON), `handlerPath`.
- **KnowledgeBase:** `id`, `tenantId`, `name`, `chunkingStrategy`, `vectorNamespace`.
- **Document:** `id`, `knowledgeBaseId`, `filename`, `mimeType`, `chunkCount`, `status`.
- **VectorChunk:** `id`, `documentId`, `content`, `embedding`, `metadata` (JSON).
- **Campaign (Voice):** `id`, `tenantId`, `name`, `agentId`, `leadList` (JSON), `schedule`, `status`, `stats` (JSON).
- **CallRecord:** `id`, `campaignId`, `phoneNumber`, `duration`, `recordingUrl`, `transcript`, `sentiment`, `outcome`.

---

## 9. Product Roadmap

### Phase 1: Core Agent Builder (Months 1–3)
**Goal:** Ship MVP that rivals Flowise core functionality.

| Sprint | Deliverables |
|---|---|
| **S1–2** | Visual canvas (React Flow), 10 core nodes, canvas CRUD |
| **S3–4** | Agent runtime engine (sync + async), playground with traces |
| **S5–6** | Knowledge base (upload, chunk, pgvector embedding), RAG node |
| **S7–8** | Deployment: REST API auto-generation, chat widget, webhooks |
| **S9–10** | Templates (5), component library v1, custom tool builder |
| **S11–12** | RBAC refinement, audit logs, environment management (dev/staging/prod), billing integration (Stripe) |

**MVP Exit Criteria:**
- User can build a RAG-enabled support agent from template in < 10 minutes.
- Deploy as chat widget and REST API.
- Multi-tenant isolation verified via penetration testing.
- 99.9% uptime on runtime API.

### Phase 2: Advanced Orchestration (Months 4–5)

| Sprint | Deliverables |
|---|---|
| **S13–14** | Multi-agent orchestration (teams, routing, handoffs) |
| **S15–16** | Human-in-the-loop (approval gates, input requests, Slack/email notifications) |
| **S17–18** | Guardrails (PII detection, output validation, cost caps) |
| **S19–20** | MCP client + server export, Zapier integration |

### Phase 3: Voice Agent Suite (Months 6–8)

| Sprint | Deliverables |
|---|---|
| **S21–22** | Voice canvas nodes (STT, LLM, TTS, call control), Twilio integration |
| **S23–24** | Inbound IVR builder + outbound campaign manager |
| **S25–26** | CRM sync (HubSpot, Salesforce), lead list management |
| **S27–28** | Live agent assist, real-time sentiment, call recording library |

### Phase 4: Analytics & Customer/Sales Platform (Months 9–12)

| Sprint | Deliverables |
|---|---|
| **S29–30** | Agent performance dashboard (resolution, CSAT, cost) |
| **S31–32** | Voice analytics (connect rates, sentiment trajectory, QA scoring) |
| **S33–34** | Unified contact timeline, lead scoring, revenue attribution |
| **S35–36** | Custom report builder, scheduled reports, alerting |

### Phase 5: Scale & Enterprise (Year 2)

- **SSO/SAML/LDAP** integration
- **Air-gapped / on-premise** deployment option
- **White-label marketplace** for agencies to resell agents
- **Advanced AI:** Fine-tuning UI, evaluation framework, A/B testing for prompts
- **Partner ecosystem:** Certified integrators, revenue share marketplace

---

## 10. Monetization & Pricing Strategy

### 10.1 Pricing Tiers

| Plan | Price | Targets |
|---|---|---|
| **Free** | $0 | Individual builders, open-source community |
| **Starter** | $29/mo | Small teams, 1-2 agents, basic RAG |
| **Pro** | $99/mo | Growing teams, multi-agent, voice preview |
| **Business** | $299/mo | Departments, unlimited agents, voice campaigns, analytics |
| **Enterprise** | Custom | SSO, SLA, on-prem, dedicated support, custom AI models |

### 10.2 Usage-Based Metering

- **Messages/Calls:** Per-conversation pricing beyond included quota.
- **Token Usage:** Pass-through LLM cost + small platform margin.
- **Storage:** Knowledge base documents, call recordings, logs.
- **Compute:** Worker execution time for async flows.

### 10.3 Revenue Model

- **Subscription:** 70% of revenue (seat + base tier).
- **Usage:** 25% of revenue (overage + token margin).
- **Marketplace:** 5% of revenue (premium template/component sales, revenue share).

---

## 11. Success Metrics (KPIs)

### 11.1 North Star Metric
**Weekly Active Agents (WAA):** Number of unique agents invoked at least once in a week. Measures real usage, not just creation.

### 11.2 Leading Indicators

| Metric | Target (6 months post-MVP) | Measurement |
|---|---|---|
| **Time to First Agent** | < 15 minutes | Onboarding funnel analytics |
| **Template Usage Rate** | > 60% of new agents | Flow metadata |
| **Playground → Deploy** | > 40% of built agents deployed | Flow status transitions |
| **API Uptime** | 99.9% | Health checks |
| **Avg Execution Latency** | < 2s for simple flows, < 5s for RAG | Execution logs |
| **Tenant Retention (Month-1)** | > 70% | Auth/session analytics |

### 11.3 Lagging Indicators

| Metric | Target (12 months) |
|---|---|
| **Monthly Recurring Revenue (MRR)** | $50K |
| **Paid Conversions** | 8% of signups |
| **NPS** | > 40 |
| **Enterprise POCs** | 10 active |
| **Community Components** | 100+ marketplace submissions |

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Langflow/Flowise add multi-tenancy** | Medium | High | Differentiate on voice + analytics + enterprise features; move faster |
| **LLM provider rate limits / downtime** | High | Medium | Multi-provider fallback; caching; async queues |
| **Voice latency unacceptable** | Medium | High | Partner with ultra-low-latency STT/TTS (Deepgram, ElevenLabs); edge deployment |
| **Security breach in multi-tenant runtime** | Low | Critical | Sandboxed execution (VM2/Firecracker), strict tenant isolation audits, SOC 2 prep |
| **User churn due to complexity** | Medium | High | Invest in templates, onboarding wizard, in-product tutorials, AI assistant |
| **Open-source community competition** | High | Medium | Open-core model: OSS builder, proprietary analytics/voice/enterprise |
| **Regulatory (TCPA/GDPR for voice)** | Medium | High | Built-in DNC lists, consent tracking, auto-opt-out, legal review before voice launch |

---

## 13. Open Questions & Decisions

1. **Canvas Library:** React Flow vs. Rete.js vs. custom SVG? *(Recommendation: React Flow — ecosystem, Typescript, active maintenance.)*
2. **Agent Runtime Language:** TypeScript (leverage existing) vs. Python (LangChain ecosystem)? *(Recommendation: TypeScript for core runtime, Python bridge for custom tool execution.)*
3. **Voice STT/TTS Default:** Deepgram + ElevenLabs vs. AWS Transcribe/Polly? *(Recommendation: Deepgram/ElevenLabs for quality; AWS as enterprise fallback.)*
4. **Embedding Model:** OpenAI `text-embedding-3-small` vs. Bedrock Titan vs. self-hosted? *(Recommendation: Bedrock Titan to align with existing AWS infrastructure.)*
5. **Marketplace Governance:** Manual review vs. automated + community flagging? *(Recommendation: Automated scanning + manual review for v1.)*

---

## 14. Appendix

### A. Glossary

| Term | Definition |
|---|---|
| **Agent** | An autonomous system that uses an LLM to perceive, decide, and act via tools. |
| **Flow** | A visual graph of nodes defining an agent's behavior. |
| **RAG** | Retrieval-Augmented Generation — augmenting LLM prompts with fetched documents. |
| **MCP** | Model Context Protocol — standard for connecting AI systems to external data/tools. |
| **HITL** | Human-in-the-Loop — requiring human approval at certain steps. |
| **STT/TTS** | Speech-to-Text / Text-to-Speech. |
| **Tenant** | An isolated organizational workspace with dedicated resources and users. |

### B. Reference Links

- [Langflow Official Site](https://langflow.org/)
- [Langflow 1.8 Release Notes](https://www.langflow.org/blog/langflow-1-8)
- [Flowise Official Site](https://flowiseai.com/)
- [Flowise Pricing](https://flowiseai.com/pricing)
- [How we use Flowwise to build AI Agents — 2V Automation.AI](https://www.2vautomation.ai/blog/how-we-use-flowwise-to-build-ai-agents)
- [Flowise AI Review, Pricing, Features and Alternatives](https://aimojo.io/tools/flowise-ai/)

---

*End of Document — Ready for Product Team Review*
