'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  agentStudioNav,
  analyticsNav,
  clawStudioNav,
  evaluationNav,
  knowledgeBaseNav,
  mainNav,
  sdksNav,
  settingsNav,
  transcriptionNav,
} from './app-sidebar';

/**
 * This header's `<h1>` is the page's accessible name — it is the only `<h1>` in the
 * dashboard, which is why pages title themselves with `<h2>` beneath it.
 *
 * It used to be resolved by a hardcoded if-chain covering seven routes, so roughly
 * fifty pages fell through to the literal string "AgentFork": /analytics, /inferences
 * and /dashboards all announced themselves as "AgentFork" to a screen reader, and the
 * heading a sighted user read as the page title was the product name.
 *
 * The titles now come from the sidebar's own nav data, which already names every
 * route and is exported for exactly this reason — adding a nav entry titles its page
 * automatically, and the two lists cannot drift apart because there is only one.
 */
type NavEntry = { name: string; href: string; children?: readonly NavEntry[] };

const NAV_GROUPS: readonly NavEntry[][] = [
  mainNav,
  analyticsNav,
  evaluationNav,
  clawStudioNav,
  agentStudioNav,
  transcriptionNav,
  knowledgeBaseNav,
  settingsNav,
  sdksNav,
];

/**
 * Routes with no nav entry of their own — section roots reached from a card, and
 * leaf pages under a section. Without these, longest-prefix matching would either
 * miss them or inherit a sibling's label.
 */
const EXTRA_TITLES: Record<string, string> = {
  '/connectors': 'Connectors',
  '/sdks': 'SDKs',
  '/settings/channels/whatsapp': 'WhatsApp',
  '/settings/channels/telegram': 'Telegram',
  '/settings/organization': 'Organization Settings',
  '/transcription/api-keys': 'API Keys',
  '/transcription/webhooks': 'Webhooks',
  '/transcription/s3-access': 'S3 Access',
  '/transcription/playground': 'Transcription Playground',
  '/transcription/models': 'Transcription Models',
  '/audit': 'Audit Logs',
};

/** Flattened once at module scope, longest href first so a nested route wins over
 *  its parent — `/transcription/llm-providers` must not resolve to `/agents`'s
 *  identically-named "LLM Providers" entry, and `/sessions/abc` must resolve to
 *  "Sessions" rather than to `/`. */
const ROUTES: Array<{ href: string; name: string }> = (() => {
  const flat: Array<{ href: string; name: string }> = [];
  const walk = (entries: readonly NavEntry[]) => {
    for (const e of entries) {
      flat.push({ href: e.href, name: e.name });
      if (e.children) walk(e.children);
    }
  };
  NAV_GROUPS.forEach(walk);
  for (const [href, name] of Object.entries(EXTRA_TITLES)) flat.push({ href, name });
  return flat.sort((a, b) => b.href.length - a.href.length);
})();

export function getPageTitle(pathname: string): string {
  const hit = ROUTES.find((r) => pathname === r.href || pathname.startsWith(r.href + '/'));
  return hit?.name ?? 'AgentFork';
}

export function Header() {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  // Every route rendered `<title>AgentFork</title>`, so a user with several tabs open
  // could not tell them apart, and browser history and bookmarks were all identically
  // named. Set here rather than via route metadata because these pages are client
  // components, which cannot export it.
  useEffect(() => {
    document.title = title === 'AgentFork' ? 'AgentFork' : `${title} · AgentFork`;
  }, [title]);

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex flex-1 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <h1 className="text-base font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-2 px-4">
        <ThemeToggle />
      </div>
    </header>
  );
}
