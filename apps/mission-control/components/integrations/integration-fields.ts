import type { FieldSpec } from '@/components/connectors/channel-fields';
import type { IntegrationId } from '@/hooks/use-integrations';

/**
 * Manual (non-OAuth) integrations only. OAuth-mode integrations (Gmail,
 * Google Calendar, Google Drive, Outlook, Notion) have no entry here: they
 * connect via a direct link straight to the provider's consent screen (see
 * integrations-client.tsx's "Connect" button) and never render a form or
 * this walkthrough.
 */
export interface IntegrationFieldConfig {
  fields: FieldSpec[];
  /** Fields forwarded to the /test route as not-yet-saved overrides. */
  testOverrideKeys: string[];
  setupHint: string;
  /** Numbered walkthrough rendered below the credentials form. */
  setupSteps: string[];
}

export const INTEGRATION_FIELDS: Partial<Record<IntegrationId, IntegrationFieldConfig>> = {
  github: {
    fields: [
      {
        name: 'token',
        label: 'Personal Access Token',
        secret: true,
        required: true,
        placeholder: 'ghp_… or github_pat_…',
        hint: 'GitHub → Settings → Developer settings → Personal access tokens. Needs repo scope to read and write issues.',
      },
    ],
    testOverrideKeys: ['token'],
    setupHint: 'Test Connection calls GitHub’s /user endpoint with this token.',
    setupSteps: [
      'Go to GitHub → Settings → Developer settings → Personal access tokens.',
      'Generate a new token (classic or fine-grained) with the repo scope, so Claw can read and write issues.',
      'Copy the token and paste it into the field above.',
      'Click Test Connection to verify it works.',
    ],
  },
  hubspot: {
    fields: [
      {
        name: 'token',
        label: 'Private App Access Token',
        secret: true,
        required: true,
        placeholder: 'pat-…',
        hint: 'HubSpot → Settings → Integrations → Private Apps → create an app with CRM scopes, then copy its access token.',
      },
    ],
    testOverrideKeys: ['token'],
    setupHint: 'Test Connection reads your HubSpot account info to identify the portal.',
    setupSteps: [
      'Go to HubSpot → Settings → Integrations → Private Apps.',
      'Create a private app and add CRM scopes for contacts (read and write).',
      'Copy the generated access token and paste it into the field above.',
      'Click Test Connection to confirm it identifies your portal.',
    ],
  },
  email: {
    fields: [
      {
        name: 'address',
        label: 'Email Address',
        secret: false,
        required: true,
        placeholder: 'you@example.com',
      },
      {
        name: 'appPassword',
        label: 'App Password',
        secret: true,
        required: true,
        hint: 'Most providers (Gmail, Outlook, Yahoo) require a per-app password, not your normal login password.',
      },
      {
        name: 'imapHost',
        label: 'IMAP Host (advanced)',
        secret: false,
        placeholder: 'auto-detected from your email domain',
      },
      {
        name: 'imapPort',
        label: 'IMAP Port (advanced)',
        secret: false,
        placeholder: '993',
      },
      {
        name: 'smtpHost',
        label: 'SMTP Host (advanced)',
        secret: false,
        placeholder: 'auto-detected from your email domain',
      },
      {
        name: 'smtpPort',
        label: 'SMTP Port (advanced)',
        secret: false,
        placeholder: '587',
      },
    ],
    testOverrideKeys: ['address', 'appPassword', 'imapHost', 'imapPort', 'smtpHost', 'smtpPort'],
    setupHint: 'Test Connection performs a live IMAP login with these settings.',
    setupSteps: [
      'Generate an app password from your provider — not your normal login password. Gmail: myaccount.google.com/apppasswords. Outlook/Hotmail/Live: Microsoft account → Security → App passwords. Yahoo: Account Security → Generate app password.',
      'Enter your email address and the app password above.',
      'Leave the advanced IMAP/SMTP host and port fields blank for Gmail, Outlook, Hotmail, Live, or Yahoo — they’re auto-detected from your domain.',
      'For any other provider, fill in the IMAP and SMTP host/port from your provider’s docs (usually IMAP port 993, SMTP port 587 or 465).',
      'Click Test Connection — note this only verifies IMAP login, not SMTP sending.',
    ],
  },
  jira: {
    fields: [
      {
        name: 'site',
        label: 'Jira Site',
        secret: false,
        required: true,
        placeholder: 'yourcompany (or a full custom domain)',
        hint: 'Just the subdomain from yourcompany.atlassian.net — or a full custom domain if you use one.',
      },
      {
        name: 'email',
        label: 'Email Address',
        secret: false,
        required: true,
        placeholder: 'you@example.com',
        hint: 'The email address of the Atlassian account the API token belongs to.',
      },
      {
        name: 'apiToken',
        label: 'API Token',
        secret: true,
        required: true,
        placeholder: 'ATATT3x...',
        hint: 'id.atlassian.com/manage-profile/security/api-tokens → Create API token.',
      },
    ],
    testOverrideKeys: ['site', 'email', 'apiToken'],
    setupHint: 'Test Connection calls Jira’s /myself endpoint with these credentials.',
    setupSteps: [
      'Go to id.atlassian.com/manage-profile/security/api-tokens (while signed in to your Atlassian account).',
      'Click Create API token, give it a label, and copy the generated token.',
      'Enter your Jira site (the subdomain from yourcompany.atlassian.net), your Atlassian account email, and the token above.',
      'Click Test Connection to verify it works.',
    ],
  },
  linear: {
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'lin_api_…',
        hint: 'Linear → Settings → Security & access → Personal API keys.',
      },
    ],
    testOverrideKeys: ['apiKey'],
    setupHint: 'Test Connection queries Linear’s GraphQL API for the current viewer.',
    setupSteps: [
      'In Linear, open Settings → Security & access → Personal API keys.',
      'Create a key and paste it into the field above.',
      'Click Test Connection to verify it works.',
    ],
  },
  gitlab: {
    fields: [
      {
        name: 'baseUrl',
        label: 'GitLab URL (advanced)',
        secret: false,
        placeholder: 'leave empty for gitlab.com',
        hint: 'Only needed for a self-hosted GitLab instance.',
      },
      {
        name: 'token',
        label: 'Personal Access Token',
        secret: true,
        required: true,
        placeholder: 'glpat-…',
        hint: 'Needs the read_api scope (api for write actions).',
      },
    ],
    testOverrideKeys: ['baseUrl', 'token'],
    setupHint: 'Test Connection calls GitLab’s /user endpoint with this token.',
    setupSteps: [
      'Create a GitLab personal access token with the read_api scope (api for write actions).',
      'For self-hosted GitLab, enter your instance URL above; leave it blank for gitlab.com.',
      'Click Test Connection to verify it works.',
    ],
  },
  confluence: {
    fields: [
      {
        name: 'baseUrl',
        label: 'Atlassian Site URL',
        secret: false,
        required: true,
        placeholder: 'https://yourcompany.atlassian.net',
      },
      {
        name: 'email',
        label: 'Email Address',
        secret: false,
        required: true,
        placeholder: 'you@example.com',
        hint: 'The email address of the Atlassian account the API token belongs to.',
      },
      {
        name: 'apiToken',
        label: 'API Token',
        secret: true,
        required: true,
        placeholder: 'ATATT3x...',
        hint: 'id.atlassian.com/manage-profile/security/api-tokens → Create API token.',
      },
    ],
    testOverrideKeys: ['baseUrl', 'email', 'apiToken'],
    setupHint: 'Test Connection calls Confluence’s /user/current endpoint with these credentials.',
    setupSteps: [
      'Go to id.atlassian.com/manage-profile/security/api-tokens (while signed in to your Atlassian account).',
      'Click Create API token, give it a label, and copy the generated token.',
      'Enter your Atlassian site URL, account email, and the token above.',
      'Click Test Connection to verify it works.',
    ],
  },
  zendesk: {
    fields: [
      {
        name: 'subdomain',
        label: 'Zendesk Subdomain',
        secret: false,
        required: true,
        placeholder: 'acme',
        hint: 'For example, "acme" for acme.zendesk.com.',
      },
      {
        name: 'email',
        label: 'Agent Email',
        secret: false,
        required: true,
        placeholder: 'you@example.com',
      },
      {
        name: 'apiToken',
        label: 'API Token',
        secret: true,
        required: true,
      },
    ],
    testOverrideKeys: ['subdomain', 'email', 'apiToken'],
    setupHint: 'Test Connection calls Zendesk’s /users/me endpoint with these credentials.',
    setupSteps: [
      'In Zendesk, create an API token (Admin Center → Apps and integrations → APIs → Zendesk API).',
      'Enter your subdomain, agent email, and the token above.',
      'Click Test Connection to verify it works.',
    ],
  },
  clickup: {
    fields: [
      {
        name: 'apiToken',
        label: 'Personal API Token',
        secret: true,
        required: true,
        placeholder: 'pk_…',
        hint: 'ClickUp → Settings → Apps → API Token.',
      },
    ],
    testOverrideKeys: ['apiToken'],
    setupHint: 'Test Connection calls ClickUp’s /user endpoint with this token.',
    setupSteps: [
      'In ClickUp, open Settings → Apps and generate a personal API token.',
      'Paste it into the field above.',
      'Click Test Connection to verify it works.',
    ],
  },
  asana: {
    fields: [
      {
        name: 'token',
        label: 'Personal Access Token',
        secret: true,
        required: true,
        hint: 'Asana → My Settings → Apps → Manage developer apps → Create personal access token.',
      },
    ],
    testOverrideKeys: ['token'],
    setupHint: 'Test Connection calls Asana’s /users/me endpoint with this token.',
    setupSteps: [
      'In Asana, open My Settings → Apps → Manage developer apps.',
      'Create a personal access token and paste it above.',
      'Click Test Connection to verify it works.',
    ],
  },
  attio: {
    fields: [
      {
        name: 'accessToken',
        label: 'API Key',
        secret: true,
        required: true,
        hint: 'Attio → Workspace Settings → Developers → API keys.',
      },
    ],
    testOverrideKeys: ['accessToken'],
    setupHint: 'Test Connection calls Attio’s /v2/self endpoint with this key.',
    setupSteps: [
      'In Attio, open Workspace Settings → Developers and create an API key.',
      'Paste it into the field above.',
      'Click Test Connection to verify it works.',
    ],
  },
  apollo: {
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        hint: 'Apollo → Settings → Integrations → API.',
      },
      {
        name: 'label',
        label: 'Account Label (optional)',
        secret: false,
        placeholder: 'work',
        hint: 'Names this account — useful if you connect more than one Apollo account.',
      },
    ],
    testOverrideKeys: ['apiKey', 'label'],
    setupHint: 'Test Connection calls Apollo’s /auth/health endpoint with this key.',
    setupSteps: [
      'In Apollo, open Settings → Integrations → API and create an API key.',
      'Paste it above. Enrichment and search endpoints require a paid Apollo plan.',
      'Click Test Connection to verify it works.',
    ],
  },
  hunter: {
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        hint: 'hunter.io → API → API keys.',
      },
    ],
    testOverrideKeys: ['apiKey'],
    setupHint: 'Test Connection calls Hunter’s /account endpoint with this key.',
    setupSteps: [
      'In Hunter, open API → API keys and copy your key.',
      'Paste it into the field above.',
      'Click Test Connection to verify it works.',
    ],
  },
  close: {
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'api_…',
        hint: 'Close → Settings → Developer → API Keys.',
      },
    ],
    testOverrideKeys: ['apiKey'],
    setupHint: 'Test Connection calls Close’s /me endpoint with this key.',
    setupSteps: [
      'In Close, open Settings → Developer → API Keys and create a key.',
      'Paste it into the field above.',
      'Click Test Connection to verify it works.',
    ],
  },
  stripe: {
    fields: [
      {
        name: 'apiKey',
        label: 'Restricted API Key',
        secret: true,
        required: true,
        placeholder: 'rk_live_…',
        hint: 'Create a restricted key with read access to Customers, Charges, and Invoices — this connector only exposes read tools.',
      },
    ],
    testOverrideKeys: ['apiKey'],
    setupHint: 'Test Connection calls Stripe’s /account endpoint with this key.',
    setupSteps: [
      'In the Stripe Dashboard, create a restricted API key with read access to Customers, Charges, and Invoices.',
      'Paste it into the field above.',
      'Click Test Connection to verify it works.',
    ],
  },
  quickbooks: {
    fields: [
      {
        name: 'accessToken',
        label: 'OAuth Access Token',
        secret: true,
        required: true,
        hint: 'From a QuickBooks app authorized against your company. Intuit access tokens expire after about an hour.',
      },
      {
        name: 'realmId',
        label: 'Company ID (Realm ID)',
        secret: false,
        required: true,
        hint: 'Shown during OAuth authorization and in the developer playground.',
      },
      {
        name: 'environment',
        label: 'Environment (advanced)',
        secret: false,
        placeholder: 'production',
        hint: '"production" (default) or "sandbox".',
      },
    ],
    testOverrideKeys: ['accessToken', 'realmId', 'environment'],
    setupHint: 'Test Connection calls QuickBooks’ /companyinfo endpoint with these credentials.',
    setupSteps: [
      'Create an app at developer.intuit.com and authorize it against your company (the OAuth playground works for testing).',
      'Copy the access token and company ID (realm ID) above.',
      'Click Test Connection to verify it works — remember the token expires hourly.',
    ],
  },
  docusign: {
    fields: [
      {
        name: 'accessToken',
        label: 'OAuth Access Token',
        secret: true,
        required: true,
        hint: 'From a Docusign app (JWT or authorization-code grant).',
      },
    ],
    testOverrideKeys: ['accessToken'],
    setupHint: 'Test Connection calls Docusign’s /oauth/userinfo endpoint with this token.',
    setupSteps: [
      'Create an app in the Docusign developer console and complete an OAuth grant.',
      'Paste the access token above — the account and API base are discovered automatically.',
      'Click Test Connection to verify it works.',
    ],
  },
  dropbox: {
    fields: [
      {
        name: 'accessToken',
        label: 'OAuth Access Token',
        secret: true,
        required: true,
        hint: 'Needs files.metadata.read and files.content.read scopes.',
      },
    ],
    testOverrideKeys: ['accessToken'],
    setupHint: 'Test Connection calls Dropbox’s /users/get_current_account endpoint with this token.',
    setupSteps: [
      'Create an app in the Dropbox App Console with files.metadata.read and files.content.read scopes.',
      'Generate an access token and paste it above.',
      'Click Test Connection to verify it works.',
    ],
  },
  box: {
    fields: [
      {
        name: 'accessToken',
        label: 'Access Token',
        secret: true,
        required: true,
        hint: 'A Box developer token or OAuth access token.',
      },
    ],
    testOverrideKeys: ['accessToken'],
    setupHint: 'Test Connection calls Box’s /users/me endpoint with this token.',
    setupSteps: [
      'Create a Box app at app.box.com/developers/console.',
      'Generate a developer token (or OAuth access token) and paste it above.',
      'Click Test Connection to verify it works.',
    ],
  },
  posthog: {
    fields: [
      {
        name: 'baseUrl',
        label: 'PostHog URL (advanced)',
        secret: false,
        placeholder: 'https://us.posthog.com',
        hint: 'Leave empty for US cloud; set for EU cloud or self-hosted.',
      },
      {
        name: 'apiKey',
        label: 'Personal API Key',
        secret: true,
        required: true,
        placeholder: 'phx_…',
        hint: 'Settings → Personal API keys (read access is enough).',
      },
      {
        name: 'projectId',
        label: 'Project ID',
        secret: false,
        required: true,
        hint: 'Settings → Project → Project ID. Connect again to add another project.',
      },
    ],
    testOverrideKeys: ['baseUrl', 'apiKey', 'projectId'],
    setupHint: 'Test Connection calls PostHog’s /users/@me endpoint with these credentials.',
    setupSteps: [
      'In PostHog, open Settings → Personal API keys and create a key.',
      'Copy your Project ID from Settings → Project.',
      'Click Test Connection to verify it works — one project per account, connect again to add another.',
    ],
  },
  mixpanel: {
    fields: [
      {
        name: 'username',
        label: 'Service Account Username',
        secret: false,
        required: true,
      },
      {
        name: 'secret',
        label: 'Service Account Secret',
        secret: true,
        required: true,
      },
      {
        name: 'projectId',
        label: 'Project ID',
        secret: false,
        required: true,
        hint: 'Project Settings. Connect again to add another project.',
      },
    ],
    testOverrideKeys: ['username', 'secret', 'projectId'],
    setupHint: 'Test Connection calls Mixpanel’s /api/app/me endpoint with these credentials.',
    setupSteps: [
      'In Mixpanel, open Organization Settings → Service Accounts and create one.',
      'Copy the username, the secret, and your Project ID (Project Settings).',
      'Click Test Connection to verify it works.',
    ],
  },
  amplitude: {
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        hint: 'Project Settings → API Keys.',
      },
      {
        name: 'secretKey',
        label: 'Secret Key',
        secret: true,
        required: true,
      },
    ],
    testOverrideKeys: ['apiKey', 'secretKey'],
    setupHint: 'Test Connection calls Amplitude’s /annotations endpoint with these credentials.',
    setupSteps: [
      'In Amplitude, open Settings → Projects → your project → API Keys.',
      'Copy the API key and secret key above. One project per account.',
      'Click Test Connection to verify it works.',
    ],
  },
  figma: {
    fields: [
      {
        name: 'accessToken',
        label: 'Personal Access Token',
        secret: true,
        required: true,
        placeholder: 'figd_…',
        hint: 'Figma → Settings → Security → Personal access tokens.',
      },
    ],
    testOverrideKeys: ['accessToken'],
    setupHint: 'Test Connection calls Figma’s /me endpoint with this token.',
    setupSteps: [
      'In Figma, open Settings → Security and generate a personal access token.',
      'Paste it into the field above.',
      'Click Test Connection to verify it works.',
    ],
  },
  canva: {
    fields: [
      {
        name: 'accessToken',
        label: 'OAuth Access Token',
        secret: true,
        required: true,
        hint: 'From a Canva Connect integration.',
      },
    ],
    testOverrideKeys: ['accessToken'],
    setupHint: 'Test Connection calls Canva’s /users/me/profile endpoint with this token.',
    setupSteps: [
      'Create a Connect integration at canva.com/developers and complete an OAuth grant.',
      'Paste the access token above.',
      'Click Test Connection to verify it works.',
    ],
  },
  whatsapp: {
    fields: [
      {
        name: 'accessToken',
        label: 'Access Token',
        secret: true,
        required: true,
        hint: "From your Meta app's WhatsApp setup page (a system-user token for long-lived access).",
      },
      {
        name: 'phoneNumberId',
        label: 'Phone Number ID',
        secret: false,
        required: true,
        hint: 'The Cloud API phone number ID (not the phone number itself).',
      },
    ],
    testOverrideKeys: ['accessToken', 'phoneNumberId'],
    setupHint: 'Test Connection calls Meta’s Graph API for this phone number.',
    setupSteps: [
      'Create a Meta app at developers.facebook.com and add the WhatsApp product.',
      'Copy the access token and the phone number ID from the API setup page.',
      'Note: free-form messages only reach people who messaged your number in the last 24 hours; outside that window only approved templates deliver.',
      'Click Test Connection to verify it works.',
    ],
  },
};
