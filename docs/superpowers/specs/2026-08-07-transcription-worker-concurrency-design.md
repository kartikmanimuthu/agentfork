# Transcription worker concurrency — design

## Context

The transcription pipeline (`apps/workers/src/jobs/transcription`) processes real call-recording
uploads for one client (SMC's regtech-quality pipeline, all diarized) at a sustained rate of
~35,000-40,000 jobs/day. The worker processes jobs strictly serially — `boss.work(JOB_NAME,
{ batchSize: 1 }, ...)` in `register.ts` — one job at a time, full stop.

Two per-item speed fixes are already deployed and verified working in production:
- **Turn-merging** in the engine's `diarize_and_transcribe()` — cut ASR model calls ~57% by
  combining consecutive same-speaker turns separated by short gaps into one call.
- **S3 connection reliability** — disabled HTTP keep-alive on the S3 client (a pooled connection
  going stale behind a NAT gateway was causing intermittent 2-minute stalls that blocked the
  entire serial queue) plus a short-timeout/fast-retry fallback.

Both fixes measurably improved per-job speed (sustained ~9-10 jobs/min today, zero stalls, vs.
~0.3 jobs/min with frequent multi-minute freezes before). But **total queue throughput is still
capped by strict serialization**: at ~9-10 jobs/min even running 24/7, capacity tops out around
13,000-14,000 jobs/day — roughly a third of the required 35,000-40,000/day. Per-item speed
improvements cannot close this gap on their own; only running more than one job at a time can.

Real measured constraints on the single EC2 GPU box (`i-01f7c1204bc06cd79`, shared with
ollama/litellm — out of scope for this change, no infra additions):
- GPU: 18.4GB free / 23GB total (only ~4.2GB in active use)
- System RAM: ~7.7GB available
- Correctness of running more than one job concurrently was already independently audited this
  session: no code (self-heal, usage tracking, job-state transitions) assumes strict serial
  processing anywhere in the pipeline.

## Goal

Raise sustained worker throughput enough to keep pace with real daily volume, via concurrency —
scoped to the current single EC2 instance (no new infrastructure in this change).

## Non-goals

- Adding a second GPU instance or any other infrastructure change (explicitly out of scope for
  this design — a separate decision if concurrency alone proves insufficient).
- Batched GPU inference at the engine level (multiple clips in one model forward pass) — a
  higher-ceiling but currently unverified option (unknown whether the ONNX-exported model
  supports a dynamic batch dimension). Not part of this change.
- Decoupling S3 download from GPU processing into separate pg-boss stages — a smaller, additive
  follow-up, not required to land the core concurrency fix.
- Raising `TRANSCRIBE_CHUNK_DURATION_SEC` past 120s — real for the plain/non-diarized path, but
  barely engages for this workload's diarized turns (almost always <120s already), so it doesn't
  address the throughput gap this design targets. Tracked as a separate, independent cleanup item.
- Fully decoupling webhook delivery from job completion (so a slow client endpoint never occupies
  a worker slot at all) — a bigger change to what `executeTranscription()` guarantees its callers,
  needing its own design (in particular, what happens if the process dies mid-delivery). This
  design only removes the *avoidable* serialization between webhook delivery and usage recording.

## Approach

Enable real concurrency in the transcription worker: `batchSize` fetches N jobs per poll, and the
callback processes all N in parallel via `Promise.allSettled`, rather than the current
`batchSize: 1` + sequential `for` loop. Alongside this, remove one avoidable per-job
serialization found while reviewing the completion path.

### Code changes — `apps/workers/src/jobs/transcription/register.ts`

1. `batchSize` reads from an environment variable (`TRANSCRIPTION_WORKER_BATCH_SIZE`, defaulting
   to the empirically-chosen `N` — see Verification) instead of being a hardcoded constant. This
   is the difference between "roll back needs a code revert + redeploy" and "roll back is an env
   var change" — cheap to add now, meaningfully cuts incident-response time later if the chosen
   `N` ever needs to be turned down in a hurry.
2. `boss.work(JOB_NAME, { batchSize, includeMetadata: true }, async (jobs) => { ... })`.
3. Replace the sequential `for (const job of jobs) { await executor.execute(...) }` body with
   `await Promise.allSettled(jobs.map(async (job) => { ...same per-job try/catch/complete/fail... }))`
   so N jobs actually run at once instead of being fetched together and still processed one at a
   time.

### Code changes — `libs/shared/src/services/transcription-runner.ts`

Found while reviewing this code for the concurrency change: `executeTranscription()` currently
runs four operations as sequential `await`s after the model call finishes — persist transcript to
S3, mark the job complete in our DB, record billing usage, then deliver the completion webhook.
The last of these is an outbound HTTP call to the *client's own* webhook receiver — its response
time directly extends how long this promise takes to resolve, which in turn extends how long a
worker slot stays occupied, on every one of the ~35-40K jobs/day.

`recordAudioMinutes` and `deliverCompletionWebhook` don't depend on each other's results — run
them concurrently via `Promise.all` instead of sequential `await`s (both call sites: the
`system_announcement` early-return path and the normal completion path). This changes their
combined cost from `sum(both)` to `max(both)`, with no change to what either caller (the sync API
route or this async worker) can rely on — the returned promise still only resolves once both are
genuinely done. A bigger change (fully decoupling webhook delivery so it never blocks the worker
slot) is out of scope here — flagged as a separate future item, since it changes the completion
guarantee this function offers to both its callers and deserves its own design.

### Error handling

Each job's `try { execute } catch { fail } / complete` moves into its own promise in the
`.map()`, fully independent of sibling jobs — one job's failure can never abort in-flight work on
others. `Promise.allSettled` (not `Promise.all`) is required for this independence.

One explicit trade-off: the existing code has a narrow safety net — if `boss.fail()` itself
throws (double failure), it rethrows so pg-boss's own callback-level error handling gets a chance
to finalize that job, added after a real past incident where a job was found stuck "active"
forever. Under `Promise.allSettled`, an individual promise's rejection no longer propagates to
the outer callback, so that specific rethrow-and-let-pg-boss-catch-it path no longer fires
immediately for that one job. The already-verified self-heal mechanism (runs at startup, heals
*any* stuck "active" job past a threshold, not assuming a count of one) recovers it on next
worker restart instead — a real but acceptable degradation from "immediate" to "eventual" for
this one rare edge case.

## Verification

**Determining N (the concurrency ceiling) — empirical, against the real box, not assumed:**
Progressively test 2, then 3, then 4 concurrent real jobs (mixed durations and formats),
measuring per-job latency and GPU memory at each step. The ceiling is wherever adding one more
concurrent job starts making *existing* jobs slower rather than adding net throughput — the point
where GPU compute contention (not memory, which has ample headroom) becomes the binding
constraint. Ship whichever N is the last one that still shows a clear net throughput win.

**Negative / adversarial test cases (required before this ships, not optional):**

1. **GPU OOM under worst-case concurrent load** — fire N *maximally long* real files (the
   ~50-minute class, not just short ones) simultaneously. Confirm no OOM crash, memory returns to
   baseline afterward.
2. **Shared-model thread-safety** — the engine holds one global `model`, `lid_model`,
   `diarization_pipeline` instance across all requests. ONNX Runtime sessions are documented
   thread-safe for concurrent `Run()` calls, and PyTorch inference-mode forward passes are
   generally safe with no shared mutable state, but this has never been exercised concurrently on
   this specific engine. Run real concurrent requests and check for any cross-contaminated output
   (e.g., job A's transcript containing job B's audio content), not just "did it crash."
3. **One job's hard crash must not take down concurrent siblings** — submit a known-bad file
   (e.g. corrupt audio) alongside a healthy job in the same batch. Confirm the healthy job still
   completes normally and only the bad one fails/retries.
4. **No double-processing** — confirm pg-boss's row-locking guarantees a job is never picked up
   by two concurrent slots at once. Should already be guaranteed by the library, but has never
   been exercised at `batchSize > 1` here, so verify explicitly rather than assume.
5. **Retry-storm / death-spiral check** — under *sustained* load (not a short burst), confirm the
   system settles into stable throughput rather than concurrency-induced failures triggering more
   retries triggering more load.
6. **Soak test, not just a burst** — run at the chosen N for an extended period (hours) to catch
   GPU memory fragmentation or leaks a short test wouldn't surface.
7. **Regression check on the already-deployed fixes** — confirm turn-merging's overlap-dedup and
   the S3 connection-per-request behavior still behave correctly under concurrency. Nothing here
   should interact badly with the earlier fixes, but it's cheap to re-verify rather than assume.
8. **Webhook parallelization doesn't change delivery guarantees** — confirm a failed webhook
   delivery still triggers the existing retry-enqueue path exactly as before. Also confirm the
   inverse case explicitly: today, if `recordAudioMinutes` throws, `deliverCompletionWebhook`
   never even starts (strictly sequential) — under `Promise.all` both start concurrently, so a
   `recordAudioMinutes` failure no longer prevents the webhook from firing. That's a real behavior
   change (arguably an improvement — the client still gets notified even if internal usage
   recording hiccups), not a regression, but confirm it's actually true rather than assumed, and
   confirm the job still doesn't get spuriously retried/re-transcribed when this happens (matching
   today's pre-existing behavior, where any error after `jobService.complete()` succeeds already
   risks this — not a new problem this change introduces, but worth confirming it isn't worse).

**Rollback plan:** set `TRANSCRIPTION_WORKER_BATCH_SIZE=1` and restart the worker task — no code
revert or redeploy needed, since batch size is now an env var. The `Promise.allSettled` structure
itself is safe to leave in place even at `batchSize: 1` (a single-element `.map()` behaves
identically to the old sequential loop), so only the env var needs to change for an emergency
rollback.

**Standard checks:** existing `apps/workers/src/jobs/transcription/register.test.ts` and
`handler.test.ts` must still pass; typecheck clean on `apps/workers`.

## Monitoring

**Status: deferred, not part of the implementation plan.** Implementing this required wiring an
already-provisioned SNS topic into `infra/compute/index.ts` — infra-touching enough that it was
explicitly dropped from scope during plan review rather than bundled into this change. The
proposal below is kept as a record of what's still worth doing as a separate follow-up.

This backlog reached 35,000+ jobs before anyone noticed — the gap wasn't that throughput was bad,
it's that nothing was watching queue depth grow. A simple threshold alert would close that gap:

- Alert when queue depth (`pgboss.job` rows in `created`/`retry` state for the `transcription`
  queue) exceeds a threshold, or when the oldest queued job's age exceeds a threshold (e.g., queue
  depth growing for more than N minutes straight, or oldest-queued-job-age past some ceiling).
- Cheap to implement as a scheduled query against the existing DB — doesn't need new
  infrastructure, just needs to exist, since right now nothing does.
- This is a detection mechanism, not a fix — it won't prevent a future volume spike from
  outpacing capacity again, but it turns "we noticed after 14+ hours and 35K jobs" into "we
  noticed within minutes," which is the actual gap that let this go unnoticed as long as it did.
