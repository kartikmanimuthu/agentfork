# Transcription Worker Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the transcription worker's sustained throughput from ~9-10 jobs/min (strictly serial) to whatever an empirically-determined concurrency level allows, closing the gap against the required ~35-40K jobs/day, without adding new infrastructure.

**Architecture:** Two code changes (`register.ts`'s `batchSize` becomes real parallel processing via `Promise.allSettled` instead of a sequential loop; `transcription-runner.ts`'s two independent completion calls run concurrently instead of sequentially), followed by empirical tuning and a required adversarial test pass against the real engine before shipping. (A queue-depth monitoring alert was scoped as part of this design but dropped from this plan — infra-touching, descoped by explicit decision; see the design doc's Monitoring section for the deferred proposal.)

**Tech Stack:** TypeScript, pg-boss (job queue), Vitest, existing `@chatbot/shared` env schema (`@t3-oss/env-core` + zod).

## Global Constraints

- `batchSize` must be runtime-configurable via environment variable, not a hardcoded constant (spec requirement — enables instant rollback without a redeploy).
- No infrastructure changes (single EC2 box only — explicit scope boundary from the design).
- The concurrency ceiling (`N`) must come from an empirical load test against the real engine, not be assumed or guessed.
- All 7 negative/adversarial test cases from the spec's Verification section are required before shipping, not optional.
- Existing tests (`register.test.ts`, `transcription-runner.test.ts`, `handler.test.ts`) must continue passing.
- Full spec: `docs/superpowers/specs/2026-08-07-transcription-worker-concurrency-design.md`

---

### Task 1: Add `TRANSCRIPTION_WORKER_BATCH_SIZE` to the env schema

**Files:**
- Modify: `libs/shared/src/env.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `env.TRANSCRIPTION_WORKER_BATCH_SIZE` (`number`, default `1`) — consumed by Task 2.

- [ ] **Step 1: Add the new env var to the schema**

In `libs/shared/src/env.ts`, inside the `server: {}` block, add this line directly after the existing `TRANSCRIPTION_ENGINE_ASYNC_TIMEOUT_MS` entry (so it stays grouped with the other Transcription Studio config):

```typescript
    // Transcription worker concurrency — how many jobs run in parallel per worker process.
    // Defaults to 1 (today's strictly-serial behavior) so this is a pure opt-in; raise once the
    // real safe ceiling has been found empirically (see docs/superpowers/plans/2026-08-07-transcription-worker-concurrency.md).
    TRANSCRIPTION_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(1),
```

- [ ] **Step 2: Wire it through Pulumi config, matching the existing `TRANSCRIPTION_*` convention exactly**

In `infra/compute/index.ts`, `sharedAppEnvironment` (starting at line 167) already has this exact
pattern for every other transcription tuning knob — `optionalEnv` reads from Pulumi's per-stack
config and only emits an env var override when the stack has actually set one, so the default
lives only in `libs/shared/src/env.ts` (Task 1, Step 1), not duplicated here. Add this line
directly after the existing `transcriptionUploadRetentionDays` entry:

```typescript
    ...optionalEnv("transcriptionWorkerBatchSize", "TRANSCRIPTION_WORKER_BATCH_SIZE"),
```

This is what makes Task 4's chosen concurrency level deployable later via
`pulumi config set transcriptionWorkerBatchSize N --stack nonprod && pulumi up --stack nonprod`
— a config-only change with no Docker rebuild, not literally instant but far faster and
lower-risk than a full code revert (skips the entire multi-stage Docker build).

- [ ] **Step 3: Typecheck both changed packages**

Run: `node_modules/.bin/tsc --noEmit --project libs/shared/tsconfig.json`
Expected: no errors (exit code 0).

`infra/compute` has its own `tsconfig.json` and its own local `typescript` devDependency (no
`typecheck` npm script defined, so invoke `tsc` directly against its own install):

Run: `cd infra/compute && node_modules/.bin/tsc --noEmit`
Expected: no errors (exit code 0).

- [ ] **Step 4: Commit**

```bash
git add libs/shared/src/env.ts infra/compute/index.ts
git commit -m "Add TRANSCRIPTION_WORKER_BATCH_SIZE env var, defaulting to today's serial behavior"
```

---

### Task 2: Restructure `register.ts` for real concurrent processing

**Files:**
- Modify: `apps/workers/src/jobs/transcription/register.ts`
- Test: `apps/workers/src/jobs/transcription/register.test.ts`

**Interfaces:**
- Consumes: `env.TRANSCRIPTION_WORKER_BATCH_SIZE` from Task 1 (`import { env } from '@chatbot/shared'`).
- Produces: `register()`'s exported behavior is unchanged in shape (still `(boss, executor) => Promise<void>`) — only its internal concurrency changes. No other file depends on internals beyond this signature.

- [ ] **Step 1: Write the failing test for concurrent execution**

Add this test inside the existing `describe('work callback', ...)` block in `apps/workers/src/jobs/transcription/register.test.ts` (after the existing "completes the job on success" test):

```typescript
    it('processes multiple jobs in the same batch concurrently, not sequentially', async () => {
      const boss = createMockBoss();
      const order: string[] = [];
      const executor = createMockExecutor(async (_jobName, jobData) => {
        const id = (jobData as { jobId?: string }).jobId ?? 'unknown';
        order.push(`start-${id}`);
        // job-a resolves after job-b starts, which only happens if they run concurrently —
        // a sequential for-loop would always fully finish job-a before job-b even starts.
        if (id === 'job-a') await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end-${id}`);
      });
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await callback([
        { ...baseJob, id: 'job-a', data: { jobId: 'job-a' } },
        { ...baseJob, id: 'job-b', data: { jobId: 'job-b' } },
      ]);

      expect(order.indexOf('start-job-b')).toBeLessThan(order.indexOf('end-job-a'));
      expect(boss.complete).toHaveBeenCalledWith('transcription', 'job-a');
      expect(boss.complete).toHaveBeenCalledWith('transcription', 'job-b');
    });

    it("one job's failure does not prevent a sibling job in the same batch from completing", async () => {
      const boss = createMockBoss();
      const executor = createMockExecutor(async (_jobName, jobData) => {
        const id = (jobData as { jobId?: string }).jobId ?? 'unknown';
        if (id === 'job-bad') throw new Error('boom');
      });
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await callback([
        { ...baseJob, id: 'job-bad', data: { jobId: 'job-bad' } },
        { ...baseJob, id: 'job-good', data: { jobId: 'job-good' } },
      ]);

      expect(boss.fail).toHaveBeenCalledWith('transcription', 'job-bad', { name: 'Error', message: 'boom' });
      expect(boss.complete).toHaveBeenCalledWith('transcription', 'job-good');
      expect(boss.complete).not.toHaveBeenCalledWith('transcription', 'job-bad');
    });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node_modules/.bin/vitest run apps/workers/src/jobs/transcription/register.test.ts --pool=forks --no-file-parallelism`
Expected: FAIL — the current sequential `for` loop passes the first test (order still happens to look sequential-safe by luck of the mock timing) or the concurrency assertion fails; write down the actual failure before proceeding so Step 4 has something concrete to fix.

- [ ] **Step 3: Restructure the callback body**

In `apps/workers/src/jobs/transcription/register.ts`:

Replace the import line:
```typescript
import { getPrismaClient } from '@chatbot/shared';
```
with:
```typescript
import { getPrismaClient, env } from '@chatbot/shared';
```

Replace the entire `boss.work(...)` block (lines 66-100 in the current file) with:

```typescript
  await boss.work(JOB_NAME, { batchSize: env.TRANSCRIPTION_WORKER_BATCH_SIZE, includeMetadata: true }, async (jobs) => {
    await Promise.allSettled(
      jobs.map(async (job) => {
        const isFinalAttempt = job.retryCount >= job.retryLimit;
        log.info('Processing job', { jobId: job.id, retryCount: job.retryCount, retryLimit: job.retryLimit, isFinalAttempt });
        try {
          await executor.execute(JOB_NAME, { ...(job.data as Record<string, unknown>), isFinalAttempt, totalAttempts: TOTAL_ATTEMPTS });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error('Job execution failed', { jobId: job.id, errorName: error.name, errorMessage: error.message, isFinalAttempt });
          try {
            await boss.fail(JOB_NAME, job.id, { name: error.name, message: error.message });
          } catch (failErr) {
            // fail() itself failing must not be swallowed — see the self-heal mechanism
            // (self-heal.ts), which recovers a job left stuck "active" on next worker
            // startup. Under Promise.allSettled a rethrow here only fails THIS job's own
            // promise, not the whole batch — logging is the last line of immediate defense.
            log.error('Failed to mark boss job as failed', { jobId: job.id, err: failErr instanceof Error ? failErr.message : failErr });
          }
          return;
        }
        // Only reached on success. Kept out of the try/catch above so a failure in complete()
        // itself — the execution already succeeded and its webhook already delivered — can
        // never be mistaken for an execution failure and trigger a retry (which would re-run
        // the job and send a duplicate webhook).
        try {
          await boss.complete(JOB_NAME, job.id);
        } catch (completeErr) {
          log.error('Failed to mark boss job as complete after successful execution', {
            jobId: job.id,
            err: completeErr instanceof Error ? completeErr.message : completeErr,
          });
        }
      })
    );
  });
```

Note the one deliberate behavior change from the original (documented in the spec's Error handling section): the previous code rethrew the execution error when `boss.fail()` itself also failed, so pg-boss's own callback-throw handling could finalize that job. Under `Promise.allSettled`, an individual job's throw only fails its own promise — it doesn't propagate to the outer callback — so that immediate rethrow path is gone. This is now caught by the existing self-heal mechanism instead, at the next worker startup.

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `node_modules/.bin/vitest run apps/workers/src/jobs/transcription/register.test.ts --pool=forks --no-file-parallelism`
Expected: PASS — all tests including the two new ones, and all pre-existing tests (they only ever pass a single job, so `Promise.allSettled(jobs.map(...))` over one element behaves identically to the old loop for them).

- [ ] **Step 5: Typecheck**

Run: `node_modules/.bin/tsc --noEmit --project apps/workers/tsconfig.json`
Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/jobs/transcription/register.ts apps/workers/src/jobs/transcription/register.test.ts
git commit -m "Process transcription jobs in a batch concurrently instead of sequentially"
```

---

### Task 3: Parallelize `recordAudioMinutes` and webhook delivery in `transcription-runner.ts`

**Files:**
- Modify: `libs/shared/src/services/transcription-runner.ts`
- Test: `libs/shared/src/services/transcription-runner.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `executeTranscription()`'s exported signature and return type are unchanged — only the internal ordering/concurrency of its last two side effects changes. Both existing callers (the sync API route and this worker) see identical resolved values and identical completion guarantees.

- [ ] **Step 1: Write the failing test for the normal completion path**

Add this test inside the `describe('success path', ...)` block in `libs/shared/src/services/transcription-runner.test.ts` (after the existing "transcribes, persists output..." test):

```typescript
    it('records audio minutes and delivers the webhook concurrently, not sequentially', async () => {
      const order: string[] = [];
      mockRecordAudioMinutes.mockImplementation(async () => {
        order.push('start-record');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('end-record');
      });
      mockDeliverWithToken.mockImplementation(async () => {
        order.push('start-webhook');
        return { success: true, status: 200 };
      });
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', language: 'en', durationSec: 60 });

      await executeTranscription(db, transcribe, baseParams({ webhookUrl: 'https://client.example.com/hook' }));

      // The webhook call must start before recordAudioMinutes finishes — a sequential
      // `await recordAudioMinutes(); await deliverCompletionWebhook();` would always show
      // start-webhook AFTER end-record.
      expect(order.indexOf('start-webhook')).toBeLessThan(order.indexOf('end-record'));
    });

    it("still delivers the webhook even when recordAudioMinutes fails, since they now run independently", async () => {
      mockRecordAudioMinutes.mockRejectedValue(new Error('usage service down'));
      mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });
      const transcribe: TranscribeFn = vi.fn().mockResolvedValue({ text: 'hi', language: 'en', durationSec: 60 });

      await expect(
        executeTranscription(db, transcribe, baseParams({ webhookUrl: 'https://client.example.com/hook' }))
      ).rejects.toThrow('usage service down');

      expect(mockDeliverWithToken).toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node_modules/.bin/vitest run libs/shared/src/services/transcription-runner.test.ts --pool=forks --no-file-parallelism`
Expected: FAIL on the first new test (`start-webhook` never happens before `end-record`, since the current code awaits `recordAudioMinutes` fully before even calling `deliverCompletionWebhook`). The second test may already incidentally pass or fail depending on today's sequential short-circuit — note the actual result before Step 4.

- [ ] **Step 3: Parallelize the two calls in both code paths**

In `libs/shared/src/services/transcription-runner.ts`, there are two places this pattern appears — the `system_announcement` early-return branch and the normal completion path.

**System announcement branch** (currently just `await deliverCompletionWebhook(p, jobService, output, latencyMs);` with no `recordAudioMinutes` call today — this branch already skips usage recording per its existing "does not record audio minutes for a system announcement" test, so it needs no change here. Leave this branch exactly as-is.

**Normal completion path** — replace:

```typescript
    await TranscriptionApiKeyService.recordAudioMinutes(db, p.apiKeyId, audioMinutes);

    await deliverCompletionWebhook(
      p,
      jobService,
      {
        text: result.text,
        language: result.language,
        durationSec: result.durationSec,
        ...(result.segments ? { segments: result.segments } : {}),
        ...(languageDetected ? { languageDetected, languageDetectionConfidence } : {}),
      },
      latencyMs
    );
```

with:

```typescript
    // Independent of each other — run concurrently instead of sequentially so the slower of
    // the two (typically the webhook, an outbound HTTP call to the client's own endpoint)
    // doesn't add its full latency on top of the other's.
    await Promise.all([
      TranscriptionApiKeyService.recordAudioMinutes(db, p.apiKeyId, audioMinutes),
      deliverCompletionWebhook(
        p,
        jobService,
        {
          text: result.text,
          language: result.language,
          durationSec: result.durationSec,
          ...(result.segments ? { segments: result.segments } : {}),
          ...(languageDetected ? { languageDetected, languageDetectionConfidence } : {}),
        },
        latencyMs
      ),
    ]);
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `node_modules/.bin/vitest run libs/shared/src/services/transcription-runner.test.ts --pool=forks --no-file-parallelism`
Expected: PASS — both new tests, and every pre-existing test in this file (none of them assert ordering between these two specific calls, only that both eventually happen with the right arguments, which `Promise.all` still guarantees).

- [ ] **Step 5: Typecheck**

Run: `node_modules/.bin/tsc --noEmit --project libs/shared/tsconfig.json`
Expected: exit code 0.

- [ ] **Step 6: Run the full shared test suite to check for regressions**

Run: `node_modules/.bin/vitest run libs/shared --pool=forks --no-file-parallelism`
Expected: all tests pass (matches the full-suite count already established as the baseline this session — no new failures anywhere else in the package).

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/services/transcription-runner.ts libs/shared/src/services/transcription-runner.test.ts
git commit -m "Run usage recording and webhook delivery concurrently instead of sequentially"
```

---

### Task 4: Empirically determine the concurrency ceiling and run the required adversarial test pass

**Files:** none (live testing against the deployed engine and worker — no code changes in this task).

**Interfaces:**
- Consumes: Tasks 1-3 must be deployed to the nonprod environment first (this task validates the real, running system, not local code).
- Produces: a chosen value for `TRANSCRIPTION_WORKER_BATCH_SIZE` for Task 5 to set in the actual environment, plus a pass/fail record for each adversarial case below (all must pass before Task 5).

This task is empirical validation, not a code change — every negative test case from the spec's Verification section is required here, not optional. Deploy Tasks 1-3 to nonprod first with `TRANSCRIPTION_WORKER_BATCH_SIZE` still at its default of `1` (so the deploy itself is a no-op behaviorally), confirm the worker is healthy, then proceed.

- [ ] **Step 1: Baseline GPU/system memory reading**

Before touching concurrency at all, record the current baseline via SSM against `i-01f7c1204bc06cd79`:
```
nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv
free -h
```
Write down the free GPU memory and free system RAM numbers — every subsequent step compares against this baseline.

- [ ] **Step 2: Set `TRANSCRIPTION_WORKER_BATCH_SIZE=2` and restart the worker task**

Update the ECS task definition's environment for `chatflow-nonprod-workers-service` (or the equivalent env-var mechanism already in use for this service) to `TRANSCRIPTION_WORKER_BATCH_SIZE=2`, force a new deployment, confirm the task reaches steady state.

- [ ] **Step 3: Fire 2 concurrent maximally-long real jobs (negative case #1 — GPU OOM under worst case)**

Submit two of the ~50-minute-class real audio files (the same test fixtures used earlier this session: `test50.wav` equivalents) as two separate transcription jobs at the same time. While they process, poll GPU memory every ~10s:
```
nvidia-smi --query-gpu=memory.used,memory.free --format=csv
```
Expected: no OOM crash in the engine's container logs (`docker logs 60c244eb148d`), memory returns to baseline (Step 1's number) within a few seconds after both jobs complete.

- [ ] **Step 4: Check output correctness — no cross-contamination (negative case #2 — shared-model thread-safety)**

From the same two-concurrent-job run in Step 3, fetch both jobs' transcripts (via the DB or S3 output) and manually confirm job A's transcript only contains content from job A's audio, and job B's only from job B's — no interleaved or swapped content between the two.

- [ ] **Step 5: Crash isolation (negative case #3)**

Submit one known-bad file (reuse the corrupt/broken-header WAV fixture already used earlier this session) at the same time as one healthy job. Confirm: the healthy job completes normally with a real transcript; the bad job fails and follows the existing retry path; the healthy job's processing time is not meaningfully affected by the bad job's failure.

- [ ] **Step 6: No double-processing (negative case #4)**

During any of the above concurrent runs, query the DB directly:
```sql
SELECT id, count(*) FROM transcription_jobs WHERE status='completed' AND "completedAt" > now() - interval '1 hour' GROUP BY id HAVING count(*) > 1;
```
Expected: zero rows (a job ID should never appear as completed more than once).

- [ ] **Step 7: Progressive ceiling test — repeat Steps 2-6 at `batchSize=3`, then `batchSize=4`**

At each level, in addition to the checks above, record per-job latency for a fixed test file (same file, same length, at every concurrency level) to compare directly. The ceiling is the last `N` where per-job latency for that fixed file has not measurably degraded compared to `N-1`, and where all of Steps 3-6 still pass cleanly. Stop increasing `N` once latency starts degrading or any check fails — that result becomes the chosen `N`.

- [ ] **Step 8: Sustained-load / retry-storm check (negative case #5)**

At the chosen `N`, submit a steady stream of jobs (mixed real durations/formats) for at least 30 minutes continuously — not a single burst. Monitor completion rate over the whole window (same DB query pattern used earlier this session: completions grouped by minute). Expected: throughput stays roughly stable across the whole window; no climbing retry/failure rate as the run continues.

- [ ] **Step 9: Soak test (negative case #6)**

Leave the worker running at the chosen `N` under normal real traffic for several hours (not a short burst). Recheck GPU memory against the Step 1 baseline at the end. Expected: no gradual memory growth (fragmentation/leak) — GPU free memory at the end should be within a small margin of the baseline, accounting for whatever's actively mid-job at the moment of the check.

- [ ] **Step 10: Regression check on turn-merging and the S3 connection fix (negative case #7)**

During any of the above concurrent runs, confirm: diarized job outputs still show the expected turn-merging behavior (fewer, coherent segments — not fragmented back to pre-merge levels), and no job shows the old 2-minute-multiple stall signature in its `startedAt`-to-previous-`completedAt` gap. Both should be unaffected by concurrency, but verify rather than assume.

- [ ] **Step 11: Record the result**

Write down the chosen `N` and a one-line pass/fail summary for each of Steps 3-10. This becomes the input to Task 5.

---

### Task 5: Deploy the chosen concurrency level to production and confirm

**Files:** none (deployment/config task).

**Interfaces:**
- Consumes: the `N` chosen in Task 4, Step 11.

- [ ] **Step 1: Set `TRANSCRIPTION_WORKER_BATCH_SIZE` to the chosen `N` in the real environment**

Update the ECS task definition's environment for the production-equivalent workers service to the value determined in Task 4. Force a new deployment.

- [ ] **Step 2: Confirm the worker is healthy post-deploy**

Check ECS service events for a successful steady-state deployment (same pattern used earlier this session: `aws ecs describe-services ... --query "services[0].events[0:5]"`), and confirm no immediate error spike in the worker's CloudWatch logs.

- [ ] **Step 3: Confirm real throughput improvement**

Over the next 30-60 minutes of real traffic, query completion rate the same way as earlier this session:
```sql
SELECT date_trunc('minute', "completedAt") AS minute, count(*)
FROM transcription_jobs
WHERE "completedAt" > now() - interval '60 minutes'
GROUP BY 1 ORDER BY 1 DESC;
```
Expected: sustained jobs/minute meaningfully higher than the ~9-10/min pre-change baseline, roughly proportional to the chosen `N`.
