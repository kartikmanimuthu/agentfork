# OpenWorker Connectors — Research Notes

**Status:** Research (pre-implementation)
**Date:** 2026-07-29
**Author:** Adya Tiwari + Claude
**Source:** [andrewyng/openworker](https://github.com/andrewyng/openworker), directory [`coworker/connectors`](https://github.com/andrewyng/openworker/tree/main/coworker/connectors) (cloned locally at `main`, ~13.5k lines across 27 files)
**Purpose:** Understand how OpenWorker connects external tools (Slack, Gmail, Google Calendar, GitHub, HubSpot, generic email, browser automation) before designing Claw Studio's own connector expansion beyond the current Slack/Telegram channel gateway (`libs/claw-studio/src/connectors/`, `libs/claw-studio/src/gateway/`).

---

## 0. Framing: OpenWorker is single-user desktop software, we are multi-tenant SaaS

This matters more than any individual pattern below. OpenWorker's `README.md` and `coworker/secrets.py` establish it as a **local-first desktop coworker** — one Python process per machine, one human owner, everything (agent loop, conversations, connector tokens, model keys) stored in a single local file (`~/.config/coworker/secrets.json`, or the Windows/macOS equivalents). There is no per-org/per-tenant database row model anywhere in the connectors code. The only server-side component, "OpenWorker Cloud," is described in their own docs as a service that "brokers OAuth handshakes for connectors" — not a credential store or multi-tenant backend.

Our system (`ClawRunService`, `ClawChatSession`, per-tenant `LlmProviderService`, etc.) is the opposite: everything is tenant-scoped in Postgres, multiple tenants share one deployment. So several OpenWorker patterns (a single global `SecretStore` JSON file, one Slack Socket-Mode token) don't transplant directly — every table below should be read as "the local-single-user shape they chose to solve this problem" and re-derived per-tenant when we borrow it. Where a pattern is genuinely tenant-agnostic (e.g. the descriptor-as-data model for adding connectors, the token-never-in-model-context rule), it's called out explicitly.

---

## 1. Core abstraction: two connector shapes, not one

OpenWorker's `coworker/connectors/` package contains two structurally different kinds of "connector," and the split is important for scoping our own next step.

### A. Messaging/chat-platform connectors (Slack, Telegram, GitHub-as-inbound)

Modeled as an adapter implementing `BasePlatformAdapter` (`base.py:141-184`) — an ABC with `connect()`, `disconnect()`, `send()` abstract, plus default `send_interactive()` / `handle_interaction()`. Inbound events become a `MessageEvent` / `SessionSource` (`base.py:42-108`); outbound replies address a target via an opaque string token (`"platform:chat_id[:thread]"`, `format_target` / `parse_target`, `base.py:24-37`). New adapters register with a central `Gateway` via `adapter.set_message_handler(...)`.

**This is structurally the same shape as our `ChannelAdapter` in `libs/claw-studio/src/gateway/types.ts`** — an inbound/outbound contract, a gateway that routes events to it, target-address encoding for replies. Nothing new to learn here architecturally; we already have the equivalent (Slack + Telegram adapters, `libs/claw-studio/src/connectors/adapters/`).

### B. Tool-only integration connectors (Gmail, Calendar, HubSpot, GitHub API, Jira, Notion, etc.) — the part we don't have yet

No adapter, no inbound events at all. Modeled purely as **data**:
- A `ConnectorDescriptor` dataclass (`descriptors.py:46-93`) declares: auth method, the form fields the connect UI should render, setup instructions text, and a `validate` callback (a real API call that both proves the credential works and returns an identity string to key storage by).
- A parallel `ConnectorToolDef` list (`tool_defs.py:12-24`) declares which tool names the connector exposes to the agent.

Adding a new connector of this kind is explicitly meant to be "mostly data, not UI code" (per the `descriptors.py` docstring) — append one descriptor + register its tool functions in `integration_tools.py`. This is the part directly relevant to what we'd build next (Gmail/Calendar/HubSpot/Notion/etc. as agent tools, not as inbound channels).

GitHub and Slack straddle both shapes: they're inbound channels *and* have write-tool APIs (`github_create_issue`, etc.).

**Central registries** (the pattern worth copying regardless of tenancy model):
- `descriptors.py` — `DESCRIPTORS: list[ConnectorDescriptor]`, `get_descriptor(name)`, `list_descriptors()`, extensible via `register_descriptor()`.
- `tool_defs.py` — `TOOL_DEFS: tuple[ConnectorToolDef, ...]`, indexed into `TOOLS_BY_CONNECTOR` and `TOOL_TO_CONNECTOR` for reverse lookup.
- `__init__.py` re-exports the whole public surface as one barrel (adapters, `Gateway`, `connect_connector`/`disconnect_connector`/`connector_list`, `make_integration_tools`, `connector_for_tool`).

---

## 2. Per-service auth, storage, and connect flow

Every connector state lives in one `SecretStore` (`coworker/secrets.py`) — a `0600`-permissioned JSON file, keyed by profile name (`"<connector>:default"`, `"<connector>:account:<id>"`, `"slack:team:<team_id>"`, `"github:install:<id>"`). Values may embed `${ENV_VAR}` references resolved at read time and never written back — lets a token come from environment/`.env` instead of the JSON file.

Every connector supports **manual token/API-key paste** unconditionally (their docs call this "sacred" — the local-only open-source flow always works with no cloud dependency); some *additionally* offer **managed one-click OAuth** brokered by OpenWorker Cloud (`descriptor.managed=True`).

| Service | Auth mechanism | What's stored | Connect flow |
|---|---|---|---|
| **Slack** | Two mutually exclusive modes: (1) Socket Mode — manual `bot_token` (`xoxb-`) + `app_token` (`xapp-`) pasted by the user, validated via `auth.test`; (2) Managed relay — "Add to Slack" OAuth via the cloud broker, no tokens typed. | Socket Mode: `slack:default` profile (both tokens + `allowed_users`). Managed: `slack:team:<team_id>` per workspace (bot token, bot user id, installer id, domain, scope, allow-list); `slack:default` flips to `mode="relay"`. Multi-workspace by design. | `descriptors.py` + `setup.py:421-472` `managed_connect_slack_install`. |
| **Gmail** | OAuth, managed via cloud broker; manual path (raw access-token paste) exists but is currently `managed_paused=True` — pending Google app (CASA) verification. | Multi-account: `gmail:account:<email>` per mailbox (access/refresh token, scope, expiry); `gmail:default` is a pointer + account-wide "Never show agents" sender/label filters. | `managed_connect_account()` on OAuth callback; `migrate_legacy_default()` lazily upgrades a pre-multi-account single profile. |
| **Google Calendar** | Same shape as Gmail (OAuth, managed, same paused status, same Google app/consent screen). | `google_calendar:account:<email>` per account; no privacy filters (no equivalent feature yet). | Same pattern as Gmail. |
| **GitHub** | Manual: classic/fine-grained personal access token pasted by user. Managed: **GitHub App installation** via the broker — no PAT ever stored; short-lived installation tokens minted per call. | Manual: `github:default.token`. Managed: `github:install:<installation_id>` — routing metadata only (account login, repo selection, allow-list); **deliberately no token field**. | `managed_connect_install()` from the broker callback, or `connect_connector()` for the PAT path. |
| **HubSpot** | Manual: HubSpot private-app access token (`pat-…`), validated via a real API call. Also `managed=True` (cloud OAuth). | `hubspot:portal:<hub_id>` per portal (token, scope, sandbox flag); `hubspot:default` pointer + `hidden_fields` denylist (portal-wide). | `managed_connect_portal()` or manual token paste. |
| **Generic email (IMAP/SMTP)** | App password (`auth="app_password"`) — explicitly not OAuth. One connector covers Gmail/iCloud/Fastmail/custom via domain-based server presets. Validated with a live IMAP login. | Single profile: address, app password, optional advanced host/port overrides, display name. | Manual only, no managed path — for users who don't want to grant OAuth scopes. Distinct connector from OAuth "gmail." |
| **Browser automation** | `auth="none"` — no external account. Local Playwright-controlled Chromium instance. | Nothing in `SecretStore`. | Nothing to connect; unconditionally available. |

Shared connect/disconnect logic, in `setup.py`:
- `connect_connector()` (manual path) — validates required fields, calls `descriptor.validate(creds)` (a real API call), stores the identity string returned. **Notable bug-fix pattern**: the GUI shows a masked placeholder for an already-stored secret field; a masked resubmission is detected and explicitly ignored so it can't stomp the real stored value on an accidental re-save.
- `managed_connect_connector()` — same shape, fed by the cloud broker's OAuth callback.
- `disconnect_connector()` — deletes all accounts/portals/installs for multi-account connectors; for MCP-backed connectors also signs out of that OAuth session.
- Generic multi-account layer, `accounts.py` — a connector opts in by setting `descriptor.account_field` (a named field like `project_id`, or the sentinel `"@identity"` meaning "key by whatever the validator returned"). This single implementation now backs most newer connectors instead of each growing its own bespoke `_accounts.py` module the way Gmail/Calendar/HubSpot/Slack did historically — worth copying as-is: it's the part of their design that generalizes best.

---

## 3. Connected accounts → callable tools

Tools are plain Python callables carrying two dunder attributes their agent framework (`aisuite`) reads: `__coworker_schema__` (OpenAI-style function-calling JSON schema) and `__aisuite_tool_metadata__` (`ai.ToolMetadata(name, category, risk_level, capabilities, requires_approval)` — drives the approval-gating UX).

`make_integration_tools(secrets, *, enabled_connectors, enabled_tools, roots)` is the factory. It defines dozens of inline closures (one per tool) that **close over the secret store handle, not a resolved token** — so every tool call re-reads the current credential at call time instead of baking it into the model's context window. Two concrete examples from the code:

```python
# a write tool — requires_approval=True
def github_create_issue(owner: str, repo: str, title: str, body: str = "") -> dict[str, Any]:
    return _github_call(secrets, "POST", f"/repos/{owner}/{repo}/issues",
                         install=owner, json={"title": title, "body": body})
```

```python
# a read tool with a silent privacy filter — matches against the account's
# "Never show agents" sender/label rules are dropped from the model's result,
# but a hidden-count is surfaced to the human via a `_display` sidecar for audit
def gmail_search_messages(query: str, max_results: int = 10, account: str = "") -> dict[str, Any]:
    email, profile, err = _gmail_profile(secrets, account)  # resolves account + refreshes token in place
    ...
```

Account-resolution helpers (`_gmail_profile`, `_account_profile`, `_github_auth`, etc.) are the join point between "connected account" and "tool call": pick the requested-or-default account, transparently refresh a near-expiry managed OAuth token, and — for GitHub specifically — choose between a stored PAT and a freshly-minted, never-persisted installation token.

Enablement is policy-gated on top of connection: `tool_defs.tool_enabled()` / `active_tool_defs()` / `tool_dicts()` let a user flip individual tools on/off per connector, and a connector with both a manual API tool set and a pinned MCP tool set (e.g. Jira) exposes exactly one, chosen by the profile's `mode` field. `connector_for_tool(name)` maps a tool name back to its connector for UI/approval display.

---

## 4. Gateway vs. relay/cloud broker — these are not the same thing

**Gateway** (`gateway.py`) is a pure *inbound router* inside the always-on desktop process. It does not proxy outbound API calls. It: enforces the per-platform allow-list, tries an "inbox reply resolver" first (an inbound message might be resolving a pending approval rather than starting a new turn), hands authorized new messages to the agent runner, and parks unauthorized senders' messages instead of silently dropping them (so the owner can allow-and-deliver in one step).

**Relay** (`relay_client.py`, `github_relay.py`) answers "how do inbound events reach a desktop machine with no public webhook endpoint": one authenticated WebSocket from the desktop to OpenWorker Cloud, fanning out Slack/GitHub events by provider. This is one of *two mutually exclusive delivery modes* per platform — e.g. Slack Socket Mode (direct WebSocket to Slack, no cloud involved) vs. managed relay (cloud pushes inbound events; the desktop still replies **directly to Slack's own Web API** with its per-team bot token — the relay is inbound-only).

The key finding: **the cloud broker is a thin OAuth-handshake + (for GitHub only) short-lived-token-minting pass-through — not a general API proxy.** Their own code states "Connector tokens never touch cloud storage": the OAuth exchange happens through the broker, but the resulting long-lived token is form-POSTed back to the desktop's own loopback HTTP server and stored locally; every subsequent Gmail/Calendar/HubSpot/Slack API call goes directly from desktop to vendor using the locally-stored token. GitHub's managed path is the one deliberate exception — installation tokens are short-lived by design, so the broker (which holds the GitHub App's private key) mints one fresh on nearly every use rather than storing it at all.

This distinction matters for us: if we build a managed-OAuth flow, we should decide up front whether Mission Control's own backend plays the "cloud broker" role (handshake + short-lived token minting only, tokens stored per-tenant in our DB, never in a third-party service) — which is the direct analogue, since we already have a real multi-tenant backend and don't need an external broker at all.

---

## 5. Multi-tenancy / scoping — the part that doesn't transplant

There is no org/tenant concept in OpenWorker; scoping is entirely per-connected-external-account, on one machine:
- Slack: per-workspace (`team_id`) allow-lists — a Slack user id is only meaningful inside its `team_id`, so ids from two workspaces never collide.
- GitHub: per-installation (`installation_id`) allow-lists of sender logins, mirroring Slack's structure.
- Gmail/Calendar/HubSpot/generic accounts: per-mailbox/per-portal/per-account profiles, each with its own tokens; a `default_account`/`default_portal` pointer picks which one a tool call uses when the model doesn't specify one.

This is "multi-account," not "multi-tenant" — all accounts belong to the single human who owns the desktop instance. **For us, every one of these keys needs an extra `tenantId` (and possibly `clawId`) dimension it doesn't have here** — e.g. our equivalent of `gmail:account:<email>` would be `(tenantId, clawId, provider, externalAccountId)`, and the "default account" pointer becomes tenant-scoped, not global.

---

## 6. Security patterns worth carrying over as-is

These are tenancy-agnostic and line up with our own "Mandatory Standards" (validation, no secrets in logs, etc.):

- **Never in model context**: credentials are read from the store at tool-call time and never serialized into a prompt or trace. This is the single most important invariant and applies identically to a multi-tenant backend.
- **Scope minimization / consent tiers**: every connector's pre-connect UI copy is asserted (in their test suite) to stay truthful to its actual tool surface — e.g. HubSpot's "read vs. read & write" is a consent tier chosen at connect time; Notion/Google Drive are read-only by design (no delete/update tools exist for them at all, not just hidden behind a flag).
- **Field-level redaction is not an ACL**: HubSpot's `hidden_fields` denylist and Gmail's "Never show agents" sender/label filters strip data from the *model's* view at the tool layer; both are explicit that this is not a human-facing permission boundary — the real ACL is the vendor's own (HubSpot permission sets, Gmail account access).
- **No token-at-rest for GitHub App installs**: only routing metadata is persisted; live tokens are minted per-call and cached in-process memory only.
- **Git credential hygiene**: a GitHub token is injected as a one-shot `http.extraHeader` CLI flag for a single git invocation — never written to `.git/config` or any credential helper.
- **Revocation**: relay "revoked" frames (Slack `team revoked`, GitHub `installation revoked`) drop the in-memory team/installation entry immediately; `disconnect_connector()` deletes all associated profiles and, for MCP connectors, actively signs out of that OAuth session and deletes the seeded MCP server config.
- **Reconnect-safe secret handling**: a masked/placeholder resubmission from the UI is detected and refused, so a re-save with the masked value shown in the form can't silently wipe the real stored secret — called out in their own code as a fixed real bug, worth pre-empting rather than rediscovering.
- **Approval gating**: every write-shaped tool sets `requires_approval=True` via its metadata object; reads are low-risk/no-approval. A central `approval_for_tool()` mapping means individual tool authors can't quietly under-gate a write — this maps directly onto our existing `HilCapabilities` / mutative-approval-gate concept in `libs/claw-studio`.

---

## 7. Where this leaves our own connector model

Current state (`libs/claw-studio/src/connectors/`, `libs/claw-studio/src/gateway/`): `ChannelConnector`/`ChannelAdapter` cover exactly OpenWorker's "shape A" (Slack, Telegram — inbound/outbound messaging channels), already split the same way (config+verify now, inbound gateway wired separately), and already have per-channel `SECRET_FIELDS` masking and a `VerifyResult` "Test Connection" pattern that's functionally identical to `descriptor.validate()`. Nothing to redesign there.

What we don't have is OpenWorker's "shape B" — tool-only integration connectors (Gmail, Calendar, HubSpot, GitHub-as-API, Notion, etc.) that give the agent callable actions against an external account with no inbound channel involved. That's the gap the next implementation phase should target, and the concrete design questions it raises for our tenant model:

1. **Descriptor registry**: do we want a `ConnectorDescriptor`-equivalent (auth method, form fields, validate callback) as a data table, the same way `ConnectorConfig`/`SECRET_FIELDS` already work for channels? This seems directly portable.
2. **Per-tenant multi-account storage**: our Prisma schema needs the `(tenantId, clawId?, provider, externalAccountId)` keying discussed in §5 — not a single global secret file.
3. **OAuth broker role**: since we already have a real backend, "managed" OAuth for Gmail/Calendar/HubSpot doesn't need an external broker service — Mission Control's own API can play that role (handshake + token storage in our DB, refresh-on-near-expiry at tool-call time like `_gmail_profile` does).
4. **Tool closures re-reading credentials at call time**, never baking a token into the LangGraph state or prompt — this is a hard requirement to carry over, not optional.
5. **Approval-gating parity**: map "read vs. write" tool risk onto our existing `mutative_approval_gate` node the same way `requires_approval=True` does there.
6. **Redaction patterns**: whether an equivalent to Gmail's "Never show agents" filter or HubSpot's `hidden_fields` denylist is worth offering as tenant-configurable policy per connector.

None of this is a commitment yet — it's the shortlist to work from when we scope the actual implementation plan.

---

## Appendix: file-by-file summary (`coworker/connectors/`)

| File | Purpose |
|---|---|
| `__init__.py` | Public package surface — re-exports adapters, Gateway, setup functions, tool factories. |
| `base.py` | `BasePlatformAdapter` ABC + core value types (`MessageEvent`, `SessionSource`, `SendResult`, target-token grammar). |
| `config.py` | Per-platform `ConnectorSettings`/`TeamAuth` + `is_authorized()` inbound allow-list logic; loads from `SecretStore` + env overrides. |
| `accounts.py` | Generic multi-account profile layer (`<connector>:account:<id>`) shared by newer connectors. |
| `adapters.py` | Real `TelegramAdapter` (long-poll) and `SlackAdapter` (Socket Mode) + raw-event → `MessageEvent` mappers + `make_adapter()` factory. |
| `attribution.py` | Prefixes outbound Slack posts with `"[Name] "` when multiple humans share one bot identity in managed-relay mode. |
| `browser_automation.py` | Playwright-backed browser tool set — no external account. |
| `catalog_copy.py` | Pre-connect marketing-adjacent but access-honest copy shown before any credentials exist. |
| `cli.py` | Standalone CLI (`status` / `fake` REPL / `send`) for exercising connectors without the full server. |
| `descriptors.py` | The connector catalog: `ConnectorDescriptor`/`Field`/`ValidationResult` dataclasses, ~45 connector descriptors, validator functions. |
| `email_tools.py` | Generic IMAP/SMTP connector — server presets, MIME parsing, read/search/send tools, app-password validation. |
| `experimental/__init__.py` | Empty-by-default registry for risk-acknowledged, release-excluded connectors. |
| `fake.py` | `FakeAdapter` — in-memory platform for tests/CLI REPL. |
| `gateway.py` | Inbound router: allow-list enforcement, reply-vs-new-turn dispatch, parking, recent-senders tracking. |
| `gcal_accounts.py` | Google Calendar per-account profile CRUD, same shape as `gmail_accounts.py` minus filters. |
| `github_installs.py` | Per-GitHub-App-installation profile store — deliberately token-less; routing metadata + allow-lists only. |
| `github_relay.py` | `GitHubRelayAdapter` — maps relay frames to `MessageEvent`s, posts replies via minted installation tokens. |
| `gmail_accounts.py` | Gmail per-mailbox profile store + "Never show agents" sender/label filter policy. |
| `hubspot_portals.py` | HubSpot per-portal profile store + `hidden_fields` denylist enforcement helper. |
| `integration_tools.py` | The big tool factory (`make_integration_tools`) — dozens of per-connector API-calling tool closures (GitHub, Gmail, Calendar, HubSpot, Jira, GitLab, Linear, QuickBooks, etc.). |
| `parked.py` | `ParkedStore`/`ParkedMessage` — JSON-backed queue of unauthorized inbound messages awaiting owner action. |
| `relay_client.py` | `RelayHub` (shared cloud WebSocket) + `SlackRelayAdapter` (managed Slack relay mode). |
| `senders.py` | Stateless one-shot HTTP senders for Slack/Telegram outbound + Slack file upload. |
| `setup.py` | Connect/disconnect/list orchestration — `connect_connector`, `managed_connect_connector`, `connector_list`, per-connector list helpers. |
| `slack_addr.py` | Team-qualified Slack chat-id encoding (`"T…/C…"`) for multi-workspace relay addressing. |
| `slack_directory.py` | Cached Slack workspace roster reads (`users.list`/`conversations.list`) powering GUI pickers. |
| `tool_defs.py` | `ConnectorToolDef` catalog, per-tool enable/disable settings, approval-kind lookup, MCP-vs-API tool-set selection. |
| `tools.py` | `send_message`/`send_file` cross-platform outbound tools (channel-name resolution, token lookup, approval gating). |

Also read outside `connectors/` for context: `coworker/secrets.py` (the `SecretStore` implementation) and `coworker/cloud.py` (the OpenWorker Cloud broker client — sign-in, managed-OAuth start/callback/refresh, GitHub installation-token minting).

**Caveats**: the OpenWorker Cloud broker's own server-side implementation is not in this repo (referenced as an external/private service `opencoworker-cloud`) — only the desktop-side client contract in `cloud.py` was inspected, so exact broker-side scope enforcement or storage can't be confirmed from this codebase alone. OS-keychain integration is a stated *future* direction in `secrets.py`'s docstring, not something implemented today.
