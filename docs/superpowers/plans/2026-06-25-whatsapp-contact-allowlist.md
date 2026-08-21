# WhatsApp Contact Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-account allowlist so a WhatsApp account only auto-replies to approved numbers — everyone else's messages are still received and stored, but get no reply.

**Architecture:** One new boolean flag + one new table on `WhatsAppAccount`; a single enforcement check inserted into the existing `MessageProcessor.processMessageEvent` flow, right after the inbound message is stored and before any command/routing/agent logic runs; CRUD API routes and a settings sub-page mirroring the existing Routing page's pattern exactly.

**Tech Stack:** Next.js App Router (apps/web-ui), Prisma/PostgreSQL, Vitest, Zod, Pino, shadcn/ui.

## Global Constraints

- `WhatsAppAccount.restrictToAllowlist` defaults to `true` — this is intentional; it locks down every existing account (including the one already connected) the moment this migrates, not a bug to work around.
- `phoneNumber` is always digits-only with country code, no `+`, no spaces — validated with `/^\d{10,15}$/`, matching the format already used for `WhatsAppAccount.phoneNumberId`.
- This gates **auto-replies triggered by an inbound message only** (the path through `MessageProcessor.processMessageEvent`). It must not touch the manual template-send route, any other send path, or any Meta-specific or Netcore-specific code.
- No bulk import of numbers — add one at a time.
- Do not modify `libs/whatsapp/src/client/meta-api.ts`, `libs/whatsapp/src/client/netcore-api.ts`, `libs/whatsapp/src/webhook/parser.ts`, `libs/whatsapp/src/webhook/netcore-parser.ts`, or `apps/web-ui/app/api/webhooks/whatsapp/route.ts` — none of them are relevant to this feature.

---

### Task 1: Schema — `restrictToAllowlist` flag and `WhatsAppAllowedContact` table

**Files:**
- Modify: `prisma/schema.prisma` (the `WhatsAppAccount` model, currently lines 719–744)
- Create: `prisma/migrations/20260625000000_add_whatsapp_allowlist/migration.sql`

**Interfaces:**
- Produces: `WhatsAppAccount.restrictToAllowlist: boolean` (default `true`) and a new `WhatsAppAllowedContact` model (`id`, `accountId`, `phoneNumber`, `label`, `createdAt`) with a compound unique constraint on `(accountId, phoneNumber)` — Prisma will expose this as the `accountId_phoneNumber` compound-unique input name, which Task 2 and Task 3 both use.

- [ ] **Step 1: Edit the schema**

Find:

```prisma
model WhatsAppAccount {
  id             String   @id @default(cuid())
  tenantId       String
  provider       String   @default("meta")
  wabaId         String
  phoneNumberId  String   @unique
  displayPhone   String
  displayName    String
  accessToken    String
  webhookSecret  String
  status         String   @default("active")
  qualityRating  String?
  messagingLimit String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant        Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  routingConfig WhatsAppRouting?
  sessions      WhatsAppSession[]
  messages      WhatsAppMessage[]
  templates     WhatsAppTemplate[]

  @@unique([tenantId, wabaId])
  @@index([tenantId])
  @@map("whatsapp_accounts")
}
```

Replace with:

