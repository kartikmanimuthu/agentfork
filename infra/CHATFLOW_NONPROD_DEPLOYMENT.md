# chatflow-nonprod Deployment — Full Record

## Goal

Create a brand-new, fully isolated AWS environment ("chatflow-nonprod") to test
deployments without touching the existing running production environment
("chatbot" / `prod` stack, account `970547372609`, `us-east-1`).

- New app name: `chatflow-nonprod` (existing prod app name: `chatbot`)
- New Pulumi stack: `nonprod` (existing prod stack: `prod`)
- Same AWS account (`970547372609`), same region (`us-east-1`)
- Same Pulumi state bucket (`s3://chatbot-pulumi-state`), different stack names
  so state is stored separately from prod

---

## 1. Branch / code sync

- Working branch: `omar-updating-graph-agent`
- Merged 8 commits from `main` into this branch (chat widget redesign, workflow
  engine, agent-studio, knowledge-base libs, etc.) so the deployed code matches
  the latest `main`.

## 2. Made the Pulumi infra code reusable for multiple environments

Committed as `4dd47b9` — *"feat(infra): make appName configurable, add chatflow
nonprod stack"*:

- **`infra/networking/index.ts`**
  - `appName` read from config, defaults to `"chatbot"` (was hardcoded)
  - All resource names (`vpc`, `s3 endpoint`, `db subnet group`) use `${appName}-...`
  - NAT gateway strategy made configurable: `natStrategy: "single"` → `Single`
    NAT gateway, anything else → `OnePerAz` (was hardcoded to `OnePerAz`)

- **`infra/compute/index.ts`**
  - `appName` read from config, defaults to `"chatbot"` (was hardcoded)
  - Networking `StackReference` now built dynamically from
    `pulumi.getStack()` instead of a hardcoded `"organization/chatbot-networking/prod"`,
    so each stack (`prod`, `nonprod`, ...) automatically references its matching
    networking stack.

## 3. Created new Pulumi stack config files

- **`infra/networking/Pulumi.nonprod.yaml`**
  ```yaml
  config:
    aws:region: us-east-1
    chatbot-networking:vpcCidr: 10.0.0.0/16
    chatbot-networking:appName: chatflow-nonprod
    chatbot-networking:natStrategy: single
  ```

- **`infra/compute/Pulumi.nonprod.yaml`**
  ```yaml
  config:
    aws:region: us-east-1
    chatbot-compute:appName: chatflow-nonprod
    chatbot-compute:appUrl: https://d28eqq2bj0c0yk.cloudfront.net
    chatbot-compute:subscriptionEmails: ""
  ```
  (Initially `appUrl` was a placeholder `https://placeholder.cloudfront.net`
  until the real CloudFront URL was known after first deploy — see step 8.)

## 4. Pulumi login + stack init

```bash
pulumi login "s3://chatbot-pulumi-state?region=us-east-1&awssdk=v2"

cd infra/networking
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot \
  pulumi stack init --secrets-provider=passphrase nonprod

cd ../compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot \
  pulumi stack init --secrets-provider=passphrase nonprod
```

This created two new, empty Pulumi stacks (`chatbot-networking-nonprod` and
`chatbot-compute-nonprod`) in the same S3 state bucket — completely separate
state from the `prod` stacks, so prod resources were never read or modified.

## 5. Install deps + build

```bash
bun install
bun run build
```

## 6. Deploy networking stack

```bash
cd infra/networking
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod
```

### Error #1 — AWS Elastic IP limit exceeded

