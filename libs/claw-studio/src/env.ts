import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Local T3 env for claw-studio — mirrors libs/ai/src/env.ts's pattern.
// DATABASE_URL isn't declared in libs/shared/src/env.ts (Prisma resolves it
// internally from schema.prisma's env("DATABASE_URL") there), but the Postgres
// checkpointer/store need it explicitly, so it's declared here rather than
// widening the shared env schema for every other consumer.
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    // Iteration budget for the executor graph's generate⇄tools⇄reflect loop.
    // Nucleus Agent Ops uses a much larger default (150) for unattended
    // autonomous runs; Claw's current invocation context is an interactive
    // chat turn, so this matches nucleus's interactive chat agents' shared
    // budget (30) instead.
    //
    // Read by claw-runtime.ts's MAX_ITERATIONS and enforced as
    // modelCallLimitMiddleware's `runLimit`. Every tool round trip costs one
    // call, so browsing turns consume this far faster than text-only ones;
    // exhausting it ends the turn with "Model call limits exceeded" as the
    // reply rather than throwing. Unattended runs use BACKGROUND_MAX_ITERATIONS
    // instead and are unaffected by this value.
    CLAW_MAX_ITERATIONS: z.coerce.number().int().positive().default(30),
    // How long a chat turn may keep running after its browser disconnected.
    //
    // A reload used to kill the turn outright: the SSE socket died, the route
    // detected the dead controller and aborted the run, and the answer was never
    // produced or recorded. Turns now finish without a listener so a reloaded
    // page can pick the answer up from the run record — but not forever. The old
    // abort existed for a real reason (an orphaned run was observed still issuing
    // model calls two minutes after its client left, holding its browser
    // session), so the wait is bounded rather than removed. Measured from the
    // moment the client goes, not from the start of the turn.
    CLAW_CHAT_DETACHED_MAX_MS: z.coerce.number().int().positive().default(180_000),
    // Total budget for the composed workspace identity (soul/agents/user/...).
    // Per-file caps live in workspace/types.ts; this bounds their sum so a
    // runaway set of files can't crowd out the conversation itself.
    CLAW_WORKSPACE_MAX_CHARS: z.coerce.number().int().positive().default(24_000),
    // How much of its own workspace Claw may rewrite. 'user' lets it record what it
    // learns about you (user/tools/heartbeat) but keeps persona files read-only to
    // it; 'all' also permits soul/agents/identity, still approval-gated.
    // Defaults to 'all' so Claw can maintain its own persona files, not just the
    // notes it keeps about you. Persona slugs (identity/soul/agents) are still
    // approval-gated per slug — see file-tools.ts's `grantedWrites` and
    // claw-deep-agent.ts's `isGranted` — so 'all' widens what Claw may PROPOSE,
    // never what it may change without being asked.
    CLAW_SELF_AUTHORING: z.enum(['off', 'user', 'all']).default('all'),
    // Scheduler guards. The cadence floor protects both the sweeper and the LLM
    // budget from a task set to run every minute.
    CLAW_MIN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
    CLAW_MAX_ACTIVE_TASKS_PER_TENANT: z.coerce.number().int().positive().default(25),
    CLAW_SCHEDULER_SWEEP_MS: z.coerce.number().int().positive().default(30_000),
    // Optional cheaper model for the internal, non-user-facing calls the graph
    // makes on every turn (evaluator, reflect, memory extraction). These are
    // classification and critique, not prose the user reads, and they ran on
    // the tenant's full-size chat model purely because nothing ever supplied
    // `reflectorModel`. Set to a model id valid for the tenant's OWN provider
    // (e.g. a Haiku-class id) — the provider/credentials are reused, only the
    // model id changes. Unset ⇒ identical behaviour to before.
    CLAW_REFLECTOR_MODEL: z.string().min(1).optional(),
    // Browsing. Chromium runs in-process in whichever host resolved the run
    // (workers for gateway/scheduled runs, mission-control for interactive
    // chat), so these bound one run's browser and, together, the blast radius
    // of a burst of browsing runs on one container.
    CLAW_BROWSER_ENABLED: z.enum(['true', 'false']).default('true'),
    CLAW_BROWSER_NAV_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    CLAW_BROWSER_SESSION_MAX_MS: z.coerce.number().int().positive().default(300_000),
    CLAW_BROWSER_IDLE_MS: z.coerce.number().int().positive().default(60_000),
    // How long a page may stay open while its turn is parked at an approval
    // gate. Longer than IDLE_MS because it is bounded by a human reading a
    // prompt, not by a model's next tool call — but still bounded, so an
    // approval nobody answers cannot pin a Chromium for the process's lifetime.
    CLAW_BROWSER_HOLD_MS: z.coerce.number().int().positive().default(300_000),
    // Process-wide, not per-run: this bounds how many Chromiums one container
    // holds at once. web_fetch launches its own short-lived browser outside
    // this count.
    CLAW_BROWSER_MAX_SESSIONS: z.coerce.number().int().positive().default(3),
  },
  client: {},
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