```prisma
model WhatsAppAccount {
  id                  String   @id @default(cuid())
  tenantId            String
  provider            String   @default("meta")
  wabaId              String
  phoneNumberId       String   @unique
  displayPhone        String
  displayName         String
  accessToken         String
  webhookSecret       String
  status              String   @default("active")
  qualityRating       String?
  messagingLimit      String?
  restrictToAllowlist Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  tenant          Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  routingConfig   WhatsAppRouting?
  sessions        WhatsAppSession[]
  messages        WhatsAppMessage[]
  templates       WhatsAppTemplate[]
  allowedContacts WhatsAppAllowedContact[]

  @@unique([tenantId, wabaId])
  @@index([tenantId])
  @@map("whatsapp_accounts")
}

model WhatsAppAllowedContact {
  id          String   @id @default(cuid())
  accountId   String
  phoneNumber String
  label       String?
  createdAt   DateTime @default(now())

  account WhatsAppAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, phoneNumber])
  @@index([accountId])
  @@map("whatsapp_allowed_contacts")
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260625000000_add_whatsapp_allowlist/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "restrictToAllowlist" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "whatsapp_allowed_contacts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_allowed_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_allowed_contacts_accountId_idx" ON "whatsapp_allowed_contacts"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_allowed_contacts_accountId_phoneNumber_key" ON "whatsapp_allowed_contacts"("accountId", "phoneNumber");

-- AddForeignKey
ALTER TABLE "whatsapp_allowed_contacts" ADD CONSTRAINT "whatsapp_allowed_contacts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `bunx prisma generate --schema=./prisma/schema.prisma`
Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 4: Apply the migration** (only if you have a local DB running — check with `docker compose ps` first; if nothing is running, skip this step, it doesn't block Tasks 2–4, only manual end-to-end verification in Task 5)

Run: `bunx prisma migrate deploy`
Expected: `1 migration found... Applied`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260625000000_add_whatsapp_allowlist/
git commit -m "feat(whatsapp): add restrictToAllowlist flag and WhatsAppAllowedContact table"
```

---

### Task 2: Enforce the allowlist in `MessageProcessor`

**Files:**
- Modify: `libs/whatsapp/src/processor/message-processor.ts:56-67` (inside `processMessageEvent`, immediately after the inbound `whatsAppMessage.create` call)
- Modify: `libs/whatsapp/src/processor/message-processor.test.ts` (add a new mock entry, add 3 new tests)

