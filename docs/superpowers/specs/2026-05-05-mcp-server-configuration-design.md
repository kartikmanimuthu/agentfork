# MCP Server Configuration & Agent Studio Integration

**Date:** 2026-05-05  
**Status:** Approved  
**Approach:** Full Versioned MCP Server Library + Agent References

---

## 1. Goals

- Add a tenant-scoped MCP (Model Context Protocol) server library with independent version control.
- Integrate MCP servers into the Agent Studio so users can click-to-attach/detach them from agents.
- Support SSE, stdio, and HTTP bridge transports.
- Mirror the existing Knowledge Base pattern for consistency.

## 2. Database Schema

### 2.1 New Models

```prisma
model McpServer {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  transport   String   // 'sse' | 'stdio' | 'http_bridge'
  config      Json     // full transport-specific config
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant   Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  versions McpServerVersion[]
  agents   AgentMcpServer[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@index([tenantId, status])
  @@map("mcp_servers")
}

model McpServerVersion {
  id            String   @id @default(cuid())
  mcpServerId   String
  version       Int
  config        Json
  changeNotes   String?
  createdBy     String   @default("system")
  createdAt     DateTime @default(now())

  mcpServer McpServer @relation(fields: [mcpServerId], references: [id], onDelete: Cascade)

  @@unique([mcpServerId, version])
  @@index([mcpServerId])
  @@index([mcpServerId, createdAt])
  @@map("mcp_server_versions")
}

model AgentMcpServer {
  id          String   @id @default(cuid())
  agentId     String
  mcpServerId String
  createdAt   DateTime @default(now())

  agent     Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)
  mcpServer McpServer @relation(fields: [mcpServerId], references: [id], onDelete: Cascade)

  @@unique([agentId, mcpServerId])
  @@index([agentId])
  @@index([mcpServerId])
  @@map("agent_mcp_servers")
}
```

### 2.2 Updated Models

```prisma
model Agent {
  // existing fields...
  mcpServers AgentMcpServer[]
}
```

The `Agent.config` JSON will also store `knowledgeBaseIds?: string[]` and `mcpServerIds?: string[]` for quick access without joins.

> **Note:** `AgentMcpServer` join table is the canonical source of truth. `config.mcpServerIds` is a denormalized cache — it must be kept in sync on attach/detach operations.

## 3. API Design

### 3.1 MCP Server Manager APIs

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/mcp-servers` | GET | `read` | List all (with status, version count) |
| `/api/mcp-servers` | POST | `create` | Create new server (auto-creates v1) |
| `/api/mcp-servers/[id]` | GET | `read` | Get single server with config |
| `/api/mcp-servers/[id]` | PUT | `update` | Update config (auto-creates version snapshot) |
| `/api/mcp-servers/[id]` | DELETE | `delete` | Soft-delete + detach from all agents |
| `/api/mcp-servers/[id]/versions` | GET | `read` | List version history |
| `/api/mcp-servers/[id]/versions` | POST | `create` | Manually snapshot version |
| `/api/mcp-servers/[id]/versions/[versionId]/restore` | POST | `update` | Restore config from version |
| `/api/mcp-servers/[id]/test` | POST | `read` | Test connection (live ping) |

### 3.2 Agent Studio APIs

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/agents/[id]/mcp-servers` | GET | `read` | List servers attached to agent |
| `/api/agents/[id]/mcp-servers` | POST | `update` | Attach a server to agent |
| `/api/agents/[id]/mcp-servers/[serverId]` | DELETE | `update` | Detach a server from agent |

## 4. UI Components & Pages

### 4.1 New Pages

| Page | Path | Purpose |
|---|---|---|
| MCP Server Manager | `/mcp-servers` | List, search, create, delete |
| MCP Server Editor | `/mcp-servers/[id]` | Edit config, test, view versions |
| MCP Server Versions | `/mcp-servers/[id]/versions` | Browse history, restore, compare |

### 4.2 Agent Studio Tabs (on `/agents/[id]`)

| Tab | Content |
|---|---|
| **Configuration** | Existing model/prompt or graph canvas |
| **Knowledge Bases** | Available KBs with click-to-attach (future scope) |
| **MCP Servers** | Global MCP server list. Name, transport, status, tool count. Toggle attach/detach per server. |
| **Versions** | Agent version history |

### 4.3 MCP Server Form

**Fields:**
- Name (text, required)
- Description (textarea)
- Transport Type (radio: SSE / stdio / HTTP Bridge)
  - SSE: Endpoint URL, Headers (key-value)
  - stdio: Command, Arguments, Environment Variables
  - HTTP Bridge: Bridge URL, Target Command
