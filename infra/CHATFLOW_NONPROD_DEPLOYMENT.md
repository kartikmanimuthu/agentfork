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
