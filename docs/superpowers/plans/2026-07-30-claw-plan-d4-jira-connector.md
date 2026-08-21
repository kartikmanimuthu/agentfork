# Claw Jira Connector Implementation Plan

> **⚠ SUPERSEDED IN PART — read this first (updated 2026-07-30, after `origin/feature/claw-studio`
> advanced `8758933 → a7fbb0a`).**
>
> A teammate shipped **`libs/claw-studio/src/integrations/jira.ts`** (248 lines + 157 test lines) in
> commit `a7fbb0a` — a Jira *integration* exposing `jira_search_issues`, `jira_get_issue`,
> `jira_list_projects`, `jira_create_issue`, `jira_add_comment`, with manual auth
> (`site` / `email` / `apiToken`), `accountMode: 'multi'`, over `/rest/api/3/*`.
>
> **§7.2 of this plan is wrong and must not be followed.** It argued against hand-written `jira_*`
> tools in favour of the Atlassian Rovo MCP server, on the grounds that nucleus draws that line.
> Reality overrides the reference: the tools now exist, are tested, and are the supported path here.
> Board reading is **done** — do not build it, and do not remove it in favour of MCP.
>
> Also worth keeping from their work: Atlassian retired `/rest/api/3/search` (returns **410 Gone**);
> `/rest/api/3/search/jql` is the replacement with the same request/response shape.
>
> **What remains for this plan** is the half they did not build — the **Jira channel connector**:
> inbound webhook → `ClawRun`, outbound reply as an ADF issue comment, and scheduled-digest
> delivery. Tasks 1–4 stand, with one required change:
>
> **Do not add a second Jira credential surface.** Their integration already stores
> `site`/`email`/`apiToken` per account. The connector must read those via
> `new IntegrationConfigService(tenantId, jiraDescriptor)` and persist only its **own**
> `webhookSecret` + `enabled` as connector config. Task 1's `JiraConnectorConfig` shrinks to
> `{ enabled, webhookSecret }`, and Task 2's `verifyCredentials` delegates to the integration's
> stored account rather than re-verifying a pasted token. Making a user paste the same API token
> twice, in two different screens, is the thing to avoid here.
>
> **Follow-up:** the tool inventory now lives in `apps/mission-control/lib/agent-tools.ts` (shared by
> the Agent → Tools tab and the scheduled-task grant picker) and carries its own `FACTORIES` table,
> because the descriptor deliberately has no `buildTools`. It has a `TODO(jira)` marking the one line
> to add. `a7fbb0a` is now merged, so this is actionable.

---

## 7.0 Second source read (2026-07-31) — the plan below was under-specified

Read in full: `lib/gateway/adapters/jira-adapter.ts` (543 lines), `lib/agent-ops/types.ts`
(`JiraIntegrationConfig`, `JiraTriggerMeta`), and `content/docs/jira-integration.mdx`. Six things the
earlier plan missed, all of which change the work:

**1. HIL is keyword-based, not button-based.** Jira comments cannot render buttons
(`approvalButtons: false`), so approval happens by **typing a comment**: `approve` / `approved` /
`reject` / `rejected` on an issue that has a run awaiting approval. Clarifications are answered by
replying on the issue. Both messages also link to the dashboard as a fallback. This needs two run
lookups we do not currently have — *find the run awaiting approval / awaiting input for this issue
key* — which for us means querying `ClawRun` by `trigger.issueKey`, the same shape the
`/api/scheduled-tasks/[taskId]/runs` route already uses for `trigger.taskId`.

**2. `parseInbound` is a five-way priority router**, not a single parse:
1. comment authored by `botAccountId` → ignore (loop guard)
2. body is exactly an approve/reject keyword **and** a run is awaiting approval → resume
3. a run is awaiting input → treat the comment as the clarification reply
4. the comment @-mentions the bot → task text with the mention stripped
5. otherwise → the comment is a new task

**3. No comment at all** (an Automation rule firing on issue create/update) → use the payload's
explicit `taskDescription` if present, else fall back to `summary\n\ndescription`.

**4. `validateRequest` accepts three secret locations** — `Authorization: Bearer <secret>`,
`x-webhook-secret`, or `?secret=` (native Jira webhooks cannot set headers) — and **fails closed**
when no secret is configured. That independently confirms the fail-closed decision recorded above.

**5. `postComment` has a strict mode.** Interactive replies are best-effort — a failed comment must
never crash a run. The scheduled digest passes `{ strict: true }` so a failure propagates and the
notifier records it on the run instead of silently dropping the digest. Our
`sendScheduledNotification` contract already expects that behaviour.

**6. `botAccountId` earns its place twice** — loop prevention *and* mention detection. Without it a
bot comment retriggers the bot.

### Config shape