- Advanced (collapsible)
  - Timeout ms (number, default 30000)
  - Retry Count (number, default 3)
  - Custom Headers (key-value pairs)

**Actions:** Test Connection | Save | Cancel

### 4.4 Version History Page

- Table: Version #, Created At, Created By, Change Notes
- Row actions: Restore (copies version config to live `McpServer` row), Preview (read-only JSON)

## 5. Data Flow

### 5.1 Attaching an MCP Server

1. Agent Studio MCP Servers tab loads global list + attached list.
2. User clicks "Add" on a server.
3. POST `/api/agents/[id]/mcp-servers` with `{ mcpServerId }`.
4. Backend inserts `AgentMcpServer` row.
5. Frontend invalidates query cache.

### 5.2 Updating an MCP Server

1. User edits in `/mcp-servers/[id]`.
2. PUT `/api/mcp-servers/[id]` with new config.
3. Backend:
   - Updates `McpServer` row
   - Creates `McpServerVersion` snapshot (`version = max+1`)
4. All referencing agents use the new config on next execution (live reference).

### 5.3 Restoring a Version

1. User clicks "Restore" on a version row.
2. POST `/api/mcp-servers/[id]/versions/[versionId]/restore`.
3. Backend copies `McpServerVersion.config` into `McpServer.config`.
4. Also creates a new version snapshot (so the restore itself is reversible).

## 6. Error Handling

| Scenario | Behavior |
|---|---|
| Connection test fails | Return `{ connected: false, error: string }` (200 OK). |
| Agent references deleted/inactive server | Skip server at execution, log warning. |
| Restore invalid config | 400 with field-level validation errors. |
| Duplicate name | 409 with "name already exists" error. |

## 7. Security & RBAC

- New module `McpServers` in `SUBJECT_TO_MODULE`.
- Actions: `create`, `read`, `update`, `delete`.
- All endpoints call `authorize()` with correct action.
- Tenant isolation: all queries filter by `tenantId`.
- Cross-tenant access returns 404 (not 403, to avoid ID enumeration).

## 8. Testing

| Level | Scope |
|---|---|
| Unit (agent-studio) | Version number increment. Snapshot on update. Restore correctness. |
| Unit (web-ui) | Form validation. Transport type field switching. |
| E2E (Playwright) | Create → edit → version history → restore → attach → detach. |
| API | CRUD status codes, tenant isolation. |

## 9. Open Questions / v2

- Encrypt API keys/secrets in `config` JSON at rest.
- Per-agent MCP server parameter overrides (e.g. different timeout).
- MCP tool discovery and schema caching.
- AgentMcpServerVersion table to snapshot attachment state per agent version.

## 10. Files to Create / Modify

### Database
- `prisma/schema.prisma` — add `McpServer`, `McpServerVersion`, `AgentMcpServer`
- Migration via `bunx prisma migrate dev`

### Backend (agent-studio lib)
- `libs/agent-studio/src/services/mcp-server-service.ts`
- `libs/agent-studio/src/services/mcp-server-version-service.ts`
- `libs/agent-studio/src/types/mcp-server.ts`
- `libs/agent-studio/src/index.ts` — export new types/services

### API Routes
- `apps/web-ui/app/api/mcp-servers/route.ts`
- `apps/web-ui/app/api/mcp-servers/[id]/route.ts`
- `apps/web-ui/app/api/mcp-servers/[id]/versions/route.ts`
- `apps/web-ui/app/api/mcp-servers/[id]/versions/[versionId]/restore/route.ts`
- `apps/web-ui/app/api/mcp-servers/[id]/test/route.ts`
- `apps/web-ui/app/api/agents/[id]/mcp-servers/route.ts`
- `apps/web-ui/app/api/agents/[id]/mcp-servers/[serverId]/route.ts`

### Frontend
- `apps/web-ui/app/(dashboard)/mcp-servers/page.tsx`
- `apps/web-ui/app/(dashboard)/mcp-servers/[id]/page.tsx`
- `apps/web-ui/app/(dashboard)/mcp-servers/[id]/versions/page.tsx`
- `apps/web-ui/components/mcp-servers/mcp-server-form.tsx`
- `apps/web-ui/components/mcp-servers/mcp-server-card.tsx`
- `apps/web-ui/components/mcp-servers/mcp-server-list.tsx`
- `apps/web-ui/components/agents/tabs/mcp-servers-tab.tsx`
- `apps/web-ui/hooks/use-mcp-servers.ts`
- `apps/web-ui/components/layout/app-sidebar.tsx` — add MCP Servers nav item
- `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx` — add tabs
- `libs/shared/src/rbac/types.ts` — add `McpServers` module

---

*Implementation plan to follow via `writing-plans` skill.*
