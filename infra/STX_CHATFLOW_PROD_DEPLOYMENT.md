# stx-chatflow-prod Deployment — Full Record

## Goal

Create a brand-new, fully isolated **production** AWS environment
("stx-chatflow-prod") on a **different AWS account** — `842675988009`
("STX-APPLICATION-PLATFORM") — as an ECS cluster, without touching:

- the existing `chatbot`/`chatflow-nonprod` environments in the current
  account (`970547372609`), or
- any pre-existing service already running on the new shared platform
  account (`stx-chatbot-*`, `stx-platform-help-center`,
  `stx-platform-foo-share`, `url-shortener-*`, etc.)

- New app name: `stx-chatflow-prod`
- New AWS account: `842675988009`, profile `stx-chatflow-prod-deployment`
- New region: `ap-south-1` (matches this account's existing footprint and
  this repo's own default `AWS_REGION`)
- New Pulumi state bucket: `s3://stx-chatflow-prod-pulumi-state` (separate
  from `chatbot-pulumi-state` — a different account needs its own bucket;
  S3 bucket names are global, so the name also had to differ)
- New sibling Pulumi projects: `infra/stx-chatflow-prod/networking`,
  `infra/stx-chatflow-prod/compute` — code symlinked from
  `infra/networking`/`infra/compute` (one source of truth), only
  `Pulumi.yaml`/`Pulumi.<stack>.yaml` are real, separate files
- Pulumi stack name: `stx-chatflow-prod` (initially created as `prod`,
  renamed for clarity — see step 8)

Design spec: `docs/superpowers/specs/2026-07-07-stx-chatflow-prod-deployment-design.md`
Implementation plan: `docs/superpowers/plans/2026-07-07-stx-chatflow-prod-deployment.md`

---

## 1. Discovery — the target account is not empty

Read-only inventory of `842675988009` before touching anything:

- Existing VPC in `us-east-1` (`project-vpc`, `10.0.0.0/16`) — unrelated.
- A full **separate, unrelated production system** already running in
  `ap-south-1`: `stx-chatbot-*-prod-a2b8c9d1` — VPC, two ECS clusters
  (`chatbot-ecs-cluster` with `chatbot-api`/`mcp-server` services, plus a
  `crawler-cluster`), S3 buckets for agent-instructions/bedrock-traces/
  chat-sessions/knowledge-base. Confirmed by the user to be a **different,
  unrelated product** — treated as fully opaque, never touched.
- Other unrelated apps on the same shared platform account:
  `stx-platform-help-center`, `stx-platform-foo-share`, `url-shortener-*`.
- **EIP quota in `ap-south-1`: 15 total, 13 already in use** by the above
  apps' NAT gateways/ALBs — only 2 free account-wide. This is why
  `natStrategy: single` (1 NAT gateway, 1 EIP) was chosen over `OnePerAz`
  (2 EIPs) — no headroom to spare.
- Existing VPC CIDRs already in use in `ap-south-1`: `10.0.0.0/16`,
  `10.156.0.0/16`, `10.209.0.0/16`, `172.31.0.0/16` — chose **`10.50.0.0/16`**
  for the new VPC, clean and non-overlapping.

## 2. Made `infra/networking/index.ts` region/AZ-configurable

This file was previously only ever deployed in `us-east-1`, and hardcoded:

- `availabilityZoneNames: ["us-east-1a", "us-east-1b"]`
- Every subnet's CIDR block as a literal `10.0.x.x` value (not derived from
  the already-configurable `vpcCidr`)

