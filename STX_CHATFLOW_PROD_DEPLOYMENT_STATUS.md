# Deployment Status Report — stx-chatflow-prod — 2026-07-07

## Environment

- **AWS Account**: `842675988009` (STX-APPLICATION-PLATFORM)
- **AWS Profile**: `stx-chatflow-prod-deployment`
- **Region**: `ap-south-1`
- **Pulumi Stacks**: `chatbot-networking-stx-chatflow-prod`, `chatbot-compute-stx-chatflow-prod`
  (own dedicated S3 state bucket — `s3://stx-chatflow-prod-pulumi-state` —
  completely separate from `chatbot-pulumi-state` used by the other account)
- **App Name**: `stx-chatflow-prod`
- **CloudFront URL**: https://d29fy6b5poipr4.cloudfront.net

---

## Issues Found & Fixed

### 1. `infra/networking/index.ts` hardcoded to `us-east-1` (FIXED)

- **Problem**: AZ names (`us-east-1a`/`us-east-1b`) and every subnet CIDR
  were hardcoded literals, not derived from the already-configurable
  `vpcCidr`. Would break (or silently misplace subnets) outside `us-east-1`.
- **Fix**: Added `availabilityZoneNames` config (default preserves old
  behavior) + `subnetCidrsFromVpcCidr()` deriving subnets from any `/16`
  CIDR — byte-for-byte identical to the old hardcoded values for the
  default `10.0.0.0/16`.
- **Status**: Verified via `tsc`, live `pulumi preview` on `nonprod`
  (36 unchanged), and an isolation test proving an unrelated `compute`
  diff was pre-existing drift, not caused by this change.

### 2. `bootstrap.sh` broke for any region other than `us-east-1` (FIXED)

- **Problem**: `aws s3api create-bucket` failed with
  `IllegalLocationConstraintException` — the script never passed
  `--create-bucket-configuration LocationConstraint`, which AWS requires
  for non-`us-east-1` regions. Pre-existing bug, only ever worked before
  because it was only ever run against `us-east-1`.
- **Fix**: Added conditional `LocationConstraint` + made `BUCKET_NAME`/
  `REGION`/`PROFILE` overridable via env vars (defaults unchanged).
- **Status**: Bucket `stx-chatflow-prod-pulumi-state` created, versioned,
  public access blocked.

### 3. AWS EIP quota nearly exhausted in the target account (HANDLED)

- **Problem**: Read-only inventory found only 2 of 15 EIPs free in
  `ap-south-1` on the target account (13 already used by other apps
  sharing this platform account).
- **Fix**: Used `natStrategy: single` (1 NAT gateway / 1 EIP) instead of
  `OnePerAz` (2 EIPs) to leave headroom.
- **Status**: Deployed. VPC `vpc-06a99eac45062d600`, CIDR `10.50.0.0/16`.

### 4. Bedrock model IDs need "inference profile" form, not bare model ID (FIXED)

- **Problem**: `aws bedrock-runtime converse` with a bare model ID
  (`anthropic.claude-haiku-4-5-...`) failed:
  `ValidationException: ... on-demand throughput isn't supported`.
- **Fix**: Used the inference profile ID instead
  (`global.anthropic.claude-haiku-4-5-...`), found via
  `aws bedrock list-inference-profiles`.
- **Status**: Verified working. The app's actual configured models
  (`global.anthropic.claude-sonnet-4-6` for chat,
  `amazon.titan-embed-text-v2:0` for embeddings) were already in the
  correct format — no code change needed, both confirmed live via direct
  invoke.

### 5. `desiredCount` fighting the autoscaling policy (FIXED)

- **Problem**: `web-ui-service` hardcoded `desiredCount: 1` while a
  separate `appautoscaling.Target` sets `minCapacity: 2`. Autoscaling had
  already bumped the live count to 2; the next deploy would have fought it
  back down to 1. Pre-existing bug in the shared file — confirmed
  `chatflow-nonprod` has the same latent gap, just hasn't hit it yet
  (its actual count still matches its code, coincidentally).
- **Fix**: `ignoreChanges: ["desiredCount"]` on the ECS Service resource.
- **Status**: Deployed. Verified `web-ui-service` stayed at desired=2/
  running=2 (no scale-down), and this causes zero new diff on
  `chatflow-nonprod`.

### 6. CloudFront distribution's cosmetic label was hardcoded (FIXED)

- **Problem**: `comment: "Chatbot WebUI"` was a literal string, not
  `appName`-driven like every other resource — showed the same generic
  label on every environment.
- **Fix**: `comment: `${appName} - Web UI``. In-place update, verified
  no replacement.
- **Status**: Deployed. Console now shows `"stx-chatflow-prod - Web UI"`.

---

## Current Status — All Healthy ✅

| Resource | Value |
|---|---|
| **App URL (CloudFront)** | https://d29fy6b5poipr4.cloudfront.net (HTTP 200) |
| CloudFront Distribution ID | `E1TDT0Z7AP8HMD` |
| ECS Cluster | `stx-chatflow-prod-ecs-cluster` |
| web-ui service | 2/2 tasks running |
| workers service | 1/1 task running |
| RDS Postgres | 16.13, `stx-chatflow-prod-postgres.cdc2g608kmvd.ap-south-1.rds.amazonaws.com` |
| ECR repos | `stx-chatflow-prod-web-ui`, `stx-chatflow-prod-workers` |
| Cognito User Pool | `ap-south-1_rlzcsznnn` |
| S3 app bucket | `stx-chatflow-prod-842675988009-ap-south-1` |
| VPC | `vpc-06a99eac45062d600` (single NAT gateway, `10.50.0.0/16`) |
| Bedrock | Chat + embedding models verified working live |

**Existing `chatbot` (POC) and `chatflow-nonprod` environments in account
`970547372609`, and all other unrelated apps already running on the new
shared platform account `842675988009` (`stx-chatbot-*`,
`stx-platform-help-center`, `stx-platform-foo-share`, `url-shortener-*`)
were not modified at any point.**

---

## Files Modified

| File | Change | Committed? |
|------|--------|------------|
| `infra/networking/index.ts` | `availabilityZoneNames` + CIDR-derivation function | See commit history |
| `infra/bootstrap/bootstrap.sh` | Env var overrides + `LocationConstraint` fix | See commit history |
| `infra/compute/index.ts` | `ignoreChanges` fix + CloudFront comment fix | See commit history |
| `infra/stx-chatflow-prod/networking/*` | New sibling Pulumi project | See commit history |
| `infra/stx-chatflow-prod/compute/*` | New sibling Pulumi project | See commit history |

---

## Recommended Next Steps

1. See `infra/STX_CHATFLOW_PROD_DEPLOYMENT.md` for full step-by-step
   deployment history and redeploy instructions.
2. The `desiredCount`/autoscaling fix and the CloudFront comment fix are
   both in the shared `infra/compute/index.ts` — worth deploying to
   `chatflow-nonprod` and the original `chatbot` stack too next time either
   is redeployed, since both fixes apply there as well (verified zero
   unexpected diff on `chatflow-nonprod` for the `desiredCount` fix).
3. Bedrock bearer token secret was set directly by the user (not scripted,
   not logged) — if this environment is ever rebuilt from scratch, that
   step needs to be repeated manually.
