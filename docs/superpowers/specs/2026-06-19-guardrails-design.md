# Guardrails for the Agentic Studio — Design

## Overview

Add a per-agent guardrail system to the agentic studio so tenant admins can enforce input/output safety policy on their agents: input moderation, output moderation, PII/secret redaction, and topic/allowed-subject fences.

**Approach:** a standalone `libs/guardrails/` package exporting a `GuardrailEngine` that runs synchronously on input before `streamChat`, and wraps the model's output stream for in-flight masking + deferred, heuristic-gated LLM judging. Detection is **hybrid** — cheap deterministic rules (regex, keyword, topic-match) plus an LLM judge invoked only when a heuristic flags suspicion. Actions are **per-rule configurable**: `mask` (replace token with a placeholder and continue), `block` (refuse the turn), `warn` (flag in audit but pass). Configuration is **per-agent**, stored in `Agent.config.guardrails` (no Prisma migration), edited via a new designer **Guardrails tab**.

Guardrails are greenfield in the chat path today: the only existing safety code is regex PII redaction during knowledge-base document ingestion (`libs/knowledge-base/src/preprocessing/`), which is not in the chat/inference path.

## Decisions

| Area | Decision |
|---|---|
| Capabilities | Input moderation, output moderation, PII/secret redaction, topic fences |
| Detection | Hybrid: rules (regex/keyword/topic) + LLM judge (small classifier) |
| Action | Per-rule configurable: `mask` (replace token with placeholder, continue) / `block` (refuse the turn) / `warn` (flag but pass) |
| Config scope | Per-agent, in a designer Guardrails tab |
| Output strategy | Tiered: regex masks in-flight always; LLM judge runs on output **only when a heuristic flags** the text as suspicious (~95% of clean turns cost zero judge calls) |
| Judge model | Per-agent, defaults to a small/cheap classifier |
| Engine home | Standalone `libs/guardrails/` Nx lib |
| Apply scope | Production inference API + playground (parity) |
| Audit | `AuditLog` writes for `block` decisions (and `flag` when enabled) — not per token |
| Schema | No Prisma migration; config in `Agent.config` JSON, decisions in `AuditLog` |

## Architecture

```
                          ┌─────────────────────────────────────────────┐
   Inference API route    │              libs/guardrails/                 │
  (production + playground)│  ┌──────────────────────────────────────┐  │
        │                   │  │ GuardrailEngine                      │  │
        │  resolve agent ─► │  │  .runInput(messages, ctx) → result   │  │
        │  config ─────────►│  │  .wrapOutputStream(stream) → stream │  │
        │                   │  └──────────────────────────────────────┘  │
        ▼                   │      uses:                                  │
 ┌──────────────┐          │   rules/   pii-redact, secret-detect,       │
 │ runInput     │          │            topic-fence, keyword-deny,       │
 │ Guardrails() │          │            injection-heuristic              │
 │  (sync)      │          │   judge/   LlmJudge (small classifier)      │
 └──────┬───────┘          │   config/  Zod schemas (GuardrailsConfig)   │
        │ pass/mask/block  │   logging/ AuditLog writer (blocks only)    │
        │                   │   output/  stream-wrapper + heuristic       │
   masked messages ──► streamChat() ──► fullStream ──► wrapOutputStream()
                                                       │ regex mask in-flight
                                                       │ if heuristic flags →
                                                       │   judge (single call)
                                                       │ block? abort stream
                                                       ▼
                                              PartStreamEmitter / SSE / JSON
```

### Flow

1. After agent resolution + content normalization in the inference route (around line 423, after `coreMessages` / `effectiveSystem` / `allTools` are built, before `streamChat`), call `runInputGuardrails(messages, ctx)` **synchronously**. Input is where jailbreak / prompt injection must be caught, and the user is already waiting for first token — one cheap judge call is acceptable. Input judging is **tiered**: rules first (regex/keyword/topic-keyword), then the LLM judge invoked only if rules pass but a lightweight injection-heuristic flags the input.
2. If a rule says **block**, return the configured refusal message immediately — never call the model. PII/secrets are **masked** in the messages before they reach the model.
3. The model streams. The output stream is wrapped in an async-iterator transform (`wrapOutputStream`) that **masks PII/secrets in-flight** (regex, free) and **defers the LLM judge** — invoking it only when a heuristic detects suspicious tokens (banned keyword, secret-like pattern, deny-subject hit). Clean turns cost zero judge calls.
4. Decisions that result in a **block** (input or output) are written to `AuditLog`. Warn/flag actions log when `audit.logFlags` is on. Bounded — never a per-token DB write.

## Components — `libs/guardrails/`

