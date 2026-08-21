import type { ComponentType, SVGProps } from 'react';
import { Mail, Building2, Search, AtSign, PhoneCall, BarChart3, PenTool, Palette } from 'lucide-react';
import {
  SiGithub, SiHubspot, SiNotion, SiGmail, SiGooglecalendar, SiGoogledrive, SiJira,
  SiLinear, SiGitlab, SiConfluence, SiZendesk, SiClickup, SiAsana, SiStripe,
  SiQuickbooks, SiDropbox, SiBox, SiPosthog, SiMixpanel, SiFigma, SiWhatsapp,
} from '@icons-pack/react-simple-icons';
import type { IntegrationId } from '@/hooks/use-integrations';
import { OutlookLogo } from './outlook-logo';

export interface IntegrationVisual {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconBg: string;
  iconColor: string;
}

/**
 * Presentation-only, kept client-side rather than travelling through the API.
 * Real brand logos throughout, except email — that connector is protocol-generic
 * IMAP/SMTP, not tied to one provider, so a specific vendor's logo (e.g.
 * Gmail's) would misrepresent it, so it keeps the generic lucide envelope.
 * Outlook has no entry in @icons-pack/react-simple-icons, so its mark is
 * hand-inlined the same way Slack's is (see `outlook-logo.tsx`).
 *
 * Attio, Apollo.io, Hunter, Close, Amplitude, Docusign, and Canva also have no
 * entry in @icons-pack/react-simple-icons (verified against the installed
 * package's icon list) — each falls back to a generic lucide icon that hints
 * at the connector's category rather than a real wordmark, same reasoning as
 * email's fallback above.
 */
export const INTEGRATION_VISUALS: Record<IntegrationId, IntegrationVisual> = {
  github: { icon: SiGithub, iconBg: 'bg-zinc-500/10', iconColor: 'text-zinc-700 dark:text-zinc-300' },
  hubspot: { icon: SiHubspot, iconBg: 'bg-orange-500/10', iconColor: 'text-orange-600' },
  email: { icon: Mail, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-600' },
  notion: { icon: SiNotion, iconBg: 'bg-zinc-500/10', iconColor: 'text-zinc-800 dark:text-zinc-200' },
  gmail: { icon: SiGmail, iconBg: 'bg-red-500/10', iconColor: 'text-red-600' },
  google_calendar: { icon: SiGooglecalendar, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-600' },
  google_drive: { icon: SiGoogledrive, iconBg: 'bg-yellow-500/10', iconColor: 'text-yellow-600' },
  outlook: { icon: OutlookLogo, iconBg: 'bg-sky-500/10', iconColor: 'text-sky-600' },
  jira: { icon: SiJira, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-600' },
  linear: { icon: SiLinear, iconBg: 'bg-indigo-500/10', iconColor: 'text-indigo-600' },
  gitlab: { icon: SiGitlab, iconBg: 'bg-orange-500/10', iconColor: 'text-orange-600' },
  confluence: { icon: SiConfluence, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-600' },
  zendesk: { icon: SiZendesk, iconBg: 'bg-teal-600/10', iconColor: 'text-teal-700 dark:text-teal-400' },
  clickup: { icon: SiClickup, iconBg: 'bg-violet-500/10', iconColor: 'text-violet-600' },
  asana: { icon: SiAsana, iconBg: 'bg-red-400/10', iconColor: 'text-red-500' },
  attio: { icon: Building2, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-600' },
  apollo: { icon: Search, iconBg: 'bg-amber-400/10', iconColor: 'text-amber-600' },
  hunter: { icon: AtSign, iconBg: 'bg-orange-500/10', iconColor: 'text-orange-600' },
  close: { icon: PhoneCall, iconBg: 'bg-sky-700/10', iconColor: 'text-sky-700 dark:text-sky-400' },
  stripe: { icon: SiStripe, iconBg: 'bg-indigo-500/10', iconColor: 'text-indigo-600' },
  quickbooks: { icon: SiQuickbooks, iconBg: 'bg-green-600/10', iconColor: 'text-green-700 dark:text-green-400' },
  docusign: { icon: PenTool, iconBg: 'bg-violet-600/10', iconColor: 'text-violet-700 dark:text-violet-400' },
  dropbox: { icon: SiDropbox, iconBg: 'bg-blue-600/10', iconColor: 'text-blue-700 dark:text-blue-400' },
  box: { icon: SiBox, iconBg: 'bg-blue-600/10', iconColor: 'text-blue-700 dark:text-blue-400' },
  posthog: { icon: SiPosthog, iconBg: 'bg-orange-600/10', iconColor: 'text-orange-700 dark:text-orange-400' },
  mixpanel: { icon: SiMixpanel, iconBg: 'bg-violet-500/10', iconColor: 'text-violet-600' },
  amplitude: { icon: BarChart3, iconBg: 'bg-blue-600/10', iconColor: 'text-blue-700 dark:text-blue-400' },
  figma: { icon: SiFigma, iconBg: 'bg-orange-600/10', iconColor: 'text-orange-700 dark:text-orange-400' },
  canva: { icon: Palette, iconBg: 'bg-cyan-500/10', iconColor: 'text-cyan-600' },
  whatsapp: { icon: SiWhatsapp, iconBg: 'bg-green-500/10', iconColor: 'text-green-600' },
};
