# Chatbot Platform — Feature Documentation

> **Last updated:** 2026-06-15  
> **Version:** Based on main branch (commit `36d5e6f`)

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Authentication & Identity](#2-authentication--identity)
3. [Multi-Tenancy & Organization Management](#3-multi-tenancy--organization-management)
4. [Role-Based Access Control (RBAC)](#4-role-based-access-control-rbac)
5. [AI Agents](#5-ai-agents)
6. [Agent Studio — Visual Workflow Builder](#6-agent-studio--visual-workflow-builder)
7. [Knowledge Base & RAG](#7-knowledge-base--rag)
8. [LLM Provider Management](#8-llm-provider-management)
9. [Communication Channels](#9-communication-channels)
10. [Embeddable SDK Chat Widget](#10-embeddable-sdk-chat-widget)
11. [Analytics & Insights](#11-analytics--insights)
12. [Audit & Compliance](#12-audit--compliance)
13. [MCP (Model Context Protocol)](#13-mcp-model-context-protocol)
14. [Background Workers & Job Processing](#14-background-workers--job-processing)
15. [Infrastructure & Deployment](#15-infrastructure--deployment)
16. [Documentation & Marketing](#16-documentation--marketing)
17. [Testing & Quality Assurance](#17-testing--quality-assurance)

---

## 1. Platform Overview

Chatbot is an open-source, multi-tenant AI chatbot platform powered by AWS Bedrock. It is designed for production self-hosting and supports multiple organizations (tenants) with complete data isolation, role-based access control, persistent conversation history, and retrieval-augmented generation (RAG) via pgvector.

### Key Capabilities
- **Multi-tenant architecture** — each organization operates in complete isolation
- **AI-powered conversations** — powered by Claude on AWS Bedrock (with support for OpenAI, Anthropic, Ollama, vLLM)
- **Visual agent builder** — node-based workflow designer for complex agent behaviors
- **Omnichannel deployment** — embeddable widgets, REST API, WhatsApp, and Telegram (coming soon)
- **Enterprise-grade security** — RBAC, audit logging, SSO, encrypted credentials

---

## 2. Authentication & Identity

### 2.1 Credentials-based Authentication
- Email/password registration and login
- Secure password hashing (bcrypt)
- Password reset via email token
- Forgot password flow with time-limited reset tokens
- Account lockout after failed attempts with automatic unlock

### 2.2 Cognito SSO (Single Sign-On)
- AWS Cognito integration via OpenID Connect
- Authorization code grant flow
- Seamless "Sign in with SSO" button on login page
- Automatic user provisioning on first SSO login

### 2.3 Session Management
- JWT-based sessions via NextAuth.js v4
- Session token rotation
- Configurable session expiry
- Secure session storage in PostgreSQL

---

## 3. Multi-Tenancy & Organization Management

### 3.1 Tenant Architecture
- Every piece of data is scoped to a `Tenant` (organization)
- Automatic tenant isolation via middleware header injection (`x-tenant-id`)
- Users without a tenant are redirected to `/create-org`

### 3.2 Organization Lifecycle
- **Create organization** — users can create new tenants with unique slugs
- **Switch organization** — users belonging to multiple tenants can switch contexts
- **My organizations** — list all tenants the user belongs to
- **Slug validation** — real-time uniqueness checks for tenant slugs

### 3.3 Tenant Configuration
- Key-value configuration store per tenant (`TenantConfig`)
- Runtime configuration updates without restarts

### 3.4 Member Invitations
- Email-based invitations to join organizations
- Role assignment at invite time
- Expiry-based invitation links
- Prevent duplicate invitations to the same email

---

## 4. Role-Based Access Control (RBAC)

### 4.1 Predefined Roles
Four built-in roles with escalating privileges:

| Role | Level | Permissions |
|------|-------|-------------|
| **Owner** | 4 | Full CRUD on all modules |
| **Admin** | 3 | Full CRUD except Settings delete |
| **Member** | 2 | Create/Read/Update on Agents, KBs, MCPs, Providers |
| **Viewer** | 1 | Read-only across all modules |

Modules covered: Settings, Users, Tenants, Agents, KnowledgeBases, McpServers, LlmProviders.

### 4.2 Custom Roles
- Create tenant-specific custom roles
- Granular permission assignment per module and action (`create`, `read`, `update`, `delete`)
- Automatic role level calculation based on permission breadth
- Role assignment restrictions (higher-level users can assign lower or equal roles)

### 4.3 Permission Enforcement
- Middleware-level tenant header injection
- API route guards checking permissions before processing
- Permission-aware UI (hide/disable actions based on role)

---

## 5. AI Agents

### 5.1 Agent Lifecycle Management
- **Create** — configure name, description, type (`simple` or `workflow`), and system config
- **Edit** — modify agent configuration with draft/published state tracking
- **Publish** — promote a draft to active; creates an immutable version
- **Delete** — soft-delete with cascade cleanup
- **Validate** — pre-publish validation of agent configuration

### 5.2 Agent Versioning
- Every publish creates a new immutable `AgentVersion`
- Version numbers auto-increment (`version` integer)
- Version status tracking: `draft`, `published`, `archived`
- Rollback capability via alias pointing

### 5.3 Agent Aliases
- Named pointers to specific agent versions (e.g., `production` → v3)
- Default alias support
- Decouples API consumers from version numbers

### 5.4 Agent Playground
- In-browser testing environment for agents
- Conversation history per playground session
- Config overrides for testing different parameters
- File upload support in playground
- Execution history tracking

### 5.5 Agent Workflows (Server-Driven)
- Menu-based guided workflows for chat sessions
- Workflow state persistence (`workflowState` / `WorkflowCursor`)
- Activatable/deactivatable per agent
- Visual workflow canvas editor

### 5.6 API Keys
- Scoped API keys per agent
- Rate limiting: daily requests, daily tokens, per-minute requests
- Scope-based access control (`inference:read`)
- Revocation and rotation support
- Webhook URL configuration for async callbacks
- Usage tracking per key per day

---

## 6. Agent Studio — Visual Workflow Builder

The Agent Studio is a node-based visual workflow engine for building complex agent behaviors without writing code.

### 6.1 Node Types (16 Total)

| Node | Purpose |
|------|---------|
| **LLM** | Call language models with system prompts and tools |
| **Tool** | Execute named tools with parameter overrides |
| **Router** | Branch execution based on conditions |
| **State Schema** | Define shared state shape passed between nodes |
| **Input** | Entry point; defines expected input and initial state |
| **Output** | Terminal node; formats final response |
| **Memory** | Manage conversation context window (`full`, `sliding`, `summarized`) |
| **Knowledge Base** | Retrieve relevant context from attached KBs |
| **MCP Server** | Invoke tools on connected MCP servers |
| **Human** | Pause execution for human approval/input |
| **Parallel** | Execute multiple branches simultaneously |
| **Sub-Agent** | Invoke another agent as a subroutine |
| **Delay** | Pause execution for a configured duration |
| **Code** | Execute custom code (JavaScript/TypeScript) |
| **Condition** | Conditional logic gates |
| **HTTP** | Make external HTTP requests |

### 6.2 Execution Engine
- Graph-based execution with topological ordering
- State management between nodes
- Error handling and retry logic
- Parallel branch dispatch and result merging
- Sub-agent invocation with input/output channel mapping

### 6.3 Validation
- Schema validation for every node configuration
- Graph validation (cycles, disconnected nodes, type mismatches)
- Real-time error reporting in the visual canvas

---

## 7. Knowledge Base & RAG

### 7.1 Knowledge Base Management
- Create and configure multiple knowledge bases per tenant
- Per-KB settings:
  - Embedding provider and model
  - Chunk strategy (`RECURSIVE_CHARACTER`)
  - Chunk size and overlap
  - Pre-processing options (HTML stripping, PII redaction, OCR, table extraction)
  - Retrieval configuration (top-K, similarity threshold, hybrid search, reranking)

### 7.2 Document Ingestion
- **File uploads** — PDF, DOCX, TXT, Markdown, and more
- **Web crawling** — headless browser crawling with Playwright
- **Data sources** — reusable source configurations with sync schedules
- Document status tracking: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`

### 7.3 Chunking & Embeddings
- Configurable chunk size (default 512) and overlap (default 50)
- Vector embeddings via Amazon Titan Embeddings V2 (default 1024 dimensions)
- PostgreSQL pgvector storage for similarity search
- Full-text search via PostgreSQL `tsvector`

### 7.4 Retrieval & Search
- **Hybrid search** — combining vector similarity + keyword matching
- **Configurable top-K** — adjustable number of retrieved chunks
- **Similarity threshold** — filter out low-relevance results
- **Reranking** — optional post-retrieval reranking
- **UMAP visualization** — 2D visualization of document embeddings

### 7.5 Knowledge Base Testing
- In-app test interface for querying knowledge bases
- Preview retrieved chunks and relevance scores
- Test against specific queries before attaching to agents

### 7.6 Agent Attachment
- Attach one or more knowledge bases to an agent
- KB retrieval node in Agent Studio workflows
- Runtime KB suggestion during inference sessions

---

## 8. LLM Provider Management

### 8.1 Supported Providers
- **AWS Bedrock** — default; Claude and Titan models
- **OpenAI** — GPT models
- **Anthropic** — Claude API
- **Ollama** — local model hosting
- **vLLM** — high-throughput inference engine
- **OpenAI Compatible** — generic OpenAI-compatible endpoints

### 8.2 Provider Configuration
- Per-tenant provider setup
- Encrypted credential storage (AES-256-GCM)
- Region configuration for cloud providers
- Default provider designation
- Model discovery and refresh

### 8.3 Model Discovery
- Automatic model listing from provider APIs
- Capability detection per model
- Chat and embedding model separation

### 8.4 Fallback & Routing
- Default provider per tenant
- Model-level configuration overrides

---

## 9. Communication Channels

### 9.1 REST Inference API (v1)
- **Session-based chat** — create sessions, send messages, receive streaming responses
- **File upload** — multipart file attachments in sessions
- **Feedback** — thumbs up/down with comments per message
- **CSAT** — post-session satisfaction surveys
- **KB suggestion** — runtime knowledge base suggestions
- **Usage tracking** — token and request consumption
- **Channel metadata** — track source channel (API, WhatsApp, Widget)

### 9.2 WhatsApp Business API Integration
- **Account connection** — connect WhatsApp Business Accounts (WABA)
- **Webhook handling** — receive and process incoming messages
- **Message routing** — route conversations to specific agents based on rules
- **Routing strategies** — keyword-based, AI intent-based, menu-based, time-based
- **Template messages** — sync and send approved WhatsApp templates
- **Session management** — 24-hour conversation window tracking
- **Quality rating** — monitor account health and messaging limits
- **Media support** — download and process images/documents/voice

### 9.3 Telegram Integration (Coming Soon)
- UI placeholder for Telegram bot connector
- Architecture prepared for expansion

### 9.4 Connectors Hub
- Centralized page for all channel connectors
- Card-based connector discovery
- Connection status and health indicators

---

## 10. Embeddable SDK Chat Widget

### 10.1 SDK Architecture
- **StencilJS Web Component** — framework-agnostic embed
- **Lazy-loaded ESM** — minimal impact on host page performance
- **Position: fixed** — floats above page content
- **Iframe containment** — used in preview pages to contain the widget

### 10.2 Widget Components
- **Launcher** — customizable floating action button
- **Chat window** — expandable chat interface
- **Message list** — rich message rendering with timestamps
- **Message parts** — structured content rendering:
  - Text, Image, File, Menu, Thinking, Card
- **Input bar** — text input with file attachment
- **Header** — branded header with bot avatar
- **Typing indicator** — animated "…" while waiting for response
- **CSAT survey** — inline satisfaction collection
- **Pre-chat form** — collect visitor info before starting
- **Quick replies** — clickable response chips
- **KB suggestions** — knowledge base article suggestions
- **Proactive engine** — auto-open with message after delay
- **Markdown rendering** — rich text formatting
- **File preview** — inline file attachment previews

### 10.3 Widget Designer
- Visual, no-code customization interface
- Real-time live preview
- Customization tabs:
  - **Appearance** — colors, theme (light/dark/auto), position, bot name, header, welcome message
  - **Behavior** — agent selection, API key, quick replies, file upload, CSAT, allowed origins
  - **Pre-chat** — enable/disable and configure pre-chat form
  - **Proactive** — timed automatic engagement messages
  - **Knowledge** — enable/disable knowledge base grounding
  - **Workflow** — visual workflow editor for the attached agent
  - **Embed** — copy-paste embed code and SDK ID

### 10.4 Widget Sandbox
- Isolated testing environment
- Test widget behavior before production deployment
- URL-based widget selection

### 10.5 Security Features
- Origin allowlist (`allowedOrigins`)
- Rate limiting (requests per minute)
- API key scoped access

---

## 11. Analytics & Insights

### 11.1 Analytics Dashboard
- **KPI Cards** — total conversations, active sessions, completed, resolution rate, analyzed count, NPS score
- **Sentiment Distribution** — pie chart of positive/negative/neutral/mixed sentiments
- **Resolution Status** — resolved vs unresolved breakdown
- **Sentiment Trends** — area chart over time
- **Resolution Trends** — area chart over time

### 11.2 Session Analytics
- Per-session sentiment analysis
- Sentiment confidence scores
- Emotional tone detection
- Resolution detection (`isResolved`)
- First user query capture
- Language detection
- Message count statistics

### 11.3 Top Queries
- Most asked questions ranked
- Positive sentiment query leaderboards
- Negative sentiment query leaderboards

### 11.4 NPS (Net Promoter Score)
- Star-based rating collection (1–5)
- NPS score calculation (promoters, passives, detractors)
- Rating distribution histogram
- Breakdown by category

### 11.5 Inference Monitoring
- Inference session list with status
- Per-session message history
- Channel attribution (API, WhatsApp, Widget)
- Session idle expiry tracking
- End reason tracking

### 11.6 Usage Tracking
- Per-API-key daily request counts
- Per-API-key daily token consumption
- Per-minute request rate tracking with automatic reset

---

## 12. Audit & Compliance

### 12.1 Comprehensive Audit Logging
- Every platform action logged with structured metadata
- Event categorization: `auth`, `rbac`, `tenant`, `agent`, `kb`, `chat`, `integration`, etc.
- Log attributes: event type, action, user, resource, status, severity, metadata, TTL

### 12.2 Log Categories
- **User actions** — CRUD operations by platform users
- **Resource actions** — syncs, executions, background jobs
- **System events** — worker jobs, cron tasks, health checks
- **Agent events** — tool executions, AI inference calls

### 12.3 Retention Policies
- Configurable TTL per event category:
  - Auth/RBAC: 365 days
  - Tenant/Account: 180 days
  - Agent/Integration/Schedule: 90 days
  - KB/Chat/Trigger/Inventory: 30 days

### 12.4 Audit Dashboard
- Filterable log viewer (date, event type, status, severity, user)
- Pagination with cursor-based next page tokens
- Correlation ID tracing across distributed actions
- Statistics dashboard (counts by type, status, severity)

### 12.5 Security Features
- IP address and user agent capture
- Change sets (before/after snapshots)
- Data classification tags
- Request ID tracking
- Severity-based alerting support

---

## 13. MCP (Model Context Protocol)

### 13.1 MCP Server Management
- Register external MCP servers (SSE, stdio, HTTP bridge transports)
- Per-tenant server isolation
- Server status tracking (`active`, `inactive`)
- Test connectivity before saving

### 13.2 MCP Versioning
- Automatic version creation on config changes
- Version history with change notes
- One-click rollback to previous versions

### 13.3 Agent Integration
- Attach MCP servers to agents
- MCP Server node in Agent Studio workflows
- Runtime tool invocation via MCP client service

---

## 14. Background Workers & Job Processing

### 14.1 Job Queue Architecture
- **pg-boss** — PostgreSQL-backed job queue
- **Boss/Executor pattern** — factory selects vertical or horizontal execution
- **Job definitions** — typed handlers with Zod schema validation

### 14.2 Worker Execution Strategies
- **Vertical** (default) — single process, sequential job processing
- **Horizontal** — multi-process via ECS for high throughput

### 14.3 Background Jobs

| Job | Purpose |
|-----|---------|
| **Document Ingestion** | Process uploaded files: extract text, chunk, embed, store |
| **Web Crawl** | Headless browser crawling with Playwright; scheduled recrawls |
| **Inference Session Analytics** | Post-session sentiment and resolution analysis |
| **Inference Session Idle Watcher** | Auto-close idle sessions after timeout |

### 14.4 Worker Features
- Structured logging with Pino
- Error handling with retry logic
- Job scheduling and cron-like recurrence
- Health check endpoints

---

## 15. Infrastructure & Deployment

### 15.1 AWS Infrastructure (Pulumi)
- **Networking stack** — VPC, subnets, security groups
- **Compute stack** — ECS/Fargate for horizontal worker scaling
- **CI/CD pipeline** — automated build and deployment

### 15.2 Local Development
- Docker Compose for PostgreSQL 16 + pgvector
- One-command setup (`bun run setup`)
- Hot-reload dev servers for web-ui and workers
- SDK dev server with live reload proxy

### 15.3 Environment Configuration
- T3 Env typed environment variables (never raw `process.env`)
- Required: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AWS_REGION`
- Optional: Cognito SSO, Bedrock model overrides, worker architecture, SDK dev proxy

### 15.4 Response Caching
- LLM response cache with configurable TTL
- Cache hit tracking
- Automatic expiry cleanup

---

## 16. Documentation & Marketing

### 16.1 Documentation Site
- Fumadocs v14 integrated into Next.js app
- MDX-based documentation pages
- Searchable docs under `/docs`
- Tailwind CSS v3 compatible styling

### 16.2 Marketing Landing Page
- Public-facing homepage at `/`
- Feature showcase sections
- Pricing display
- Quick start guide
- Social proof and CTA sections
- Responsive navbar and footer

---

## 17. Testing & Quality Assurance

### 17.1 Unit Testing (Vitest)
- **Shared library** — 65+ tests for auth, RBAC, services, validation
- **AI library** — 13+ tests for Bedrock client, chat completion, embeddings, providers
- **Workers** — tests for job handlers and utilities
- **Coverage** — 60% threshold enforced (lines/branches/functions)

### 17.2 End-to-End Testing (Playwright)
- 51+ e2e tests across modules:
  - `@auth` — login, register, forgot password
  - `@sso` — Cognito SSO flows
  - `@marketing` — landing page sections
  - `@docs` — documentation navigation
  - `@navigation` — authenticated route guards
  - `@inference-api` — API endpoint validation
- Tag-based filtering for selective test runs
- Auth state pre-seeding for fast authenticated tests
- Modular architecture with fixtures, page objects, and helpers

### 17.3 Test Infrastructure
- Separate e2e project at `apps/web-ui-e2e/`
- Custom fixtures (`anonPage` for unauthenticated sessions)
- Environment-specific config via `@t3-oss/env-core`
- CI-optimized targets (`e2e:smoke` for critical path)

---

## Feature Matrix

| Feature | Owner | Admin | Member | Viewer |
|---------|:-----:|:-----:|:------:|:------:|
| Agents (CRUD) | ✅ | ✅ | ✅* | 👁️ |
| Knowledge Bases (CRUD) | ✅ | ✅ | ✅* | 👁️ |
| MCP Servers (CRUD) | ✅ | ✅ | ✅* | 👁️ |
| LLM Providers (CRUD) | ✅ | ✅ | ✅* | 👁️ |
| Members & Invitations | ✅ | ✅ | ❌ | ❌ |
| Custom Roles | ✅ | ✅ | ❌ | ❌ |
| Organization Settings | ✅ | ✅* | 👁️ | 👁️ |
| Audit Logs | ✅ | ✅ | 👁️ | 👁️ |
| Analytics | ✅ | ✅ | ✅ | ✅ |
| Widget Designer | ✅ | ✅ | ✅ | ❌ |
| API Keys | ✅ | ✅ | ✅ | 👁️ |

> ✅* = Create/Read/Update only (no delete)  
> ✅ = Full access  
> 👁️ = Read-only  
> ❌ = No access

---

*End of Feature Documentation*