**Interfaces:**
- Consumes: `account.restrictToAllowlist: boolean` and `account.id: string` (already present on every `account` object fetched in this file — no `select` clause restricts the existing `prisma.whatsAppAccount.findFirst` query, so the new field is automatically present after Task 1's migration).
- Produces: nothing new for later tasks — this is the enforcement leaf.

Read the file first and confirm the current state matches what's shown below (it should, if Task 1 alone has landed) before editing.

- [ ] **Step 1: Add the new mock and write the 3 failing tests**

In `libs/whatsapp/src/processor/message-processor.test.ts`, find:

```ts
const mockPrisma = {
  whatsAppAccount: { findFirst: vi.fn() },
  whatsAppMessage: { findUnique: vi.fn(), create: vi.fn() },
  whatsAppSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  whatsAppRouting: { findUnique: vi.fn() },
  whatsAppRoutingRule: { findMany: vi.fn() },
};
```

Replace with:

```ts
const mockPrisma = {
  whatsAppAccount: { findFirst: vi.fn() },
  whatsAppMessage: { findUnique: vi.fn(), create: vi.fn() },
  whatsAppSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  whatsAppRouting: { findUnique: vi.fn() },
  whatsAppRoutingRule: { findMany: vi.fn() },
  whatsAppAllowedContact: { findUnique: vi.fn() },
};
```

Then add these 3 tests at the end of the `describe('MessageProcessor', ...)` block, right before its closing `});`:

```ts
  it('skips processing for a non-allowlisted contact but still stores the inbound message', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1', restrictToAllowlist: true });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockPrisma.whatsAppAllowedContact.findUnique.mockResolvedValueOnce(null);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.notallowed', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockPrisma.whatsAppMessage.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.whatsAppAllowedContact.findUnique).toHaveBeenCalledWith({
      where: { accountId_phoneNumber: { accountId: 'acc_1', phoneNumber: '15559876543' } },
    });
    expect(mockSessionManager.findActiveSession).not.toHaveBeenCalled();
    expect(mockAgentExecutor.execute).not.toHaveBeenCalled();
    expect(mockContactLock.release).toHaveBeenCalledWith('acc_1', '15559876543');
  });

  it('processes normally for an allowlisted contact when restrictToAllowlist is true', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1', restrictToAllowlist: true });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockPrisma.whatsAppAllowedContact.findUnique.mockResolvedValueOnce({ id: 'allow_1', accountId: 'acc_1', phoneNumber: '15559876543' });
    mockPrisma.whatsAppRouting.findUnique.mockResolvedValueOnce(null);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.allowed', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockSessionManager.findActiveSession).toHaveBeenCalledWith('acc_1', '15559876543');
  });

  it('does not check the allowlist when restrictToAllowlist is false', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1', restrictToAllowlist: false });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockPrisma.whatsAppRouting.findUnique.mockResolvedValueOnce(null);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.unrestricted', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockPrisma.whatsAppAllowedContact.findUnique).not.toHaveBeenCalled();
    expect(mockSessionManager.findActiveSession).toHaveBeenCalledWith('acc_1', '15559876543');
  });
```

Note for whoever implements this: every pre-existing test in this file mocks an `account` object without a `restrictToAllowlist` field at all. That field will be `undefined` on those mocks, and `undefined` is falsy in the `if (account.restrictToAllowlist)` check Step 3 below adds — so every existing test keeps passing completely unmodified. Don't touch any test other than the 3 new ones above.

- [ ] **Step 2: Run tests to verify the 3 new ones fail**

Run: `bunx vitest run libs/whatsapp/src/processor/message-processor.test.ts`
Expected: the 3 new tests FAIL (no allowlist check exists yet — the "non-allowlisted" test will fail because `findActiveSession` gets called when it shouldn't; the allowlist `findUnique` mock won't be called in the other two). Every pre-existing test still PASSES.

- [ ] **Step 3: Add the enforcement check**

Find:

```ts
      await (this.deps.prisma as any).whatsAppMessage.create({
        data: {
          accountId: account.id,
          waMessageId: message.id,
          direction: 'inbound',
          contactPhone: contact.wa_id,
          type: message.type,
          content: this.extractContent(message),
          status: 'received',
        },
      });

      const messageText = message.text?.body ?? '';
```

Replace with:

```ts
      await (this.deps.prisma as any).whatsAppMessage.create({
        data: {
          accountId: account.id,
          waMessageId: message.id,
          direction: 'inbound',
          contactPhone: contact.wa_id,
          type: message.type,
          content: this.extractContent(message),
          status: 'received',
        },
      });

      if (account.restrictToAllowlist) {
        const allowed = await (this.deps.prisma as any).whatsAppAllowedContact.findUnique({
          where: { accountId_phoneNumber: { accountId: account.id, phoneNumber: contact.wa_id } },
        });
        if (!allowed) return;
      }

      const messageText = message.text?.body ?? '';
```

This `return` is inside the existing `try` block — the `finally` block a few lines below (`await this.deps.contactLock.release(...)`) already runs on any `return` from within `try`, so the lock is released correctly with no further changes needed.

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bunx vitest run libs/whatsapp/src/processor/message-processor.test.ts`
Expected: all tests PASS — the 3 new ones, and every pre-existing one unmodified.

- [ ] **Step 5: Run the full `libs/whatsapp` suite as a regression check**

Run: `bunx vitest run libs/whatsapp`
Expected: all tests PASS, including `message-processor.integration.test.ts` (its mocked accounts also lack `restrictToAllowlist`, so it's unaffected for the same falsy-by-default reason).

- [ ] **Step 6: Commit**

```bash
git add libs/whatsapp/src/processor/message-processor.ts libs/whatsapp/src/processor/message-processor.test.ts
git commit -m "feat(whatsapp): enforce contact allowlist before routing/replying to inbound messages"
```

---

### Task 3: Allowlist API routes

**Files:**
- Create: `apps/web-ui/app/api/whatsapp/accounts/[id]/allowlist/route.ts` (GET, PUT)
- Create: `apps/web-ui/app/api/whatsapp/accounts/[id]/allowlist/contacts/route.ts` (POST)
- Create: `apps/web-ui/app/api/whatsapp/accounts/[id]/allowlist/contacts/[contactId]/route.ts` (DELETE)

**Interfaces:**
- Consumes: `getSessionTenantId`, `authorize`, `getPrismaClient`, `createLogger` from `@chatbot/shared`; `authOptions` from `@/lib/auth` — same imports the existing `routing/route.ts` uses.
- Produces:
  - `GET /api/whatsapp/accounts/[id]/allowlist` → `200 { restrictToAllowlist: boolean, contacts: Array<{id, accountId, phoneNumber, label, createdAt}> }`
  - `PUT /api/whatsapp/accounts/[id]/allowlist` body `{ restrictToAllowlist: boolean }` → `200 { restrictToAllowlist: boolean }`
  - `POST /api/whatsapp/accounts/[id]/allowlist/contacts` body `{ phoneNumber: string, label?: string }` → `201` with the created contact, or `409` on duplicate
  - `DELETE /api/whatsapp/accounts/[id]/allowlist/contacts/[contactId]` → `200 { success: true }`, or `404` if the contact doesn't exist under that account

  Task 4's frontend calls exactly these 4 endpoints with exactly these shapes.

There is no test file for any existing route under `apps/web-ui/app/api/**` in this repo (confirmed — none of `routing/route.ts`, `templates/route.ts`, `connect/netcore/route.ts` have one), so don't add one here either; verify manually in Step 4.

- [ ] **Step 1: Create the account-level route**

Create `apps/web-ui/app/api/whatsapp/accounts/[id]/allowlist/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-allowlist');

const updateAllowlistSchema = z.object({
  restrictToAllowlist: z.boolean(),
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

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const contacts = await (prisma as any).whatsAppAllowedContact.findMany({
      where: { accountId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ restrictToAllowlist: account.restrictToAllowlist, contacts });
  } catch (error) {
    logger.error({ error }, 'Error fetching allowlist');
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
    const parsed = updateAllowlistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    await (prisma as any).whatsAppAccount.update({
      where: { id },
      data: { restrictToAllowlist: parsed.data.restrictToAllowlist },
    });

    logger.info({ tenantId, accountId: id, restrictToAllowlist: parsed.data.restrictToAllowlist }, 'Updated WhatsApp allowlist mode');

    return NextResponse.json({ restrictToAllowlist: parsed.data.restrictToAllowlist });
  } catch (error) {
    logger.error({ error }, 'Error updating allowlist mode');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the contacts collection route**

Create `apps/web-ui/app/api/whatsapp/accounts/[id]/allowlist/contacts/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-allowlist-contacts');

const addContactSchema = z.object({
  phoneNumber: z.string().regex(/^\d{10,15}$/, 'Phone number must be digits only, with country code, no + or spaces'),
  label: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = addContactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const contact = await (prisma as any).whatsAppAllowedContact.create({
      data: {
        accountId: id,
        phoneNumber: parsed.data.phoneNumber,
        label: parsed.data.label ?? null,
      },
    });

    logger.info({ tenantId, accountId: id, phoneNumber: parsed.data.phoneNumber }, 'Added WhatsApp allowlist contact');

    return NextResponse.json(contact, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error as any).code === 'P2002') {
      return NextResponse.json({ error: 'This phone number is already on the allowlist' }, { status: 409 });
    }
    logger.error({ error }, 'Error adding allowlist contact');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create the single-contact route**

Create `apps/web-ui/app/api/whatsapp/accounts/[id]/allowlist/contacts/[contactId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('whatsapp-allowlist-contacts');

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id, contactId } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const contact = await (prisma as any).whatsAppAllowedContact.findFirst({
      where: { id: contactId, accountId: id },
    });
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    await (prisma as any).whatsAppAllowedContact.delete({ where: { id: contactId } });

    logger.info({ tenantId, accountId: id, contactId }, 'Removed WhatsApp allowlist contact');

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Error removing allowlist contact');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Manual verification**

Run: `bun run dev`, then (with a real session cookie from logging into the app in a browser — or defer full verification to Task 4 once there's a UI to click through instead of hand-crafting cookies):

```bash
curl -s http://localhost:3005/api/whatsapp/accounts/<a-real-account-id>/allowlist -H "Cookie: <your-session-cookie>"
```

Expected: `200 {"restrictToAllowlist":true,"contacts":[]}` for an account that has none yet (every account defaults to `restrictToAllowlist: true` after Task 1's migration).

- [ ] **Step 5: Commit**

```bash
git add "apps/web-ui/app/api/whatsapp/accounts/[id]/allowlist"
git commit -m "feat(web-ui): add WhatsApp allowlist API routes"
```

---

### Task 4: Frontend — Allowlist settings page and accounts-table icon

**Files:**
- Create: `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/[id]/allowlist/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/[id]/allowlist/loading.tsx`
- Modify: `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/page.tsx` (import line + actions column)

**Interfaces:**
- Consumes: the 4 endpoints from Task 3, exactly as specified there.
- Produces: nothing further downstream — this is the final user-facing piece.

- [ ] **Step 1: Create the loading skeleton**

Create `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/[id]/allowlist/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

- [ ] **Step 2: Create the allowlist page**

Create `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/[id]/allowlist/page.tsx`:

```tsx
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
import { toast } from 'sonner';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

interface AllowedContact {
  id: string;
  phoneNumber: string;
  label: string | null;
  createdAt: string;
}

const addContactSchema = z.object({
  phoneNumber: z.string().regex(/^\d{10,15}$/, 'Digits only, with country code, no + or spaces'),
  label: z.string().optional(),
});

export default function AllowlistPage({ params }: { params: Promise<{ id: string }> }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [restrictToAllowlist, setRestrictToAllowlist] = useState(true);
  const [contacts, setContacts] = useState<AllowedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingToggle, setSavingToggle] = useState(false);
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    params.then(({ id }) => {
      setAccountId(id);
      fetchAllowlist(id);
    });
  }, [params]);

  const fetchAllowlist = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}/allowlist`);
      if (!res.ok) throw new Error('Failed to load allowlist');
      const data = await res.json();
      setRestrictToAllowlist(data.restrictToAllowlist);
      setContacts(data.contacts ?? []);
    } catch {
      toast.error('Failed to load allowlist');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (checked: boolean) => {
    if (!accountId) return;
    setSavingToggle(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${accountId}/allowlist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restrictToAllowlist: checked }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setRestrictToAllowlist(checked);
      toast.success(checked ? 'Allowlist restriction enabled' : 'Allowlist restriction disabled');
    } catch {
      toast.error('Failed to update allowlist setting');
    } finally {
      setSavingToggle(false);
    }
  };

  const handleAddContact = async () => {
    if (!accountId) return;
    const parsed = addContactSchema.safeParse({ phoneNumber: newPhoneNumber, label: newLabel || undefined });
    if (!parsed.success) {
      setAddError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setAddError('');
    setAdding(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${accountId}/allowlist/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 409) {
        setAddError('This phone number is already on the allowlist');
        return;
      }
      if (!res.ok) throw new Error('Failed to add');
      const contact = await res.json();
      setContacts((prev) => [contact, ...prev]);
      setNewPhoneNumber('');
      setNewLabel('');
      toast.success('Number added to allowlist');
    } catch {
      toast.error('Failed to add number');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveContact = async (contactId: string) => {
    if (!accountId) return;
    try {
      const res = await fetch(`/api/whatsapp/accounts/${accountId}/allowlist/contacts/${contactId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to remove');
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
      toast.success('Number removed from allowlist');
    } catch {
      toast.error('Failed to remove number');
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
            <WhatsAppIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Allowlist</h2>
            <p className="text-sm text-muted-foreground">Control which numbers receive automated replies.</p>
          </div>
        </div>
        <Link href="/settings/channels/whatsapp">
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
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Restrict Auto-Replies</CardTitle>
              <CardDescription>
                When on, only numbers listed below receive automated replies. Everyone else&apos;s messages are still received but get no response.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Switch
                  checked={restrictToAllowlist}
                  onCheckedChange={handleToggle}
                  disabled={savingToggle}
                />
                <span className="text-sm">{restrictToAllowlist ? 'Restricted to allowlist' : 'Open to everyone'}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Allowed Numbers</CardTitle>
              <CardDescription>Add the numbers that should receive automated replies.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="new-phone-number">Phone Number</Label>
                  <Input
                    id="new-phone-number"
                    placeholder="918826603017"
                    value={newPhoneNumber}
                    onChange={(e) => setNewPhoneNumber(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <Label htmlFor="new-label">Label (optional)</Label>
                  <Input
                    id="new-label"
                    placeholder="Omar - testing"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </div>
                <Button className="mt-7" onClick={handleAddContact} disabled={adding}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add
                </Button>
              </div>
              {addError && <p className="text-xs text-destructive">{addError}</p>}

              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No numbers added yet. Add a number above to let it receive replies.
                </p>
              ) : (
                <div className="space-y-2">
                  {contacts.map((contact) => (
                    <div key={contact.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium">{contact.phoneNumber}</p>
                        {contact.label && <p className="text-xs text-muted-foreground">{contact.label}</p>}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleRemoveContact(contact.id)}
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the icon button to the accounts table**

In `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/page.tsx`, find:

```ts
import { ArrowLeft, Trash2, Settings, MessageSquare, Plus, Loader2 } from 'lucide-react';
```

Replace with:

```ts
import { ArrowLeft, Trash2, Settings, MessageSquare, Plus, Loader2, ShieldCheck } from 'lucide-react';
```

Find:

```tsx
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/settings/channels/whatsapp/${row.original.id}/templates`)}
              aria-label="Templates"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDisconnectTarget(row.original)}
```

Replace with:

```tsx
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/settings/channels/whatsapp/${row.original.id}/templates`)}
              aria-label="Templates"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/settings/channels/whatsapp/${row.original.id}/allowlist`)}
              aria-label="Allowlist"
            >
              <ShieldCheck className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDisconnectTarget(row.original)}
```

- [ ] **Step 4: Verify the project builds**

Run: `cd apps/web-ui && bunx tsc --noEmit` (or `bun run build` from repo root)
Expected: no new type errors.

- [ ] **Step 5: Manual UI check**

Run: `bun run dev`, navigate to `/settings/channels/whatsapp`, click the new shield icon on a connected account. Confirm:
- The page loads with the switch showing "Restricted to allowlist" (matches the `true` default).
- Adding a phone number with a `+` or spaces shows the inline validation error and does not call the API.
- Adding a valid number succeeds, shows a success toast, and appears in the list immediately.
- Adding the same number again shows "This phone number is already on the allowlist".
- Removing a number works and updates the list.
- Toggling the switch off and reloading the page shows it still off (persisted).

- [ ] **Step 6: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/settings/channels/whatsapp/[id]/allowlist" "apps/web-ui/app/(dashboard)/settings/channels/whatsapp/page.tsx"
git commit -m "feat(web-ui): add WhatsApp allowlist settings page"
```

---

### Task 5: Full regression and real-traffic verification

**Files:** none — verification only.

- [ ] **Step 1: Run the full unit test suite**

Run: `bun run test`
Expected: all PASS.

- [ ] **Step 2: Run a full build**

Run: `bun run build`
Expected: succeeds with no new errors.

- [ ] **Step 3: End-to-end verification against the real local data** (requires the local Postgres container to be reachable — check with `docker compose ps` or `docker ps --filter name=chatbot-postgres`; if nothing is reachable, skip to Step 4)

```bash
# Confirm the existing connected account now defaults to restricted:
docker exec -i chatbot-postgres psql -U chatbot_admin -d chatbot -c \
  "SELECT id, provider, \"phoneNumberId\", \"restrictToAllowlist\" FROM whatsapp_accounts;"
```

Expected: `restrictToAllowlist` is `t` (true) for every row, including the pre-existing Netcore account, confirming the migration's default applied retroactively.

```bash
# Send a synthetic inbound message from a number NOT on the allowlist:
curl -s -X POST http://localhost:3005/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"incoming_message":[{"to":"<the-connected-account-phoneNumberId>","message_type":"TEXT","text_type":{"text":"allowlist verification"},"message_id":"wamid.allowlistcheck1","from":"910000000099","received_at":"1700000000","context":{"ncmessage_id":"","message_id":""},"from_name":"Verify"}]}'
```

Expected: `200 {"status":"ok"}`. Then confirm via psql:

```bash
docker exec -i chatbot-postgres psql -U chatbot_admin -d chatbot -c \
  "SELECT direction, \"contactPhone\", content, \"createdAt\" FROM whatsapp_messages WHERE \"contactPhone\" = '910000000099' ORDER BY \"createdAt\" DESC;"
```

Expected: exactly **one** row (the inbound message, `direction = 'inbound'`) — no outbound reply row was created, confirming the message was stored but not auto-replied to.

- [ ] **Step 4: Final commit check**

```bash
git status
```
Confirm clean tree — everything should already be committed task-by-task.
