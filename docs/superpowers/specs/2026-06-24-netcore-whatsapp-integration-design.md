# Netcore WhatsApp Integration — Design Spec

**Date:** 2026-06-24
**Status:** Approved
**Branch:** automation-test-suites

## Overview

The existing `libs/whatsapp` integration (see `docs/superpowers/specs/2026-05-17-whatsapp-integration-design.md`) only understands **Meta's Cloud API** webhook/auth contract. Tenant SMC Global does not connect to Meta directly — they go through **Netcore Cloud** as their WhatsApp BSP (Business Solution Provider). Netcore's webhook/API contract is different from Meta's, so today every inbound message Netcore sends to our existing `/api/webhooks/whatsapp` endpoint is rejected with `401 Invalid signature` before it ever reaches `MessageProcessor`.

This spec adds Netcore as a second WhatsApp provider alongside Meta, without disturbing the existing (Meta-specific, currently unverified-in-production) code paths.

## How this was researched

Netcore's primary docs site (`netcorecloud.stoplight.io` / `cpaasdocs.netcorecloud.com`) is a JS-only Stoplight SPA blocked by Cloudflare for non-browser requests — it could not be fetched directly. Two things grounded this spec instead:

1. **`wadocs.pepipost.com`** — a GitBook-hosted mirror of the same underlying CPaaS backend (Pepipost is the system Netcore acquired and still runs WhatsApp messaging on; confirmed by Netcore's own marketing-product docs at `cedocs.netcorecloud.com/docs/whatsapp` explicitly naming it as "the backend CPaaS platform"). Full page index pulled from `wadocs.pepipost.com/llms.txt`.
2. **Real captured traffic** — a temporary diagnostic logging change (raw body + headers on signature-verification failure) deployed to the nonprod webhook route. This captured ~30 real inbound messages from real customers already messaging the connected number, plus deliberate test messages covering every major content type. **Where real traffic and docs disagreed, real traffic won** — e.g. the docs' minimal example payload omits the `to` field; every real request includes it.

Anywhere this spec states something as docs-only/unconfirmed, treat it as a hypothesis to verify (via a real request or by re-reading the relevant doc page) during implementation — not as settled fact.

## Architecture

Adapter pattern at the boundary, not a parallel system and not a deep refactor of the shared core:

```
Netcore (POST, no signature) ──┐
                                ├─► /api/webhooks/whatsapp (shape-detect) ─► ParsedEvent[] ─► MessageProcessor (shared, unchanged)
Meta (POST, X-Hub-Signature-256)┘                                                                  │
                                                                                                     ▼
                                                                                   clientFactory(account) picks
                                                                                   MetaWhatsAppClient | NetcoreWhatsAppClient
```

- `MessageProcessor`, `SessionManager`, routers, `CommandHandler` — **untouched**, shared by both providers.
- Meta's client/parser/signature-check files — **untouched**, isolated from Netcore.
- New, separate Netcore-specific files for client/parser, normalized to the exact shapes the shared core already expects.

This was chosen over (a) a fully separate Netcore code path (would duplicate session/routing logic, and would never exercise the shared core's only-mock-tested-so-far logic with live traffic) and (b) a full `WhatsAppProviderClient` interface refactor (touches the working — if unverified-live — Meta code for no immediate benefit). See conversation history for the full trade-off discussion.

**Known limitation, deliberately not solved now:** Real captured traffic confirms every inbound payload includes a `to` field (the receiving business number), so routing works exactly like Meta's `phoneNumberId` for any number of tenants. The thing still unsolved is *security at the per-tenant level if a second Netcore tenant ever appears* — see "Security" below.

## Data Model

Add one column, no new tables:

```prisma
model WhatsAppAccount {
  // ...existing fields...
  provider String @default("meta") // "meta" | "netcore"
}
```

Field reuse for `provider: "netcore"`:

| Field | Netcore meaning |
|---|---|
| `wabaId` | Netcore's WABA ID (e.g. `106567969099921`) |
| `phoneNumberId` (unique) | The business's WhatsApp number, no `+`, with country code (e.g. `919711750243`) — confirmed this is what real traffic's `to` field contains |
| `accessToken` | Netcore Bearer API key, encrypted at rest the same way as Meta's token (`EncryptionService`) |
| `displayPhone`, `displayName` | Same meaning as Meta, populated from the connect form |
| `webhookSecret` | Reserved for the optional shared-secret header check (see Security) — unused until that's configured |
| `qualityRating`, `messagingLimit` | Meta-only concepts, stay `null` for Netcore |

Migration: `bunx prisma migrate dev` after the schema change, as usual for this repo.

## Connect Flow

The "Connect WhatsApp Account" dialog (`apps/web-ui/app/(dashboard)/settings/channels/whatsapp/page.tsx`) gets a second option alongside the existing "Meta Embedded Signup" card: a "Netcore" card with a plain form — **Display Name, WABA ID, Phone Number, API Key**. No OAuth/popup flow for Netcore — confirmed via Netcore's own "Integrate Netcore with External WhatsApp BSPs" flow description: provisioning happens entirely in Netcore's dashboard (already done for SMC Global); our side just stores credentials the tenant already has.

New route `POST /api/whatsapp/connect/netcore` (separate from the Meta route — input shape is unrelated):
- Zod-validate `{ displayName, wabaId, phoneNumber, apiKey }`.
- Encrypt `apiKey` with `EncryptionService` (same as Meta's `accessToken`).
- Create `WhatsAppAccount` with `provider: 'netcore'`, `phoneNumberId: phoneNumber` (normalized to digits-only, country code, no `+`, no spaces — matches the format seen in every real payload).
- Create a default `WhatsAppRouting` row (same as the Meta connect route does).
- **No live validation call against Netcore on connect** — there's no confirmed "check this key" endpoint, and Netcore's own API gateway requires the `Authorization: Bearer <key>` header format (confirmed — a bare, non-`Bearer`-prefixed `Authorization` header gets a generic `403 Forbidden` that looks identical to an IP/WAF block; don't waste time chasing that as infra when it happens, it's almost always this).

### Connected Accounts table — Provider column

The existing table (same page) shows Display Name, Phone Number, Status, Quality, Limit — nothing today distinguishes a Meta row from a Netcore row, and Quality/Limit will just be blank dashes for every Netcore account (Meta-only concepts). Add a **Provider** column (a `Badge`, same pattern as the existing Status column) between Display Name and Phone Number, rendering "Meta" or "Netcore" from the account's `provider` field.

This requires two concrete changes beyond the schema itself, both easy to miss since the field already exists in the DB:
- `GET /api/whatsapp/accounts` (`apps/web-ui/app/api/whatsapp/accounts/route.ts`) explicitly lists selected fields (`id, phoneNumberId, displayPhone, displayName, status, qualityRating, messagingLimit, createdAt`) — `provider` must be added to that `select` block or it will silently never reach the frontend even though the column exists.
- The frontend `WhatsAppAccount` interface and `columns` array in `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/page.tsx` need the new field and column definition.

## Webhook Routing (single shared URL — no change needed at Netcore)

`apps/web-ui/app/api/webhooks/whatsapp/route.ts` POST handler, after reading `rawBody`:

1. Try Meta path first (existing, unchanged): if `JSON.parse(rawBody).object === 'whatsapp_business_account'`, run the existing `X-Hub-Signature-256` check and `parseWebhookPayload`.
2. Else, check for Netcore shape: payload has `incoming_message` or `delivery_status` as a top-level array key.
3. Else: log and return `200` (don't retry-loop something we don't recognize).

For the Netcore branch: look up the `WhatsAppAccount` by `phoneNumberId = payload.incoming_message[0].to` (or `delivery_status[0].recipient` — **unconfirmed field name for status events, since no `delivery_status` traffic was ever observed in this account; verify against a real captured status payload before relying on it**). Run `parseNetcoreWebhookPayload(payload)` to produce the same `ParsedEvent[]` shape Meta's parser produces.

GET handler: unchanged, Meta-only. No evidence Netcore performs any GET verification handshake — every historical GET hit on this route had `hub.mode: null`, consistent with "Netcore never sends this," not with "Netcore uses different param names" (no Netcore GET traffic of any kind was ever observed).

## Netcore Webhook Payload Reference

All shapes below are from **real captured production traffic** on the connected number, content anonymized (names/numbers replaced with placeholders; structure and field names are verbatim). The common envelope (`message_id`, `from`, `to`, `from_name`, `received_at`, `context`) is present on every type; `context.ncmessage_id` / `context.message_id` are `""` (empty string, not `null`) when there's no reply/reaction context — treat both the same in the parser. Field order in the JSON varies between requests; never rely on order.

```json
// TEXT
{"incoming_message":[{"received_at":"1782241255","context":{"ncmessage_id":"","message_id":""},"from_name":"<name>","to":"919711750243","message_type":"TEXT","text_type":{"text":"<text>"},"message_id":"wamid.<...>","from":"91XXXXXXXXXX"}]}

// IMAGE
{"incoming_message":[{"to":"919711750243","message_type":"IMAGE","image_type":{"mime_type":"image/jpeg","sha256":"<base64>","id":"<media-id>"},"message_id":"wamid.<...>","from":"91XXXXXXXXXX","received_at":"...","context":{...},"from_name":"<name>"}]}

// VIDEO
{"incoming_message":[{"to":"919711750243","message_type":"VIDEO","video_type":{"mime_type":"video/mp4","sha256":"<base64>","id":"<media-id>"},"message_id":"wamid.<...>","from":"91XXXXXXXXXX","received_at":"...","context":{...},"from_name":"<name>"}]}

// AUDIO (voice notes have "voice": true; regular audio attachments presumably false/absent — only voice notes were tested)
{"incoming_message":[{"context":{...},"from_name":"<name>","to":"919711750243","message_type":"AUDIO","audio_type":{"mime_type":"audio/ogg; codecs=opus","sha256":"<base64>","id":"<media-id>","voice":true},"message_id":"wamid.<...>","from":"91XXXXXXXXXX","received_at":"..."}]}

// DOCUMENT
{"incoming_message":[{"to":"919711750243","message_type":"DOCUMENT","document_type":{"filename":"<filename>","mime_type":"application/pdf","sha256":"<base64>","id":"<media-id>"},"message_id":"wamid.<...>","from":"91XXXXXXXXXX","received_at":"...","context":{...},"from_name":"<name>"}]}

// LOCATION
{"incoming_message":[{"location_type":{"latitude":"28.642715454102","longitude":"77.181449890137","name":"<place name>","url":"<url>","address":"<address>"},"message_id":"wamid.<...>","from":"91XXXXXXXXXX","received_at":"...","context":{...},"from_name":"<name>","to":"919711750243","message_type":"LOCATION"}]}

// REACTION (emoji reaction to a message previously sent via the API — note context IS populated here, correlating to that prior send)
{"incoming_message":[{"from_name":"<name>","message_type":"REACTION","to":"919711750243","reaction_type":{"emoji":"👍"},"message_id":"wamid.<...>","from":"91XXXXXXXXXX","received_at":"...","context":{"ncmessage_id":"<uuid>","message_id":"wamid.<...>","x-apiheader":""}}]}

// delivery/status events (DOCS ONLY — never observed in real traffic from this account; "Event" webhook subscription type appears to not be configured. Verify this shape against a real payload before relying on it)
{"delivery_status":[{"ncmessage_id":"<uuid>","recipient":"91XXXXXXXXXX","status":"read","status_remark":"","received_at":"...","source":"<uuid>"}]}
```

**Confirmed gap, not a bug to fix:** GIFs and stickers produced **zero webhook calls at all** when sent to the connected number — not even a malformed envelope. Netcore silently doesn't forward these. The parser should simply never see them; no special-casing needed, but don't assume a missing webhook call means delivery failed if you're debugging something else later.

**Unconfirmed:** an emoji-only text message likely produced one observed payload with the bare envelope and *no* `message_type` / no type-specific object at all (i.e. Netcore failing to classify it) — this was inferred by elimination, not isolated with a dedicated test. The parser should fall back to logging-and-skipping (not crashing) on any payload where `message_type` is absent or unrecognized, which covers this case whether or not the inference is exactly right.

**Unconfirmed:** the JSON shape for a button/quick-reply click — not documented anywhere in `wadocs.pepipost.com`, and SMC Global's routing setup doesn't use interactive buttons today, so this is out of scope until there's an actual need.

## Sending

`libs/whatsapp/src/client/netcore-api.ts` — `NetcoreWhatsAppClient`, same public method names as `MetaWhatsAppClient` (`sendTextMessage`, `sendTemplateMessage`) so `MessageProcessor` call sites don't change.

**Found while writing the implementation plan, not originally listed here:** `MetaWhatsAppClient` is also instantiated directly in two more places outside `MessageProcessor`/`factory.ts` — the Agent Studio graph node executors `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts` (the tenant's actual configured reply path: `[WhatsApp Trigger] → [LLM] → [WhatsApp Send]`) and `whatsapp-send-template-executor.ts`, plus the manual template-send API route `apps/web-ui/app/api/whatsapp/accounts/[id]/templates/send/route.ts`. All three need a `provider` branch: the send-executor gets real Netcore text support (mirroring the rationale above), the other two get a clear early-throw guard rather than silently misusing a Netcore key against Meta's API — template sending stays deferred, same as media sending.

**Confirmed via real request** (the exact curl that worked):

```
POST https://cpaaswa.netcorecloud.net/api/v2/message/nc/priority
Authorization: Bearer <api-key>      ← "Bearer " prefix is required; a bare token gets a 403 that looks like an infra block but isn't
Content-Type: application/json

{"message":[{"recipient_whatsapp":"91XXXXXXXXXX","recipient_type":"individual","message_type":"text","source":"<any-string>","type_text":[{"content":"<text>"}]}]}

→ 200 {"data":{"id":"<uuid>"},"message":"Request received successfully.","status":"success"}
```

Normalize the response into Meta's shape so `MessageProcessor`'s `sendResult.messages[0].id` line doesn't need to change: `{ messages: [{ id: response.data.id }] }`.

**Important, confirmed-real caveat:** a `200`/`"status":"success"` response only means Netcore *accepted the request* — it does not mean WhatsApp delivered it. Two real, documented failure modes happen downstream of that response:
- **Error `8007`**: outside the 24-hour customer-service window — freeform text rejected, a template is required.
- **Error `8002`**: recipient not opted in — Netcore's docs state opt-in is checked on *every* send (`POST /api/v2/consent/manage/`). **Unconfirmed:** whether a customer messaging the business first is itself sufficient to satisfy this opt-in check, or whether it's a fully separate explicit-consent record regardless of who initiated contact — this was tested empirically during research (customer messaged first, then a send was retried) and the message still did not arrive, but there's no dashboard access to confirm *why* it failed via Netcore's actual delivery reports. **Do not guess at this — when implementing the send path, either get dashboard access to check a real delivery report, or test by explicitly opting in a real number via the Consent API first and confirming delivery before assuming either theory is correct.**

**Docs-only, unconfirmed against real traffic** (different endpoint domain than the one confirmed above — `waapi.pepipost.com` vs `cpaaswa.netcorecloud.net` — verify with a real request before relying on this in code):

```
Media upload:  POST https://waapi.pepipost.com/api/v2/media/upload/   (multipart form-data, field: file)
               → {"status":"success","data":{"mediaId":"<uuid>"}}
Media get:     GET  https://waapi.pepipost.com/api/v2/media/{mediaId}  → binary
Media send:    message_type: "media", type_media: [{attachments:[{attachment_id, caption}]}]
Template send: POST https://cpaaswa.netcorecloud.net/api/v2/message/nc  (note: no "/priority" suffix — different path than text)
               message_type: "template", type_template: [{name, attributes, language:{locale, policy}}]
```

Given real customers are already sending media (confirmed: IMAGE/VIDEO/AUDIO/DOCUMENT all observed), media *receiving* (parsing inbound payloads above) is in scope now. Media *sending* — uploading media to attach to an outbound reply — is lower priority since the current routing setup only sends text agent replies; build it when there's an actual reply-with-media use case, not speculatively.

## Security

**Confirmed via ~30 real requests, not inferred:** zero authentication on inbound Netcore webhooks. Every single real request had the identical header set (standard CloudFront/proxy headers: `x-forwarded-for`, `via`, `x-amzn-trace-id`, etc. — nothing Netcore-specific, no signature, no custom header, no `Authorization`). This matches Netcore's own dashboard UI (the "Webhook header" field on the incoming-webhook config is optional and was left blank) and matches the docs' encryption page, which documents no signature/HMAC/encryption scheme for webhook authentication at all.

Practical consequence: anyone who learns this URL can currently POST fake WhatsApp messages into the system. Mitigations, in order of effort:
1. **Free, do this:** if a second webhook config slot is ever added on Netcore's side, set the "Webhook header" field to a secret value and check for it — `webhookSecret` column is already reserved for this. Skip the check entirely when unconfigured (today's reality), never reject solely for its absence.
2. **Cheap, optional:** the real traffic's source IP was consistently `35.244.61.191` (Google Cloud-hosted, matches the `Server: Google Frontend` header seen when calling Netcore's own send API) — could allowlist this at the CloudFront/WAF level, but this is Netcore's outbound IP, not contractually guaranteed stable; verify it hasn't changed if this is ever implemented.
3. **Not pursued:** Netcore's own dashboard mentions IP whitelisting *for reviewing webhook responses* in their docs — this is about a different direction (Netcore checking *our* responses), not about us verifying *their* requests; don't confuse the two if revisiting this.

## Error Handling & Logging

Standard repo conventions apply (Zod at boundaries, Pino structured logging, try/catch with re-throw or typed error response). Useful real Netcore error codes for the send path specifically (confirmed from docs, not yet triggered and observed firsthand except where noted):

| Code | Meaning |
|---|---|
| `8001` | Required parameter missing |
| `8002` | Phone number not opted in |
| `8003` | WhatsApp contact does not exist |
| `8004` | Client details not found |
| `8006` | Validation failure (invalid type, recipient format, etc.) |
| `8007` | Outside 24h freeform-message window — confirmed-relevant scenario, use a template instead |
| `8008` | Invalid media ID or bad media |

## Testing

- `libs/whatsapp/src/webhook/netcore-parser.test.ts` — one test per confirmed real payload shape above (anonymized fixtures, not literal customer data), plus a test asserting unrecognized/missing `message_type` logs-and-skips rather than throwing.
- `libs/whatsapp/src/client/netcore-api.test.ts` — mirrors `meta-api.test.ts`: mock `fetch`, assert the `Authorization: Bearer` header, body shape, and the response-normalization into `{messages:[{id}]}`.
- `message-processor.test.ts` stays untouched — regression guard proving the Netcore parser's output is consumed identically to Meta's by the shared core.
- Manual: once deployed, the existing diagnostic logging (raw body on signature failure) doubles as a live integration check — a real inbound message should move from "logged as rejected" to "processed by `MessageProcessor`" with no other observable change in CloudWatch.

## Rollout Note

The connected number (`+91 9711750243`) already receives real, organic customer traffic — confirmed via the diagnostic logging deployed during this investigation (~30 distinct real customers in under 24 hours: account questions, opt-outs, images, a reaction). Every one of those has been silently dropped with a `401` since the webhook was configured. This isn't a "test number" — whoever owns the business relationship for this number should be aware that real customer messages have been going unanswered, independent of when this fix ships.
