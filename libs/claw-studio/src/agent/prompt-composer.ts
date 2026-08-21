/**
 * prompt-composer.ts
 *
 * Turns Claw's workspace files into the identity block that opens the system
 * prompt of every node where Claw speaks or acts. Pure — no DB, no env reads —
 * so the truncation and surface-gating rules are exhaustively testable.
 *
 * A tenant with no files composes to '', and buildBaseIdentity() then falls back
 * to DEFAULT_IDENTITY. That is the non-regression guarantee: nothing changes for
 * anyone who has not written a soul.
 */

import { SLUG_CHAR_CAPS, type WorkspaceSlug } from '../workspace/types';

export type PromptSurface = 'speaking' | 'acting' | 'scheduled';

const SPEAKING: readonly WorkspaceSlug[] = ['identity', 'soul', 'agents', 'user'];

/** `tools` only reaches nodes that can call tools; `heartbeat` only unattended runs. */
export const SURFACE_SLUGS: Record<PromptSurface, readonly WorkspaceSlug[]> = {
  speaking: SPEAKING,
  acting: [...SPEAKING, 'tools'],
  scheduled: [...SPEAKING, 'tools', 'heartbeat'],
};

const HEADINGS: Record<WorkspaceSlug, string> = {
  identity: 'WHO YOU ARE',
  soul: 'YOUR CHARACTER',
  agents: 'HOW YOU WORK',
  user: "WHO YOU'RE HELPING",
  tools: 'YOUR ENVIRONMENT',
  heartbeat: 'EVERY SCHEDULED RUN',
};

export const DEFAULT_TOTAL_CAP = 16_000;

export interface ComposeInput {
  files: Map<WorkspaceSlug, string>;
  surface: PromptSurface;
  /** Replaces the `agents` file for this run only — carries deps.systemPrompt. */
  agentsOverride?: string;
  totalCap?: number;
}

/** Truncation is marked, never silent: a quietly cut soul is a debugging trap. */
function capped(slug: WorkspaceSlug, text: string): string {
  const cap = SLUG_CHAR_CAPS[slug];
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n<!-- truncated: ${slug} exceeded ${cap} chars -->`;
}

export function composeIdentity(input: ComposeInput): string {
  const { files, surface, agentsOverride, totalCap = DEFAULT_TOTAL_CAP } = input;

  const sections: string[] = [];
  for (const slug of SURFACE_SLUGS[surface]) {
    const raw = slug === 'agents' ? (agentsOverride ?? files.get(slug)) : files.get(slug);
    if (!raw || !raw.trim()) continue;
    sections.push(`=== ${HEADINGS[slug]} ===\n${capped(slug, raw.trim())}`);
  }

  const composed = sections.join('\n\n');
  if (composed.length <= totalCap) return composed;
  return `${composed.slice(0, totalCap)}\n<!-- truncated: workspace exceeded ${totalCap} chars -->`;
}
