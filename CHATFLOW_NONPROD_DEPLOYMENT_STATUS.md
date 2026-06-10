# Deployment Status Report — chatflow-nonprod — 2026-06-10

## Environment

- **AWS Account**: 970547372609
- **AWS Profile**: omar-testing-saas-chatbot
- **Region**: us-east-1
- **Pulumi Stacks**: `chatbot-networking-nonprod`, `chatbot-compute-nonprod` (new — separate from prod's `prod` stacks)
- **App Name**: `chatflow-nonprod` (prod app name remains `chatbot`, untouched)
- **CloudFront URL**: https://d28eqq2bj0c0yk.cloudfront.net

---

## Issues Found & Fixed

### 1. AWS Elastic IP limit exceeded (FIXED)

- **Problem**: Networking stack `pulumi up` failed creating the second NAT
  gateway's EIP — `AddressLimitExceeded: The maximum number of addresses has
  been reached`. 32/36 resources created, 2 errored.
- **Fix**: Made NAT gateway strategy configurable in `infra/networking/index.ts`
  (`natStrategy: "single"` → 1 NAT gateway / 1 EIP instead of 2). Set
  `chatbot-networking:natStrategy: single` in `Pulumi.nonprod.yaml`.
- **Status**: Deployed. Networking stack fully complete — 36/36 resources.
  VPC `vpc-03b09500a0b2b247d`, CIDR `10.0.0.0/16`.

### 2. RDS Postgres engine version 16.6 not available (FIXED)

- **Problem**: Compute stack `pulumi up` failed creating the RDS instance —
  `InvalidParameterCombination: Cannot find version 16.6 for postgres`. AWS no
  longer offers 16.6 in `us-east-1` (only 16.9–16.14 available). 48/68
  resources created, 2 errored.
- **Fix**: Changed `engineVersion: "16.6"` → `"16.9"` in
  `infra/compute/index.ts`.
- **Status**: Deployed. Postgres instance created —
  `chatflow-nonprod-postgres.cfsuk8eescim.us-east-1.rds.amazonaws.com`.

### 3. Postgres dbName/username contained invalid hyphen (FIXED)

- **Problem**: `dbName` and `username` were set directly to `appName`
  (`"chatflow-nonprod"`), but Postgres identifiers can't contain hyphens. This
  would have errored on the next attempt.
- **Fix**: Added `dbIdentifier = appName.replace(/-/g, "_")` in
  `infra/compute/index.ts`, used for `dbName`, `username`
  (`chatflow_nonprod` / `chatflow_nonprod_admin`), and the connection-string
  secret. No effect on prod (`appName === "chatbot"` has no hyphen).
- **Status**: Deployed.

### 4. Workers Docker image build failed — TypeScript compile error (FIXED)

- **Problem**: `bunx tsc --project tsconfig.build.json` exited with code 2
  inside the `apps/workers` Docker build:
  ```
  error TS2307: Cannot find module '@chatbot/agent-studio/server'
  ```
  A recent `main` merge added the `agent-studio` feature (graph-based agent
  execution), which `apps/workers` now imports — along with its dependencies
  `@chatbot/telegram` and `@chatbot/whatsapp`. The Dockerfile pre-builds
  `shared`/`ai`/`knowledge-base` into `node_modules/@chatbot/*` for the
  workers `tsc` build, but had no equivalent step for the new libraries.
  **This is a pre-existing bug on `main`/prod too** — verified by reproducing
  the same error in the `main` worktree.
- **Fix**: Added build steps to `apps/workers/Dockerfile` to copy
  `telegram`/`whatsapp` (raw TS, no build) and compile+link `agent-studio`
  into `node_modules/@chatbot/*`, matching the existing pattern. Verified via
  a scratch-directory replication of the Docker steps — `tsc` now compiles
  with zero errors.
- **Status**: Deployed. Both `web-ui` and `workers` Docker images built and
  pushed successfully.

### 5. `appUrl` placeholder (FIXED)

- **Problem**: `chatbot-compute:appUrl` was `https://placeholder.cloudfront.net`
  (unknown until first deploy completed), used for Cognito callback/logout
  URLs and `NEXT_PUBLIC_APP_URL`.
- **Fix**: Updated `infra/compute/Pulumi.nonprod.yaml` to the real CloudFront
  URL `https://d28eqq2bj0c0yk.cloudfront.net` and re-ran `pulumi up`.
- **Status**: Deployed (~2.5 min, config-only update + rolling ECS deploy).

---

## Current Status — All Healthy ✅

| Resource | Value |
|---|---|
| **App URL (CloudFront)** | https://d28eqq2bj0c0yk.cloudfront.net (HTTP 200) |
| CloudFront Distribution ID | `E195OTQC1UAF3B` |
| ECS Cluster | `chatflow-nonprod-ecs-cluster` |
| web-ui service | 2/2 tasks running |
| workers service | 1/1 task running |
| RDS Postgres | 16.9, `chatflow-nonprod-postgres.cfsuk8eescim.us-east-1.rds.amazonaws.com` |
| ECR repos | `chatflow-nonprod-web-ui`, `chatflow-nonprod-workers` |
| Cognito User Pool | `us-east-1_eOUTu6GIT` |
| S3 app bucket | `chatflow-nonprod-970547372609-us-east-1` |
| VPC | `vpc-03b09500a0b2b247d` (single NAT gateway) |

**Existing prod environment (`chatbot-ecs-cluster`,
https://dhdaqqvh7yj46.cloudfront.net) was not modified at any point.**

---

## Files Modified

| File | Change | Committed? |
|------|--------|------------|
| `infra/networking/index.ts` | `appName` + `natStrategy` configurable | Yes (`4dd47b9`) |
| `infra/networking/Pulumi.nonprod.yaml` | New stack config | Yes (`4dd47b9`) |
| `infra/compute/index.ts` | Dynamic stack reference, `appName` configurable | Yes (`4dd47b9`) |
| `infra/compute/Pulumi.nonprod.yaml` | New stack config (incl. final `appUrl`) | No |
| `infra/compute/index.ts` | Engine version 16.6→16.9, `dbIdentifier` sanitization | No |
| `apps/workers/Dockerfile` | Added agent-studio/telegram/whatsapp build steps | No |

---

## Recommended Next Steps

1. Commit the remaining uncommitted infra/Dockerfile changes (see table above)
   on `omar-updating-graph-agent`.
2. Consider porting the `apps/workers/Dockerfile` fix to `main`/prod
   independently — it's a real bug that will block any future prod `workers`
   image rebuild.
3. Before ever running this code against the `prod` stack, run
   `pulumi preview --stack prod` first and check the `aws:rds:Instance
   (postgres)` diff — the `engineVersion: 16.9` change would attempt to
   upgrade the live prod database in place. Either schedule that upgrade
   deliberately or make `engineVersion` stack-configurable and pin prod to
   `16.6` for now.
4. See `infra/CHATFLOW_NONPROD_DEPLOYMENT.md` for full step-by-step deployment
   history and detailed redeploy instructions for both nonprod and prod.
