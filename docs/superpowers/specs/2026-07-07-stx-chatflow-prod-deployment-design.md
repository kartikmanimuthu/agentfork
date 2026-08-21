# stx-chatflow-prod Deployment — Design

## Goal

Deploy a new, fully isolated production environment for this chatbot on a
**different AWS account** — `842675988009` ("STX-APPLICATION-PLATFORM") — as
an ECS cluster named `stx-chatflow-prod-ecs-cluster`, without touching any
existing service on that account or either existing environment in the
current account (`970547372609`).

## Existing environments (context)

| Env | Account | Region | Profile | Pulumi stack | ECS cluster |
|---|---|---|---|---|---|
| `chatbot` (prod) | `970547372609` | us-east-1 | `omar-testing-saas-chatbot` | `prod` | `chatbot-ecs-cluster` |
| `chatflow-nonprod` | `970547372609` | us-east-1 | `omar-testing-saas-chatbot` | `nonprod` | `chatflow-nonprod-ecs-cluster` |
| **`stx-chatflow-prod` (new)** | **`842675988009`** | **ap-south-1** | `stx-chatflow-prod-deployment` | `prod` (new backend) | `stx-chatflow-prod-ecs-cluster` |

## Target account is not empty — discovered via read-only inventory

`842675988009` is a shared multi-app platform account ("STX-APPLICATION-PLATFORM"),
already running production workloads unrelated to this project. Confirmed
present (all **must remain untouched**):

- **`stx-chatbot-*-prod-a2b8c9d1`** — a separate, unrelated chatbot product:
  VPC `stx-chatbot-main-vpc-prod-a2b8c9d1` (`10.0.0.0/16`, ap-south-1), ECS
  clusters `stx-chatbot-chatbot-ecs-cluster-prod-a2b8c9d1` (services:
  `chatbot-api`, `mcp-server`) and `stx-chatbot-crawler-cluster-prod-a2b8c9d1`,
  plus S3 buckets for agent-instructions, bedrock-traces, chat-sessions,
  knowledge-base, web-ui-v3, mcp-artifact. Confirmed unrelated to this repo.
- `stx-platform-help-center` — VPC `10.156.0.0/16`, ECS Fargate cluster, RDS.
- `stx-platform-foo-share` — VPC `10.209.0.0/16`, ECS Fargate cluster, RDS.
- `url-shortener-*` — Lambda/API Gateway/CloudFront based, several S3 buckets,
  Cognito pools.
- Default VPC `172.31.0.0/16` (`aws-controltower-VPC`).

Region footprint: everything above lives in **ap-south-1**, not us-east-1 —
confirmed by inventory, and matches this repo's own `AWS_REGION` default
(`ap-south-1` per root `CLAUDE.md`).

**EIP quota in ap-south-1: 15 total, 13 already in use** (existing NAT
gateways + ALBs/NLBs from the above apps) — only 2 EIPs of headroom
account-wide. This directly affects the NAT gateway strategy choice below.

## Architecture

### New sibling Pulumi projects, symlinked code

```
infra/
  networking/                    # existing — untouched
  compute/                       # existing — untouched
  stx-chatflow-prod/
    networking/
      Pulumi.yaml                 # NEW — name: chatbot-networking, backend: s3://<new-bucket>
      Pulumi.prod.yaml            # NEW — stack config (see below)
      index.ts -> ../../networking/index.ts        # symlink
      package.json -> ../../networking/package.json # symlink
      tsconfig.json -> ../../networking/tsconfig.json # symlink
      bun.lock -> ../../networking/bun.lock         # symlink
    compute/
      Pulumi.yaml                 # NEW — name: chatbot-compute, backend: s3://<new-bucket>
      Pulumi.prod.yaml            # NEW — stack config (see below)
      index.ts -> ../../compute/index.ts
      package.json -> ../../compute/package.json
      tsconfig.json -> ../../compute/tsconfig.json
      bun.lock -> ../../compute/bun.lock
```

Rationale: the infra code (`index.ts`) is already environment-agnostic —
parameterized by `appName`, `natStrategy`, `vpcCidr`, region, etc. — and
already serves both `prod` and `chatflow-nonprod` in the existing account via
stack config alone. Symlinking keeps that pattern intact: one source of
truth, so future bugfixes (e.g. Dockerfile build steps, RDS engine version
bumps) apply to every environment automatically instead of drifting across
copies.

