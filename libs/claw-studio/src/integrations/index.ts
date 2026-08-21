/**
 * index.ts — aggregates every connected integration's tools into one array for
 * `claw-runtime.ts` to splice into the graph's tool list.
 *
 * Async, and filters per-integration on `listAccounts().length > 0` first —
 * mirrors `createMcpTools`'s filtering-out-unreachable-servers behavior — so
 * the model never sees e.g. `github_create_issue` before GitHub is actually
 * connected; discovering "not connected" by calling it would just burn a turn.
 */

import type { StructuredTool } from '@langchain/core/tools';
import { createLogger } from '@chatbot/shared';
import { IntegrationConfigService } from './account-config-service';
import { createGithubTools, githubDescriptor } from './github';
import { createHubspotTools, hubspotDescriptor } from './hubspot';
import { createEmailTools, emailDescriptor } from './email';
import { createNotionTools, notionDescriptor } from './notion';
import { createGmailTools, gmailDescriptor } from './gmail';
import { createGoogleCalendarTools, googleCalendarDescriptor } from './google-calendar';
import { createGoogleDriveTools, googleDriveDescriptor } from './google-drive';
import { createOutlookTools, outlookDescriptor } from './outlook';
import { createJiraTools, jiraDescriptor } from './jira';
import { createLinearTools, linearDescriptor } from './linear';
import { createGitlabTools, gitlabDescriptor } from './gitlab';
import { createConfluenceTools, confluenceDescriptor } from './confluence';
import { createZendeskTools, zendeskDescriptor } from './zendesk';
import { createClickupTools, clickupDescriptor } from './clickup';
import { createAsanaTools, asanaDescriptor } from './asana';
import { createAttioTools, attioDescriptor } from './attio';
import { createApolloTools, apolloDescriptor } from './apollo';
import { createHunterTools, hunterDescriptor } from './hunter';
import { createCloseTools, closeDescriptor } from './close';
import { createStripeTools, stripeDescriptor } from './stripe';
import { createQuickbooksTools, quickbooksDescriptor } from './quickbooks';
import { createDocusignTools, docusignDescriptor } from './docusign';
import { createDropboxTools, dropboxDescriptor } from './dropbox';
import { createBoxTools, boxDescriptor } from './box';
import { createPosthogTools, posthogDescriptor } from './posthog';
import { createMixpanelTools, mixpanelDescriptor } from './mixpanel';
import { createAmplitudeTools, amplitudeDescriptor } from './amplitude';
import { createFigmaTools, figmaDescriptor } from './figma';
import { createCanvaTools, canvaDescriptor } from './canva';
import { createWhatsappTools, whatsappDescriptor } from './whatsapp';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations');

const FACTORIES: Array<{ descriptor: IntegrationDescriptor; build: (tenantId: string) => StructuredTool[] }> = [
  { descriptor: githubDescriptor, build: createGithubTools },
  { descriptor: hubspotDescriptor, build: createHubspotTools },
  { descriptor: emailDescriptor, build: createEmailTools },
  { descriptor: notionDescriptor, build: createNotionTools },
  { descriptor: gmailDescriptor, build: createGmailTools },
  { descriptor: googleCalendarDescriptor, build: createGoogleCalendarTools },
  { descriptor: googleDriveDescriptor, build: createGoogleDriveTools },
  { descriptor: outlookDescriptor, build: createOutlookTools },
  { descriptor: jiraDescriptor, build: createJiraTools },
  { descriptor: linearDescriptor, build: createLinearTools },
  { descriptor: gitlabDescriptor, build: createGitlabTools },
  { descriptor: confluenceDescriptor, build: createConfluenceTools },
  { descriptor: zendeskDescriptor, build: createZendeskTools },
  { descriptor: clickupDescriptor, build: createClickupTools },
  { descriptor: asanaDescriptor, build: createAsanaTools },
  { descriptor: attioDescriptor, build: createAttioTools },
  { descriptor: apolloDescriptor, build: createApolloTools },
  { descriptor: hunterDescriptor, build: createHunterTools },
  { descriptor: closeDescriptor, build: createCloseTools },
  { descriptor: stripeDescriptor, build: createStripeTools },
  { descriptor: quickbooksDescriptor, build: createQuickbooksTools },
  { descriptor: docusignDescriptor, build: createDocusignTools },
  { descriptor: dropboxDescriptor, build: createDropboxTools },
  { descriptor: boxDescriptor, build: createBoxTools },
  { descriptor: posthogDescriptor, build: createPosthogTools },
  { descriptor: mixpanelDescriptor, build: createMixpanelTools },
  { descriptor: amplitudeDescriptor, build: createAmplitudeTools },
  { descriptor: figmaDescriptor, build: createFigmaTools },
  { descriptor: canvaDescriptor, build: createCanvaTools },
  { descriptor: whatsappDescriptor, build: createWhatsappTools },
];