```
libs/guardrails/src/
  index.ts                 # public exports
  config/
    schema.ts              # Zod: GuardrailsConfig + sub-schemas
    defaults.ts            # default config factory
  engine/
    guardrail-engine.ts    # runInputGuardrails(), wrapOutputStream()
    types.ts               # GuardrailContext, GuardrailResult, GuardrailDecision
    pipeline.ts            # rule ordering + action resolution
  rules/
    pii-redact.ts          # reuse KB DEFAULT_PII_PATTERNS, lifted to shared
    secret-detect.ts       # API keys, tokens, AWS keys, private keys
    topic-fence.ts         # allow/deny subject lists (keyword + judge)
    keyword-deny.ts        # banned phrase/word list
    injection-heuristic.ts # cheap jailbreak signal (length, markers, keywords)
  judge/
    llm-judge.ts           # small-classifier call via createLLMProvider
    prompts.ts             # classification prompts (injection/toxicity/topic)
  logging/
    audit-writer.ts        # AuditService.logGuardrail (blocks/flags)
  output/
    stream-wrapper.ts      # async-iterator transform + heuristic gating
    heuristic.ts           # cheap "is this suspicious?" check
vitest.config.ts
```

### `GuardrailsConfig` Zod schema (stored in `Agent.config.guardrails`)

```typescript
GuardrailsConfig = {
  enabled: boolean                       // master toggle per agent
  input: {
    piiRedaction: { enabled, patterns?: string[], customPatterns?: Pattern[] }
    secretDetection: { enabled, action: 'mask' | 'block' | 'warn' }
    injectionDetection: { enabled, action: 'block' | 'warn', threshold: number }
    topicFence: {
      allowedSubjects?: string[]         // if set, off-topic → block/warn
      deniedSubjects?: string[]
      action: 'block' | 'warn'
      mode: 'keyword' | 'judge' | 'both' // how subjects are evaluated
    }
    bannedPhrases: { phrases: string[], action: 'mask' | 'block' | 'warn' }
  }
  output: {
    piiRedaction: { enabled, patterns?: string[] }    // mask in-flight, regex only
    secretDetection: { enabled, action: 'mask' | 'block' }
    topicFence: { allowedSubjects?, deniedSubjects?, action, mode }
    bannedPhrases: { phrases, action }
    toxicity: { enabled, action: 'block' | 'warn', mode: 'heuristic' | 'judge' }
  }
  judge: {
    model?: string                       // per-agent judge model, defaults to small classifier
    providerConfigKey?: string           // optional override provider
    enabled: boolean                     // can disable judge, rules-only
  }
  refusalMessage: string                 // returned on block (per-agent override)
  audit: { logBlocks: boolean, logFlags: boolean }
}
```

### `GuardrailEngine` interface

```typescript
runInputGuardrails(messages, ctx): Promise<GuardrailResult>
// GuardrailResult = {
//   decision: 'pass' | 'mask' | 'block',
//   maskedMessages?,
//   refusalMessage?,
//   triggered: GuardrailDecision[],
//   degraded: boolean        // true when fail-open occurred
// }

wrapOutputStream(fullStream, ctx): AsyncIterable<TextStreamChunk>
// yields masked chunks; on hard block yields a refusal + stops;
// collects final text for conditional judge
```

### `GuardrailContext`

Carries `tenantId, agentId, agentVersionId, config, db, logger` so rules / judge / audit-writer share one typed context. No `process.env` access — env via T3 Env typed object, per project standards.

### Rules contract

Each rule is `{ id, phase: 'input' | 'output', evaluate(textOrMessages, ctx): Promise<RuleFinding> }` where `RuleFinding = { matched, action, maskedText?, reason }`. The pipeline runs input rules in a defined order — PII → secret → banned-phrase → topic-keyword → injection-heuristic → judge — applies masks cumulatively, and short-circuits on the first `block`.

### LLM judge

