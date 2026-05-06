# MCP Server Configuration & Agent Studio Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global tenant-scoped MCP server library with version control, and integrate it into the Agent Studio via tabs for click-to-attach/detach.

**Architecture:** Full Versioned MCP Server Library + Agent References. `McpServer` stores live config, `McpServerVersion` auto-snapshots on every save, `AgentMcpServer` join table links agents to servers. Agent Studio gets tabs: Configuration | Knowledge Bases | MCP Servers | Versions.

**Tech Stack:** Next.js 15 App Router, Prisma, PostgreSQL, TypeScript, React, TanStack Query, shadcn/ui, Zod

---

## File Structure

```
prisma/schema.prisma                           — add McpServer, McpServerVersion, AgentMcpServer
prisma/migrations/...                          — auto-generated via prisma migrate dev

libs/agent-studio/src/types/mcp-server.ts      — McpServer types, transport config unions, Zod schemas
libs/agent-studio/src/services/mcp-server-service.ts      — McpServer CRUD, version auto-snapshot
libs/agent-studio/src/services/mcp-server-version-service.ts  — Version history, restore
libs/agent-studio/src/index.ts                  — export new types/services

apps/web-ui/app/api/mcp-servers/route.ts
apps/web-ui/app/api/mcp-servers/[id]/route.ts
apps/web-ui/app/api/mcp-servers/[id]/versions/route.ts
apps/web-ui/app/api/mcp-servers/[id]/versions/[versionId]/restore/route.ts
apps/web-ui/app/api/mcp-servers/[id]/test/route.ts
apps/web-ui/app/api/agents/[id]/mcp-servers/route.ts
apps/web-ui/app/api/agents/[id]/mcp-servers/[serverId]/route.ts

apps/web-ui/hooks/use-mcp-servers.ts
apps/web-ui/components/mcp-servers/mcp-server-form.tsx
apps/web-ui/components/mcp-servers/mcp-server-card.tsx
apps/web-ui/components/mcp-servers/mcp-server-list.tsx
apps/web-ui/components/agents/tabs/mcp-servers-tab.tsx
apps/web-ui/app/(dashboard)/mcp-servers/page.tsx
apps/web-ui/app/(dashboard)/mcp-servers/[id]/page.tsx
apps/web-ui/app/(dashboard)/mcp-servers/[id]/versions/page.tsx

apps/web-ui/components/layout/app-sidebar.tsx  — add MCP Servers nav item
apps/web-ui/app/(dashboard)/agents/[id]/page.tsx — add tabs wrapper
libs/shared/src/rbac/types.ts                  — add McpServers module
```

---

## Workstream A: Database Schema

### Task A1: Add MCP Server Models to Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add McpServer, McpServerVersion, AgentMcpServer models**

Insert after the `Agent` model definition, before `AgentVersion`:

```prisma
model McpServer {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  transport   String   // 'sse' | 'stdio' | 'http_bridge'
  config      Json
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

- [ ] **Step 2: Add relation field to Agent model**

In `prisma/schema.prisma`, find the `Agent` model and add inside it:

```prisma
  mcpServers AgentMcpServer[]
```

- [ ] **Step 3: Add relation field to Tenant model**

In `prisma/schema.prisma`, find the `Tenant` model and add inside it:

```prisma
  mcpServers McpServer[]
```

- [ ] **Step 4: Commit schema changes**

```bash
git add prisma/schema.prisma
git commit -m "feat(mcp): add McpServer, McpServerVersion, AgentMcpServer models"
```

### Task A2: Generate Prisma Client and Create Migration

**Files:**
- Create: auto-generated `prisma/migrations/...`

- [ ] **Step 1: Generate Prisma client**

```bash
bunx prisma generate --schema=./prisma/schema.prisma
```

Expected: Prisma client generated successfully.

- [ ] **Step 2: Create and apply migration**

```bash
bunx prisma migrate dev --name add_mcp_server_models
```

When prompted, name it: `add_mcp_server_models`

Expected: Migration created and applied to local database.

- [ ] **Step 3: Verify tables exist**

```bash
bunx prisma db execute --stdin <<EOF
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'mcp%';
EOF
```

Expected output shows `mcp_servers`, `mcp_server_versions`, `agent_mcp_servers`.

- [ ] **Step 4: Commit migration**

```bash
git add prisma/migrations/
git commit -m "feat(mcp): add migration for MCP server tables"
```

---

## Workstream B: Backend Types and Services (agent-studio lib)

### Task B1: MCP Server Types

**Files:**
- Create: `libs/agent-studio/src/types/mcp-server.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
// libs/agent-studio/src/types/mcp-server.ts

export type McpServerTransport = 'sse' | 'stdio' | 'http_bridge';

export type McpServerStatus = 'active' | 'inactive' | 'error';

export interface SseTransportConfig {
  endpoint: string;
  headers?: Record<string, string>;
}

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpBridgeTransportConfig {
  bridgeUrl: string;
  targetCommand: string;
}

export type McpServerTransportConfig =
  | SseTransportConfig
  | StdioTransportConfig
  | HttpBridgeTransportConfig;

export interface McpServerConfig {
  transport: McpServerTransport;
  transportConfig: McpServerTransportConfig;
  timeoutMs?: number;
  retryCount?: number;
}