Nucleus stores `{ webhookSecret, baseUrl, userEmail, apiToken, botAccountId, enabled, autoApprove }`.
Since `a7fbb0a` landed, `baseUrl`/`email`/`apiToken` **already live in the Jira integration**, so our
connector config is only what the integration does not have:

```ts
interface JiraConnectorConfig extends BaseConnectorConfig {
  webhookSecret: string;   // required — validateRequest fails closed without it
  botAccountId?: string;   // loop guard + mention detection
}
```

Credentials come from `new IntegrationConfigService(tenantId, jiraDescriptor)`. One paste, one place.

### Tenant resolution — do NOT copy nucleus here

Nucleus uses the Jira **project key** as the tenant id (`payload.issue.fields.project.key ||
'default'`). That works in a single-org deployment and is wrong for multi-tenant: two customers with
an `ENG` project would collide. Use the documented `ClawChannelLink` pattern with `externalId` = the
Jira site host, derived from `issue.self`.

### MCP (§7.2) — the exact Rovo setup, for the docs task

Server URL `https://mcp.atlassian.com/v1/mcp`. Browser OAuth works interactively; headless (Docker /
ECS) needs Basic auth instead, as a **stdio** server:

```
command: npx
args:
  -y
  mcp-remote@latest
  https://mcp.atlassian.com/v1/mcp
  --header
  Authorization: Basic <base64 of "email:api_token">
```

No env vars — `mcp-remote` reads the credential from `--header`, and setting
`ATLASSIAN_API_TOKEN` instead makes it fall back to the OAuth flow. **Check our MCP server form
supports multi-line args and a custom header before promising this works.** Note the base64 is
encoding, not encryption.

---


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Jira trigger Claw runs and receive replies as issue comments, and let scheduled tasks deliver their digests to a Jira issue — by porting nucleus's production Jira adapter.

**Architecture:** One new `JiraConnector` implementing the existing `ChannelAdapter` contract, registered in `ConnectorRegistry`. The generic `app/api/gateway/[channel]/route.ts` already routes inbound webhooks, so Jira needs no new route. Board *reading* is deliberately **not** built here — it comes from the Atlassian Rovo MCP server through the existing MCP support, which is exactly how nucleus does it.

**Tech Stack:** TypeScript strict, Jira REST API v3 + ADF (Atlassian Document Format), Prisma, Vitest, Next.js 15 App Router, shadcn/ui, Zod, T3 Env, Pino.

**Spec:** `docs/superpowers/specs/2026-07-30-claw-soul-and-cron-design.md` (§7, §7.4)

**Depends on:** D3 Task 5, which adds the optional `sendScheduledNotification` to `ChannelAdapter`. Nucleus's Jira adapter already implements that method, so this port is also the reference implementation for it.

**Reference source:** `/Users/H2702/.superset/projects/nucleus-prod/nucleus-cloud-ops` (branch `master-v1`, read-only)

| Port target | Nucleus source | Lines |
|---|---|---|
| Adapter | `apps/web-ui/lib/gateway/adapters/jira-adapter.ts` | 543 |
| Adapter tests | `apps/web-ui/tests/gateway/adapters/jira-adapter.test.ts` | 107 |
| Settings form | `apps/web-ui/components/channels/jira-settings-form.tsx` | — |
| Credential verify | `apps/web-ui/app/api/agent-ops/settings/jira/test/route.ts` | 91 |

**Closest in-repo reference:** `libs/claw-studio/src/connectors/adapters/discord.ts` — the most recently added connector, so it best reflects current conventions. Read it before writing.

## Global Constraints

- **Non-regression (spec §7.4).** Pre-effort baseline: `Test Files 48 passed (48)`, `Tests 443 passed (443)`. D1–D3 added to that. Keep everything green.
- **Do NOT modify the three live adapters** — `connectors/adapters/{slack,telegram,discord}.ts`. Jira is additive. The only exception is D3 Task 10's Slack change, which is out of scope here.
- **Do NOT modify** `integrations/**`, `memory/**`, `skills/**`, `mcp/**`, `agent/tool-classifier.ts`, `gateway/execute-run.ts`.
- **Only pre-existing files this plan touches:** `libs/claw-studio/src/connectors/types.ts` (additive: `JiraConnectorConfig`, `SECRET_FIELDS.jira`), `connectors/registry.ts` (one registration), `connectors/index.ts` (exports), `libs/claw-studio/src/index.ts`, `apps/mission-control/components/connectors/{channel-fields.ts,channel-visuals.tsx}`, `libs/claw-studio/CLAUDE.md`.
- **`ChannelType` already declares `'jira'`** (`connectors/types.ts:16`) — no union change needed.
- **The inbound route already exists** and is generic (`app/api/gateway/[channel]/route.ts`). Do not add a Jira-specific route.
- **Credentials:** `apiToken` is a secret — it must go in `SECRET_FIELDS.jira` so the existing encryption + masking applies. `baseUrl` and `email` are not secrets.
- **Tenant resolution must never come from a caller-controlled header.** Use the documented `ClawChannelLink` pattern: `channel: 'jira'`, `externalId` = the site hostname derived from `baseUrl`, upserted when credentials are saved.
- **UI conventions:** follow the *Mission Control UI Conventions* section in `2026-07-30-claw-plan-d1-workspace-files.md`. The connectors UI is already generic — prefer extending its config maps over writing a bespoke Jira page.
- **Standards:** Zod at every boundary; env via T3 Env only; try/catch everywhere with Pino structured context `{ tenantId, issueKey, runId }`.
- **Tests:** `cd libs/claw-studio && bunx vitest run` — must be run with that cwd.
- **Code style:** no comments unless the *why* is non-obvious; no multi-line docstrings.