```
AddressLimitExceeded: The maximum number of addresses has been reached
```
36 resources to create, 32 succeeded, 2 errored (the second NAT gateway's EIP).
AWS accounts default to 5 EIPs per region; `OnePerAz` NAT strategy needs 2 EIPs
per environment, and the account was already near the limit from prod.

**Fix:** Set `chatbot-networking:natStrategy: single` in
`Pulumi.nonprod.yaml` (uses 1 NAT gateway / 1 EIP instead of 2). Re-ran:

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod
```

✅ **Result: networking stack fully deployed — 36 resources.**
- VPC: `vpc-03b09500a0b2b247d`
- CIDR: `10.0.0.0/16`
- Single NAT gateway

## 7. Deploy compute stack — attempt 1

```bash
cd ../compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod
```

68 resources to create. 48 succeeded, 2 errored.

### Error #2 — RDS Postgres engine version not available

```
aws:rds:Instance (postgres):
  InvalidParameterCombination: Cannot find version 16.6 for postgres
```

`infra/compute/index.ts` had `engineVersion: "16.6"` hardcoded, but AWS no
longer offers 16.6 in `us-east-1` (only 16.9–16.14 available now).

**Fix (in `infra/compute/index.ts`):**
- Changed `engineVersion: "16.6"` → `"16.9"`
- Also discovered: `dbName` and `username` were set directly to `appName`
  (`"chatflow-nonprod"`), but Postgres identifiers can't contain hyphens.
  Added:
  ```ts
  // Postgres identifiers (dbName, username) only allow letters, numbers, underscores
  const dbIdentifier = appName.replace(/-/g, "_");
  ```
  and used `dbIdentifier` for `dbName`, `username`, and the connection-string
  secret. (For prod, `appName === "chatbot"` has no hyphen, so this is a no-op
  there.)

## 8. Deploy compute stack — attempt 2

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod
```

Postgres created successfully this time (✅ engine version fix worked).
12 more resources created, but **2 new errors**.

### Error #3 — `workers` Docker image build failed (TypeScript compile error)

```
docker-build:index:Image (workers-image):
  error: failed to solve: process "/bin/sh -c cd apps/workers && bunx tsc --project tsconfig.build.json"
  did not complete successfully: exit code: 2
```

**Root cause:** A recent `main` merge added a new feature (`agent-studio` —
graph-based agent execution). `apps/workers` now imports
`@chatbot/agent-studio/server`, which in turn depends on `@chatbot/telegram`
and `@chatbot/whatsapp`. The `apps/workers/Dockerfile` manually pre-compiles
`libs/shared`, `libs/ai`, and `libs/knowledge-base` into
`node_modules/@chatbot/*` before running `tsc` on the workers project — but
nobody added the equivalent steps for the new `agent-studio`/`telegram`/
`whatsapp` libraries. This is a **pre-existing bug on `main`** too (verified by
running the same `tsc` command against the `main` worktree — same error),
unrelated to this infra work.

**Fix (in `apps/workers/Dockerfile`):** added, after the `knowledge-base` build
step and before "Compile workers":

```dockerfile
# telegram and whatsapp ship as raw TS source (no build step) — link directly for
# agent-studio's node-executors and runtime resolution.
COPY libs/telegram/ /app/node_modules/@chatbot/telegram/
COPY libs/whatsapp/ /app/node_modules/@chatbot/whatsapp/

COPY libs/agent-studio/ libs/agent-studio/
RUN cd libs/agent-studio && bunx tsc --project tsconfig.lib.json && \
    mkdir -p /app/node_modules/@chatbot/agent-studio && \
    cp -rL /app/dist/out-tsc/libs/agent-studio/src /app/node_modules/@chatbot/agent-studio/src && \
    printf '{"name":"@chatbot/agent-studio","version":"0.0.1","type":"module","main":"src/index.js","types":"src/index.d.ts","exports":{".":"./src/index.js","./server":"./src/server.js"}}\n' > /app/node_modules/@chatbot/agent-studio/package.json
```

Verified by replicating the Docker build steps in a scratch directory (without
running Docker) — `tsc` compiled with zero errors after this fix.

## 9. Deploy compute stack — attempt 3 (success)

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod
```

✅ **All remaining 11 resources created, 1 deleted (old broken image
reference). 0 errors. Duration ~21 minutes** (mostly Docker image builds —
`web-ui` ~20 min, `workers` ~20 min).

## 10. Update `appUrl` placeholder → real CloudFront URL

`infra/compute/Pulumi.nonprod.yaml` was changed from:
```yaml
chatbot-compute:appUrl: https://placeholder.cloudfront.net
```
to:
```yaml
chatbot-compute:appUrl: https://d28eqq2bj0c0yk.cloudfront.net
```

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod
```

✅ 9 changes, 0 errors, **~2.5 minutes** (no Docker rebuild needed — only
Cognito callback/logout URLs and ECS task definition env vars updated, with a
normal rolling ECS deploy).

---

## 11. Schema/migration drift — `agent_workflows` and related fields (2026-06-10)

`prisma/schema.prisma` had `agents.showThinking`, `inference_session_messages.parts`,
`inference_sessions.workflowState`, and the `agent_workflows` table defined, but
**no corresponding migration file existed**. `docker-entrypoint.sh` runs
`prisma migrate deploy` on every container start, which only applies existing
migration files — it does **not** generate new ones from schema drift. So the
deployed DB was missing these columns/table even though the Prisma client
(generated from `schema.prisma`) expected them, which would cause runtime
errors wherever the new agent-workflow code paths are exercised.

Fixed in `90511da` by adding the missing migration:
`prisma/migrations/20260610120000_add_agent_workflows_and_missing_fields/migration.sql`
(adds `agents.showThinking`, `inference_session_messages.parts`,
`inference_sessions.workflowState`, and creates `agent_workflows`).

This migration was applied automatically by `docker-entrypoint.sh` during the
deploy in step 12 below — no manual `prisma migrate deploy` needed.

**Lesson**: when `schema.prisma` changes, always generate a matching migration
(`bunx prisma migrate dev`) in the same commit — schema-only changes silently
drift from the deployed DB until the next migration is written.

## 12. Deploy `AWS_BEARER_TOKEN_BEDROCK` secret + agent_workflows migration (2026-06-11)

**Problem**: The Kimi (`moonshotai.kimi-k2.5`) simple-agent worked in the
Playground (no tools attached → normal Bedrock Converse API path) but failed
in the SDK Chat Widget with `AI_LoadAPIKeyError: OpenAI API key is missing`.
Root cause: when tools (knowledge base/MCP) are attached and the model is
`moonshotai.*`/`deepseek.*`, `libs/ai/src/providers/bedrock.ts`'s
`needsMantleForTools()` routes the call through the `bedrock-mantle`
OpenAI-compatible gateway via `createOpenAI({ apiKey: env.AWS_BEARER_TOKEN_BEDROCK })`
— and `AWS_BEARER_TOKEN_BEDROCK` was never set in the ECS task environment.

**Fix**: Added a Bedrock API key (bearer token, already created/used locally)
to Secrets Manager via Pulumi config, and wired it into the web-ui task's
`secrets` array (`infra/compute/index.ts`):

```bash
cd infra/compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi config set --secret bedrockBearerToken --stack nonprod
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod --yes
```

New resources: `aws.secretsmanager.Secret`/`SecretVersion` (`chatflow-nonprod/bedrock-bearer-token`),
updated `ecs-execution-role-secrets-policy` to grant `secretsmanager:GetSecretValue`
on it, and `AWS_BEARER_TOKEN_BEDROCK` added to `WebUIContainer`'s `secrets`.
Conditional on `bedrockBearerToken` config being set — no-op for stacks
(e.g. prod) where it isn't configured.

This `pulumi up` also picked up the still-undeployed `90511da`/`589e8fa`
commits (the `agent_workflows` migration from step 11, the
`bedrock:ListFoundationModels` IAM fix, RDS engine version 16.6→16.9, db
identifier sanitization, and the workers Dockerfile build fix) — both
`web-ui-image` and `workers-image` were rebuilt as part of this run.

Also hit a **Pulumi passphrase prompt** — this stack uses an empty passphrase
(`PULUMI_CONFIG_PASSPHRASE=""`, see `infra/DEPLOYMENT.md`); cancel the prompt
(Ctrl+C) and re-run with that env var set.

✅ 12 changes (3 created, 5 updated, 3 replaced, 1 deleted), 0 errors,
**~4.5 minutes**.

`infra/compute/index.ts` and `infra/compute/Pulumi.nonprod.yaml` changes from
this step were **not yet committed** as of writing this — see Outstanding below.

---

## Current Status (as of this deployment session)

### chatflow-nonprod — fully deployed and healthy ✅

| Resource | Value |
|---|---|
| **App URL (CloudFront)** | **https://d28eqq2bj0c0yk.cloudfront.net** (HTTP 200) |
| CloudFront Distribution ID | `E195OTQC1UAF3B` |
| VPC | `vpc-03b09500a0b2b247d` (CIDR `10.0.0.0/16`, single NAT gateway) |
| ECS Cluster | `chatflow-nonprod-ecs-cluster` |
| web-ui service | `chatflow-nonprod-web-ui-service` — 2/2 tasks running |
| workers service | `chatflow-nonprod-workers-service` — 1/1 task running |
| RDS Postgres | `chatflow-nonprod-postgres.cfsuk8eescim.us-east-1.rds.amazonaws.com` (Postgres 16.9, db/user `chatflow_nonprod` / `chatflow_nonprod_admin`) |
| ECR repos | `chatflow-nonprod-web-ui`, `chatflow-nonprod-workers` |
| Cognito User Pool | `us-east-1_eOUTu6GIT` (domain prefix `chatflow-nonprod-auth-970547372609`) |
| S3 app bucket | `chatflow-nonprod-970547372609-us-east-1` |
| Bastion EC2 | `i-0887ff89751a7aa9d` |
| ALB | `chatflow-nonprod-alb-630136549.us-east-1.elb.amazonaws.com` |

### Existing prod environment — untouched ✅

| Resource | Value |
|---|---|
| App URL (CloudFront) | https://dhdaqqvh7yj46.cloudfront.net |
| ECS Cluster | `chatbot-ecs-cluster` |

### Outstanding (not yet committed to git)

- `infra/compute/index.ts` — `AWS_BEARER_TOKEN_BEDROCK` secret wiring (step 12)
- `infra/compute/Pulumi.nonprod.yaml` — `bedrockBearerToken` encrypted config (step 12)

(Engine version fix, db identifier sanitization, workers Dockerfile fix,
final `appUrl`, and the agent_workflows migration (step 11) were committed in
`589e8fa`/`90511da` and are already deployed as of step 12.)

---

## Next Steps — Redeploying chatflow-nonprod (after future code changes)

1. Make your code changes, commit them as usual.
2. From `infra/networking` (only if VPC/networking config changed — rare):
   ```bash
   cd infra/networking
   PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod
   ```
3. From `infra/compute` (this is the common case — app code, env vars, infra changes):
   ```bash
   cd infra/compute
   PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi up --stack nonprod
   ```
4. Pulumi shows a **preview** of what will change — review it, then type `yes`.
5. If only config/env vars changed (no Dockerfile/source changes), expect ~2-3
   minutes. If `apps/web-ui` or `apps/workers` source changed, Docker images
   rebuild — expect ~15-25 minutes.
6. After it finishes, verify:
   ```bash
   AWS_PROFILE=omar-testing-saas-chatbot aws ecs describe-services \
     --cluster chatflow-nonprod-ecs-cluster \
     --services chatflow-nonprod-web-ui-service chatflow-nonprod-workers-service \
     --region us-east-1 \
     --query "services[*].{name:serviceName,status:status,desired:desiredCount,running:runningCount,pending:pendingCount}" \
     --output table

   curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" https://d28eqq2bj0c0yk.cloudfront.net
   ```

---

## Next Steps — Deploying to prod (when ready)

The infra code changes made here are **mostly safe** for prod because they
default to prod's existing values when no nonprod-specific config is set:

- `appName` defaults to `"chatbot"` (prod's existing name) — unchanged for prod.
- `natStrategy` defaults to `OnePerAz` (prod's existing setting) — unchanged for prod.
- Stack reference resolves to `organization/chatbot-networking/prod` for the
  `prod` stack — same as the old hardcoded value.
- `dbIdentifier` = `appName.replace(/-/g, "_")` = `"chatbot"` for prod (no
  hyphen to replace) — no actual change to prod's DB name/username.

**⚠️ One change WILL affect prod if deployed as-is:**

- `engineVersion` changed from `16.6` → `16.9`. Prod's live RDS instance is
  presumably still on `16.6`. Running `pulumi up --stack prod` with this code
  would show a diff on the `postgres` resource and could trigger an **in-place
  engine version upgrade of the live production database** (potential downtime
  / reboot during the maintenance window).

### Recommended steps for prod:

1. **Always preview first — never apply blind:**
   ```bash
   cd infra/compute
   PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=<prod-profile> pulumi preview --stack prod
   ```
2. Check the preview output carefully for the `aws:rds:Instance (postgres)`
   resource. If it shows an `engineVersion` diff:
   - Either schedule the 16.6 → 16.9 upgrade deliberately (during a maintenance
     window, with a DB snapshot/backup first), **or**
   - Make `engineVersion` stack-configurable too (like `appName`/`natStrategy`)
     and pin prod's `Pulumi.prod.yaml` to `16.6` until you're ready to upgrade
     it on purpose.
3. The `apps/workers/Dockerfile` fix (agent-studio/telegram/whatsapp build
   steps) is a straight bug fix — safe and recommended to bring to prod
   whenever the `workers` image is next rebuilt for prod (otherwise that build
   would fail there too, the same way it did here).
4. Once the preview looks correct (no unexpected RDS diff, or the RDS upgrade
   is intentional and approved):
   ```bash
   PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=<prod-profile> pulumi up --stack prod
   ```
5. Verify prod services the same way as step 6 above, but against
   `chatbot-ecs-cluster` and `https://dhdaqqvh7yj46.cloudfront.net`.

---

# Deployment 2026-08-02 — Claw Studio + Transcription Studio + Mission Control

Everything below was written **before** deploying, from a real `pulumi preview` run
against `nonprod`. Read it end to end before running `pulumi up`.

**Applied 2026-08-03.** What actually happened, including two build bugs the preview
could not catch, is recorded in *Deployment outcome 2026-08-03* at the end of this file.

## What this deployment contains

Three branches merged into `integration/transcription-claw-studio`, then to `main`:

| Branch | Brings |
|---|---|
| `infra/stx-prod-deployment` | the `stx-chatflow-prod` stack (symlinks to `infra/compute`) |
| `feature/claw-studio` | `libs/claw-studio`, `apps/mission-control`, 9 Prisma migrations |
| `feature/transcribing-studio` | Transcription Studio, 9 models (migration was missing — added as `20260802040947_add_transcription_studio`) |

## Preview result — what to expect

`pulumi preview --stack nonprod` → **24 changes: 13 create, 5 update, 2 delete, 4 replace.**
Exit 0, no errors (only the pre-existing `s3.BucketV2` deprecation warnings).

**Created (11):** all Mission Control — ECR repo, image, log group, security group,
task definition, target group, listener rule, ECS service, and its own NextAuth
secret (random + secret + version).

**Replaced (retained):** `web-ui-task-def`, `workers-task-def`,
`ephemeral-worker-task-def` — `~containerDefinitions`, i.e. the new env vars. Old
revisions are retained, not destroyed.

**Updated:** `web-ui-service` + `workers-service` (new task-def revisions → rolling
restart), `ecs-execution-role-secrets-policy` (new secret ARN),
`workers-ecs-dispatch-policy` (knock-on — references the replaced ephemeral ARN).

**Both images rebuild** — verify these tags change, because the transcription and
Claw jobs run in the workers container:

```
web-ui:  989837e4b6f5 → 14640e01bb21
workers: be93fce45833 → d1ff90c8fe6a
```

## ⚠️ Things that will surprise you if you don't know

### 1. The bastion is destroyed and recreated — this is expected

```
+- aws:ec2:Instance bastion replace
   ~ ami: "ami-02b7a1d3fcb743fcb" => "ami-0d52a9965700d5237"
```

Not caused by this work. `bastionAmi` uses
`getAmiOutput({ mostRecent: true, filters: ["al2023-ami-*-arm64"] })`, so every time
AWS publishes a newer AL2023 ARM64 image the data source resolves differently and
Pulumi replaces the instance. **Decision taken 2026-08-02: let it replace.** You get
a new instance id and private IP; SSM re-registers on its own. Expect this to recur
on future deploys. If it ever becomes annoying, add `ignoreChanges: ["ami"]` to the
bastion resource.

### 2. CloudFront distribution updates (comment only)

`comment: "Chatbot WebUI" => "chatflow-nonprod - Web UI"` — from `f83c076` on the
stx-prod branch, which parameterised it as `${appName} - Web UI`. Cosmetic, but a
CloudFront update takes a few minutes to propagate. Don't cancel the deploy thinking
it has hung.

### 3. AWS provider downgrade 7.34.0 → 7.32.0

The deployed state was written by provider `7.34.0`; `infra/compute/bun.lock` resolves
`7.32.0`. Usually harmless. To remove the question entirely, run
`bun update @pulumi/aws` in `infra/compute` before deploying.

### 4. Public ECR 403 during the image build

`FROM public.ecr.aws/...` can fail with `403 Forbidden` even though `ecrPublicLogin`
runs inside the program. If the build fails there:

```bash
aws ecr-public get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin public.ecr.aws
```

then re-run. If buildkit still 403s, `docker pull public.ecr.aws/docker/library/node:20-slim`
first to seed the local cache.

### 5. Build time

**Three** images now build (web-ui, workers, mission-control), each a full monorepo
install plus a Next build. Budget 25–40 minutes for this deploy, not the usual 15–25.

## Env vars — set these BEFORE `pulumi up`

All 21 new vars are optional or defaulted, so **nothing crashes if you forget them** —
features just silently do not work. That is exactly why they are easy to miss.

`MISSION_CONTROL_URL` / `NEXT_PUBLIC_MISSION_CONTROL_URL` are wired automatically to
`${appUrl}/mission-control`. Nothing to do.

### Required for Claw's OAuth connectors (otherwise "Connect" fails at click time)

```bash
cd infra/compute
export PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot

# Signs the OAuth CSRF state parameter. MUST be >= 32 chars or libs/shared
# env validation rejects it at container start.
pulumi config set --secret oauthStateSecret "$(openssl rand -base64 48)" --stack nonprod

# One Google app covers Gmail, Calendar and Drive
pulumi config set        googleOauthClientId     '<id>'     --stack nonprod
pulumi config set --secret googleOauthClientSecret '<secret>' --stack nonprod

# Microsoft covers Outlook
pulumi config set        microsoftOauthClientId     '<id>'     --stack nonprod
pulumi config set --secret microsoftOauthClientSecret '<secret>' --stack nonprod

pulumi config set        notionOauthClientId     '<id>'     --stack nonprod
pulumi config set --secret notionOauthClientSecret '<secret>' --stack nonprod
```

Each provider's redirect URI must be registered in its own developer console as:
`https://d28eqq2bj0c0yk.cloudfront.net/mission-control/api/integrations/<name>/oauth/callback`

A secret is only created in Secrets Manager if its config value is set, and the
execution role's `GetSecretValue` policy is ARN-scoped and generated from the same
list — so partial configuration is safe.

### Optional tuning — only set to override the code default

Defaults live in `libs/shared/src/env.ts` and `libs/claw-studio/src/env.ts`. An entry
is emitted into the task definition **only** when the stack sets it, so the default
stays in one place.

| Pulumi config key | Env var | Default |
|---|---|---|
| `transcriptionMaxAudioMb` | `TRANSCRIPTION_MAX_AUDIO_MB` | 50 |
| `transcriptionDefaultDailyReqLimit` | `TRANSCRIPTION_DEFAULT_DAILY_REQ_LIMIT` | 1000 |
| `transcriptionDefaultDailyMinutesLimit` | `TRANSCRIPTION_DEFAULT_DAILY_MINUTES_LIMIT` | 600 |
| `transcriptionDefaultMinuteReqLimit` | `TRANSCRIPTION_DEFAULT_MINUTE_REQ_LIMIT` | 100 |
| `transcriptionUploadUrlTtlSeconds` | `TRANSCRIPTION_UPLOAD_URL_TTL_SECONDS` | 3600 |
| `transcriptionUploadRetentionDays` | `TRANSCRIPTION_UPLOAD_RETENTION_DAYS` | 7 |
| `clawMaxIterations` | `CLAW_MAX_ITERATIONS` | 30 |
| `clawWorkspaceMaxChars` | `CLAW_WORKSPACE_MAX_CHARS` | 16000 |
| `clawSelfAuthoring` | `CLAW_SELF_AUTHORING` | `all` |
| `clawMinIntervalMinutes` | `CLAW_MIN_INTERVAL_MINUTES` | 15 |
| `clawMaxActiveTasksPerTenant` | `CLAW_MAX_ACTIVE_TASKS_PER_TENANT` | 25 |
| `clawSchedulerSweepMs` | `CLAW_SCHEDULER_SWEEP_MS` | 30000 |
| `missionControlUrl` | `MISSION_CONTROL_URL` | `${appUrl}/mission-control` |

**`clawSelfAuthoring` deserves a deliberate decision.** The code default is `all`
(`libs/claw-studio/src/env.ts`), not `user` — an earlier version of this table said
`user` and nonprod was set to `user` on the strength of it, which left Claw unable
to edit its own `identity`/`soul`/`agents` at all: those three are denied outright
at the backend under `user`, and Claw answers "you are not permitted to edit soul".

The three modes are: `off` (no self-authoring), `user` (Claw may maintain what it
learns about you — `user`/`tools`/`heartbeat` — but its persona files are read-only
to it), and `all` (it may also propose edits to `identity`/`soul`/`agents`).
`all` is NOT unguarded: those three stay approval-gated per slug in
`claw-deep-agent.ts`, so it widens what Claw may PROPOSE, never what it changes
without being asked.

## Database migrations

**10 pending migrations** will apply automatically — both `apps/web-ui/docker-entrypoint.sh`
and `apps/workers/docker-entrypoint.sh` run `prisma migrate deploy` at container start.
There is no manual step and no gate.

Verified beforehand:

- nonprod had 25 applied, repo has 32 → 10 pending (9 Claw + 1 Transcription).
- nonprod carries **3 migrations that are not in the repo** —
  `20260630120000_add_user_connections`, `20260701000000_add_slack_workspaces`,
  `20260702000000_add_user_connector_credentials`, from `feature/voice-agents` /
  `web-search`, deployed but never merged. Reproduced this exact state in a scratch
  container: `migrate deploy` exits 0 and ignores them. **It will not block the deploy.**
- No table-name collision between those 3 and the 10 pending.

### ⚠️ Whenever you write a new migration after this

`prisma migrate dev` emits these at the top of **every** generated migration:

```sql
DROP INDEX "claw_memories_embedding_hnsw";
DROP INDEX "idx_document_chunks_embedding";
```

Prisma cannot model HNSW indexes on `Unsupported("vector(...)")` columns, so it reads
them as drift. **Delete those lines before committing.** Shipping them silently
degrades Claw memory recall and knowledge-base search to sequential scans — no error,
just wrong. `prisma/migrations/20260715055000_restore_document_chunks_embedding_index`
exists because this has already happened twice. `bun run check:indexes` catches it.

## Mission Control

New third service. Served at **`https://d28eqq2bj0c0yk.cloudfront.net/mission-control`**
via a listener rule at priority 10 on the existing ALB; the listener's default action
still forwards to web-ui, so web-ui routing is untouched. CloudFront needs no change —
caching is already disabled with all headers and cookies forwarded.

It runs under Next.js `basePath: '/mission-control'`, so `/mission-control/api/health`
is the health-check path — the un-prefixed `/api/health` is a 404 and would never pass.

Its NextAuth signing key is separate from web-ui's (`${appName}/mission-control-nextauth-secret`),
and its session cookies are namespaced, because both apps run NextAuth on the same
origin and would otherwise overwrite each other's session on every login.

Log in with the Studio ID and password from web-ui's Claw Studio page.

## Post-deploy verification

```bash
AWS_PROFILE=omar-testing-saas-chatbot aws ecs describe-services \
  --cluster chatflow-nonprod-ecs-cluster \
  --services chatflow-nonprod-web-ui-service \
             chatflow-nonprod-workers-service \
             chatflow-nonprod-mission-control-service \
  --region us-east-1 \
  --query "services[*].{name:serviceName,status:status,desired:desiredCount,running:runningCount,pending:pendingCount}" \
  --output table

# web-ui still serves the root
curl -s -o /dev/null -w "web-ui:          %{http_code}\n" https://d28eqq2bj0c0yk.cloudfront.net
# Mission Control health
curl -s -w "\n" https://d28eqq2bj0c0yk.cloudfront.net/mission-control/api/health
# Mission Control login page renders
curl -s -o /dev/null -w "mission-control: %{http_code}\n" https://d28eqq2bj0c0yk.cloudfront.net/mission-control/login
```

Then confirm the migrations landed **and the vector indexes survived** — port-forward
through the bastion (note: new instance id after the replacement, look it up):

```bash
BASTION=$(AWS_PROFILE=omar-testing-saas-chatbot aws ec2 describe-instances \
  --filters 'Name=tag:Name,Values=chatflow-nonprod-bastion' 'Name=instance-state-name,Values=running' \
  --query 'Reservations[0].Instances[0].InstanceId' --output text --region us-east-1)

AWS_PROFILE=omar-testing-saas-chatbot aws ssm start-session --target "$BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["chatflow-nonprod-postgres.cfsuk8eescim.us-east-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["5455"]}'
```

Then in another shell, against `localhost:5455`:

```sql
-- Expect 35, NOT 32. The repo has 32 migration directories, of which 22 were
-- already applied and 10 are pending. nonprod also carries the 3 phantom rows
-- described above, which stay in the table: 22 + 10 + 3 = 35.
select count(*) from _prisma_migrations where finished_at is not null;
select count(*) from information_schema.tables
  where table_schema='public' and table_name like 'transcription%';     -- expect 9
select count(*) from information_schema.tables
  where table_schema='public' and table_name like 'claw%';              -- expect 15
select indexname from pg_indexes
  where indexname in ('claw_memories_embedding_hnsw','idx_document_chunks_embedding');
  -- BOTH must be present. If either is missing, semantic search is silently degraded.
```

The bastion cannot read Secrets Manager and has no `psql` — fetch
`chatflow-nonprod/database-url` locally and connect through the tunnel from your machine.

## Watch the worker logs on first start

`MISSION_CONTROL_URL` is now a real URL rather than `localhost:3010`, but the Claw
scheduler's notifier path has not been exercised in ECS before. Check
`/ecs/chatflow-nonprod-workers` for errors from the scheduler sweep after deploy.

## Known gaps carried into this deploy

- `apps/mission-control` has **no autoscaling policy** (web-ui has CPU + memory target
  tracking). Fixed `desiredCount: 1`. Fine for nonprod; revisit for prod.
- Mission Control audit rows record the actor as `'unknown'` — see
  `docs/superpowers/claw-studio-known-issues.md` entry 13.
- Transcription upload uses S3 presigned POST, so external clients upload directly to
  the app bucket. **Bucket CORS has not been verified** — if browser uploads fail with
  a CORS error, that is why.

---

# Deployment outcome 2026-08-03 — Claw Studio + Transcription Studio + Mission Control

Applied. **chatflow-nonprod is live and verified**, including Mission Control's first
ever run in ECS. It took four `pulumi up` runs: two genuine bugs neither the preview
nor any test could surface, and one local-machine failure.

## Result

| | |
|---|---|
| Final run | 12 changes, **0 errors**, 7m07s |
| web-ui | 1/1 running, task def `:14` |
| workers | 1/1 running, task def `:16` |
| mission-control | 1/1 running, task def `:1` |
| `/` | 200 |
| `/mission-control/api/health` | 200, `{"status":"healthy","database":"connected"}` |
| `/mission-control/login` | 200 |

Pulumi config set before the first run, as the pre-deployment section requires:
`oauthStateSecret`, `google/microsoft/notionOauthClientId` + `…Secret`, and
`clawSelfAuthoring: all` (set explicitly rather than inherited). These are now
committed in `Pulumi.nonprod.yaml`.

## Error #4 — workers image: claw-studio was never linked

First `pulumi up` died after 14m29s, 2 errored:

```
src/jobs/claw-gateway-run/handler.ts(24,80): error TS2307: Cannot find module '@chatbot/claw-studio'
src/jobs/claw-scheduler/handler.ts(19,47):   error TS2307: Cannot find module '@chatbot/claw-studio'
src/jobs/claw-scheduler/register.ts(43,20):  error TS2307: Cannot find module '@chatbot/claw-studio'
```

`apps/workers/Dockerfile` compiles each workspace lib and hand-writes a
`node_modules/@chatbot/<lib>/package.json`. `claw-studio` never got a block, so the
three new claw job files could not resolve it. **This is Error #3 recurring** — same
root cause, different lib. The `workers` Dockerfile is not automatic; every lib that
lands in `apps/workers/src` needs its own block.

The other two reported errors (`web-ui-image`, `mission-control-image`,
*"grpc: the client connection is closing"*) were collateral from the aborted run.

**State left behind:** the ALB listener rule and target group for Mission Control were
created, but its ECS service was not, because its image never built. `/mission-control/*`
therefore returned **503** — a path that previously fell through to web-ui — until the
next successful deploy. web-ui and workers kept serving their existing task definitions
throughout.

## Error #5 — Claw scheduler sweep failed every 30s after a *successful* deploy

The second run succeeded (13 changes, 0 errors, 19m14s) and everything was healthy.
The worker logs were not:

```
{"level":50,"context":"claw-scheduler","msg":"Sweep failed",
 "error":"ResolveMessage: Cannot find module '@chatbot/agent-studio/services/mcp-server-service'
          from '/app/node_modules/@chatbot/claw-studio/src/mcp/mcp-tools.js'"}
```

Linking claw-studio fixed the *build*; this broke at *runtime*. The hand-written
`exports` map for agent-studio declared only `"."` and `"./server"`, but
`libs/claw-studio/src/mcp/mcp-tools.ts` imports two deep subpaths
(`services/mcp-server-service`, `services/mcp-client.service`). TypeScript emits those
specifiers **extensionless**, so the map needs `"./*": "./src/*.js"` — with the `.js`.

Only `apps/workers` is affected: web-ui and mission-control resolve these through
Next's `transpilePackages` + tsconfig paths, never through a written exports map.

Both fixes are in `39ea90c`.

### How to catch this class of bug without a 20-minute deploy

Enumerate cross-package specifiers in the **compiled** output, not the source, so every
missing subpath surfaces at once instead of one per deploy:

```bash
grep -rhoE "from '@chatbot/[^']+'" dist/out-tsc/libs/<lib>/src | sort -u
```

Then prove resolution in a real container before deploying:

```bash
docker build --target builder --platform linux/arm64 -f apps/workers/Dockerfile -t wv .
docker run --rm --entrypoint sh wv -c \
  'bun -e "import(\"@chatbot/agent-studio/services/mcp-server-service\").then(()=>console.log(\"RESOLVED\"))"'
```

A bare container fails `@chatbot/claw-studio` with *"Invalid environment variables"* —
that is T3 Env rejecting an empty environment, which means the module **did** resolve.
Not a failure.

## Error #6 — buildkit `input/output error` (local machine, not AWS)

The third run failed in ~5 minutes:

```
failed to create temp dir: mkdir /tmp/buildkit-mount...: input/output error
write /var/lib/buildkit/runc-overlayfs/metadata_v2.db: input/output error
```

The build host's disk was full (127Mi free of 228Gi) after repeated full image builds.
`docker builder prune -af` cannot repair this on its own — buildkit needs to write its
own metadata DB to prune, and it cannot. **Restart Docker Desktop first, then prune.**
That recovered 17.25GB and the next run succeeded.

nonprod was untouched by this failure: pulumi aborts and the existing images keep
serving. Budget disk before deploying — three cold images need roughly 15GB.

## Verification performed

Migrations applied themselves at container start, as designed:
`All migrations have been successfully applied.` (10 of them).

The bastion was replaced twice during these runs and its SSM agent stayed
**`ConnectionLost`** for 40+ minutes afterwards, so the documented port-forward was
unavailable. The database checks were run instead as a one-off read-only Fargate task
on the `ephemeral-worker` task definition — no bastion, no psql, no writes:

```bash
aws ecs run-task --cluster chatflow-nonprod-ecs-cluster \
  --task-definition chatflow-nonprod-ephemeral-worker-task --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[<private>],securityGroups=[<workers-sg>],assignPublicIp=DISABLED}' \
  --overrides file://overrides.json     # command override running read-only SELECTs
```

Result, matching the pre-deployment predictions exactly:

```json
{"indexes":["claw_memories_embedding_hnsw","idx_document_chunks_embedding"],
 "migrations":35,"transcriptionTables":9,"clawTables":15}
```

**Both HNSW indexes survived.** Note `20260715054818_add_claw_studio` really does
`DROP INDEX "idx_document_chunks_embedding"`; `20260715055000_restore_document_chunks_embedding_index`
recreates it immediately after, and `20260716085055_add_claw_memory` recreates both with
`IF NOT EXISTS`. The net effect is correct, but only because those restore migrations exist.

Worker health after the final deploy: task `:16`, **zero** error-level log lines, the
scheduler sweeping cleanly every 30s. The old task's failures continue in CloudWatch
until it finishes draining — check the task id before concluding a fix did not work.

## Outstanding after this deployment

- **OAuth redirect URIs are not registered.** Until each is added in its provider's own
  console, "Connect" fails at click time; no redeploy can fix it:
  - `…/mission-control/api/integrations/gmail/oauth/callback`
  - `…/mission-control/api/integrations/google_calendar/oauth/callback`
  - `…/mission-control/api/integrations/google_drive/oauth/callback`
  - `…/mission-control/api/integrations/outlook/oauth/callback`
  - `…/mission-control/api/integrations/notion/oauth/callback`
- **Bastion SSM is down** (`i-0f1db97d888501302`, `ConnectionLost`). Database access via
  port-forward is unavailable until it is fixed or replaced.
- **Known issue #15 applies here.** nonprod's `llm_providers.embeddingModel` must be
  `amazon.titan-embed-text-v2:0`. On Titan G1 every Claw memory write fails with
  *expected 1024 dimensions, not 1536*, is caught, logged as WARN, and chat still returns
  200 — Claw appears to learn and does not.
- **Prod needs the Dockerfile fix.** `stx-chatflow-prod` shares `apps/workers/Dockerfile`
  and will fail to build in exactly the same way the next time its workers image is built.
- One pending CREATE operation remains in stack state from the interrupted first run
  (`awsx:ecr:Image`). It did not block any subsequent deploy. Clearing it needs an
  interactive `pulumi refresh`.
