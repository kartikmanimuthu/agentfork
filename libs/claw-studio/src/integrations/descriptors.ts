/**
 * descriptors.ts — the integration descriptor registry.
 *
 * Plain data, not a class with a globalThis cache like `ConnectorRegistry` —
 * descriptors hold no live connections or other state worth caching across
 * requests, just auth metadata and a `verify()` closure.
 */

import { githubDescriptor } from './github';
import { hubspotDescriptor } from './hubspot';
import { emailDescriptor } from './email';
import { notionDescriptor } from './notion';
import { gmailDescriptor } from './gmail';
import { googleCalendarDescriptor } from './google-calendar';
import { googleDriveDescriptor } from './google-drive';
import { outlookDescriptor } from './outlook';
import { jiraDescriptor } from './jira';
import { linearDescriptor } from './linear';
import { gitlabDescriptor } from './gitlab';
import { confluenceDescriptor } from './confluence';
import { zendeskDescriptor } from './zendesk';
import { clickupDescriptor } from './clickup';
import { asanaDescriptor } from './asana';
import { attioDescriptor } from './attio';
import { apolloDescriptor } from './apollo';
import { hunterDescriptor } from './hunter';
import { closeDescriptor } from './close';
import { stripeDescriptor } from './stripe';
import { quickbooksDescriptor } from './quickbooks';
import { docusignDescriptor } from './docusign';
import { dropboxDescriptor } from './dropbox';
import { boxDescriptor } from './box';
import { posthogDescriptor } from './posthog';
import { mixpanelDescriptor } from './mixpanel';
import { amplitudeDescriptor } from './amplitude';
import { figmaDescriptor } from './figma';
import { canvaDescriptor } from './canva';
import { whatsappDescriptor } from './whatsapp';
import type { IntegrationDescriptor } from './types';

export const INTEGRATION_DESCRIPTORS: Record<string, IntegrationDescriptor> = {
  github: githubDescriptor,
  hubspot: hubspotDescriptor,
  email: emailDescriptor,
  notion: notionDescriptor,
  gmail: gmailDescriptor,
  google_calendar: googleCalendarDescriptor,
  google_drive: googleDriveDescriptor,
  outlook: outlookDescriptor,
  jira: jiraDescriptor,
  linear: linearDescriptor,
  gitlab: gitlabDescriptor,
  confluence: confluenceDescriptor,
  zendesk: zendeskDescriptor,
  clickup: clickupDescriptor,
  asana: asanaDescriptor,
  attio: attioDescriptor,
  apollo: apolloDescriptor,
  hunter: hunterDescriptor,
  close: closeDescriptor,
  stripe: stripeDescriptor,
  quickbooks: quickbooksDescriptor,
  docusign: docusignDescriptor,
  dropbox: dropboxDescriptor,
  box: boxDescriptor,
  posthog: posthogDescriptor,
  mixpanel: mixpanelDescriptor,
  amplitude: amplitudeDescriptor,
  figma: figmaDescriptor,
  canva: canvaDescriptor,
  whatsapp: whatsappDescriptor,
};

export function getIntegrationDescriptor(name: string): IntegrationDescriptor | null {
  return INTEGRATION_DESCRIPTORS[name] ?? null;
}

export function listIntegrationDescriptors(): IntegrationDescriptor[] {
  return Object.values(INTEGRATION_DESCRIPTORS);
}