---

### Task 1: Jira config type and ADF helpers

**Files:**
- Modify: `libs/claw-studio/src/connectors/types.ts` (additive)
- Create: `libs/claw-studio/src/connectors/adapters/jira-adf.ts`
- Test: `libs/claw-studio/src/connectors/adapters/jira-adf.test.ts`

**Interfaces:**
- Produces:
  - `interface JiraConnectorConfig extends BaseConnectorConfig { baseUrl: string; email: string; apiToken: string; webhookSecret: string; cloudId?: string }`
  - `SECRET_FIELDS.jira = ['apiToken', 'webhookSecret']`
  - `function adfToPlainText(node: unknown): string`
  - `function plainTextToAdf(text: string): AdfDocument`
  - `function extractMentionIds(node: unknown): string[]`
  - `function jiraSiteHost(baseUrl: string): string | null`

ADF is why this needs its own module: Jira comment bodies are a nested rich-text document, not a
string, so both directions need converting. Ported from the `AdfNode` handling in nucleus's adapter.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/connectors/adapters/jira-adf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { adfToPlainText, extractMentionIds, jiraSiteHost, plainTextToAdf } from './jira-adf';

const doc = (content: unknown[]) => ({ type: 'doc', version: 1, content });

describe('adfToPlainText', () => {
  it('extracts text from a simple paragraph', () => {
    expect(adfToPlainText(doc([
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello there' }] },
    ]))).toBe('Hello there');
  });

  it('joins multiple paragraphs with newlines', () => {
    expect(adfToPlainText(doc([
      { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
    ]))).toBe('One\nTwo');
  });

  it('skips mention nodes so the bot name is not part of the task', () => {
    expect(adfToPlainText(doc([
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id: 'abc-123', text: '@Claw' } },
          { type: 'text', text: ' check the board' },
        ],
      },
    ]))).toBe('check the board');
  });

  it('recurses through nested content', () => {
    expect(adfToPlainText(doc([
      {
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested item' }] }],
        }],
      },
    ]))).toBe('Nested item');
  });

  it('returns an empty string for null, undefined, or a non-document', () => {
    expect(adfToPlainText(null)).toBe('');
    expect(adfToPlainText(undefined)).toBe('');
    expect(adfToPlainText('already a string')).toBe('');
    expect(adfToPlainText(doc([]))).toBe('');
  });
});

describe('plainTextToAdf', () => {
  it('wraps text in a valid ADF document', () => {
    const out = plainTextToAdf('Done.');
    expect(out).toEqual({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done.' }] }],
    });
  });

  it('splits on newlines into separate paragraphs', () => {
    expect(plainTextToAdf('One\nTwo').content).toHaveLength(2);
  });

  it('never emits an empty text node, which Jira rejects', () => {
    const out = plainTextToAdf('');
    expect(out.content.length).toBeGreaterThan(0);
    const texts = JSON.stringify(out);
    expect(texts).not.toContain('"text":""');
  });

  it('round-trips through adfToPlainText', () => {
    expect(adfToPlainText(plainTextToAdf('One\nTwo'))).toBe('One\nTwo');
  });
});

describe('extractMentionIds', () => {
  it('collects mention account ids', () => {
    expect(extractMentionIds(doc([
      { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'acc-1' } }] },
    ]))).toEqual(['acc-1']);
  });

  it('returns an empty array when there are none', () => {
    expect(extractMentionIds(doc([{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }]))).toEqual([]);
  });
});

