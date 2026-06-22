# WhatsApp Graph Nodes — End-to-End Testing Guide

How to test the `whatsapp_trigger`, `whatsapp_send`, and `whatsapp_send_template` graph nodes end-to-end.

---

## What You Need

| Requirement | Details |
|---|---|
| Running app | Next.js dev server on port 3005 |
| PostgreSQL | Docker container via `docker compose up -d` |
| Public webhook URL | ngrok tunnel (Meta can't reach localhost) |
| Meta Developer App | WhatsApp product added, Live mode OR test number registered |
| WhatsApp Business Account | WABA with a registered phone number |
| Environment variables | `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `ENCRYPTION_KEY` |

---

## Environment Variables

Add these to your `.env` file:

```env
META_APP_SECRET=<your-meta-app-secret>
META_WEBHOOK_VERIFY_TOKEN=<any-string-you-choose-eg-my-verify-token-123>
ENCRYPTION_KEY=<32-char-hex-string>
```

Generate `ENCRYPTION_KEY`:
```bash
openssl rand -hex 32
```

---

## Step 1 — Start the Environment

```bash
docker compose up -d
bun run dev
# Optional — run workers too:
bun run dev:workers
```

---

## Step 2 — Start an ngrok Tunnel

Meta's servers need a publicly accessible URL to send webhooks to.

```bash
npx ngrok http 3005
```

Copy the HTTPS URL, e.g. `https://abc123.ngrok.io`. Your webhook endpoint will be:

```
https://abc123.ngrok.io/api/webhooks/whatsapp
```

Keep ngrok running for the duration of testing. The URL changes on every restart unless you have a paid ngrok account.

---

## Step 3 — Connect Your WhatsApp Account

1. Go to `http://localhost:3005`
2. Navigate to **Settings → Channels → WhatsApp**
3. Click **Connect Account**
4. Complete the Facebook OAuth flow
5. Your WhatsApp account will appear in the list with status **connected**

---

## Step 4 — Register the Webhook with Meta

1. Open your [Meta App Dashboard](https://developers.facebook.com/apps)
2. Select your app → **WhatsApp → Configuration**
3. Under **Webhook**, click **Edit**
4. Set:
   - **Callback URL**: `https://abc123.ngrok.io/api/webhooks/whatsapp`
   - **Verify Token**: the value you set as `META_WEBHOOK_VERIFY_TOKEN` in `.env`
5. Click **Verify and Save**
6. Under **Webhook Fields**, subscribe to: `messages`

If verification fails: check ngrok is running and `META_WEBHOOK_VERIFY_TOKEN` matches exactly.

---

## Step 5 — Build the Graph Agent

1. Go to **Agent Studio → Agents → New Agent**
2. Name it anything, set Type to **Graph**
3. Build this graph in the canvas:

```
[WhatsApp Trigger] → [LLM] → [WhatsApp Send]
```

### Node configuration

**WhatsApp Trigger**
- No configuration required
- It auto-reads: `wa_sender_id`, `wa_message_text`, `wa_message_type`, `wa_within_window` from the incoming message

**LLM**
- Model: your Bedrock model (e.g. `us.anthropic.claude-sonnet-4-5-20250514-v1:0`)
- System Prompt: `You are a helpful assistant.`
- Context Channels: `wa_message_text` (so it reads the WhatsApp message text)
- Output Channel: `llm_output`

**WhatsApp Send**
- Message Type: `text`
- Message Channel: `llm_output`

4. Save the agent and set it to **Active**

---

## Step 6 — Set Up Routing

1. Go to **Settings → Channels → WhatsApp → your account → Routing**
2. Set:
   - **Strategy**: `keyword` (simplest) or leave as default
   - **Fallback Agent**: select the graph agent you just created
3. Save

This tells the system: when a WhatsApp message arrives on this number, route it to your graph agent.

---

## Step 7 — Send a Test Message

Send a WhatsApp message from your personal phone to the connected business number.

You should receive a reply within a few seconds.

---

## What to Watch in Logs

```
[INFO] WhatsApp trigger processed   { senderId: "91...", messageType: "text" }
[INFO] WhatsApp message sent        { senderId: "91...", messageType: "text", sentMessageId: "wamid.xxx" }
```

If the `whatsapp_send` node handled delivery, the MessageProcessor skips its own send. You'll see the trigger log and the send log from inside the graph executor.

---

## Testing the 24-Hour Window Split

To test `whatsapp_send_template` (outside the 24h window):

Build this graph instead:

```
[WhatsApp Trigger]
        |
[Condition: wa_within_window == true]
     |              |
    yes             no
     |              |
[WhatsApp Send]   [WhatsApp Send Template]
(freeform reply)  (template reply)
```

**WhatsApp Send Template** config:
- Template Name: name of an approved template in your Meta account (e.g. `hello_world`)
- Language Code: `en` or `en_US`
- Components Channel: (leave empty for templates with no variables)

---

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| Webhook verification failed (403) | `META_WEBHOOK_VERIFY_TOKEN` mismatch | Make sure `.env` value matches Meta dashboard exactly |
| `wa_sender_id is missing` | Graph entry node is not `whatsapp_trigger` | Check the graph — trigger node must be the entry point (no incoming edges) |
| `WhatsAppAccount not found` | Routing rule not set OR account not connected | Set the fallback agent in the routing config |
| Meta API error 131047 | Outside 24h window, sending freeform message | Use `WhatsApp Send Template` node for re-engagement |
| Meta API error: model ID on-demand throughput | Wrong Bedrock model ID format | Use cross-region prefix: `us.anthropic.claude-...` |
| ngrok URL expired | ngrok restarted, URL changed | Re-register the new ngrok URL in Meta dashboard |
| No reply received | Workers not running | Run `bun run dev:workers` |

---

## Local Smoke Test (No Meta Account)

You can simulate an inbound webhook to test the graph execution path without a real WhatsApp number. You need a valid HMAC-SHA256 signature.

```bash
# Replace <BODY> with your JSON payload
# Replace <SECRET> with your META_APP_SECRET

BODY='{"object":"whatsapp_business_account","entry":[{"id":"WABA_ID","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550001234","phone_number_id":"PHONE_NUMBER_ID"},"contacts":[{"profile":{"name":"Test User"},"wa_id":"919876543210"}],"messages":[{"from":"919876543210","id":"wamid.test001","timestamp":"1700000000","type":"text","text":{"body":"Hello"}}]}}]}]}'

SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "<SECRET>" | awk '{print $2}')

curl -X POST http://localhost:3005/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$BODY"
```

Replace `WABA_ID` and `PHONE_NUMBER_ID` with values from your connected WhatsApp account in the DB (or from the Meta dashboard). The routing lookup requires the `phone_number_id` to match a real `WhatsAppAccount` record.

---

## Graph Channel Reference

These channels are available to all nodes after `whatsapp_trigger` runs:

| Channel | Type | Value |
|---|---|---|
| `wa_sender_id` | string | Customer's WhatsApp phone number |
| `wa_message_text` | string | Text body of the message (empty if media) |
| `wa_message_type` | string | `text`, `image`, `audio`, `video`, `document`, etc. |
| `wa_media_id` | string \| null | Meta media ID (media messages only) |
| `wa_phone_number_id` | string | Your WhatsApp phone number ID (Meta) |
| `wa_account_id` | string | Your WhatsApp account DB ID |
| `wa_session_id` | string | Conversation session DB ID |
| `wa_within_window` | boolean | True if within 24h customer service window |
