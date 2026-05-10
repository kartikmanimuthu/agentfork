# Agent Studio Integration: Knowledge Base, MCP, Versioning & Aliases

## Date
2026-05-07

## Status
Approved — ready for implementation planning

## Problem Statement
The Agent Studio UI has tabs for Knowledge Bases, MCP Servers, and Versions, but Knowledge Bases and Versions show placeholder "coming soon" text. MCP Servers are already wired but Knowledge Bases have no backend or frontend integration. Agent versions are created on every save, but there is no UI to view history, publish versions, or test specific versions. There is no concept of aliases (dev/prod/ut) for version management.

## Goals
1. Allow agents to be linked to one or more Knowledge Bases
2. Automatically retrieve from linked KBs during agent inference
3. Provide a Versions tab to view, publish, and test agent versions
4. Add an Alias system (dev/prod/ut/etc.) mapping mutable pointers to immutable versions
5. Enable the testing workflow: Edit → Save (auto-version) → Test in Playground → Iterate

## Non-Goals
- Replacing the existing graph canvas editor
- Changing the MCP Server integration (already working)
- Changing the inference API v1 public contract (only adding optional alias param)
- Adding RBAC changes beyond existing permissions

## Architecture

### Data Model

Two new Prisma models and one relation addition:

```prisma
model AgentKnowledgeBase {
  id             String   @id @default(cuid())
  agentId        String
  knowledgeBaseId String
  createdAt      DateTime @default(now())

  agent         Agent         @relation(fields: [agentId], references: [id], onDelete: Cascade)
  knowledgeBase KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)

  @@unique([agentId, knowledgeBaseId])
  @@index([agentId])
  @@index([knowledgeBaseId])
  @@map("agent_knowledge_bases")
}

model AgentAlias {
  id          String   @id @default(cuid())
  agentId     String
  name        String   // e.g. 'dev', 'prod', 'ut'
  versionId   String
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  agent   Agent         @relation(fields: [agentId], references: [id], onDelete: Cascade)
  version AgentVersion  @relation(fields: [versionId], references: [id], onDelete: Restrict)

  @@unique([agentId, name])
  @@index([agentId])
  @@index([versionId])
  @@map("agent_aliases")
}
```

Relations added to existing models:
- `Agent.knowledgeBases` → `AgentKnowledgeBase[]`
- `KnowledgeBase.agents` → `AgentKnowledgeBase[]`
- `Agent.aliases` → `AgentAlias[]`
- `AgentVersion.aliases` → `AgentAlias[]`

### Backend Services

#### KnowledgeBaseAttachmentService
- `attach(agentId, knowledgeBaseId)` / `detach(agentId, knowledgeBaseId)`
- `findAttached(agentId)` — list KBs linked to agent
- Uses `agentKnowledgeBase` Prisma delegate

#### AgentAliasService
- `createAlias(agentId, name, versionId, isDefault?)`
- `updateAlias(id, { versionId?, isDefault? })`
- `deleteAlias(id)`
- `resolveAlias(agentId, aliasName?)` — returns version config; falls back to default alias
- Enforces only one `isDefault` per agent

#### Inference Integration
When an agent executes (playground or API v1):
1. Resolve version: explicit `versionId` > `alias` param > default alias > agent's current config
2. Load attached KBs for that agent
3. Run retrieval using `@chatbot/knowledge-base` RetrievalService with agent's query
4. Inject retrieved chunks into system prompt context
5. Proceed to LLM call

### API Routes

#### New Internal Routes (dashboard API)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/[id]/knowledge-bases` | List attached KBs |
| POST | `/api/agents/[id]/knowledge-bases` | Attach a KB |
| DELETE | `/api/agents/[id]/knowledge-bases/[kbId]` | Detach a KB |
| GET | `/api/agents/[id]/versions` | List versions with alias info |
| POST | `/api/agents/[id]/versions/[versionId]/publish` | Publish version |
| GET | `/api/agents/[id]/aliases` | List aliases |
| POST | `/api/agents/[id]/aliases` | Create alias |
| PUT | `/api/agents/[id]/aliases/[aliasId]` | Update alias |
| DELETE | `/api/agents/[id]/aliases/[aliasId]` | Delete alias |

#### Inference API v1 Changes
- `POST /api/v1/inference` accepts optional `alias` or `versionId` in body
- `POST /api/v1/inference/sessions` accepts optional `alias` or `versionId`

### Frontend

#### Knowledge Bases Tab
- Multi-select list of tenant KBs
- Shows attached status with toggle
- Displays KB metadata (document count, status)

#### Versions Tab
- Table with version number, status, created date
- Actions: Test in Playground, Publish, Archive
- Shows which aliases point to each version

#### Playground
- Version selector: dropdown showing aliases + specific versions
- Default: "Latest draft"
- Runs inference with selected version/alias

#### Alias Management
- Inline within Versions tab or separate modal
- Create alias with name + version picker
- Set default alias toggle
- Delete alias button

### Testing Workflow

```
Edit agent config → Save → Auto-version created (draft)
→ Versions tab shows new version
→ Click "Test in Playground" → Opens playground with that version
→ Iterate config → Save → New version
→ Satisfied? Click "Publish" on version
→ Create/update alias (e.g. "dev") to point to published version
→ API callers use ?alias=dev
```

## Error Handling
- KB attachment fails if KB is archived → 400 with clear message
- Alias update fails if version is archived → 400 (archived versions immutable)
- Alias delete fails if it's the only default → 400 (must have a default)
- Inference with invalid alias → 404
- Inference with no attached KBs → proceeds normally (no KB context)

## Security & Permissions
- All new routes use existing `authorize()` helper with `Agent` resource
- Alias changes require `update` permission on Agent
- Inference API uses existing API key + quota checks

## Migration
- `prisma migrate dev` for new tables
- No data migration needed (new features)

## Files to Touch
- `prisma/schema.prisma`
- `libs/agent-studio/src/services/` — new services + tests
- `libs/agent-studio/src/types/` — new types
- `libs/agent-studio/src/index.ts` — exports
- `apps/web-ui/app/api/agents/[id]/knowledge-bases/route.ts`
- `apps/web-ui/app/api/agents/[id]/versions/route.ts` (extend existing)
- `apps/web-ui/app/api/agents/[id]/aliases/route.ts`
- `apps/web-ui/app/api/v1/inference/lib/` — update resolver
- `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx` — replace placeholders
- `apps/web-ui/components/agents/tabs/` — new/updated tab components
- `apps/web-ui/hooks/` — new React Query hooks
- `apps/web-ui/app/api/agents/[id]/playground/route.ts` — accept version/alias

## Spec Self-Review

| Check | Status |
|-------|--------|
| No TBD/placeholders | Pass |
| Internal consistency | Pass — alias resolution order is explicit |
| Scope focused | Pass — single feature set |
| No ambiguity | Pass — data model, API, and UI are specified |