describe('jiraSiteHost', () => {
  it('extracts the host for tenant resolution', () => {
    expect(jiraSiteHost('https://acme.atlassian.net')).toBe('acme.atlassian.net');
    expect(jiraSiteHost('https://acme.atlassian.net/')).toBe('acme.atlassian.net');
  });

  it('returns null for a malformed or non-https url', () => {
    expect(jiraSiteHost('not a url')).toBeNull();
    expect(jiraSiteHost('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/connectors/adapters/jira-adf.test.ts`
Expected: FAIL — cannot resolve `./jira-adf`.

- [ ] **Step 3: Write the implementation**

Add to `libs/claw-studio/src/connectors/types.ts`, beside the other config interfaces:

```ts
export interface JiraConnectorConfig extends BaseConnectorConfig {
  /** e.g. https://acme.atlassian.net */
  baseUrl: string;
  /** Atlassian account email — the basic-auth username. */
  email: string;
  apiToken: string;
  /** Required. Inbound webhooks fail closed without it — see validateRequest. */
  webhookSecret: string;
  /** Cached from the credential test; used for the ClawChannelLink externalId. */
  cloudId?: string;
}
```

Add `JiraConnectorConfig` to the `ConnectorConfig` union, and add to `SECRET_FIELDS`:

```ts
  jira: ['apiToken', 'webhookSecret'],
```

Create `libs/claw-studio/src/connectors/adapters/jira-adf.ts`:

```ts
export interface AdfNode {
  type?: string;
  text?: string;
  attrs?: { id?: string; text?: string };
  content?: AdfNode[];
}

export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock']);

/**
 * Flattens an ADF document to plain text. Mentions are dropped: an inbound
 * comment reads "@Claw check the board", and the bot's own name is not part of
 * the task description.
 */
export function adfToPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const adf = node as AdfNode;
  if (adf.type === 'mention') return '';
  if (adf.type === 'text') return adf.text ?? '';

  const children = (adf.content ?? []).map(adfToPlainText).filter((s) => s !== '');
  if (!children.length) return '';
  const joiner = BLOCK_TYPES.has(adf.type ?? '') ? '' : '';
  const inner = children.join(joiner);

  return adf.type === 'doc'
    ? (adf.content ?? []).map(adfToPlainText).filter((s) => s.trim() !== '').join('\n')
    : inner.trim();
}

export function plainTextToAdf(text: string): AdfDocument {
  const lines = text.split('\n');
  const content: AdfNode[] = lines.map((line) =>
    line.length > 0
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      // Jira rejects a text node with an empty string, so a blank line is an
      // empty paragraph with no content at all.
      : { type: 'paragraph' },
  );
  return { type: 'doc', version: 1, content };
}

export function extractMentionIds(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const adf = node as AdfNode;
  const ids: string[] = [];
  if (adf.type === 'mention' && adf.attrs?.id) ids.push(adf.attrs.id);
  for (const child of adf.content ?? []) ids.push(...extractMentionIds(child));
  return ids;
}

export function jiraSiteHost(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:') return null;
    return url.host;
  } catch {
    return null;
  }
}
```

Iterate on `adfToPlainText` until every test passes — the paragraph-joining behaviour is the fiddly
part, and the tests define it precisely.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/connectors/adapters/jira-adf.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/connectors/types.ts libs/claw-studio/src/connectors/adapters/jira-adf.ts libs/claw-studio/src/connectors/adapters/jira-adf.test.ts
git commit -m "feat(claw-studio): add Jira connector config type and ADF helpers"
```

---

### Task 2: The Jira connector — config and credential verification

**Files:**
- Create: `libs/claw-studio/src/connectors/adapters/jira.ts`
- Test: `libs/claw-studio/src/connectors/adapters/jira.test.ts`

**Interfaces:**
- Consumes: `jira-adf.ts` (Task 1); `ClawConnectorConfigService`; the `ChannelAdapter` contract in `gateway/types.ts`
- Produces: `class JiraConnector implements ChannelAdapter` with `channelType: 'jira'`, plus this task's half: `getConfig`, `verifyCredentials`

Split across two tasks because the `ChannelConnector` half (config + verify) is independently
reviewable and independently useful — the Test Connection button works before inbound routing exists.

`hilCapabilities`: `{ clarification: true, approvalButtons: false, threadedReplies: true }` — Jira
comments cannot render buttons, so approvals arrive as a comment asking the user to reply, and
`deliveryMode` is `'callback'`.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/connectors/adapters/jira.test.ts`, mirroring the structure of
`discord.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraConnector } from './jira';

const config = {
  enabled: true,
  baseUrl: 'https://acme.atlassian.net',
  email: 'bot@acme.com',
  apiToken: 'token-123',
};

describe('JiraConnector — descriptor', () => {
  it('declares its channel identity', () => {
    const c = new JiraConnector();
    expect(c.channelType).toBe('jira');
    expect(c.displayName).toBe('Jira');
    expect(c.deliveryMode).toBe('callback');
  });

  it('cannot render approval buttons but supports threaded replies', () => {
    const c = new JiraConnector();
    expect(c.hilCapabilities.approvalButtons).toBe(false);
    expect(c.hilCapabilities.threadedReplies).toBe(true);
  });
});

describe('JiraConnector.verifyCredentials', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns ok with the account display name on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ displayName: 'Claw Bot', accountId: 'acc-1' }),
      { status: 200 },
    )));
    const result = await new JiraConnector().verifyCredentials('t1', config);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail).toContain('Claw Bot');
  });

  it('fails clearly on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    const result = await new JiraConnector().verifyCredentials('t1', config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/credential|unauthor/i);
  });

  it('rejects a non-https baseUrl before making a request', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const result = await new JiraConnector()
      .verifyCredentials('t1', { ...config, baseUrl: 'http://acme.atlassian.net' });
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns a failure rather than throwing when the network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const result = await new JiraConnector().verifyCredentials('t1', config);
    expect(result.ok).toBe(false);
  });

  it('reports missing credentials when nothing is stored', async () => {
    const result = await new JiraConnector().verifyCredentials('t1');
    expect(result.ok).toBe(false);
  });
});
```

Mock `ClawConnectorConfigService` with `vi.mock` exactly as `discord.test.ts` does, so the
no-stored-config case resolves to `null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/connectors/adapters/jira.test.ts`
Expected: FAIL — cannot resolve `./jira`.

- [ ] **Step 3: Write the implementation**

Create `libs/claw-studio/src/connectors/adapters/jira.ts` with the class skeleton and this task's two
methods. Key details:

- `verifyCredentials` calls `GET {baseUrl}/rest/api/3/myself` with
  `Authorization: Basic base64(email:apiToken)`, bounded by
  `signal: AbortSignal.timeout(15_000)` — the same 15s bound every integration uses, because a stalled
  Atlassian API would otherwise hang the request.
- Reject a `baseUrl` that fails `jiraSiteHost()` **before** fetching.
- Map `401`/`403` to a credential message, other non-2xx to the status, and a thrown error to its
  message. Never throw.
- On success return `{ ok: true, detail: \`Connected as ${displayName}\`, meta: { accountId } }`.
- `getConfig` delegates to `ClawConnectorConfigService`, as the other adapters do.
- A private `request()` helper centralises base-auth, the timeout, and error shaping for Task 3 to reuse.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/connectors/adapters/jira.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/connectors/adapters/jira.ts libs/claw-studio/src/connectors/adapters/jira.test.ts
git commit -m "feat(claw-studio): add JiraConnector config and credential verification"
```

---

### Task 3: The gateway half — inbound and outbound

**Files:**
- Modify: `libs/claw-studio/src/connectors/adapters/jira.ts`
- Test: `libs/claw-studio/src/connectors/adapters/jira.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2's class; `readRawBody`, `parseJsonSafely`, `resolveTenantByExternalId`, `linkChannel` from the gateway
- Produces: the full `ChannelAdapter` — `validateRequest`, `parseInbound`, `sendAck`, `sendResult`, `sendError`, `sendClarification`, `sendApprovalRequest`, `sendScheduledNotification`

Ported from nucleus's adapter, whose method set matches ours exactly.

**Tenant resolution:** the inbound webhook body carries the issue's `self` URL, whose host is the Jira
site. Resolve the tenant via `resolveTenantByExternalId('jira', host)` against the `ClawChannelLink`
row upserted at save time. **Never** trust a header.

- [ ] **Step 1: Write the failing test**

Extend `jira.test.ts`:

```ts
const webhook = (over: Record<string, unknown> = {}) => ({
  webhookEvent: 'comment_created',
  issue: { key: 'ENG-42', self: 'https://acme.atlassian.net/rest/api/3/issue/10001' },
  comment: {
    id: '9001',
    author: { accountId: 'acc-human', displayName: 'Omar' },
    body: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [
        { type: 'mention', attrs: { id: 'acc-bot', text: '@Claw' } },
        { type: 'text', text: ' summarise this ticket' },
      ] },
    ] },
  },
  ...over,
});

describe('JiraConnector.parseInbound', () => {
  it('extracts the task text with the mention stripped', async () => { /* expect 'summarise this ticket' */ });
  it('carries the issue key in channelMeta for the reply', async () => { /* expect issueKey 'ENG-42' */ });
  it('resolves the tenant from the issue self host, not a header', async () => { /* assert resolveTenantByExternalId called with ('jira','acme.atlassian.net') */ });
  it('throws GatewayTenantUnresolvedError for an unknown site', async () => { /* … */ });
  it('throws GatewayUnsupportedPayloadError for an event with no comment', async () => { /* webhookEvent: 'issue_updated' */ });
  it('ignores a comment authored by the bot itself to prevent a reply loop', async () => { /* author.accountId === config.cloudId-linked bot acc ⇒ unsupported */ });
});

describe('JiraConnector.validateRequest', () => {
  it('accepts a request with the correct webhook secret', async () => { /* … */ });
  it('rejects a wrong secret', async () => { /* … */ });
  it('REJECTS when no secret is configured (fail closed)', async () => { /* see the note below */ });
  it('rejects a request with no token header at all', async () => { /* … */ });
});

describe('JiraConnector outbound', () => {
  it('posts the answer as an ADF comment on the triggering issue', async () => { /* assert POST /rest/api/3/issue/ENG-42/comment with an ADF body */ });
  it('posts a clarification question as a comment', async () => { /* … */ });
  it('posts an approval request as a comment explaining how to approve', async () => { /* no buttons available */ });
  it('posts a scheduled digest to the configured target issue', async () => { /* delivery.target = 'OPS-7' */ });
  it('does not throw when the comment POST fails', async () => { /* 500 ⇒ resolves */ });
});
```

Write each body out fully, following `discord.test.ts` for gateway mocking.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/connectors/adapters/jira.test.ts`
Expected: FAIL — the gateway methods do not exist.

- [ ] **Step 3: Write the implementation**

Add the remaining methods, porting nucleus's logic:

- `validateRequest(req)` — compare `webhookSecret` against the `x-automation-webhook-token` header
  (falling back to the `?token=` query param) with `crypto.timingSafeEqual` over equal-length buffers.
  **Fail closed: when no secret is configured, return `false`.**

  This deliberately diverges from nucleus, which returns `true` in that case. Nucleus is an internal
  single-org tool; this is multi-tenant SaaS, and an unsigned inbound webhook *spawns agent runs* — so
  anyone who learns a tenant's Jira hostname could burn their tokens indefinitely. Jira Automation's
  "Send web request" action does support custom headers, so requiring the token costs the user one
  paste. Record the divergence in a comment so nobody "restores parity" with nucleus later.
- `parseInbound(req)` — read the raw body, `parseJsonSafely`, require `comment` (else
  `GatewayUnsupportedPayloadError`), drop comments authored by the bot's own `accountId` (loop guard),
  derive the site host from `issue.self`, `resolveTenantByExternalId('jira', host)` (else
  `GatewayTenantUnresolvedError`), and return a `GatewayMessage` with `adfToPlainText(comment.body)` as
  the text and `channelMeta: { issueKey, commentId, authorAccountId, siteHost }`.
- `sendAck(req, runId)` — a `200` with an empty body. Jira Automation does not display a response, so
  there is nothing to render; the ack exists only to close the request fast.
- `sendResult` / `sendError` / `sendClarification` / `sendApprovalRequest` — all post a comment via a
  shared private `postComment(tenantId, issueKey, text)` that wraps `plainTextToAdf`. Because
  `approvalButtons` is `false`, `sendApprovalRequest` posts text naming the pending tools and telling
  the user to approve in Mission Control, with the run URL from `runUrl()`.
- `sendScheduledNotification(task, run, outcome)` — post to `task.delivery.target` (an issue key),
  with a heading line per outcome (`result` / `failure` / `attention`) and the run's answer or error.
- Every outbound method is wrapped in try/catch and logs on failure without throwing: an undeliverable
  comment must not fail the run. The notifier records the failure as a run event (D3 Task 5).

- [ ] **Step 4: Run the full suite**

Run: `cd libs/claw-studio && bunx vitest run`
Expected: PASS, all pre-existing tests included.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/connectors/adapters/jira.ts libs/claw-studio/src/connectors/adapters/jira.test.ts
git commit -m "feat(claw-studio): add Jira inbound parsing and comment-based outbound"
```

---

### Task 4: Register, wire the UI, and link the tenant

**Files:**
- Modify: `libs/claw-studio/src/connectors/registry.ts`
- Modify: `libs/claw-studio/src/connectors/index.ts`
- Modify: `libs/claw-studio/src/index.ts`
- Modify: `apps/mission-control/components/connectors/channel-fields.ts`
- Modify: `apps/mission-control/components/connectors/channel-visuals.tsx`
- Create: `apps/mission-control/components/connectors/jira-logo.tsx`

**Interfaces:**
- Consumes: `JiraConnector` (Tasks 2–3)
- Produces: Jira visible and configurable at `/connectors`, with its webhook URL shown and its
  `ClawChannelLink` upserted on save

The connectors UI is data-driven, so this is mostly config-map entries — read
`channel-fields.ts` and confirm the shape before editing.

- [ ] **Step 1: Register the connector**

In `connectors/registry.ts`, register `new JiraConnector()` alongside Slack/Telegram/Discord. Export
`JiraConnector` from `connectors/index.ts` and re-export from `libs/claw-studio/src/index.ts`
alongside the other connector exports, plus the `JiraConnectorConfig` type.

- [ ] **Step 2: Add the field descriptors**

In `channel-fields.ts`, add a `jira` entry. Field list, matching `JiraConnectorConfig`:

| key | label | type | required | help |
|---|---|---|---|---|
| `baseUrl` | Site URL | text | yes | `https://your-org.atlassian.net` |
| `email` | Atlassian email | text | yes | The account the API token belongs to |
| `apiToken` | API token | secret | yes | Create at id.atlassian.com → Security → API tokens |
| `webhookSecret` | Webhook token | secret | **yes** | Shared token your Jira Automation rule must send as `x-automation-webhook-token` |

Match the existing entries' exact shape — including how secret fields are flagged so
`connector-secret-field.tsx` masks them.

- [ ] **Step 3: Add the logo and visuals**

Create `jira-logo.tsx` as an inline SVG component following `slack-logo.tsx`/`outlook-logo.tsx` (no
external asset — the CSP on this app blocks remote images and the other logos are all inline). Add the
`jira` entry to `channel-visuals.tsx` with the logo and its brand colour.

- [ ] **Step 4: Upsert the channel link on save**

Find where the existing connectors upsert `ClawChannelLink` when credentials are saved (Slack does it
with `team_id` from `auth.test`; Telegram with `sha256(secretToken)`). Add the Jira case: on a
successful save, `linkChannel({ channel: 'jira', externalId: jiraSiteHost(baseUrl), tenantId, label: host })`.

Without this, every inbound Jira webhook fails tenant resolution. Verify by saving credentials and
confirming a `claw_channel_links` row appears with `channel = 'jira'`.

- [ ] **Step 5: Verify and commit**

Verify in the running app:
1. `/connectors` lists Jira with its logo, styled identically to Discord.
2. Fill in a real site URL, email, and API token → `Test connection` returns
   `Connected as <name>`.
3. Save → the webhook card shows the inbound URL `/api/gateway/jira`; a `claw_channel_links` row
   exists.
4. Reload → `apiToken` renders masked, never in plaintext.
5. In Jira, add an Automation rule posting to that URL on comment-created; comment `@Claw summarise
   this ticket` on an issue → a run appears at `/runs` with source `jira`, and Claw's answer arrives as
   a comment on the issue.

Run:
```bash
cd libs/claw-studio && bunx vitest run && bunx tsc --noEmit -p tsconfig.json
cd ../../apps/mission-control && bunx tsc --noEmit
```
Expected: all PASS.

```bash
git add libs/claw-studio/src/connectors apps/mission-control/components/connectors libs/claw-studio/src/index.ts
git commit -m "feat(claw-studio): register Jira connector and wire its settings UI"
```

---

### Task 5: Atlassian Rovo MCP — docs, not code

**Files:**
- Create: `apps/web-ui/content/docs/claw-jira.mdx`
- Modify: `apps/mission-control/components/mcp/mcp-server-form-dialog.tsx` (a suggestion hint)
- Modify: `libs/claw-studio/CLAUDE.md`

**Interfaces:**
- Consumes: the existing MCP support (`ClawMcpServer`, `createMcpTools`, `/mcp` page)
- Produces: documentation and discoverability. **No `jira_*` integration tools.**

Per spec §7.2 and nucleus's own docs, reading a Jira board is an **MCP** concern, not a hand-written
integration. Nucleus's `docs/agent-ops/README.md:217` draws exactly this line, and its test fixtures
show the tool names the Rovo server serves: `searchJiraIssuesUsingJql`, `getJiraIssue`. Claw Studio
already supports MCP end to end, so board reading needs zero new code — writing our own `jira_*` tools
would duplicate a maintained upstream server and a second credential surface.

- [ ] **Step 1: Write the docs page**

Create `apps/web-ui/content/docs/claw-jira.mdx` (Fumadocs MDX, matching the frontmatter of a
neighbouring page in that directory). Cover, in this order:

1. **The two halves, and which one you want.** A table: *"Trigger Claw from a Jira comment / reply on
   the issue"* → the Jira **connector** (`/connectors`); *"Let Claw read the board, search issues,
   create tickets"* → the Atlassian **Rovo MCP server** (`/mcp`). Readers routinely conflate these.
2. **Connector setup** — API token creation, the four fields, `Test connection`, the inbound URL, and
   a copy-pasteable Jira Automation rule (trigger: comment created; action: send web request; body:
   the issue + comment payload).
3. **Rovo MCP setup** — adding the server on the MCP Configuration page, headless auth, and how to
   confirm the tools bound (the tool count on the Mission Dashboard's Tool Servers card, and asking
   Claw to list what it can do). Adapt from nucleus's `apps/web-ui/content/docs/jira-integration.mdx`.
4. **A worked example** tying it to scheduled tasks: a daily 10am task whose prompt reads the board via
   `searchJiraIssuesUsingJql` and emails a summary, with `gmail_send_message` as the only granted tool.
   This is the flagship scenario — spell it out end to end.
5. **Which tools need approval** — the Rovo mutative tools (`createJiraIssue`, `addCommentToJiraIssue`,
   …) classify as mutative and appear in the scheduled-task grant picker.

- [ ] **Step 2: Make the Rovo server discoverable**

In `mcp-server-form-dialog.tsx`, add a small suggested-servers hint above the form — one line naming
the Atlassian Rovo server with its URL and a link to the docs page. Without this the setup is folklore.
Keep it to a `text-xs text-muted-foreground` line plus an anchor; do not build a catalogue.

- [ ] **Step 3: Verify the served tool names**

Connect the Rovo server in a real tenant and record the actual tool names it serves. Then add any
mutative ones to the grant picker's label map (D3 Task 8) so they render friendly names rather than raw
identifiers. Update the docs page if the names differ from `searchJiraIssuesUsingJql` /
`getJiraIssue`.

This step is the reason §7.2 says "verify during implementation" — do not skip it and do not guess.

- [ ] **Step 4: Document the decision**

Add to `libs/claw-studio/CLAUDE.md`:

```markdown
## Jira

Two independent halves, deliberately:

- **Connector** (`connectors/adapters/jira.ts`) — inbound trigger from a Jira comment, outbound reply
  as an ADF comment, plus scheduled-digest delivery. Ported from nucleus
  `lib/gateway/adapters/jira-adapter.ts`. `approvalButtons: false` — Jira comments cannot render
  buttons, so an approval request is a comment pointing at Mission Control.
- **Reading the board** — the **Atlassian Rovo MCP server**, added on the MCP Configuration page. No
  hand-written `jira_*` tools: nucleus draws the same line (`docs/agent-ops/README.md:217`), and
  duplicating a maintained upstream server would mean a second credential surface to keep in sync.

Tenant resolution uses `ClawChannelLink` with `externalId` = the Jira site host, upserted when
credentials are saved — never a caller-supplied header.

`validateRequest` **fails closed**: no configured `webhookSecret` means every inbound request is
rejected. This diverges from nucleus (which accepts unsigned) on purpose — nucleus is an internal
single-org tool, whereas here an unsigned webhook spawns billable agent runs for a tenant identified
only by a guessable hostname. Do not "restore parity".
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/content/docs/claw-jira.mdx apps/mission-control/components/mcp/mcp-server-form-dialog.tsx libs/claw-studio/CLAUDE.md
git commit -m "docs: document the Jira connector and Atlassian Rovo MCP setup"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run every gate**

```bash
cd libs/claw-studio && bunx vitest run && bunx tsc --noEmit -p tsconfig.json
cd ../../apps/mission-control && bunx tsc --noEmit
cd ../workers && bunx tsc --noEmit
cd ../.. && bun run test
```
Expected: all PASS, no new failures versus the pre-effort baseline of 443.

- [ ] **Step 2: Confirm the live adapters were untouched**

```bash
git diff --stat main...HEAD -- \
  libs/claw-studio/src/connectors/adapters/telegram.ts \
  libs/claw-studio/src/connectors/adapters/discord.ts \
  libs/claw-studio/src/integrations \
  libs/claw-studio/src/memory \
  libs/claw-studio/src/skills \
  libs/claw-studio/src/mcp \
  libs/claw-studio/src/agent/tool-classifier.ts \
  libs/claw-studio/src/gateway/execute-run.ts
```
Expected: **empty output** (`execute-run.ts` may show D3's one additive `runtimeOverrides` field; nothing else).

- [ ] **Step 3: Regression-test the existing channels**

Send a message through Slack, Telegram, and Discord. Each must still create a run, stream updates, and
render approve/reject buttons exactly as before. Registering a fourth connector must not perturb the
other three.

- [ ] **Step 4: Full scenario test**

The flagship path, end to end:
1. Connect the Jira connector and the Rovo MCP server.
2. In `/chat`, ask Claw to summarise open issues on a board — it should use `searchJiraIssuesUsingJql`.
3. Click `Schedule this` → a daily 10am task, granting only `gmail_send_message`.
4. `Run now` → the report is emailed with no approval prompt.
5. Comment `@Claw what changed on this ticket?` in Jira → Claw replies as a comment.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(claw-studio): address Jira connector verification findings"
```

---

## Verification checklist

- [ ] `cd libs/claw-studio && bunx vitest run` — green, only additions vs baseline
- [ ] `bunx tsc --noEmit` clean in `libs/claw-studio`, `apps/mission-control`, `apps/workers`
- [ ] `bun run test` — no new failures
- [ ] `/connectors` shows Jira, visually identical in treatment to Discord
- [ ] `Test connection` succeeds against a real site; `apiToken` renders masked after reload
- [ ] A `claw_channel_links` row exists with `channel = 'jira'` after saving
- [ ] An inbound Jira comment creates a run and Claw replies on the issue
- [ ] A wrong `webhookSecret` is rejected; an unknown site fails tenant resolution
- [ ] The bot's own comments do not trigger a reply loop
- [ ] A scheduled task can deliver its digest to a Jira issue
- [ ] Rovo MCP tools bind and the board is readable from `/chat`
- [ ] Slack, Telegram, and Discord all still work unchanged
- [ ] **No hand-written `jira_*` integration tools exist** — `ls libs/claw-studio/src/integrations/ | grep -i jira` returns nothing
