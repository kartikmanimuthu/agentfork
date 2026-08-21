# stx-chatflow-prod Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a new, fully isolated production environment for this chatbot on AWS account `842675988009` ("STX-APPLICATION-PLATFORM"), as an ECS cluster named `stx-chatflow-prod-ecs-cluster` in `ap-south-1`, without touching any existing resource on that account or in the current account (`970547372609`).

**Architecture:** New sibling Pulumi projects (`infra/stx-chatflow-prod/networking`, `infra/stx-chatflow-prod/compute`) with symlinked infra code (one source of truth) but their own `Pulumi.yaml`/`Pulumi.prod.yaml` pointing at a brand-new S3 state bucket in the new account. `infra/networking/index.ts` gets a small backward-compatible change to make region/AZ configurable (currently hardcoded to `us-east-1`).

**Tech Stack:** Pulumi (TypeScript, nodejs runtime), AWS (VPC, ECS Fargate, RDS Postgres 16, ECR, ALB, CloudFront, Cognito, Secrets Manager), Bun.

Reference spec: `docs/superpowers/specs/2026-07-07-stx-chatflow-prod-deployment-design.md`

## Global Constraints

- **Never run `git commit` without explicit user confirmation immediately before that specific commit** (per this user's global CLAUDE.md — "Never commit unless I explicitly ask"). `git add`/staging is fine; every "Commit" step below means "stage, then ask the user before committing."
- **Every `pulumi up` is preceded by `pulumi preview` and a human review of the diff.** Never run `pulumi up --yes` blind, especially against the new account.
- **Every command targeting the new account must explicitly set `AWS_PROFILE=stx-chatflow-prod-deployment`.** Never rely on a default/ambient profile when operating on account `842675988009`.
- **Never reference, modify, or run any mutating command against `stx-chatbot-*`, `stx-platform-*`, `url-shortener-*`, `aws-controltower-VPC`, or any other resource not created by this plan.** All read commands against those are fine (already used during design); no write/delete commands touch them, ever.
- Target env values (all four repeat across every task below): `appName=stx-chatflow-prod`, `aws:region=ap-south-1`, `vpcCidr=10.50.0.0/16`, `availabilityZoneNames=["ap-south-1a","ap-south-1b"]`, `natStrategy=single`.
- The compute stack's Pulumi commands require `PULUMI_CONFIG_PASSPHRASE=""` (empty-passphrase secrets provider — this project's existing convention, see `infra/DEPLOYMENT.md`). The networking stack has no secrets and doesn't need it.
- This repo has no automated test suite for Pulumi infra code. "Test"/verification steps in this plan are `pulumi preview` diffs, `tsc --noEmit` typechecks, and read-only `aws` CLI checks — treat them with the same rigor as automated tests: run them, read the actual output, don't assume.

---

### Task 1: Make `infra/networking/index.ts` region/AZ-configurable, prove zero impact on existing stacks

**Files:**
- Modify: `infra/networking/index.ts:1-53` (config + VPC resource), `infra/networking/index.ts:143` (export)
- Test: no automated test — verified via `tsc --noEmit` and `pulumi preview` against the *existing* `prod`/`nonprod` stacks (must show zero changes)

**Interfaces:**
- Produces: new config key `chatbot-networking:availabilityZoneNames` (JSON string array), default `["us-east-1a","us-east-1b"]` — consumed by Task 4's `Pulumi.prod.yaml`.
- Produces: subnet CIDRs now derived from `chatbot-networking:vpcCidr` (must be a `/16`) instead of hardcoded — consumed implicitly by Task 4's deploy.
- No change to any other export (`vpcId`, `vpcCidr`, `publicSubnetIds`, `privateSubnetIds`, `databaseSubnetIds`, `intraSubnetIds`, `dbSubnetGroupName`) — `compute/index.ts` keeps consuming these unchanged.

- [ ] **Step 1: Edit the config + VPC section**

Replace lines 1–53 of `infra/networking/index.ts`:

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

// ============================================================================
// CONFIG
// ============================================================================

