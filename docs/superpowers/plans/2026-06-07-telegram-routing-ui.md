# Telegram Routing UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the missing Telegram routing page that lets users assign a graph agent to a connected Telegram bot — the final piece needed for the Telegram integration to function end-to-end.

**Architecture:** Mirror the WhatsApp routing page exactly. Two new files: a `GET`/`PUT` API route at `/api/telegram/accounts/[id]/routing` and a UI page at `/settings/channels/telegram/[id]/routing`. The Telegram accounts list page already has a routing button that links to this path (line 169 of `telegram/page.tsx`) — it just has no destination yet.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Prisma, shadcn/ui, Zod, Pino logger, `@chatbot/shared` auth helpers.

---

## Context: What already exists

- `apps/web-ui/app/(dashboard)/settings/channels/telegram/page.tsx` — accounts list, routing button at line 169 pushes to `/settings/channels/telegram/${id}/routing`
- `apps/web-ui/app/api/telegram/accounts/route.ts` — GET list of accounts
- `apps/web-ui/app/api/telegram/routing/route.ts` — POST-only stub (wrong path, wrong schema — do NOT use or modify it)
- `prisma/schema.prisma` — `TelegramRouting` and `TelegramRoutingRule` models exist with fields: `strategy`, `config`, `fallbackAgentId`, `rules[agentId, priority, condition, isActive]`
- `apps/web-ui/app/api/whatsapp/accounts/[id]/routing/route.ts` — reference implementation to mirror exactly

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `apps/web-ui/app/api/telegram/accounts/[id]/routing/route.ts` | GET + PUT routing API for one Telegram account |
| Create | `apps/web-ui/app/(dashboard)/settings/channels/telegram/[id]/routing/page.tsx` | Routing config UI — strategy, fallback agent, keyword rules |

---

## Task 1: Routing API route

**Files:**
- Create: `apps/web-ui/app/api/telegram/accounts/[id]/routing/route.ts`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p apps/web-ui/app/api/telegram/accounts/\[id\]/routing
```

- [ ] **Step 2: Write the route**

Full file contents — mirrors `apps/web-ui/app/api/whatsapp/accounts/[id]/routing/route.ts` exactly, substituting Telegram model names:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('telegram-routing');

const updateRoutingSchema = z.object({
  strategy: z.enum(['keyword', 'menu', 'ai_intent', 'time_based']),
  config: z.record(z.unknown()).default({}),
  fallbackAgentId: z.string().nullable().optional(),
  rules: z.array(z.object({
    agentId: z.string().min(1),
    priority: z.number().int().min(0),
    condition: z.record(z.unknown()),
    isActive: z.boolean().default(true),
  })).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).telegramAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const routing = await (prisma as any).telegramRouting.findUnique({
      where: { accountId: id },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });

    return NextResponse.json(routing);
  } catch (error) {
    logger.error({ error }, 'Error fetching Telegram routing config');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateRoutingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();

    const account = await (prisma as any).telegramAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const routing = await (prisma as any).telegramRouting.upsert({
      where: { accountId: id },
      update: {
        strategy: parsed.data.strategy,
        config: parsed.data.config,
        fallbackAgentId: parsed.data.fallbackAgentId ?? null,
      },
      create: {
        accountId: id,
        strategy: parsed.data.strategy,
        config: parsed.data.config,
        fallbackAgentId: parsed.data.fallbackAgentId ?? null,
      },
    });

    if (parsed.data.rules) {
      await (prisma as any).telegramRoutingRule.deleteMany({
        where: { routingId: routing.id },
      });

      await (prisma as any).telegramRoutingRule.createMany({
        data: parsed.data.rules.map((rule) => ({
          routingId: routing.id,
          agentId: rule.agentId,
          priority: rule.priority,
          condition: rule.condition,
          isActive: rule.isActive,
        })),
      });
    }

    const updated = await (prisma as any).telegramRouting.findUnique({
      where: { accountId: id },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });

    logger.info({ tenantId, accountId: id, strategy: parsed.data.strategy }, 'Telegram routing config updated');

    return NextResponse.json(updated);
  } catch (error) {
    logger.error({ error }, 'Error updating Telegram routing config');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot && bunx nx run web-ui:build 2>&1 | tail -5
```