export interface McpServer {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  transport: McpServerTransport;
  config: McpServerConfig;
  status: McpServerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpServerVersion {
  id: string;
  mcpServerId: string;
  version: number;
  config: McpServerConfig;
  changeNotes: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface CreateMcpServerInput {
  name: string;
  description?: string;
  transport: McpServerTransport;
  config: McpServerConfig;
}

export interface UpdateMcpServerInput {
  name?: string;
  description?: string;
  transport?: McpServerTransport;
  config?: McpServerConfig;
}

export interface McpServerFilters {
  status?: McpServerStatus;
  transport?: McpServerTransport;
  search?: string;
  page?: number;
  pageSize?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add libs/agent-studio/src/types/mcp-server.ts
git commit -m "feat(mcp): add McpServer type definitions"
```

### Task B2: MCP Server Service

**Files:**
- Create: `libs/agent-studio/src/services/mcp-server-service.ts`

- [ ] **Step 1: Write the service**

```typescript
// libs/agent-studio/src/services/mcp-server-service.ts

import type {
  McpServer,
  McpServerStatus,
  McpServerTransport,
  CreateMcpServerInput,
  UpdateMcpServerInput,
  McpServerFilters,
  McpServerConfig,
} from '../types/mcp-server';

export interface McpServerPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<unknown | null>;
  findMany(args: {
    where: Record<string, unknown>;
    skip?: number;
    take?: number;
    orderBy?: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<unknown[]>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface AgentMcpServerPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findMany(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<unknown[]>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
}

export interface McpServerDb {
  mcpServer: McpServerPrismaDelegate;
  agentMcpServer: AgentMcpServerPrismaDelegate;
}

export class McpServerService {
  constructor(
    private readonly tenantId: string,
    private readonly db: McpServerDb
  ) {}

  async create(input: CreateMcpServerInput) {
    const result = await this.db.mcpServer.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        description: input.description ?? null,
        transport: input.transport,
        config: input.config as unknown as Record<string, unknown>,
        status: 'active' satisfies McpServerStatus,
      },
    });
    return result as McpServer;
  }

  async findById(id: string) {
    const result = await this.db.mcpServer.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    return result as McpServer | null;
  }

  async findByIdWithVersions(id: string) {
    const result = await this.db.mcpServer.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    return result as (McpServer & { versions: unknown[] }) | null;
  }

  async findMany(filters: Omit<McpServerFilters, 'tenantId'> = {}) {
    const { status, transport, search, page = 1, pageSize = 20 } = filters;
    const where: Record<string, unknown> = { tenantId: this.tenantId };

    if (status) where['status'] = status;
    if (transport) where['transport'] = transport;
    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.db.mcpServer.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { versions: true } } },
      }),
      this.db.mcpServer.count({ where }),
    ]);

    return { items: items as McpServer[], total, page, pageSize };
  }

  async update(id: string, input: UpdateMcpServerInput) {
    const result = await this.db.mcpServer.update({
      where: { id, tenantId: this.tenantId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.transport !== undefined && { transport: input.transport }),
        ...(input.config !== undefined && {
          config: input.config as unknown as Record<string, unknown>,
        }),
      },
    });
    return result as McpServer;
  }

  async delete(id: string) {
    // First detach from all agents
    await this.db.agentMcpServer.deleteMany({
      where: { mcpServerId: id },
    });

    return this.db.mcpServer.delete({
      where: { id, tenantId: this.tenantId },
    });
  }

  async updateStatus(id: string, status: McpServerStatus) {
    return this.update(id, { status } as UpdateMcpServerInput);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add libs/agent-studio/src/services/mcp-server-service.ts
git commit -m "feat(mcp): add McpServerService with CRUD operations"
```

### Task B3: MCP Server Version Service

**Files:**
- Create: `libs/agent-studio/src/services/mcp-server-version-service.ts`

- [ ] **Step 1: Write the service**

```typescript
// libs/agent-studio/src/services/mcp-server-version-service.ts

import type { McpServerVersion, McpServerConfig } from '../types/mcp-server';

export interface McpServerVersionPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<unknown[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface McpServerVersionDb {
  mcpServerVersion: McpServerVersionPrismaDelegate;
}

export class McpServerVersionService {
  constructor(private readonly db: McpServerVersionDb) {}

  async create(mcpServerId: string, config: McpServerConfig, changeNotes?: string) {
    const count = await this.db.mcpServerVersion.count({
      where: { mcpServerId },
    });

    return this.db.mcpServerVersion.create({
      data: {
        mcpServerId,
        version: count + 1,
        config: config as unknown as Record<string, unknown>,
        changeNotes: changeNotes ?? null,
      },
    }) as Promise<McpServerVersion>;
  }

  async findById(id: string) {
    const result = await this.db.mcpServerVersion.findFirst({
      where: { id },
    });
    return result as McpServerVersion | null;
  }

  async findByMcpServerId(mcpServerId: string) {
    const result = await this.db.mcpServerVersion.findMany({
      where: { mcpServerId },
      orderBy: { version: 'desc' },
    });
    return result as McpServerVersion[];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add libs/agent-studio/src/services/mcp-server-version-service.ts
git commit -m "feat(mcp): add McpServerVersionService for version control"
```

### Task B4: Wire Up Exports

**Files:**
- Modify: `libs/agent-studio/src/index.ts`

- [ ] **Step 1: Add exports**

At the bottom of `libs/agent-studio/src/index.ts`, add:

```typescript
// MCP Server types
export type {
  McpServer,
  McpServerTransport,
  McpServerStatus,
  McpServerConfig,
  McpServerVersion,
  CreateMcpServerInput,
  UpdateMcpServerInput,
  McpServerFilters,
  SseTransportConfig,
  StdioTransportConfig,
  HttpBridgeTransportConfig,
} from './types/mcp-server';

// MCP Server services
export { McpServerService } from './services/mcp-server-service';
export type { McpServerDb } from './services/mcp-server-service';
export { McpServerVersionService } from './services/mcp-server-version-service';
export type { McpServerVersionDb } from './services/mcp-server-version-service';
```

- [ ] **Step 2: Commit**

```bash
git add libs/agent-studio/src/index.ts
git commit -m "feat(mcp): export MCP server types and services"
```

---

## Workstream C: API Routes

### Task C1: MCP Server List and Create API

**Files:**
- Create: `apps/web-ui/app/api/mcp-servers/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// apps/web-ui/app/api/mcp-servers/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { McpServerService, McpServerVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'McpServers', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') ?? undefined;
    const transport = searchParams.get('transport') ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);

    const db = getPrismaClient();
    const service = new McpServerService(tenantId, db as any);
    const result = await service.findMany({
      status: status as any,
      transport: transport as any,
      search,
      page,
      pageSize,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'McpServers', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const server = await service.create(body);

    // Auto-create v1 version snapshot
    const versionService = new McpServerVersionService(db as any);
    await versionService.create(
      server.id,
      server.config as any,
      'Initial version'
    );

    return NextResponse.json(server, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (
      error instanceof Error &&
      error.message.includes('Unique constraint')
    ) {
      return NextResponse.json(
        { error: 'MCP server with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/api/mcp-servers/route.ts
git commit -m "feat(mcp): add MCP server list and create API"
```

### Task C2: MCP Server Detail, Update, Delete API

**Files:**
- Create: `apps/web-ui/app/api/mcp-servers/[id]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// apps/web-ui/app/api/mcp-servers/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { McpServerService, McpServerVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new McpServerService(tenantId, db as any);
    const server = await service.findByIdWithVersions(id);

    if (!server) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(server);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const server = await service.update(id, body);

    // Auto-create version snapshot
    const versionService = new McpServerVersionService(db as any);
    await versionService.create(
      id,
      server.config as any,
      body.changeNotes ?? undefined
    );

    return NextResponse.json(server);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (
      error instanceof Error &&
      error.message.includes('Unique constraint')
    ) {
      return NextResponse.json(
        { error: 'MCP server with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new McpServerService(tenantId, db as any);

    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await service.delete(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/api/mcp-servers/\[id\]/route.ts
git commit -m "feat(mcp): add MCP server detail, update, delete API"
```

### Task C3: MCP Server Versions API

**Files:**
- Create: `apps/web-ui/app/api/mcp-servers/[id]/versions/route.ts`
- Create: `apps/web-ui/app/api/mcp-servers/[id]/versions/[versionId]/restore/route.ts`

- [ ] **Step 1: Write the versions list/create route**

```typescript
// apps/web-ui/app/api/mcp-servers/[id]/versions/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { McpServerService, McpServerVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const versionService = new McpServerVersionService(db as any);
    const versions = await versionService.findByMcpServerId(id);

    return NextResponse.json(versions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { changeNotes } = await req.json();
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const versionService = new McpServerVersionService(db as any);
    const version = await versionService.create(
      id,
      existing.config as any,
      changeNotes
    );

    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the restore route**

```typescript
// apps/web-ui/app/api/mcp-servers/[id]/versions/[versionId]/restore/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { McpServerService, McpServerVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'McpServers', authOptions);
    if (authError) return authError;

    const { id, versionId } = await params;
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const versionService = new McpServerVersionService(db as any);
    const version = await versionService.findById(versionId);
    if (!version || version.mcpServerId !== id) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    // Restore the config
    const restored = await service.update(id, {
      config: version.config as any,
    });

    // Create a new version snapshot of the restore itself
    await versionService.create(
      id,
      version.config as any,
      `Restored from version ${version.version}`
    );

    return NextResponse.json(restored);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/mcp-servers/\[id\]/versions/route.ts
git add apps/web-ui/app/api/mcp-servers/\[id\]/versions/\[versionId\]/restore/route.ts
git commit -m "feat(mcp): add MCP server version list, create, and restore APIs"
```

### Task C4: MCP Server Test Connection API

**Files:**
- Create: `apps/web-ui/app/api/mcp-servers/[id]/test/route.ts`

- [ ] **Step 1: Write the test route**

```typescript
// apps/web-ui/app/api/mcp-servers/[id]/test/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { McpServerService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const server = await service.findById(id);
    if (!server) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Placeholder: actual MCP connection testing would go here
    // For now, return a mock response based on status
    const connected = server.status === 'active';

    return NextResponse.json({
      connected,
      serverId: id,
      transport: server.transport,
      error: connected ? undefined : 'Server is inactive',
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json(
      { connected: false, error: 'Test failed' },
      { status: 200 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/api/mcp-servers/\[id\]/test/route.ts
git commit -m "feat(mcp): add MCP server connection test API"
```

### Task C5: Agent MCP Server Attach/Detach APIs

**Files:**
- Create: `apps/web-ui/app/api/agents/[id]/mcp-servers/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/mcp-servers/[serverId]/route.ts`

- [ ] **Step 1: Write the list and attach route**

```typescript
// apps/web-ui/app/api/agents/[id]/mcp-servers/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const agent = await (db as any).agent.findFirst({
      where: { id, tenantId },
      include: {
        mcpServers: {
          include: { mcpServer: true },
        },
      },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const servers = agent.mcpServers.map((ams: any) => ams.mcpServer);
    return NextResponse.json(servers);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { mcpServerId } = await req.json();
    const db = getPrismaClient();

    // Verify agent exists and belongs to tenant
    const agent = await (db as any).agent.findFirst({
      where: { id, tenantId },
    });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Verify MCP server exists and belongs to tenant
    const server = await (db as any).mcpServer.findFirst({
      where: { id: mcpServerId, tenantId },
    });
    if (!server) {
      return NextResponse.json(
        { error: 'MCP server not found' },
        { status: 404 }
      );
    }

    // Create join record
    await (db as any).agentMcpServer.create({
      data: { agentId: id, mcpServerId },
    });

    // Update denormalized config
    const currentIds = (agent.config?.mcpServerIds ?? []) as string[];
    if (!currentIds.includes(mcpServerId)) {
      await (db as any).agent.update({
        where: { id },
        data: {
          config: {
            ...(agent.config as Record<string, unknown> ?? {}),
            mcpServerIds: [...currentIds, mcpServerId],
          },
        },
      });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (
      error instanceof Error &&
      error.message.includes('Unique constraint')
    ) {
      return NextResponse.json(
        { error: 'MCP server already attached' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the detach route**

```typescript
// apps/web-ui/app/api/agents/[id]/mcp-servers/[serverId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; serverId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id, serverId } = await params;
    const db = getPrismaClient();

    // Verify agent exists and belongs to tenant
    const agent = await (db as any).agent.findFirst({
      where: { id, tenantId },
    });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Delete join record
    await (db as any).agentMcpServer.deleteMany({
      where: { agentId: id, mcpServerId: serverId },
    });

    // Update denormalized config
    const currentIds = (agent.config?.mcpServerIds ?? []) as string[];
    if (currentIds.includes(serverId)) {
      await (db as any).agent.update({
        where: { id },
        data: {
          config: {
            ...(agent.config as Record<string, unknown> ?? {}),
            mcpServerIds: currentIds.filter((sid) => sid !== serverId),
          },
        },
      });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/agents/\[id\]/mcp-servers/route.ts
git add apps/web-ui/app/api/agents/\[id\]/mcp-servers/\[serverId\]/route.ts
git commit -m "feat(mcp): add agent MCP server attach and detach APIs"
```

---

## Workstream D: Frontend Pages and Components

### Task D1: MCP Server React Query Hooks

**Files:**
- Create: `apps/web-ui/hooks/use-mcp-servers.ts`

- [ ] **Step 1: Write the hooks**

```typescript
// apps/web-ui/hooks/use-mcp-servers.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface McpServer {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  transport: 'sse' | 'stdio' | 'http_bridge';
  config: Record<string, unknown>;
  status: 'active' | 'inactive' | 'error';
  createdAt: string;
  updatedAt: string;
  _count?: { versions: number };
}

export interface McpServerListResult {
  items: McpServer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface McpServerFilters {
  status?: string;
  transport?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

async function fetchMcpServers(filters: McpServerFilters = {}): Promise<McpServerListResult> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.transport) params.set('transport', filters.transport);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const res = await fetch(`/api/mcp-servers?${params}`);
  if (!res.ok) throw new Error('Failed to fetch MCP servers');
  return res.json();
}

async function fetchMcpServer(id: string): Promise<McpServer> {
  const res = await fetch(`/api/mcp-servers/${id}`);
  if (!res.ok) throw new Error('Failed to fetch MCP server');
  return res.json();
}

async function createMcpServer(input: {
  name: string;
  description?: string;
  transport: string;
  config: Record<string, unknown>;
  changeNotes?: string;
}): Promise<McpServer> {
  const res = await fetch('/api/mcp-servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create MCP server');
  }
  return res.json();
}

async function updateMcpServer(
  id: string,
  input: Partial<McpServer> & { changeNotes?: string }
): Promise<McpServer> {
  const res = await fetch(`/api/mcp-servers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to update MCP server');
  }
  return res.json();
}

async function deleteMcpServer(id: string): Promise<void> {
  const res = await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete MCP server');
}

async function testMcpServer(id: string): Promise<{ connected: boolean; error?: string }> {
  const res = await fetch(`/api/mcp-servers/${id}/test`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to test MCP server');
  return res.json();
}

async function restoreMcpServerVersion(
  id: string,
  versionId: string
): Promise<McpServer> {
  const res = await fetch(`/api/mcp-servers/${id}/versions/${versionId}/restore`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to restore version');
  return res.json();
}

async function fetchMcpServerVersions(id: string): Promise<unknown[]> {
  const res = await fetch(`/api/mcp-servers/${id}/versions`);
  if (!res.ok) throw new Error('Failed to fetch versions');
  return res.json();
}

// Agent MCP server operations
async function fetchAgentMcpServers(agentId: string): Promise<McpServer[]> {
  const res = await fetch(`/api/agents/${agentId}/mcp-servers`);
  if (!res.ok) throw new Error('Failed to fetch agent MCP servers');
  return res.json();
}

async function attachMcpServer(agentId: string, mcpServerId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/mcp-servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcpServerId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to attach MCP server');
  }
}

async function detachMcpServer(agentId: string, mcpServerId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/mcp-servers/${mcpServerId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to detach MCP server');
}

// Query keys
export const mcpServerKeys = {
  all: ['mcp-servers'] as const,
  lists: () => [...mcpServerKeys.all, 'list'] as const,
  list: (filters: McpServerFilters) => [...mcpServerKeys.lists(), filters] as const,
  details: () => [...mcpServerKeys.all, 'detail'] as const,
  detail: (id: string) => [...mcpServerKeys.details(), id] as const,
  versions: (id: string) => [...mcpServerKeys.detail(id), 'versions'] as const,
  agentServers: (agentId: string) => ['agents', agentId, 'mcp-servers'] as const,
};

// Hooks
export function useMcpServers(filters: McpServerFilters = {}) {
  return useQuery({
    queryKey: mcpServerKeys.list(filters),
    queryFn: () => fetchMcpServers(filters),
  });
}

export function useMcpServer(id: string) {
  return useQuery({
    queryKey: mcpServerKeys.detail(id),
    queryFn: () => fetchMcpServer(id),
    enabled: Boolean(id),
  });
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMcpServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() });
    },
  });
}

export function useUpdateMcpServer(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<McpServer> & { changeNotes?: string }) =>
      updateMcpServer(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() });
    },
  });
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMcpServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() });
    },
  });
}

export function useTestMcpServer(id: string) {
  return useMutation({
    mutationFn: () => testMcpServer(id),
  });
}

export function useMcpServerVersions(id: string) {
  return useQuery({
    queryKey: mcpServerKeys.versions(id),
    queryFn: () => fetchMcpServerVersions(id),
    enabled: Boolean(id),
  });
}

export function useRestoreMcpServerVersion(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => restoreMcpServerVersion(id, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.versions(id) });
    },
  });
}

export function useAgentMcpServers(agentId: string) {
  return useQuery({
    queryKey: mcpServerKeys.agentServers(agentId),
    queryFn: () => fetchAgentMcpServers(agentId),
    enabled: Boolean(agentId),
  });
}

export function useAttachMcpServer(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mcpServerId: string) => attachMcpServer(agentId, mcpServerId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: mcpServerKeys.agentServers(agentId),
      });
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() });
    },
  });
}

export function useDetachMcpServer(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mcpServerId: string) => detachMcpServer(agentId, mcpServerId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: mcpServerKeys.agentServers(agentId),
      });
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/hooks/use-mcp-servers.ts
git commit -m "feat(mcp): add MCP server React Query hooks"
```

### Task D2: MCP Server Form Component

**Files:**
- Create: `apps/web-ui/components/mcp-servers/mcp-server-form.tsx`

- [ ] **Step 1: Write the form component**

```tsx
// apps/web-ui/components/mcp-servers/mcp-server-form.tsx

'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useForm } from '@tanstack/react-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

const transportSchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('sse'),
    endpoint: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
  z.object({
    transport: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  }),
  z.object({
    transport: z.literal('http_bridge'),
    bridgeUrl: z.string().url(),
    targetCommand: z.string().min(1),
  }),
]);

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  transport: z.enum(['sse', 'stdio', 'http_bridge']),
  transportConfig: transportSchema,
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  retryCount: z.number().int().min(0).max(10).optional(),
});

type FormValues = z.infer<typeof schema>;

interface McpServerFormProps {
  defaultValues?: Partial<FormValues>;
  onSubmit: (values: FormValues) => void;
  onTest?: () => void;
  loading?: boolean;
  testLoading?: boolean;
  submitLabel?: string;
}

export function McpServerForm({
  defaultValues,
  onSubmit,
  onTest,
  loading,
  testLoading,
  submitLabel = 'Save',
}: McpServerFormProps) {
  const [transport, setTransport] = useState<
    'sse' | 'stdio' | 'http_bridge'
  >(defaultValues?.transport ?? 'sse');

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? '',
      description: defaultValues?.description ?? '',
      transport: defaultValues?.transport ?? 'sse',
      transportConfig: defaultValues?.transportConfig ?? {
        transport: 'sse',
        endpoint: '',
      },
      timeoutMs: defaultValues?.timeoutMs ?? 30000,
      retryCount: defaultValues?.retryCount ?? 3,
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onSubmit(value);
    },
  });

  const handleTransportChange = (value: 'sse' | 'stdio' | 'http_bridge') => {
    setTransport(value);
    let newConfig;
    switch (value) {
      case 'sse':
        newConfig = { transport: 'sse', endpoint: '' };
        break;
      case 'stdio':
        newConfig = { transport: 'stdio', command: '' };
        break;
      case 'http_bridge':
        newConfig = { transport: 'http_bridge', bridgeUrl: '', targetCommand: '' };
        break;
    }
    form.setFieldValue('transport', value);
    form.setFieldValue('transportConfig', newConfig as any);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-6"
    >
      <form.Field name="name">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Name</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="My MCP Server"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">
                {String(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="description">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Description</Label>
            <Textarea
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="What does this MCP server do?"
              rows={3}
            />
          </div>
        )}
      </form.Field>

      <div className="grid gap-1.5">
        <Label>Transport Type</Label>
        <Select value={transport} onValueChange={handleTransportChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
            <SelectItem value="stdio">stdio (Local Process)</SelectItem>
            <SelectItem value="http_bridge">HTTP Bridge</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {transport === 'sse' && (
        <form.Field name="transportConfig">
          {(field) => {
            const config = (field.state.value ?? { endpoint: '' }) as {
              endpoint: string;
              headers?: Record<string, string>;
            };
            return (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-1.5">
                  <Label>Endpoint URL</Label>
                  <Input
                    value={config.endpoint}
                    onChange={(e) =>
                      field.handleChange({
                        ...config,
                        transport: 'sse',
                        endpoint: e.target.value,
                      })
                    }
                    placeholder="https://api.example.com/sse"
                  />
                </div>
              </div>
            );
          }}
        </form.Field>
      )}

      {transport === 'stdio' && (
        <form.Field name="transportConfig">
          {(field) => {
            const config = (field.state.value ?? { command: '' }) as {
              command: string;
              args?: string[];
              env?: Record<string, string>;
            };
            return (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-1.5">
                  <Label>Command</Label>
                  <Input
                    value={config.command}
                    onChange={(e) =>
                      field.handleChange({
                        ...config,
                        transport: 'stdio',
                        command: e.target.value,
                      })
                    }
                    placeholder="npx"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Arguments (comma-separated)</Label>
                  <Input
                    value={(config.args ?? []).join(', ')}
                    onChange={(e) =>
                      field.handleChange({
                        ...config,
                        transport: 'stdio',
                        args: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="-y, @modelcontextprotocol/server-filesystem"
                  />
                </div>
              </div>
            );
          }}
        </form.Field>
      )}

      {transport === 'http_bridge' && (
        <form.Field name="transportConfig">
          {(field) => {
            const config = (field.state.value ?? {
              bridgeUrl: '',
              targetCommand: '',
            }) as {
              bridgeUrl: string;
              targetCommand: string;
            };
            return (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-1.5">
                  <Label>Bridge URL</Label>
                  <Input
                    value={config.bridgeUrl}
                    onChange={(e) =>
                      field.handleChange({
                        ...config,
                        transport: 'http_bridge',
                        bridgeUrl: e.target.value,
                      })
                    }
                    placeholder="https://bridge.example.com"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Target Command</Label>
                  <Input
                    value={config.targetCommand}
                    onChange={(e) =>
                      field.handleChange({
                        ...config,
                        transport: 'http_bridge',
                        targetCommand: e.target.value,
                      })
                    }
                    placeholder="npx @modelcontextprotocol/server-filesystem"
                  />
                </div>
              </div>
            );
          }}
        </form.Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <form.Field name="timeoutMs">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={field.name}>Timeout (ms)</Label>
              <Input
                id={field.name}
                type="number"
                value={field.state.value ?? 30000}
                onChange={(e) =>
                  field.handleChange(Number(e.target.value))
                }
                min={1000}
                max={300000}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="retryCount">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={field.name}>Retry Count</Label>
              <Input
                id={field.name}
                type="number"
                value={field.state.value ?? 3}
                onChange={(e) =>
                  field.handleChange(Number(e.target.value))
                }
                min={0}
                max={10}
              />
            </div>
          )}
        </form.Field>
      </div>

      <div className="flex gap-2">
        {onTest && (
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={testLoading}
          >
            {testLoading ? 'Testing...' : 'Test Connection'}
          </Button>
        )}
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/components/mcp-servers/mcp-server-form.tsx
git commit -m "feat(mcp): add MCP server form component"
```

### Task D3: MCP Server List Page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/mcp-servers/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/web-ui/app/(dashboard)/mcp-servers/page.tsx

'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useMcpServers, useDeleteMcpServer } from '@/hooks/use-mcp-servers';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Search, Server, Settings, Trash2, History } from 'lucide-react';

export default function McpServersPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useMcpServers({ search, pageSize: 50 });
  const deleteMutation = useDeleteMcpServer();

  const servers = useMemo(() => data?.items ?? [], [data]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this MCP server? It will be detached from all agents.')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('MCP server deleted');
    } catch {
      toast.error('Failed to delete MCP server');
    }
  };

  const getTransportLabel = (t: string) => {
    switch (t) {
      case 'sse':
        return 'SSE';
      case 'stdio':
        return 'stdio';
      case 'http_bridge':
        return 'Bridge';
      default:
        return t;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'active':
        return 'default' as const;
      case 'inactive':
        return 'secondary' as const;
      case 'error':
        return 'destructive' as const;
      default:
        return 'outline' as const;
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <Server className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">MCP Servers</h2>
      </div>
      <p className="text-muted-foreground">
        Manage Model Context Protocol servers for your agents.
      </p>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>All Servers</CardTitle>
              <CardDescription>
                {isLoading ? (
                  <Skeleton className="h-4 w-32" />
                ) : (
                  `${servers.length} server${servers.length !== 1 ? 's' : ''}`
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search servers..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Link href="/mcp-servers/new" className={buttonVariants()}>
                <Plus className="h-4 w-4 mr-2" />
                New Server
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : servers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No MCP servers yet. Create one to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Server className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium">{server.name}</div>
                      {server.description && (
                        <div className="text-sm text-muted-foreground truncate max-w-md">
                          {server.description}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {getTransportLabel(server.transport)}
                        </Badge>
                        <Badge variant={getStatusVariant(server.status)} className="text-xs capitalize">
                          {server.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {server._count?.versions ?? 0} version
                          {(server._count?.versions ?? 0) !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link
                      href={`/mcp-servers/${server.id}/versions`}
                      className={buttonVariants({
                        variant: 'ghost',
                        size: 'icon',
                        className: 'h-8 w-8',
                      })}
                    >
                      <History className="h-4 w-4" />
                    </Link>
                    <Link
                      href={`/mcp-servers/${server.id}`}
                      className={buttonVariants({
                        variant: 'ghost',
                        size: 'icon',
                        className: 'h-8 w-8',
                      })}
                    >
                      <Settings className="h-4 w-4" />
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(server.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/mcp-servers/page.tsx
git commit -m "feat(mcp): add MCP server manager list page"
```

### Task D4: MCP Server Editor Page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/mcp-servers/[id]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/web-ui/app/(dashboard)/mcp-servers/[id]/page.tsx

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMcpServer, useUpdateMcpServer, useTestMcpServer } from '@/hooks/use-mcp-servers';
import { McpServerForm } from '@/components/mcp-servers/mcp-server-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Server, History } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

export default function McpServerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const serverId = params.id;

  const { data: server, isLoading } = useMcpServer(serverId);
  const updateMutation = useUpdateMcpServer(serverId);
  const testMutation = useTestMcpServer(serverId);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">MCP server not found.</p>
          <Button variant="outline" onClick={() => router.push('/mcp-servers')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Servers
          </Button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (values: {
    name: string;
    description?: string;
    transport: 'sse' | 'stdio' | 'http_bridge';
    transportConfig: Record<string, unknown>;
    timeoutMs?: number;
    retryCount?: number;
  }) => {
    try {
      await updateMutation.mutateAsync({
        name: values.name,
        description: values.description,
        transport: values.transport,
        config: {
          transport: values.transport,
          transportConfig: values.transportConfig,
          timeoutMs: values.timeoutMs,
          retryCount: values.retryCount,
        },
      });
      toast.success('MCP server updated');
    } catch {
      toast.error('Failed to update MCP server');
    }
  };

  const handleTest = async () => {
    try {
      const result = await testMutation.mutateAsync();
      if (result.connected) {
        toast.success('Connection successful');
      } else {
        toast.error(result.error ?? 'Connection failed');
      }
    } catch {
      toast.error('Test failed');
    }
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => router.push('/mcp-servers')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Server className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">{server.name}</h2>
        <Badge variant="outline" className="capitalize">
          {server.transport}
        </Badge>
        <Link
          href={`/mcp-servers/${serverId}/versions`}
          className="ml-auto"
        >
          <Button variant="ghost" size="sm">
            <History className="h-4 w-4 mr-1" />
            Versions
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Update the transport settings and connection parameters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <McpServerForm
            defaultValues={{
              name: server.name,
              description: server.description ?? undefined,
              transport: server.transport,
              transportConfig: (server.config as any)?.transportConfig ?? {
                transport: server.transport,
                ...(server.transport === 'sse' && { endpoint: '' }),
                ...(server.transport === 'stdio' && { command: '' }),
                ...(server.transport === 'http_bridge' && {
                  bridgeUrl: '',
                  targetCommand: '',
                }),
              },
              timeoutMs: (server.config as any)?.timeoutMs ?? 30000,
              retryCount: (server.config as any)?.retryCount ?? 3,
            }}
            onSubmit={handleSubmit}
            onTest={handleTest}
            loading={updateMutation.isPending}
            testLoading={testMutation.isPending}
            submitLabel="Save Changes"
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/mcp-servers/\[id\]/page.tsx
git commit -m "feat(mcp): add MCP server editor page"
```

### Task D5: MCP Server Versions Page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/mcp-servers/[id]/versions/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/web-ui/app/(dashboard)/mcp-servers/[id]/versions/page.tsx

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMcpServer, useMcpServerVersions, useRestoreMcpServerVersion } from '@/hooks/use-mcp-servers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Server, RotateCcw, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

interface McpServerVersionItem {
  id: string;
  version: number;
  config: Record<string, unknown>;
  changeNotes: string | null;
  createdBy: string;
  createdAt: string;
}

export default function McpServerVersionsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const serverId = params.id;

  const { data: server, isLoading: serverLoading } = useMcpServer(serverId);
  const { data: versions, isLoading: versionsLoading } = useMcpServerVersions(serverId);
  const restoreMutation = useRestoreMcpServerVersion(serverId);
  const [previewVersion, setPreviewVersion] = useState<McpServerVersionItem | null>(null);

  const isLoading = serverLoading || versionsLoading;

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">MCP server not found.</p>
          <Button variant="outline" onClick={() => router.push('/mcp-servers')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Servers
          </Button>
        </div>
      </div>
    );
  }

  const handleRestore = async (versionId: string) => {
    if (!confirm('Restore this version? A new version snapshot will be created.')) return;
    try {
      await restoreMutation.mutateAsync(versionId);
      toast.success('Version restored');
    } catch {
      toast.error('Failed to restore version');
    }
  };

  const versionList = (versions ?? []) as McpServerVersionItem[];

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-background max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => router.push(`/mcp-servers/${serverId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Server className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">{server.name}</h2>
        <Badge variant="outline">Version History</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>
            {versionList.length} version{versionList.length !== 1 ? 's' : ''} saved
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versionList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No versions yet. Edit the server to create snapshots.
            </div>
          ) : (
            <div className="space-y-2">
              {versionList.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <div className="font-medium">Version {version.version}</div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(version.createdAt).toLocaleString()} · {version.createdBy}
                    </div>
                    {version.changeNotes && (
                      <div className="text-sm text-muted-foreground mt-1">
                        {version.changeNotes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPreviewVersion(version)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRestore(version.id)}
                      disabled={restoreMutation.isPending}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {previewVersion && (
        <Card>
          <CardHeader>
            <CardTitle>Version {previewVersion.version} Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="rounded-lg bg-muted p-4 overflow-auto text-sm">
              {JSON.stringify(previewVersion.config, null, 2)}
            </pre>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setPreviewVersion(null)}
            >
              Close Preview
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/mcp-servers/\[id\]/versions/page.tsx
git commit -m "feat(mcp): add MCP server version history page"
```

### Task D6: MCP Servers Tab in Agent Studio

**Files:**
- Create: `apps/web-ui/components/agents/tabs/mcp-servers-tab.tsx`

- [ ] **Step 1: Write the tab component**

```tsx
// apps/web-ui/components/agents/tabs/mcp-servers-tab.tsx

'use client';

import { useMcpServers, useAgentMcpServers, useAttachMcpServer, useDetachMcpServer } from '@/hooks/use-mcp-servers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Server, Plus, Minus } from 'lucide-react';

interface McpServersTabProps {
  agentId: string;
}

export function McpServersTab({ agentId }: McpServersTabProps) {
  const { data: allServers, isLoading: allLoading } = useMcpServers({ pageSize: 100 });
  const { data: attachedServers, isLoading: attachedLoading } = useAgentMcpServers(agentId);
  const attachMutation = useAttachMcpServer(agentId);
  const detachMutation = useDetachMcpServer(agentId);

  const isLoading = allLoading || attachedLoading;
  const attachedIds = new Set((attachedServers ?? []).map((s) => s.id));

  const handleAttach = async (serverId: string) => {
    try {
      await attachMutation.mutateAsync(serverId);
      toast.success('MCP server attached');
    } catch {
      toast.error('Failed to attach MCP server');
    }
  };

  const handleDetach = async (serverId: string) => {
    try {
      await detachMutation.mutateAsync(serverId);
      toast.success('MCP server detached');
    } catch {
      toast.error('Failed to detach MCP server');
    }
  };

  const getTransportLabel = (t: string) => {
    switch (t) {
      case 'sse':
        return 'SSE';
      case 'stdio':
        return 'stdio';
      case 'http_bridge':
        return 'Bridge';
      default:
        return t;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'active':
        return 'default' as const;
      case 'inactive':
        return 'secondary' as const;
      case 'error':
        return 'destructive' as const;
      default:
        return 'outline' as const;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const servers = allServers?.items ?? [];

  if (servers.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No MCP servers available.{' '}
          <a href="/mcp-servers" className="underline">
            Create one first
          </a>
          .
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Attached MCP Servers</CardTitle>
          <CardDescription>
            {attachedServers?.length ?? 0} server
            {(attachedServers?.length ?? 0) !== 1 ? 's' : ''} attached
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {servers.map((server) => {
              const isAttached = attachedIds.has(server.id);
              return (
                <div
                  key={server.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{server.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {getTransportLabel(server.transport)}
                        </Badge>
                        <Badge variant={getStatusVariant(server.status)} className="text-xs capitalize">
                          {server.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant={isAttached ? 'outline' : 'default'}
                    size="sm"
                    onClick={() =>
                      isAttached ? handleDetach(server.id) : handleAttach(server.id)
                    }
                    disabled={
                      attachMutation.isPending || detachMutation.isPending
                    }
                  >
                    {isAttached ? (
                      <>
                        <Minus className="h-4 w-4 mr-1" />
                        Remove
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/components/agents/tabs/mcp-servers-tab.tsx
git commit -m "feat(mcp): add MCP servers tab for Agent Studio"
```

---

## Workstream E: Integration

### Task E1: Add RBAC Module

**Files:**
- Modify: `libs/shared/src/rbac/types.ts`

- [ ] **Step 1: Add McpServers module**

In `libs/shared/src/rbac/types.ts`, modify line 1:

```typescript
export type Module = 'Conversations' | 'Messages' | 'Settings' | 'Users' | 'Tenants' | 'Agents' | 'KnowledgeBases' | 'McpServers';
```

In `libs/shared/src/rbac/types.ts`, add to `SUBJECT_TO_MODULE` around line 26:

```typescript
  McpServer: 'McpServers',
  McpServers: 'McpServers',
```

- [ ] **Step 2: Commit**

```bash
git add libs/shared/src/rbac/types.ts
git commit -m "feat(mcp): add McpServers RBAC module"
```

### Task E2: Add Sidebar Navigation

**Files:**
- Modify: `apps/web-ui/components/layout/app-sidebar.tsx`

- [ ] **Step 1: Add MCP Servers to sidebar**

In `apps/web-ui/components/layout/app-sidebar.tsx`, find the `mainNav` array and add after Agent Studio:

```typescript
  { name: 'MCP Servers', href: '/mcp-servers', icon: Server },
```

Import `Server` from lucide-react if not already imported:

```typescript
import {
  // ... existing imports
  Server,
} from 'lucide-react';
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/components/layout/app-sidebar.tsx
git commit -m "feat(mcp): add MCP Servers to sidebar navigation"
```

### Task E3: Add Tabs to Agent Detail Page

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx`

- [ ] **Step 1: Add tabs to the simple agent page**

In `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx`, modify the simple agent return section (around line 148).

Import tabs components at the top:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { McpServersTab } from '@/components/agents/tabs/mcp-servers-tab';
```

Replace the simple agent return section content (the Card with Configuration) with:

```tsx
      <Tabs defaultValue="configuration" className="space-y-4">
        <TabsList>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="knowledge-bases">Knowledge Bases</TabsTrigger>
          <TabsTrigger value="mcp-servers">MCP Servers</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="configuration">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Configure the model and system prompt for this agent.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleAgentForm
                config={simpleConfig}
                onSave={handleSimpleSave}
                saving={saving}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="knowledge-bases">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Knowledge Base integration coming soon.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mcp-servers">
          <McpServersTab agentId={agentId} />
        </TabsContent>

        <TabsContent value="versions">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <a href={`/api/agents/${agentId}/versions`} className="underline">
                View version history via API
              </a>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/agents/\[id\]/page.tsx
git commit -m "feat(mcp): add tabs to Agent Studio with MCP Servers integration"
```

### Task E4: Add "New MCP Server" Page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/mcp-servers/new/page.tsx`

- [ ] **Step 1: Write the new server page**

```tsx
// apps/web-ui/app/(dashboard)/mcp-servers/new/page.tsx

'use client';

import { useRouter } from 'next/navigation';
import { useCreateMcpServer } from '@/hooks/use-mcp-servers';
import { McpServerForm } from '@/components/mcp-servers/mcp-server-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Server } from 'lucide-react';
import { toast } from 'sonner';

export default function NewMcpServerPage() {
  const router = useRouter();
  const createMutation = useCreateMcpServer();

  const handleSubmit = async (values: {
    name: string;
    description?: string;
    transport: 'sse' | 'stdio' | 'http_bridge';
    transportConfig: Record<string, unknown>;
    timeoutMs?: number;
    retryCount?: number;
  }) => {
    try {
      await createMutation.mutateAsync({
        name: values.name,
        description: values.description,
        transport: values.transport,
        config: {
          transport: values.transport,
          transportConfig: values.transportConfig,
          timeoutMs: values.timeoutMs,
          retryCount: values.retryCount,
        },
      });
      toast.success('MCP server created');
      router.push('/mcp-servers');
    } catch {
      toast.error('Failed to create MCP server');
    }
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => router.push('/mcp-servers')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Server className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">New MCP Server</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Set up a new Model Context Protocol server connection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <McpServerForm
            onSubmit={handleSubmit}
            loading={createMutation.isPending}
            submitLabel="Create Server"
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/mcp-servers/new/page.tsx
git commit -m "feat(mcp): add new MCP server creation page"
```

---

## Workstream F: Build Verification

### Task F1: Run Build

- [ ] **Step 1: Build all projects**

```bash
bun run build
```

Expected: Build completes without errors.

- [ ] **Step 2: Fix any TypeScript errors**

If build fails with TypeScript errors:
1. Read the error message
2. Fix the file
3. Re-run build
4. Repeat until clean

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(mcp): resolve build errors"
```

### Task F2: Run Unit Tests

- [ ] **Step 1: Run agent-studio tests**

```bash
nx test agent-studio
```

Expected: Tests pass.

- [ ] **Step 2: Run shared tests**

```bash
nx test shared
```

Expected: Tests pass.

- [ ] **Step 3: Commit test fixes if needed**

```bash
git add -A
git commit -m "test(mcp): fix failing tests"
```

---

## Self-Review

### Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| Prisma schema: McpServer | A1 |
| Prisma schema: McpServerVersion | A1 |
| Prisma schema: AgentMcpServer | A1 |
| Agent model relation | A1 |
| Tenant model relation | A1 |
| Backend types | B1 |
| McpServerService CRUD + version snapshot | B2 |
| McpServerVersionService | B3 |
| Export from index.ts | B4 |
| API: List/Create MCP servers | C1 |
| API: Get/Update/Delete MCP server | C2 |
| API: Version list/create | C3 |
| API: Version restore | C3 |
| API: Test connection | C4 |
| API: Agent attach/detach | C5 |
| Frontend hooks | D1 |
| Frontend form | D2 |
| Frontend list page | D3 |
| Frontend editor page | D4 |
| Frontend versions page | D5 |
| Frontend Agent Studio tab | D6 |
| RBAC module | E1 |
| Sidebar nav | E2 |
| Agent page tabs | E3 |
| New server page | E4 |
| Build verification | F1 |
| Test verification | F2 |

**Coverage: 100%** — all spec requirements have implementing tasks.

### Placeholder Scan

- No "TBD", "TODO", "implement later", "fill in details" found.
- No vague error handling descriptions — all behaviors specified.
- No "similar to Task X" shortcuts — each task is self-contained.
- All code blocks contain complete, runnable code.

### Type Consistency Check

- `McpServerTransport` = `'sse' | 'stdio' | 'http_bridge'` — consistent across B1, C1-C5, D1-D6.
- `McpServerStatus` = `'active' | 'inactive' | 'error'` — consistent across B1-B3, C2, D3-D6.
- `McpServerConfig` shape — consistent in B1, B2 snapshot, C1-C2 API body, D2 form, D4 editor.
- Service method names: `create`, `findById`, `findMany`, `update`, `delete` — match existing `AgentService` pattern.

No inconsistencies found.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-mcp-server-configuration.md`.**

### Parallel Workstreams for Agent Teams

This plan is organized into 6 workstreams that can run in parallel or near-parallel:

- **Workstream A (Database):** Tasks A1-A2 — Schema + migration. Must complete first.
- **Workstream B (Backend):** Tasks B1-B4 — Types + services. Can start once schema is drafted.
- **Workstream C (API):** Tasks C1-C5 — All API routes. Depends on Workstream B.
- **Workstream D (Frontend):** Tasks D1-D6 — Hooks, components, pages. Can start once API routes exist (or mock).
- **Workstream E (Integration):** Tasks E1-E4 — RBAC, sidebar, agent tabs, new page. Depends on D.
- **Workstream F (Verification):** Tasks F1-F2 — Build + tests. Final step.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per workstream, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach would you like?**