The only thing that genuinely differs and can't be shared is `Pulumi.yaml`'s
`backend.url`, because a Pulumi project's backend applies to every stack
defined in that folder — and S3 bucket names are globally unique across all
AWS accounts, so the new account needs its own bucket.

`Pulumi.yaml`'s `name:` field is kept identical (`chatbot-networking`,
`chatbot-compute`) to the existing projects, because `compute/index.ts` hardcodes
the networking stack reference as `organization/chatbot-networking/${pulumi.getStack()}`.
Keeping the same project name means the compute stack auto-discovers its
networking stack outputs with **zero code changes** — safe because it's a
different backend bucket entirely, so there's no risk of it resolving to the
existing account's stacks.

Stack name is `prod` — safe to reuse since it lives in a completely separate
backend bucket from the existing `prod` stack in the other account.

### New AWS account bootstrap

One-time, using `infra/bootstrap/bootstrap.sh` adapted for this account:

- `PROFILE=stx-chatflow-prod-deployment`
- `BUCKET_NAME=stx-chatflow-prod-pulumi-state` (verify availability at creation
  time — S3 bucket names are global)
- `REGION=ap-south-1`

Creates the S3 state bucket (versioned, public access blocked) and logs
Pulumi into it. This is the only bucket/backend the new stacks will ever
write to.

## Required code change: region/AZ parameterization (self-review finding)

`infra/networking/index.ts` currently hardcodes two things that only happen
to work today because every existing stack (`prod`, `nonprod`) shares the
same region (`us-east-1`) and the same `10.0.0.0/16` CIDR:

1. `availabilityZoneNames: ["us-east-1a", "us-east-1b"]` — literal, not
   config-driven.
2. Every `subnetSpecs[].cidrBlocks` entry — literal `10.0.x.x/xx` values, not
   derived from the configured `vpcCidr`.

Deploying to `ap-south-1` with a different `/16` requires both to become
configurable. Fix, kept fully backward-compatible:

- Add `chatbot-networking:availabilityZoneNames` config (JSON array),
  **defaulting to `["us-east-1a", "us-east-1b"]`** — identical to today's
  hardcoded value when unset, so `prod`/`nonprod` are unaffected.
- Replace the hardcoded subnet `cidrBlocks` with a small pure function that
  derives all 8 subnet CIDRs from the configured `/16` `vpcCidr` (same
  relative layout: Private `/22` ×2, Public `/24` ×2, Database `/24` ×2,
  Intra `/26` ×2 — just re-based on the given network's first two octets
  instead of hardcoded `10.0`). For the existing default `10.0.0.0/16` this
  function produces **exactly** today's hardcoded values (verified by hand:
  `10.0.0.0/22`, `10.0.4.0/22`, `10.0.8.0/24`, `10.0.9.0/24`, `10.0.10.0/24`,
  `10.0.11.0/24`, `10.0.12.0/26`, `10.0.12.64/26` — byte-for-byte match) —
  zero diff for existing stacks.
- The exported `availabilityZones` stack output becomes
  `pulumi.output(azNames)` (the parsed config list) instead of a hardcoded
  literal.
- New stack's config: `availabilityZoneNames: ["ap-south-1a", "ap-south-1b"]`.

**Safety verification before this touches anything real:** after making this
change, run `pulumi preview --stack prod` and `pulumi preview --stack
nonprod` in the *existing* `infra/networking` (and `infra/compute`, since it
consumes the `availabilityZones` output) against the *existing* account —
confirm **zero resource diff** on both before ever deploying the new stack.
This is the concrete proof that a shared-code change is safe, not just an
assertion.

`compute/index.ts` was also checked for region hardcoding: the only literal
`us-east-1` reference is in the `ecr-public get-login-password --region
us-east-1` command, which is correct as-is — the public ECR gallery's
authentication endpoint is fixed at `us-east-1` regardless of where the
consuming resources live. No change needed there.

## Configuration

**`infra/stx-chatflow-prod/networking/Pulumi.prod.yaml`:**
```yaml
config:
  aws:region: ap-south-1
  chatbot-networking:vpcCidr: 10.50.0.0/16
  chatbot-networking:appName: stx-chatflow-prod
  chatbot-networking:natStrategy: single
```

- `vpcCidr: 10.50.0.0/16` — does not overlap any existing VPC in this account
  (`10.0.0.0/16`, `10.156.0.0/16`, `10.209.0.0/16`, `172.31.0.0/16` all
  already taken).