const config = new pulumi.Config();
// Use vpcCidrConfig to avoid duplicate identifier with the vpcCidr export below.
const vpcCidrConfig = config.get("vpcCidr") ?? "10.0.0.0/16";
const appName = config.get("appName") ?? "chatbot";
const availabilityZoneNames = config.getObject<string[]>("availabilityZoneNames") ?? ["us-east-1a", "us-east-1b"];

// ============================================================================
// VPC — 4-tier subnets with explicit CIDRs matching CDK allocation
// CDK allocates largest subnets first: Private /22 -> Public /24 -> Database /24 -> Intra /26
// Subnet CIDRs are derived from the configured vpcCidr (must be a /16), keeping
// the same relative layout CDK used for the original 10.0.0.0/16 deployment:
//   Private:  <net>.0.0/22, <net>.4.0/22
//   Public:   <net>.8.0/24, <net>.9.0/24
//   Database: <net>.10.0/24, <net>.11.0/24
//   Intra:    <net>.12.0/26, <net>.12.64/26
// For the default 10.0.0.0/16 this reproduces the original hardcoded values
// byte-for-byte (verified by hand).
// ============================================================================

function subnetCidrsFromVpcCidr(vpcCidr: string) {
    const match = vpcCidr.match(/^(\d+)\.(\d+)\.0\.0\/16$/);
    if (!match) {
        throw new Error(`vpcCidr must be a /16 in the form X.Y.0.0/16, got: ${vpcCidr}`);
    }
    const net = `${match[1]}.${match[2]}`;
    return {
        private: [`${net}.0.0/22`, `${net}.4.0/22`],
        public: [`${net}.8.0/24`, `${net}.9.0/24`],
        database: [`${net}.10.0/24`, `${net}.11.0/24`],
        intra: [`${net}.12.0/26`, `${net}.12.64/26`],
    };
}

const subnetCidrs = subnetCidrsFromVpcCidr(vpcCidrConfig);

const vpc = new awsx.ec2.Vpc(`${appName}-vpc`, {
    cidrBlock: vpcCidrConfig,
    availabilityZoneNames: availabilityZoneNames,
    enableDnsHostnames: true,
    enableDnsSupport: true,
    natGateways: { strategy: config.get("natStrategy") === "single" ? "Single" : "OnePerAz" },
    subnetSpecs: [
        {
            type: "Private",
            name: "private",
            cidrBlocks: subnetCidrs.private,
        },
        {
            type: "Public",
            name: "public",
            cidrBlocks: subnetCidrs.public,
        },
        {
            type: "Isolated",
            name: "database",
            cidrBlocks: subnetCidrs.database,
        },
        {
            type: "Isolated",
            name: "intra",
            cidrBlocks: subnetCidrs.intra,
        },
    ],
    tags: { Name: `${appName}-vpc` },
});
```

Then update the `availabilityZones` export (currently line 143):

```typescript
export const availabilityZones = pulumi.output(availabilityZoneNames);
```

(replacing `export const availabilityZones = pulumi.output(["us-east-1a", "us-east-1b"]);`)

- [ ] **Step 2: Typecheck**

Run: `cd infra/networking && bunx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 3: Prove zero diff on the existing `prod` stack**