Reuses `createLLMProvider(config)` from `libs/ai` with the per-agent judge model (defaulting to the tenant's small classifier via `TenantConfigService.get('llmConfig')`). Returns structured `{ violated, category, confidence }` via a `jsonSchema` tool, following the AI SDK v6 `inputSchema` convention. Judge calls have a 5s timeout and a single retry; on exhaustion, fail open.

### PII reuse

`DEFAULT_PII_PATTERNS` / `processPiiRedaction` in `libs/knowledge-base/src/preprocessing/index.ts` is lifted into `libs/shared` so both KB ingestion and chat guardrails share one implementation. This is a targeted improvement to code the guardrail work touches, not unrelated refactoring.

## Data Flow & Integration

### Production inference route (`apps/web-ui/app/api/v1/inference/route.ts`)

After agent/version resolution + content normalization (around line 423), before `streamChat`:

```typescript
const gr = agent.config.guardrails;
if (gr?.enabled) {
  const result = await runInputGuardrails(coreMessages, {
    config: gr, tenantId, agentId, agentVersionId, db, logger,
  });
  if (result.decision === 'block') {
    await auditWriter.log({ ...result, severity: 'warn' });
    return refusalResponse(result.refusalMessage, format);  // SSE / UI-stream / JSON
  }
  coreMessages = result.maskedMessages ?? coreMessages;     // PII/secrets masked
}
const stream = streamChat({ ...options, messages: coreMessages });
const out = gr?.enabled
  ? wrapOutputStream(stream.fullStream, ctx)
  : stream.fullStream;
```

- The three output formats (SSE via `PartStreamEmitter`, `toUIMessageStreamResponse`, non-streaming JSON) each get a thin adapter so the wrapped stream plugs in identically. For non-streaming JSON, the output judge runs on the assembled text directly.

### Playground route (`apps/web-ui/app/api/agents/[id]/playground/route.ts`)

Same `runInputGuardrails` + `wrapOutputStream` calls around its `streamChat`. Keeps dashboard parity with production so agents behave identically when published.

### Designer Guardrails tab (`apps/web-ui/components/agents/tabs/guardrails-tab.tsx`)

Sibling to `tools-tab.tsx`. shadcn/ui exclusively. Sections: master `enabled` switch, Input group (PII / secrets / injection / topic-fence / banned-phrases), Output group (same minus injection), Judge group (model picker defaulting to small classifier), Refusal message input, Audit toggles. Validated by the same Zod `GuardrailsConfig` schema on save (shared between client and server via `@chatbot/guardrails`). Config is written through the existing agent save endpoint (part of `Agent.config`) — no new API route; the agent config form's Zod schema is extended to include `guardrails`.

### Streaming output wrapper behavior

- Maintains a small rolling buffer (last ~200 chars) for regex that can span chunk boundaries (emails, credit cards).
- Emits masked text deltas as they clear the buffer.
- Heuristic runs on the buffer; if it flags, accumulates the full text and triggers the LLM judge once near stream end (single call). On a block verdict, emits the refusal and stops the iterator — the user sees prior masked content + refusal (acceptable; output blocks are rare and input-side already catches most jailbreaks).
- Persists the **masked** final text to `InferenceSessionMessage` / `ApiKeyExecution`, never raw PII.

### Audit logging

`AuditService.logGuardrail({ tenantId, agentId, agentVersionId, decision, triggered, severity })` writes to `AuditLog` only for `block` (and `flag` when `audit.logFlags` is on). One row per blocked turn, not per token.

## Error Handling, Observability & Testing

### Error handling

Per project standards, every function/route/job wraps logic in try/catch, logs, and rethrows or returns a typed error.

- A guardrail failure must **never break the chat**. On internal error (judge timeout, provider 5xx, regex throw) the engine **fails open**: logs `logger.error({ agentId, reason })`, treats the turn as `pass` (no mask), and continues. This is the standard SaaS guardrail posture — a broken safety net shouldn't take down the product.
- `GuardrailResult` includes a `degraded: boolean` flag when fail-open occurred, surfaced into AuditLog severity so admins see when guardrails went degraded.
- Typed errors via a `GuardrailError` class; route handlers map to the existing error-response shape (SSE error frame / JSON error) consistent with the inference route's current handling.

### Observability (Pino)

Structured logs with `{ tenantId, agentId, agentVersionId, sessionId, ruleId, decision }`. Input judge invocations at `info` with latency; fail-open at `error`; warn/flag at `warn`. No PII in logs (Pino redact already configured; rule reasons are category strings, not raw text).

### Testing

**Unit** (`libs/guardrails/vitest.config.ts`, run via `nx test guardrails`):
- Each rule in isolation: PII redaction across chunk boundaries, secret patterns (AWS keys, `sk-`, JWT, private key headers), topic-fence keyword + judge modes, banned-phrase masking, injection-heuristic false/true positives.
- `runInputGuardrails`: cumulative masking order, block short-circuit, fail-open on judge throw, refusal message passthrough.
- `wrapOutputStream`: rolling-buffer masking, heuristic-gated single judge call (mock provider), block-abort mid-stream, no-judge-call on clean turns.
- `GuardrailConfig` Zod: defaults, invalid configs rejected, action enums.

**Integration** (existing `apps/web-ui-e2e` + a new `@guardrails` module tag, or a Vitest integration spec hitting the inference route):
- Agent with guardrails enabled blocks a jailbreak input.
- Masks an SSN in a passing turn.
- Output-masks a leaked email.
- Deny-subject fence refuses an off-topic question.
- Fail-open still returns a response when the judge provider errors.

**Parity check**: same agent config produces identical guardrail behavior in playground vs inference (prevents "works in studio, breaks in prod").

## Standards Compliance

- **Validation**: Zod at every boundary (config load, route request, judge output schema).
- **UI**: shadcn/ui exclusively in the Guardrails tab.
- **Env**: T3 Env for any env access — no `process.env`.
- **Logging**: Pino structured logging throughout; correct severities; structured context.
- **Schema**: No Prisma migration; reuse `AuditLog` + `Agent.config` JSON.
- **Error handling**: try/catch everywhere, fail-open on internal errors, typed `GuardrailError`.

## Out of Scope (YAGNI)

- Tenant-level guardrail policy / tenant-defaults-with-overrides (per-agent only for now).
- A dedicated guardrail audit dashboard UI (AuditLog rows are queryable; a view can come later).
- Bedrock-native in-band guardrails as a provider (the judge is a normal LLM call; a Bedrock Guardrail provider can be added later behind the same judge interface without rewriting call sites).
- Real-time LLM judging of every output chunk (deferred + heuristic-gated only).
- Hallucination / contextual-grounding checks (separate concern from safety moderation).