- `natStrategy: single` — 1 NAT gateway / 1 EIP instead of `OnePerAz`'s 2.
  Chosen because of the tight EIP headroom (2 free account-wide) discovered
  above — leaves 1 EIP of margin rather than consuming both remaining slots.
  Trade-off: single NAT gateway is a shared point of failure for outbound
  traffic across AZs (same trade-off nonprod already accepts). A quota
  increase request could allow `OnePerAz` later if desired.

**`infra/stx-chatflow-prod/compute/Pulumi.prod.yaml`:**
```yaml
config:
  aws:region: ap-south-1
  chatbot-compute:appName: stx-chatflow-prod
  chatbot-compute:appUrl: https://placeholder.cloudfront.net   # updated post-deploy
  chatbot-compute:subscriptionEmails: ""
```

- `appName: stx-chatflow-prod` drives all resource naming — ECS cluster
  becomes `stx-chatflow-prod-ecs-cluster`, RDS `stx-chatflow-prod-postgres`,
  ECR `stx-chatflow-prod-web-ui`/`stx-chatflow-prod-workers`, Cognito pool
  `stx-chatflow-prod-user-pool`, S3 app bucket
  `stx-chatflow-prod-842675988009-ap-south-1`, etc. No hyphen-related
  `dbIdentifier` issue (existing sanitization already handles it, same as
  `chatflow-nonprod`).
- `appUrl` starts as placeholder, gets updated to the real CloudFront domain
  after the first successful compute deploy (same two-step pattern used for
  nonprod), then redeployed.
- `bedrockBearerToken` — **not set initially**. Bedrock model access must be
  confirmed for this account/region before this is needed (see Prerequisites).

## Bedrock prerequisite

Read-only check confirmed `ap-south-1` **offers** the needed foundation
models (Claude Sonnet 5, Opus 4.8, Haiku 4.5, etc. all listed via
`list-foundation-models`). This does **not** by itself confirm invoke access
is granted for this account — that requires either model access already
being enabled, or a working `bedrock:InvokeModel`/Converse call. This must be
verified (e.g. a small `invoke-model` smoke test) before the compute stack is
deployed with a working `bedrockBearerToken`, and before declaring the
environment usable end-to-end. Flagged as an explicit checkpoint in the
implementation plan.

## Deployment sequence

1. Bootstrap new account's S3 state bucket (`stx-chatflow-prod-deployment` profile).
2. Create `infra/stx-chatflow-prod/{networking,compute}` directories with
   symlinks + new `Pulumi.yaml`/`Pulumi.prod.yaml`; commit.
3. `pulumi login` to the new backend; `pulumi stack init prod` in both dirs.
4. Deploy networking stack (`pulumi preview` then `pulumi up`); verify VPC.
5. **Checkpoint:** confirm/verify Bedrock model access in the new
   account/region.
6. Deploy compute stack (`pulumi preview` then `pulumi up`) — expect Docker
   image builds for `web-ui` + `workers` (~20–25 min, matching nonprod's
   experience).
7. Update `appUrl` to the real CloudFront URL; redeploy (fast, config-only).
8. Verify ECS services (`describe-services`) and CloudFront (HTTP 200).

Every `pulumi up` against this account is preceded by `pulumi preview` and a
manual review of the diff — never applied blind, per the caution already
established for this project's `prod` stack in the other account.

## Safety / isolation guarantees

- Separate AWS account (`842675988009`) — zero shared credentials/state with
  either environment in `970547372609`.
- Separate Pulumi state bucket (`stx-chatflow-prod-pulumi-state`) — no shared
  state file with `chatbot-pulumi-state` or any bucket already in this
  account.
- Separate VPC, non-overlapping CIDR, separate `appName` prefix on every
  resource — no naming or networking collision with `stx-chatbot-*`,
  `stx-platform-help-center`, `stx-platform-foo-share`, or `url-shortener-*`.
- All AWS CLI inventory checks performed so far are read-only
  (`describe-*`/`list-*`); no mutating calls have been made against this
  account.

## Out of scope (per explicit decision)

- CI/CD pipeline (`infra/cicd` — CodePipeline/CodeBuild) — not being deployed
  for this environment; deploys are manual `pulumi up`, mirroring how
  `chatflow-nonprod` is operated today.
- Forcing the literal cluster name `stx-chatflow-ecs-cluster-prod` — accepted
  the convention-derived `stx-chatflow-prod-ecs-cluster` instead, consistent
  with every other resource's naming.