Run:
```bash
cd infra/networking
AWS_PROFILE=PLATFORM-ADMIN pulumi preview --stack prod
```
(Use whichever profile is actually configured for the real `prod` stack — `infra/DEPLOYMENT.md` documents it as `PLATFORM-ADMIN`; confirm with the user if that profile isn't set up locally.)

Expected: `Resources: X unchanged` with **zero** to add/update/delete. If anything shows a diff, stop — do not proceed to Task 2 until this is a true no-op.

- [ ] **Step 4: Prove zero diff on the existing `nonprod` stack**

Run:
```bash
AWS_PROFILE=omar-testing-saas-chatbot pulumi preview --stack nonprod
```
Expected: same — zero changes.

- [ ] **Step 5: Prove zero diff on `infra/compute` (consumes the `availabilityZones` output)**

Run:
```bash
cd ../compute
AWS_PROFILE=PLATFORM-ADMIN pulumi preview --stack prod
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=omar-testing-saas-chatbot pulumi preview --stack nonprod
```
Expected: zero changes on both.

- [ ] **Step 6: Stage (do not commit)**

```bash
git add infra/networking/index.ts
```
Ask the user before running `git commit`.

---

### Task 2: Make `infra/bootstrap/bootstrap.sh` reusable for a second AWS account

**Files:**
- Modify: `infra/bootstrap/bootstrap.sh:10-12`

**Interfaces:**
- Produces: script now honors `BUCKET_NAME`, `REGION`, `PROFILE` env var overrides (falling back to the original hardcoded defaults), used by Task 3.

- [ ] **Step 1: Edit the three hardcoded variables**

Replace:
```bash
BUCKET_NAME="chatbot-pulumi-state"
REGION="us-east-1"
PROFILE="PLATFORM-ADMIN"
```
with:
```bash
BUCKET_NAME="${BUCKET_NAME:-chatbot-pulumi-state}"
REGION="${REGION:-us-east-1}"
PROFILE="${PROFILE:-PLATFORM-ADMIN}"
```

- [ ] **Step 2: Syntax check**

Run: `bash -n infra/bootstrap/bootstrap.sh`
Expected: no output, exit code 0.

- [ ] **Step 3: Stage (do not commit)**

```bash
git add infra/bootstrap/bootstrap.sh
```
Ask the user before running `git commit`.

---

### Task 3: Bootstrap the Pulumi S3 state bucket in the new account

**⚠️ First real write against account `842675988009`.** Confirm with the user immediately before Step 2.

**Files:** none (AWS-side only)

- [ ] **Step 1: Confirm the bucket name is available**

```bash
aws s3api head-bucket --bucket stx-chatflow-prod-pulumi-state --profile stx-chatflow-prod-deployment 2>&1
```
Expected: `Not Found` / 404 (bucket doesn't exist anywhere yet — S3 names are global, so this also rules out a name collision with another AWS customer). If it already exists, stop and pick a different name with the user (e.g. append a short suffix).

- [ ] **Step 2: Run the bootstrap script against the new account**

```bash
cd infra/bootstrap
BUCKET_NAME=stx-chatflow-prod-pulumi-state REGION=ap-south-1 PROFILE=stx-chatflow-prod-deployment bash bootstrap.sh
```
Expected output ends with:
```
Bootstrap complete.
  S3 bucket: stx-chatflow-prod-pulumi-state (versioning enabled, public access blocked)
  Pulumi backend: s3://stx-chatflow-prod-pulumi-state
```

- [ ] **Step 3: Verify versioning and public access block**

```bash
aws s3api get-bucket-versioning --bucket stx-chatflow-prod-pulumi-state --profile stx-chatflow-prod-deployment --region ap-south-1
aws s3api get-public-access-block --bucket stx-chatflow-prod-pulumi-state --profile stx-chatflow-prod-deployment --region ap-south-1
```
Expected: `{"Status": "Enabled"}` and all four `PublicAccessBlockConfiguration` values `true`.

---

### Task 4: Scaffold and deploy the `stx-chatflow-prod` networking stack

**Files:**
- Create: `infra/stx-chatflow-prod/networking/Pulumi.yaml`
- Create: `infra/stx-chatflow-prod/networking/Pulumi.prod.yaml`
- Create (symlinks): `infra/stx-chatflow-prod/networking/index.ts`, `package.json`, `package-lock.json`, `bun.lock` → the corresponding files in `infra/networking/`

**Interfaces:**
- Produces: stack outputs `vpcId`, `vpcCidr`, `publicSubnetIds`, `privateSubnetIds`, `databaseSubnetIds`, `intraSubnetIds`, `availabilityZones`, `dbSubnetGroupName` — consumed by Task 5's compute stack via `StackReference("organization/chatbot-networking/prod")`.

- [ ] **Step 1: Create the directory and symlinks**

```bash
mkdir -p infra/stx-chatflow-prod/networking
cd infra/stx-chatflow-prod/networking
ln -s ../../networking/index.ts index.ts
ln -s ../../networking/package.json package.json
ln -s ../../networking/package-lock.json package-lock.json
ln -s ../../networking/bun.lock bun.lock
ls -la
```
Expected: four symlinks listed, each pointing at `../../networking/<file>`.

- [ ] **Step 2: Write `Pulumi.yaml`**

```yaml
name: chatbot-networking
runtime: nodejs
description: stx-chatflow-prod — VPC and networking (isolated AWS account 842675988009)
backend:
  url: s3://stx-chatflow-prod-pulumi-state?region=ap-south-1&awssdk=v2
```

(Project `name:` intentionally matches the existing `chatbot-networking` — `compute/index.ts` hardcodes `StackReference("organization/chatbot-networking/${pulumi.getStack()}")`; keeping the name identical means zero code changes are needed for the compute stack to find this networking stack. Safe because the backend bucket is entirely separate.)

- [ ] **Step 3: Write `Pulumi.prod.yaml`**

```yaml
config:
  aws:region: ap-south-1
  chatbot-networking:vpcCidr: 10.50.0.0/16
  chatbot-networking:appName: stx-chatflow-prod
  chatbot-networking:natStrategy: single
  chatbot-networking:availabilityZoneNames:
    - ap-south-1a
    - ap-south-1b
```

- [ ] **Step 4: Log in to the new backend and init the stack**

```bash
cd infra/stx-chatflow-prod/networking
pulumi login "s3://stx-chatflow-prod-pulumi-state?region=ap-south-1&awssdk=v2"
AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack init prod
```
Expected: `Created stack 'prod'`.

- [ ] **Step 5: Install dependencies**

```bash
bun install
```
Expected: `node_modules/` created in this directory (real directory, not a symlink) with `@pulumi/aws`, `@pulumi/awsx`, `@pulumi/pulumi` installed.

- [ ] **Step 6: Preview**

```bash
AWS_PROFILE=stx-chatflow-prod-deployment pulumi preview --stack prod
```
Expected: a plan to create ~36 resources (VPC, 8 subnets, NAT gateway + EIP, route tables, S3 gateway endpoint, DB subnet group — matching the nonprod deploy's resource count from `infra/CHATFLOW_NONPROD_DEPLOYMENT.md`). Review the plan — confirm every resource name is prefixed `stx-chatflow-prod-` and the VPC CIDR is `10.50.0.0/16`. **Do not proceed if anything looks like it references an existing resource.**

- [ ] **Step 7: Apply — ask the user to confirm before typing `yes`**

```bash
AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack prod
```
Review the interactive diff one more time, then confirm.
Expected: all resources created, 0 errors.

- [ ] **Step 8: Verify the VPC**

```bash
AWS_PROFILE=stx-chatflow-prod-deployment aws ec2 describe-vpcs --region ap-south-1 \
  --filters "Name=tag:Name,Values=stx-chatflow-prod-vpc" \
  --query "Vpcs[0].{VpcId:VpcId,CIDR:CidrBlock}" --output table
```
Expected: CIDR `10.50.0.0/16`.

- [ ] **Step 9: Stage the new files (do not commit)**

```bash
git add infra/stx-chatflow-prod/networking/
```
Ask the user before running `git commit`.

---

### Task 5: Scaffold and deploy the `stx-chatflow-prod` compute stack (placeholder appUrl)

**Files:**
- Create: `infra/stx-chatflow-prod/compute/Pulumi.yaml`
- Create: `infra/stx-chatflow-prod/compute/Pulumi.prod.yaml`
- Create (symlinks): `infra/stx-chatflow-prod/compute/index.ts`, `package.json`, `package-lock.json`, `bun.lock`, `tsconfig.json` → the corresponding files in `infra/compute/`

**Interfaces:**
- Consumes: Task 4's networking stack outputs via `StackReference("organization/chatbot-networking/prod")`.
- Produces: stack outputs `cloudFrontUrl`, `ecsClusterName`, `postgresEndpoint`, `bastionInstanceId`, `webUiServiceName`, `workersServiceName` (per `infra/DEPLOYMENT.md`'s output table) — consumed by Task 6.

- [ ] **Step 1: Create the directory and symlinks**

```bash
mkdir -p infra/stx-chatflow-prod/compute
cd infra/stx-chatflow-prod/compute
ln -s ../../compute/index.ts index.ts
ln -s ../../compute/package.json package.json
ln -s ../../compute/package-lock.json package-lock.json
ln -s ../../compute/bun.lock bun.lock
ln -s ../../compute/tsconfig.json tsconfig.json
```

- [ ] **Step 2: Sanity-check that `repoRoot` resolution still works through the symlink**

`compute/index.ts` computes `const repoRoot = path.resolve(__dirname, "../..")`. Node dereferences symlinks by default, so `__dirname` should resolve to the *real* `infra/compute` path, not this symlinked directory — meaning `repoRoot` still correctly resolves to the actual repo root. Verify before trusting a 20-minute Docker build to it:

```bash
node -e "console.log(require('path').resolve(require('path').dirname(require('fs').realpathSync('index.ts')), '../..'))"
```
Expected: prints the absolute path to the repo root (e.g. `/Users/.../multi-tenant-SaaS-Chatbot/infra/stx-prod-deployment`), NOT a path containing `stx-chatflow-prod`. If it prints the wrong path, stop — this needs investigating before Step 7.

- [ ] **Step 3: Write `Pulumi.yaml`**

```yaml
name: chatbot-compute
runtime: nodejs
description: stx-chatflow-prod — ECS, RDS, Cognito, CloudFront (isolated AWS account 842675988009)
backend:
  url: s3://stx-chatflow-prod-pulumi-state?region=ap-south-1&awssdk=v2
```

- [ ] **Step 4: Write `Pulumi.prod.yaml`**

```yaml
config:
  aws:region: ap-south-1
  chatbot-compute:appName: stx-chatflow-prod
  chatbot-compute:appUrl: https://placeholder.cloudfront.net
  chatbot-compute:subscriptionEmails: ""
```

- [ ] **Step 5: Init the stack**

```bash
cd infra/stx-chatflow-prod/compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack init prod --secrets-provider=passphrase
```
Expected: `Created stack 'prod'`.

- [ ] **Step 6: Install dependencies**

```bash
bun install
```

- [ ] **Step 7: Preview**

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi preview --stack prod
```
Expected: a plan to create ~68 resources (Cognito, RDS, S3, SNS, bastion, ECR, ECS cluster + services, ALB, CloudFront, IAM, Secrets Manager — per `infra/DEPLOYMENT.md`'s "This deploys everything" list). Confirm:
- `requireOutput()` successfully resolved the Task 4 networking stack (no "stack not found" error)
- Every resource name is prefixed `stx-chatflow-prod-`
- RDS `engineVersion` shows `16.13` (already confirmed available in `ap-south-1` in the design phase)

- [ ] **Step 8: Apply — ask the user to confirm before typing `yes`**

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack prod
```
Expected: ~15–25 minutes (RDS provisioning + two Docker image builds for `web-ui` and `workers`), 0 errors.

- [ ] **Step 9: Verify ECS services**

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack output ecsClusterName --stack prod
AWS_PROFILE=stx-chatflow-prod-deployment aws ecs describe-services --region ap-south-1 \
  --cluster stx-chatflow-prod-ecs-cluster \
  --services stx-chatflow-prod-web-ui-service stx-chatflow-prod-workers-service \
  --query "services[*].{name:serviceName,status:status,desired:desiredCount,running:runningCount}" \
  --output table
```
Expected: both services `ACTIVE`, `running == desired`.

- [ ] **Step 10: Get the CloudFront URL (needed for Task 6) and check it responds**

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack output cloudFrontUrl --stack prod
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" "$(PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack output cloudFrontUrl --stack prod)"
```
Expected: `HTTP Status: 200` (or a redirect to the login page — either is fine at this stage; Cognito callback URLs aren't correct yet since `appUrl` is still the placeholder).

- [ ] **Step 11: Stage the new files (do not commit)**

```bash
git add infra/stx-chatflow-prod/compute/
```
Ask the user before running `git commit`.

---

### Task 6: Verify Bedrock access, swap in the real CloudFront URL, final end-to-end verification

**Files:**
- Modify: `infra/stx-chatflow-prod/compute/Pulumi.prod.yaml` (`appUrl` value)

- [ ] **Step 1: Verify Bedrock invoke access works in this account/region**

Design-phase check confirmed `ap-south-1` *offers* the needed models (`list-foundation-models`); this step confirms actual invoke permission, which is a separate grant. Run a minimal, low-cost Converse call:

```bash
AWS_PROFILE=stx-chatflow-prod-deployment aws bedrock-runtime converse \
  --region ap-south-1 \
  --model-id anthropic.claude-haiku-4-5-20251001-v1:0 \
  --messages '[{"role":"user","content":[{"text":"reply with OK"}]}]' \
  --query "output.message.content[0].text" --output text
```
Expected: `OK` (or similar short reply). If this errors with `AccessDeniedException`, stop here and tell the user model access needs to be requested in the Bedrock console for account `842675988009` / region `ap-south-1` before continuing — **do not proceed to Step 2 until this succeeds.**

- [ ] **Step 2: Set the Bedrock bearer token secret (only if this app's tool-calling path needs it)**

Per `infra/CHATFLOW_NONPROD_DEPLOYMENT.md` step 12, `AWS_BEARER_TOKEN_BEDROCK` is only required when Bedrock calls route through the OpenAI-compatible `bedrock-mantle` gateway (tool/MCP calls to `moonshotai.*`/`deepseek.*` models). Ask the user for the bearer token value — **do not read it from any `.env` file** (per this project's CLAUDE.md security rule). Set it interactively so it never appears in shell history or this transcript:

```bash
cd infra/stx-chatflow-prod/compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi config set --secret bedrockBearerToken --stack prod
# (prompts for the value interactively)
```

- [ ] **Step 3: Update `appUrl` to the real CloudFront domain**

Take the value from Task 5 Step 10 and edit `infra/stx-chatflow-prod/compute/Pulumi.prod.yaml`:

```yaml
config:
  aws:region: ap-south-1
  chatbot-compute:appName: stx-chatflow-prod
  chatbot-compute:appUrl: https://<actual-cloudfront-domain>.cloudfront.net
  chatbot-compute:subscriptionEmails: ""
```

- [ ] **Step 4: Preview and apply**

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi preview --stack prod
```
Expected: a small diff — Cognito callback/logout URLs and the ECS task definition's `NEXT_PUBLIC_APP_URL` env var change, plus the new `bedrockBearerToken` secret if Step 2 ran. No unrelated resources touched.

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack prod
```
Expected: ~2–5 minutes (config-only update + rolling ECS deploy, no Docker rebuild).

- [ ] **Step 5: Final end-to-end verification**

```bash
AWS_PROFILE=stx-chatflow-prod-deployment aws ecs describe-services --region ap-south-1 \
  --cluster stx-chatflow-prod-ecs-cluster \
  --services stx-chatflow-prod-web-ui-service stx-chatflow-prod-workers-service \
  --query "services[*].{name:serviceName,status:status,desired:desiredCount,running:runningCount}" \
  --output table

curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" https://<actual-cloudfront-domain>.cloudfront.net
```
Expected: both services `running == desired`, HTTP 200. Then have the user open the URL in a browser and confirm login/chat works end-to-end — this is the point where "done" can actually be claimed.

- [ ] **Step 6: Stage the config change (do not commit)**

```bash
git add infra/stx-chatflow-prod/compute/Pulumi.prod.yaml
```
Ask the user before running `git commit`. Once they approve, this is also the point to ask whether they want the whole `stx-chatflow-prod` addition (Tasks 1–6) committed as one commit or several.