Deploying to `ap-south-1` with a different `/16` would have failed outright
(AZ names don't exist in that region) or misplaced subnets outside the VPC's
own CIDR range.

**Fix (backward-compatible):**
- Added `chatbot-networking:availabilityZoneNames` config (JSON array),
  defaulting to `["us-east-1a", "us-east-1b"]` — identical to the old
  hardcoded value when unset.
- Added `subnetCidrsFromVpcCidr()` — derives all 8 subnet CIDRs from the
  configured `/16` `vpcCidr`, reproducing the original hardcoded values
  **byte-for-byte** for the default `10.0.0.0/16` (verified by hand and via
  live `pulumi preview`).

**Verification before trusting this on a shared file:**
- `tsc --noEmit` — clean.
- `pulumi preview --stack nonprod` on the *existing* `infra/networking` —
  **36 unchanged**, zero diff.
- `pulumi preview --stack nonprod` on `infra/compute` (consumes the
  `availabilityZones` output) — showed an 11-change diff; **isolation test**
  (reverted the networking change, re-ran the identical preview) proved this
  exact same diff exists with or without the change — pre-existing drift
  (stale Docker images from unrelated app commits + bastion AMI drift), not
  caused by this edit.
- A live check against the real `prod` stack (old account) was attempted but
  blocked by expired local credentials for that profile; the user explicitly
  waived this check, noting that stack is a POC, not load-bearing.

## 3. Parameterized `infra/bootstrap/bootstrap.sh` for reuse across accounts

`BUCKET_NAME`, `REGION`, `PROFILE` changed from hardcoded values to
`${VAR:-default}` — same defaults preserved, now overridable via env vars.

## 4. Bootstrapped the new account's Pulumi state bucket

```bash
cd infra/bootstrap
BUCKET_NAME=stx-chatflow-prod-pulumi-state REGION=ap-south-1 PROFILE=stx-chatflow-prod-deployment bash bootstrap.sh
```

### Error — `IllegalLocationConstraintException`

```
An error occurred (IllegalLocationConstraintException) when calling the CreateBucket operation:
The unspecified location constraint is incompatible for the region specific endpoint this request was sent to.
```

**Root cause:** `aws s3api create-bucket` requires an explicit
`--create-bucket-configuration LocationConstraint=<region>` for any region
other than `us-east-1`. `bootstrap.sh` never had this — it happened to work
before purely because it had only ever been run against `us-east-1`
(the special-cased default region that doesn't need it). Pre-existing bug,
surfaced the moment a second region was used.

**Fix:** conditional `--create-bucket-configuration LocationConstraint="$REGION"`
when `REGION != us-east-1`.

✅ Re-ran — bucket created, versioning enabled, public access blocked, Pulumi
logged into the new backend.

## 5. Created the new sibling Pulumi projects

`infra/stx-chatflow-prod/networking/` and `infra/stx-chatflow-prod/compute/`:

- `index.ts`, `package.json`, `package-lock.json`, `bun.lock` (and
  `tsconfig.json` for compute) — **symlinked** to the existing
  `infra/networking`/`infra/compute` files. One source of truth: future
  bugfixes apply to every environment automatically.
- `Pulumi.yaml` — real, separate file per project. `name:` kept identical
  to the original (`chatbot-networking`, `chatbot-compute`) because
  `compute/index.ts` hardcodes its `StackReference` as
  `organization/chatbot-networking/${pulumi.getStack()}` — matching the
  project name means zero code changes were needed for compute to find its
  networking stack. `backend.url` points at the new bucket.
- `Pulumi.<stack>.yaml` — stack config (`appName: stx-chatflow-prod`,
  `aws:region: ap-south-1`, `vpcCidr: 10.50.0.0/16`,
  `availabilityZoneNames: [ap-south-1a, ap-south-1b]`,
  `natStrategy: single`).

```bash
pulumi login "s3://stx-chatflow-prod-pulumi-state?region=ap-south-1&awssdk=v2"
cd infra/stx-chatflow-prod/networking
AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack init prod
cd ../compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack init prod --secrets-provider=passphrase
```

## 6. Deployed the networking stack

```bash
cd infra/stx-chatflow-prod/networking
AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack prod --yes
```

✅ **36 resources created, 0 errors, ~2m17s.**
- VPC: `vpc-06a99eac45062d600`, CIDR `10.50.0.0/16`
- AZs: `ap-south-1a`, `ap-south-1b`
- Single NAT gateway (matches the tight EIP quota)

## 7. Deployed the compute stack (placeholder `appUrl`)

```bash
cd ../compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack prod --yes
```

✅ **70 resources created, 0 errors, ~33m21s** (RDS provisioning + two Docker
image builds — `web-ui` and `workers`). `StackReference` to the Task 6
networking stack resolved correctly (matching VPC ID confirmed in outputs).

## 8. Renamed both stacks from `prod` to `stx-chatflow-prod`

Requested by the user for clarity (a bare "prod" was ambiguous alongside the
other account's stacks). Checked first that `pulumi.getStack()` is used
**only** for the `StackReference` lookup in `compute/index.ts` — never baked
into an actual AWS resource's name (all physical naming comes from the
separate `appName` config) — so renaming carries no resource-replacement
risk in principle.

```bash
cd infra/stx-chatflow-prod/networking
AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack rename stx-chatflow-prod --stack prod
cd ../compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi stack rename stx-chatflow-prod --stack prod
```

Pulumi automatically renamed the corresponding `Pulumi.prod.yaml` →
`Pulumi.stx-chatflow-prod.yaml` config files.

**One real side effect:** because the `StackReference`'s own identity
includes the stack name it targets (`organization/chatbot-networking/<stack>`),
renaming changed that reference's identity, cascading into a **replace of
both ECS task definitions** (retained, not deleted) and a rolling redeploy of
both services — purely from the name change, no functional difference.
Applied deliberately after flagging this tradeoff to the user.

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack stx-chatflow-prod --yes
```

✅ 6 updated, 2 replaced, 8 changes, 19s. Verified both services healthy
afterward (`web-ui` 2/2, `workers` 1/1).

## 9. Swapped the placeholder `appUrl` for the real CloudFront URL

```yaml
# infra/stx-chatflow-prod/compute/Pulumi.stx-chatflow-prod.yaml
chatbot-compute:appUrl: https://d29fy6b5poipr4.cloudfront.net
```

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack stx-chatflow-prod --yes
```

✅ 6 updated, 3 replaced, 9 changes, 18s (Cognito callback/logout URLs + ECS
task env vars updated, task definitions replaced but retained). Verified
both services still healthy, CloudFront returns HTTP 200.

## 10. Verified Bedrock actually works (not just "listed")

`list-foundation-models` in the design phase only confirmed the region
*offers* the needed models — not that invoke access is actually granted.
Live-tested with `aws bedrock-runtime converse`:

### Gotcha — on-demand invocation not supported for some models

```
ValidationException: Invocation of model ID anthropic.claude-haiku-4-5-...
with on-demand throughput isn't supported. Retry your request with the ID
or ARN of an inference profile that contains this model.
```

**Fix:** use the **inference profile ID** instead of the bare model ID —
found via `aws bedrock list-inference-profiles`:
`global.anthropic.claude-haiku-4-5-20251001-v1:0`. Retried — worked.

Then verified the app's *actual configured* models (both already use the
correct `global.` inference-profile form by default, in
`infra/compute/index.ts`):
- Chat: `global.anthropic.claude-sonnet-4-6` — confirmed working via
  `converse`.
- Embedding: `amazon.titan-embed-text-v2:0` — confirmed working via
  `invoke-model` (returned an actual embedding vector). No code change
  needed — the app was already configured correctly.

## 11. Added the Bedrock bearer token secret

Only needed for tool-calling with `moonshotai.*`/`deepseek.*` models (the
default chat model doesn't need it — confirmed working without it in step
10). User chose to set it up anyway.

The user ran this **themselves, directly in their own terminal** — the
value was never typed into or observed by the assistant, per this project's
"never include secrets in output" rule:

```bash
cd infra/stx-chatflow-prod/compute
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi config set --secret bedrockBearerToken --stack stx-chatflow-prod
```

Confirmed set afterward via `pulumi config` (key present, marked `[secret]`
— value never displayed).

## 12. Found + fixed a real `desiredCount` drift bug

While previewing the bearer-token deploy, the plan unexpectedly showed:

```
~ desiredCount: 2 => 1
```

on `web-ui-service` — nothing to do with the bearer token. **Root cause:**
`infra/compute/index.ts` hardcodes `desiredCount: 1` on the ECS Service, but
a separate `aws.appautoscaling.Target` sets `minCapacity: 2`. Autoscaling had
already bumped the live count to 2 to satisfy its own minimum; Pulumi's own
model still said 1, so the next `pulumi up` would fight the autoscaling
policy back down to 1 — a pre-existing bug in the shared file that would
recur on every future deploy.

**Checked against `chatflow-nonprod` first:** its actual desiredCount is
already 1 (matches its code) — autoscaling simply never had cause to bump it
there, so the bug hasn't manifested for that stack yet, but the same latent
gap exists in its code too.

**Fix:** `ignoreChanges: ["desiredCount"]` on the `web-ui-service` resource
options — tells Pulumi to stop overwriting whatever the autoscaling policy
has set. Verified: removes the drift on `stx-chatflow-prod`'s preview, causes
**zero new diff** on `chatflow-nonprod` (already matched, unaffected).
Applied together with the bearer token — 11 changes, 0 errors, 19s. Confirmed
`web-ui-service` stayed at desired=2/running=2 (no scale-down happened).

## 13. Fixed the CloudFront distribution's cosmetic label

User noticed the CloudFront console showed the distribution's Description as
generic **"Chatbot WebUI"** for this new environment. Root cause: the
`comment` field on the `aws.cloudfront.Distribution` resource in
`infra/compute/index.ts` was hardcoded as a literal string, never
`appName`-driven like every other resource.

**Fix:** `comment: `${appName} - Web UI`` — verified this is an in-place
**update**, not a replace, before applying.

```bash
PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack stx-chatflow-prod --yes
```

✅ 5 updated, 2 replaced, 7 changes, 59s. Confirmed via
`aws cloudfront get-distribution` — Comment now reads
`"stx-chatflow-prod - Web UI"`. Both services still healthy afterward.

---

## Current Status — All Healthy ✅

| Resource | Value |
|---|---|
| **App URL (CloudFront)** | **https://d29fy6b5poipr4.cloudfront.net** (HTTP 200) |
| CloudFront Distribution ID | `E1TDT0Z7AP8HMD` |
| CloudFront Comment | `stx-chatflow-prod - Web UI` |
| VPC | `vpc-06a99eac45062d600` (CIDR `10.50.0.0/16`, single NAT gateway, `ap-south-1a`/`ap-south-1b`) |
| ECS Cluster | `stx-chatflow-prod-ecs-cluster` |
| web-ui service | `stx-chatflow-prod-web-ui-service` — 2/2 tasks running |
| workers service | `stx-chatflow-prod-workers-service` — 1/1 task running |
| RDS Postgres | `stx-chatflow-prod-postgres.cdc2g608kmvd.ap-south-1.rds.amazonaws.com` (Postgres 16.13) |
| ECR repos | `stx-chatflow-prod-web-ui`, `stx-chatflow-prod-workers` |
| Cognito User Pool | `ap-south-1_rlzcsznnn` (domain prefix `stx-chatflow-prod-auth-842675988009`) |
| S3 app bucket | `stx-chatflow-prod-842675988009-ap-south-1` |
| Bastion EC2 | `i-055f86f716439e640` |
| ALB | `stx-chatflow-prod-alb-597469372.ap-south-1.elb.amazonaws.com` |
| Bedrock chat model | `global.anthropic.claude-sonnet-4-6` — verified working |
| Bedrock embedding model | `amazon.titan-embed-text-v2:0` — verified working |
| Bedrock bearer token | Set by user directly (not logged anywhere in this process) |

### Other environments — untouched throughout ✅

| Resource | Value |
|---|---|
| `chatbot` (POC, old account) | `chatbot-ecs-cluster`, account `970547372609` |
| `chatflow-nonprod` (old account) | `chatflow-nonprod-ecs-cluster`, https://d28eqq2bj0c0yk.cloudfront.net, account `970547372609` |
| `stx-chatbot-*` (unrelated, new account) | untouched, confirmed unrelated product on `842675988009` |
| `stx-platform-help-center`, `stx-platform-foo-share`, `url-shortener-*` | untouched, unrelated apps on `842675988009` |

---

## Files Modified

| File | Change | Committed? |
|------|--------|------------|
| `infra/networking/index.ts` | `availabilityZoneNames` config + CIDR-derivation function (backward-compatible) | Staged, not committed |
| `infra/bootstrap/bootstrap.sh` | Env var overrides + `LocationConstraint` fix for non-`us-east-1` | Staged, not committed |
| `infra/compute/index.ts` | `ignoreChanges: ["desiredCount"]` fix + CloudFront `comment` fix | Staged, not committed |
| `infra/stx-chatflow-prod/networking/*` | New sibling Pulumi project (symlinks + config) | Staged, not committed |
| `infra/stx-chatflow-prod/compute/*` | New sibling Pulumi project (symlinks + config) | Staged, not committed |
| `docs/superpowers/specs/2026-07-07-stx-chatflow-prod-deployment-design.md` | Design spec | Staged, not committed |
| `docs/superpowers/plans/2026-07-07-stx-chatflow-prod-deployment.md` | Implementation plan | Staged, not committed |

---

## Next Steps — Redeploying `stx-chatflow-prod` (after future code changes)

1. Make code changes, commit as usual.
2. From `infra/stx-chatflow-prod/networking` (only if VPC/networking config
   changed — rare):
   ```bash
   cd infra/stx-chatflow-prod/networking
   AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack stx-chatflow-prod
   ```
3. From `infra/stx-chatflow-prod/compute` (the common case — app code, env
   vars, infra changes):
   ```bash
   cd infra/stx-chatflow-prod/compute
   PULUMI_CONFIG_PASSPHRASE="" AWS_PROFILE=stx-chatflow-prod-deployment pulumi up --stack stx-chatflow-prod
   ```
4. Pulumi shows a **preview** first — review it, then confirm.
5. Config-only changes: ~20-60s. `apps/web-ui`/`apps/workers` source
   changes: Docker images rebuild, expect ~20-25 minutes.
6. After it finishes, verify:
   ```bash
   AWS_PROFILE=stx-chatflow-prod-deployment aws ecs describe-services \
     --cluster stx-chatflow-prod-ecs-cluster \
     --services stx-chatflow-prod-web-ui-service stx-chatflow-prod-workers-service \
     --region ap-south-1 \
     --query "services[*].{name:serviceName,status:status,desired:desiredCount,running:runningCount,pending:pendingCount}" \
     --output table

   curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" https://d29fy6b5poipr4.cloudfront.net
   ```

## Redeploying `chatflow-nonprod` or the `chatbot` POC (unaffected by any of this)

Unchanged from before — see the equivalent sections in
`infra/CHATFLOW_NONPROD_DEPLOYMENT.md`. Different folder
(`infra/networking`/`infra/compute`), different stack name (`nonprod`/`prod`),
different profile (`omar-testing-saas-chatbot`/`PLATFORM-ADMIN`), different
account (`970547372609`) — no overlap with `stx-chatflow-prod` whatsoever.
