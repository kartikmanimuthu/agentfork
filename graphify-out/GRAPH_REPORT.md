# Graph Report - .  (2026-05-04)

## Corpus Check
- Large corpus: 296 files · ~115,831 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 714 nodes · 752 edges · 33 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 163 edges (avg confidence: 0.81)
- Token cost: 12,700 input · 2,000 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Route Handlers|API Route Handlers]]
- [[_COMMUNITY_Next.js API Routes|Next.js API Routes]]
- [[_COMMUNITY_Worker Job Processing|Worker Job Processing]]
- [[_COMMUNITY_Auth & Login Pages|Auth & Login Pages]]
- [[_COMMUNITY_Conversation & Audit Services|Conversation & Audit Services]]
- [[_COMMUNITY_Tenant & Repository Layer|Tenant & Repository Layer]]
- [[_COMMUNITY_Dashboard UI Pages|Dashboard UI Pages]]
- [[_COMMUNITY_Product Docs & Vision|Product Docs & Vision]]
- [[_COMMUNITY_Coverage Report UI|Coverage Report UI]]
- [[_COMMUNITY_Audit Service|Audit Service]]
- [[_COMMUNITY_Bundled Client Code|Bundled Client Code]]
- [[_COMMUNITY_App Sidebar Navigation|App Sidebar Navigation]]
- [[_COMMUNITY_RBAC Permissions|RBAC Permissions]]
- [[_COMMUNITY_Loading State Screenshots|Loading State Screenshots]]
- [[_COMMUNITY_Playwright Error Screenshots|Playwright Error Screenshots]]
- [[_COMMUNITY_Block Navigation (Coverage)|Block Navigation (Coverage)]]
- [[_COMMUNITY_Docs Pages|Docs Pages]]
- [[_COMMUNITY_Postgres Audit Log Repo|Postgres Audit Log Repo]]
- [[_COMMUNITY_Email Service|Email Service]]
- [[_COMMUNITY_Role Management Page|Role Management Page]]
- [[_COMMUNITY_Breadcrumb Component|Breadcrumb Component]]
- [[_COMMUNITY_Carousel Component|Carousel Component]]
- [[_COMMUNITY_Coverage Reports Index|Coverage Reports Index]]
- [[_COMMUNITY_SES Email Service|SES Email Service]]
- [[_COMMUNITY_Item Component|Item Component]]
- [[_COMMUNITY_AI Coverage Report|AI Coverage Report]]
- [[_COMMUNITY_Logger|Logger]]
- [[_COMMUNITY_Header Component|Header Component]]
- [[_COMMUNITY_Playwright Test Reports|Playwright Test Reports]]
- [[_COMMUNITY_Env Vars Docs|Env Vars Docs]]
- [[_COMMUNITY_Docker Deployment Docs|Docker Deployment Docs]]
- [[_COMMUNITY_AI Library Index|AI Library Index]]
- [[_COMMUNITY_Audit Severity Type|Audit Severity Type]]