/** One connected integration, for the "what you have connected" prompt section. */
export interface ConnectedIntegration {
  name: string;
  displayName: string;
  description: string;
}

export interface IntegrationToolsResult {
  tools: StructuredTool[];
  /**
   * The integrations that actually have an account connected.
   *
   * Returned alongside the tools rather than from a second function because
   * establishing this costs one `listAccounts()` round-trip per descriptor (~30
   * queries) and that work is already being done here — asking again would double
   * it on the critical path of every run.
   */
  connected: ConnectedIntegration[];
}

export async function createIntegrationTools(tenantId: string): Promise<IntegrationToolsResult> {
  // One `listAccounts()` round-trip per descriptor, issued concurrently. This
  // ran sequentially before — ~30 awaited queries back-to-back on the critical
  // path of EVERY run, which is seconds of dead time once the database isn't
  // local. Order is preserved because Promise.all resolves positionally, so the
  // tool list the model sees stays stable.
  const results = await Promise.all(
    FACTORIES.map(async ({ descriptor, build }) => {
      try {
        const accounts = await new IntegrationConfigService(tenantId, descriptor).listAccounts();
        if (accounts.length === 0) return { tools: [], descriptor: null };
        return { tools: await build(tenantId), descriptor };
      } catch (error) {
        logger.warn({ error, tenantId, integration: descriptor.name }, 'Failed to load integration tools — skipping');
        return { tools: [], descriptor: null };
      }
    }),
  );

  return {
    tools: results.flatMap((r) => r.tools),
    connected: results
      .map((r) => r.descriptor)
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => ({ name: d.name, displayName: d.displayName, description: d.description })),
  };
}

export * from './types';
export { IntegrationConfigService, OAuthReauthRequiredError } from './account-config-service';
export type { IntegrationAccountSummary } from './account-config-service';
export { githubDescriptor, createGithubTools } from './github';
export { hubspotDescriptor, createHubspotTools } from './hubspot';
export { emailDescriptor, createEmailTools } from './email';
export { notionDescriptor, createNotionTools } from './notion';
export { gmailDescriptor, createGmailTools } from './gmail';
export { googleCalendarDescriptor, createGoogleCalendarTools } from './google-calendar';
export { googleDriveDescriptor, createGoogleDriveTools } from './google-drive';
export { outlookDescriptor, createOutlookTools } from './outlook';
export { jiraDescriptor, createJiraTools } from './jira';
export { linearDescriptor, createLinearTools } from './linear';
export { gitlabDescriptor, createGitlabTools } from './gitlab';
export { confluenceDescriptor, createConfluenceTools } from './confluence';
export { zendeskDescriptor, createZendeskTools } from './zendesk';
export { clickupDescriptor, createClickupTools } from './clickup';
export { asanaDescriptor, createAsanaTools } from './asana';
export { attioDescriptor, createAttioTools } from './attio';
export { apolloDescriptor, createApolloTools } from './apollo';
export { hunterDescriptor, createHunterTools } from './hunter';
export { closeDescriptor, createCloseTools } from './close';
export { stripeDescriptor, createStripeTools } from './stripe';
export { quickbooksDescriptor, createQuickbooksTools } from './quickbooks';
export { docusignDescriptor, createDocusignTools } from './docusign';
export { dropboxDescriptor, createDropboxTools } from './dropbox';
export { boxDescriptor, createBoxTools } from './box';
export { posthogDescriptor, createPosthogTools } from './posthog';
export { mixpanelDescriptor, createMixpanelTools } from './mixpanel';
export { amplitudeDescriptor, createAmplitudeTools } from './amplitude';
export { figmaDescriptor, createFigmaTools } from './figma';
export { canvaDescriptor, createCanvaTools } from './canva';
export { whatsappDescriptor, createWhatsappTools } from './whatsapp';
export { createGoogleOAuthProvider } from './oauth-providers/google';
export { createMicrosoftOAuthProvider } from './oauth-providers/microsoft';
export { notionOAuthProvider } from './oauth-providers/notion';
export { INTEGRATION_DESCRIPTORS, getIntegrationDescriptor, listIntegrationDescriptors } from './descriptors';
export { signOAuthState, verifyOAuthState, OAuthStateSecretUnavailableError } from './oauth-state';
export { buildAuthorizeUrl, completeOAuthCallback, verifyViaIdentify } from './oauth-broker';
export type { OAuthCallbackResult } from './oauth-broker';