Expected: `NX   Successfully ran target build for project web-ui`

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/telegram/accounts/
git commit -m "feat(telegram): add GET/PUT routing API at /api/telegram/accounts/[id]/routing"
```

---

## Task 2: Routing UI page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/settings/channels/telegram/[id]/routing/page.tsx`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p "apps/web-ui/app/(dashboard)/settings/channels/telegram/[id]/routing"
```

- [ ] **Step 2: Write the page**

Full file — mirrors `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/[id]/routing/page.tsx` exactly, with Telegram colours (sky instead of green) and Telegram API paths:

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { TelegramIcon } from '@/components/icons/telegram-icon';
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';

interface RoutingRule {
  id: string;
  agentId: string;
  priority: number;
  condition: Record<string, unknown>;
  isActive: boolean;
}

interface RoutingConfig {
  id: string;
  strategy: string;
  config: Record<string, unknown>;
  fallbackAgentId: string | null;
  rules: RoutingRule[];
}

interface Agent {
  id: string;
  name: string;
}

export default function TelegramRoutingPage({ params }: { params: Promise<{ id: string }> }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [routing, setRouting] = useState<RoutingConfig | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    params.then(({ id }) => {
      setAccountId(id);
      fetchRouting(id);
      fetchAgents();
    });
  }, [params]);

  const fetchRouting = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/accounts/${id}/routing`);
      if (!res.ok) throw new Error('Failed to load routing');
      const data = await res.json();
      setRouting(data ?? { id: '', strategy: 'keyword', config: {}, fallbackAgentId: null, rules: [] });
    } catch {
      toast.error('Failed to load routing configuration');
      setRouting({ id: '', strategy: 'keyword', config: {}, fallbackAgentId: null, rules: [] });
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents?pageSize=100');
      if (!res.ok) throw new Error('Failed to load agents');
      const data = await res.json();
      setAgents(data.items ?? []);
    } catch {
      toast.error('Failed to load agents');
    }
  };

  const handleSave = async () => {
    if (!accountId || !routing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/telegram/accounts/${accountId}/routing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: routing.strategy,
          config: routing.config,
          fallbackAgentId: routing.fallbackAgentId,
          rules: routing.rules,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Routing configuration saved');
    } catch {
      toast.error('Failed to save routing configuration');
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    if (!routing) return;
    const newRule: RoutingRule = {
      id: `temp-${Date.now()}`,
      agentId: agents[0]?.id ?? '',
      priority: routing.rules.length,
      condition: { type: 'keyword', value: '' },
      isActive: true,
    };
    setRouting({ ...routing, rules: [...routing.rules, newRule] });
  };

  const updateRule = (index: number, updates: Partial<RoutingRule>) => {
    if (!routing) return;
    const rules = [...routing.rules];
    rules[index] = { ...rules[index], ...updates };
    setRouting({ ...routing, rules });
  };

  const removeRule = (index: number) => {
    if (!routing) return;
    setRouting({ ...routing, rules: routing.rules.filter((_, i) => i !== index) });
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
            <TelegramIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Routing Configuration</h2>
            <p className="text-sm text-muted-foreground">Configure how incoming Telegram messages are routed to agents.</p>
          </div>
        </div>
        <Link href="/settings/channels/telegram">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Channels
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : routing ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Strategy & Fallback</CardTitle>
              <CardDescription>Choose how messages are routed when no rule matches.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="strategy">Routing Strategy</Label>
                  <Select
                    value={routing.strategy}
                    onValueChange={(value) => setRouting({ ...routing, strategy: value })}
                  >
                    <SelectTrigger id="strategy">
                      <SelectValue placeholder="Select strategy" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword">Keyword</SelectItem>
                      <SelectItem value="menu">Menu</SelectItem>
                      <SelectItem value="time_based">Time Based</SelectItem>
                      <SelectItem value="ai_intent">AI Intent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fallback">Fallback Agent</Label>
                  <Select
                    value={routing.fallbackAgentId ?? ''}
                    onValueChange={(value) => setRouting({ ...routing, fallbackAgentId: value || null })}
                  >
                    <SelectTrigger id="fallback">
                      <SelectValue placeholder="Select fallback agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Routing Rules</CardTitle>
                <CardDescription>Define keyword rules to route messages to specific agents.</CardDescription>
              </div>
              <Button onClick={addRule}>
                <Plus className="mr-2 h-4 w-4" />
                Add Rule
              </Button>
            </CardHeader>
            <CardContent>
              {routing.rules.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No rules configured. Messages will go to the fallback agent.
                </p>
              ) : (
                <div className="space-y-4">
                  {routing.rules.map((rule, index) => (
                    <div key={rule.id} className="flex items-start gap-4 rounded-lg border p-4">
                      <div className="flex-1 grid gap-4 md:grid-cols-4">
                        <div className="space-y-2">
                          <Label>Priority</Label>
                          <Input
                            type="number"
                            value={rule.priority}
                            onChange={(e) => updateRule(index, { priority: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Agent</Label>
                          <Select
                            value={rule.agentId}
                            onValueChange={(value) => updateRule(index, { agentId: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select agent" />
                            </SelectTrigger>
                            <SelectContent>
                              {agents.map((agent) => (
                                <SelectItem key={agent.id} value={agent.id}>
                                  {agent.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Condition</Label>
                          <Input
                            value={JSON.stringify(rule.condition)}
                            onChange={(e) => {
                              try {
                                updateRule(index, { condition: JSON.parse(e.target.value) });
                              } catch {
                                // ignore invalid JSON while typing
                              }
                            }}
                            placeholder='{"type":"keyword","value":"sales"}'
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Active</Label>
                          <div className="flex items-center h-9">
                            <Switch
                              checked={rule.isActive}
                              onCheckedChange={(checked) => updateRule(index, { isActive: checked })}
                            />
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive shrink-0 mt-6"
                        onClick={() => removeRule(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No routing configuration found.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TelegramIcon exists**

```bash
find /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot/apps/web-ui/components/icons -name "telegram-icon*"
```

Expected: finds `telegram-icon.tsx`. If it does NOT exist, create it:

```tsx
// apps/web-ui/components/icons/telegram-icon.tsx
import { SVGProps } from 'react';

export function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-2.01 9.47c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.873.75z" />
    </svg>
  );
}
```

- [ ] **Step 4: Build to verify TypeScript**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot && bunx nx run web-ui:build 2>&1 | tail -5
```

Expected: `NX   Successfully ran target build for project web-ui`

- [ ] **Step 5: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/settings/channels/telegram/" apps/web-ui/components/icons/telegram-icon.tsx
git commit -m "feat(telegram): add routing configuration UI at /settings/channels/telegram/[id]/routing"
```

---

## Task 3: Verification

- [ ] **Step 1: Run agent-studio tests to confirm nothing broken**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot/libs/agent-studio && bunx vitest run 2>&1 | tail -5
```

Expected: `Tests  156 passed (156)`

- [ ] **Step 2: Run telegram lib tests**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot/libs/telegram && bunx vitest run 2>&1 | tail -5
```

Expected: `Tests  13 passed (13)`

- [ ] **Step 3: Confirm the routing page is reachable in the build output**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot && bunx nx run web-ui:build 2>&1 | grep "telegram"
```

Expected output includes:
```
ƒ /settings/channels/telegram/[id]/routing
○ /api/telegram/accounts/[id]/routing
```

- [ ] **Step 4: Final commit if anything was fixed**

```bash
git add -A
git commit -m "fix(telegram): routing page verification fixes"
```

---

## Manual test checklist (run after build)

Once the dev server is running:

1. Go to **Connectors → Telegram** → connect a bot
2. Click the gear icon (⚙) on the connected bot row
3. Should land on `/settings/channels/telegram/[id]/routing`
4. Page loads with Strategy dropdown and Fallback Agent dropdown
5. Select a graph agent as fallback → click **Save Changes**
6. Toast shows "Routing configuration saved"
7. Refresh page — saved agent is still selected
8. Add a keyword rule → Save → refresh — rule persists
9. Remove the rule → Save → refresh — rule is gone