## God Nodes (most connected - your core abstractions)
1. `getPrismaClient()` - 34 edges
2. `authorize()` - 29 edges
3. `getSessionTenantId()` - 20 edges
4. `PostgresConversationRepository` - 14 edges
5. `AuditService` - 12 edges
6. `Shared Library Index Exports` - 12 edges
7. `PostgresMessageRepository` - 9 edges
8. `parseJson()` - 8 edges
9. `getAuthSession()` - 7 edges
10. `ConversationService` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Shared Library Index Exports` --leaks_server_code_into_client_bundle--> `app/(auth)/register/page.js (Next.js client bundle)`  [INFERRED]
  libs/shared/coverage/src/index.ts.html → playwright-report/data/c0c515533cf7741efc74ce1d9175faf55eb52e79.png
- `.next/static/chunks/app/(auth)/register/page.js` --IMPORTS_FROM--> `Shared Library Index Exports`  [INFERRED]
  test-results/auth-Auth-—-Register-Page-register-page-renders-form-chromium/test-failed-1.png → libs/shared/coverage/src/index.ts.html
- `app/(auth)/register/page.js (Next.js client bundle)` --imports_shared_lib--> `Shared Library Index Exports`  [INFERRED]
  playwright-report/data/a9c42928a6651e1369d7944c6745bbb9298fa53d.png → libs/shared/coverage/src/index.ts.html
- `Shared Library Index Exports` --RE_EXPORTS--> `libs/shared/src/logging/logger.ts`  [INFERRED]
  libs/shared/coverage/src/index.ts.html → test-results/auth-Auth-—-Register-Page-register-page-renders-form-chromium/test-failed-1.png
- `POST()` --calls--> `createCustomRole()`  [INFERRED]
  apps/web-ui/app/api/roles/route.ts → libs/shared/src/rbac/custom-role-service.ts

## Hyperedges (group relationships)
- **AI Layer Test Coverage** — coverage_bedrock_client, coverage_chat_completion, coverage_embeddings [INFERRED 0.90]
- **Agent Builder Platform Vision** — agentstudio_visual_platform, prd_agent_builder, prd_figma_for_ai [INFERRED 0.85]
- **Core Platform Concepts** — readme_multi_tenancy, readme_rbac, architecture_tenant_isolation [EXTRACTED 0.90]
- **Authentication Layer** — auth_session_ts, auth_types_ts, auth_options_ts [INFERRED 0.90]
- **Database Access Layer** — db_prisma_client_ts, db_tenant_middleware_ts, db_repository_factory_ts [INFERRED 0.90]
- **Audit Log Repository Pattern** — audit_log_interface_ts, audit_log_postgres_ts, db_repository_factory_ts [INFERRED 0.85]
- **RBAC Authorization Flow** — rbac_types_predefinedrole, rbac_permissions_haspermission, rbac_authorize_authorize [EXTRACTED 1.00]
- **Conversation Repository Pattern** — conversation_interface_conversationrepository, conversation_postgres_postgresconversationrepository, conversation_service_conversationservice [EXTRACTED 0.95]
- **Tenant-Scoped Service Pattern** — conversation_service_conversationservice, message_service_messageservice, tenant_config_service_tenantconfigservice [INFERRED 0.85]

## Communities

### Community 0 - "API Route Handlers"
Cohesion: 0.08
Nodes (34): computeStats(), GET(), getAuthSession(), getSessionTenantId(), getSessionUserId(), POST(), GET(), POST() (+26 more)

### Community 1 - "Next.js API Routes"
Cohesion: 0.08
Nodes (21): createAuthOptions(), getCognitoClient(), GET(), getPrismaClient(), GET(), GET(), castRole(), createCustomRole() (+13 more)

### Community 2 - "Worker Job Processing"
Cohesion: 0.09
Nodes (8): handleConversationSummary(), HorizontalExecutor, VerticalExecutor, handleMessageEmbedding(), getBedrockProvider(), streamChat(), generateEmbedding(), generateEmbeddings()

### Community 3 - "Auth & Login Pages"
Cohesion: 0.1
Nodes (31): Audit Log Repository Interface, Audit Log Postgres Implementation, app/(auth)/login/page.js (Next.js login page bundle), Auth Options (NextAuth Config), app/(auth)/register/page.js (Next.js client bundle), Auth Session Module, Auth Types, Prisma Client (+23 more)

### Community 4 - "Conversation & Audit Services"
Cohesion: 0.08
Nodes (18): AuditService Class, AuditService.log Static Method, ConversationRecord Interface, ConversationRepository Interface, CreateConversationInput Interface, UpdateConversationInput Interface, PostgresConversationRepository, ConversationService Class (+10 more)

### Community 5 - "Tenant & Repository Layer"
Cohesion: 0.07
Nodes (7): getTenantClient(), createConversationRepository(), createMessageRepository(), ConversationService, MessageService, TenantConfigService, handleSwitch()

### Community 6 - "Dashboard UI Pages"
Cohesion: 0.12
Nodes (11): formatTimestampLocal(), formatDateLocal(), formatDate(), formatShortDateTime(), formatTimestamp(), getTimezoneOffset(), fetchData(), formatDateLocal() (+3 more)

### Community 7 - "Product Docs & Vision"
Cohesion: 0.1
Nodes (22): LangGraph Native Architecture, AgentStudio PRD, AgentStudio Visual Agent Builder, Chat Data Flow, Tenant Isolation via getTenantClient, Bedrock Model Configuration, Cognito SSO Configuration, Bedrock Client Coverage Report (+14 more)

### Community 8 - "Coverage Report UI"
Cohesion: 0.36
Nodes (13): addSearchBox(), addSortIndicators(), enableUI(), getNthColumn(), getTable(), getTableBody(), getTableHeader(), loadColumns() (+5 more)

### Community 9 - "Audit Service"
Cohesion: 0.24
Nodes (2): AuditService, getRetentionDays()

### Community 10 - "Bundled Client Code"
Cohesion: 0.44
Nodes (10): a(), B(), c(), D(), g(), i(), k(), o() (+2 more)

### Community 11 - "App Sidebar Navigation"
Cohesion: 0.2
Nodes (6): NavProjects(), NavUser(), AppSidebar(), cn(), SidebarMenuSubButton(), useSidebar()

### Community 12 - "RBAC Permissions"
Cohesion: 0.29
Nodes (8): hasCustomPermission(), hasPermission(), ROLE_LEVELS Constant, ROLE_PERMISSIONS Constant, Action Type, Module Type, PermissionSet Type, PredefinedRole Type

### Community 18 - "Loading State Screenshots"
Cohesion: 0.33
Nodes (7): Loading State Screenshot, Next.js Logo Button (bottom-left), Page in Loading/Pending State, Skeleton Input/Content Blocks (two wider placeholders), Skeleton Loading Placeholders, Skeleton Subtitle Block (narrow placeholder), Skeleton Title Block (wide placeholder)

### Community 19 - "Playwright Error Screenshots"
Cohesion: 0.38
Nodes (7): Call Stack (5 frames), Jest Worker Child Process Exception, Next.js Error Overlay, Next.js 15.5.15 (outdated), Playwright Test Screenshot - Runtime Error State, Runtime Error, Webpack Bundler

### Community 20 - "Block Navigation (Coverage)"
Cohesion: 0.73
Nodes (4): goToNext(), goToPrevious(), makeCurrent(), toggleClass()

### Community 21 - "Docs Pages"
Cohesion: 0.4
Nodes (3): NotFound(), generateMetadata(), Page()

### Community 25 - "Postgres Audit Log Repo"
Cohesion: 0.4
Nodes (1): PostgresAuditLogRepository

### Community 26 - "Email Service"
Cohesion: 0.4
Nodes (2): ConsoleEmailService, getEmailService()

### Community 27 - "Role Management Page"
Cohesion: 0.5
Nodes (2): deleteRole(), fetchRoles()

### Community 29 - "Breadcrumb Component"
Cohesion: 0.5
Nodes (2): BreadcrumbLink(), cn()

### Community 31 - "Carousel Component"
Cohesion: 0.5
Nodes (2): CarouselNext(), useCarousel()

### Community 32 - "Coverage Reports Index"
Cohesion: 0.6
Nodes (5): AI Library Coverage Report, Shared Library Coverage Report, Shared Library (libs/shared), Sort Arrow Sprite, Sortable Column UI Element

### Community 33 - "SES Email Service"
Cohesion: 0.5
Nodes (1): SESEmailService

### Community 37 - "Item Component"
Cohesion: 0.67
Nodes (2): cn(), Item()

### Community 39 - "AI Coverage Report"
Cohesion: 0.67
Nodes (4): AI Library Coverage Report, AI Library (libs/ai), Coverage Report Favicon (Istanbul/NYC), Istanbul/NYC Code Coverage Tool

### Community 40 - "Logger"
Cohesion: 1.0
Nodes (2): createBaseLogger(), createLogger()

### Community 52 - "Header Component"
Cohesion: 1.0
Nodes (2): getPageTitle(), Header()

### Community 53 - "Playwright Test Reports"
Cohesion: 1.0
Nodes (3): Playwright, Playwright Logo (SVG), Playwright Report (trace output)

### Community 190 - "Env Vars Docs"
Cohesion: 1.0
Nodes (1): Environment Variables Configuration

### Community 191 - "Docker Deployment Docs"
Cohesion: 1.0
Nodes (1): Docker Deployment

### Community 192 - "AI Library Index"
Cohesion: 1.0
Nodes (1): AI Library Index

### Community 193 - "Audit Severity Type"
Cohesion: 1.0
Nodes (1): AuditSeverity Type

## Knowledge Gaps
- **38 isolated node(s):** `Role-Based Access Control`, `Tenant Isolation via getTenantClient`, `Environment Variables Configuration`, `Cognito SSO Configuration`, `Bedrock Model Configuration` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Audit Service`** (14 nodes): `audit-service.ts`, `AuditService`, `.createAuditLog()`, `.getAuditLogs()`, `.getAuditLogsByCorrelation()`, `.getAuditLogStats()`, `.groupBy()`, `.log()`, `.logAgentEvent()`, `.logResourceAction()`, `.logSystemEvent()`, `.logUserAction()`, `.validateAndCleanAuditData()`, `getRetentionDays()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Postgres Audit Log Repo`** (5 nodes): `PostgresAuditLogRepository`, `.constructor()`, `.create()`, `.findAll()`, `postgres.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Email Service`** (5 nodes): `email-service.ts`, `ConsoleEmailService`, `.sendEmail()`, `getEmailService()`, `setEmailService()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Role Management Page`** (5 nodes): `page.tsx`, `deleteRole()`, `fetchRoles()`, `initDialog()`, `permissionSummary()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Breadcrumb Component`** (5 nodes): `breadcrumb.tsx`, `Breadcrumb()`, `BreadcrumbLink()`, `BreadcrumbPage()`, `cn()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Carousel Component`** (5 nodes): `carousel.tsx`, `Carousel()`, `CarouselNext()`, `cn()`, `useCarousel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `SES Email Service`** (4 nodes): `ses-email-service.ts`, `SESEmailService`, `.constructor()`, `.sendEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Item Component`** (4 nodes): `item.tsx`, `cn()`, `Item()`, `ItemGroup()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Logger`** (3 nodes): `logger.ts`, `createBaseLogger()`, `createLogger()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Header Component`** (3 nodes): `header.tsx`, `getPageTitle()`, `Header()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Env Vars Docs`** (1 nodes): `Environment Variables Configuration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Docker Deployment Docs`** (1 nodes): `Docker Deployment`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `AI Library Index`** (1 nodes): `AI Library Index`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Audit Severity Type`** (1 nodes): `AuditSeverity Type`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getPrismaClient()` connect `Next.js API Routes` to `API Route Handlers`, `Audit Service`, `Worker Job Processing`, `Tenant & Repository Layer`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `getTenantClient()` connect `Tenant & Repository Layer` to `Next.js API Routes`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `authorize()` connect `API Route Handlers` to `Next.js API Routes`, `RBAC Permissions`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 33 inferred relationships involving `getPrismaClient()` (e.g. with `createCustomRole()` and `getCustomRoles()`) actually correct?**
  _`getPrismaClient()` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `authorize()` (e.g. with `getCustomRolePermissions()` and `GET()`) actually correct?**
  _`authorize()` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `getSessionTenantId()` (e.g. with `GET()` and `POST()`) actually correct?**
  _`getSessionTenantId()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Role-Based Access Control`, `Tenant Isolation via getTenantClient`, `Environment Variables Configuration` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._