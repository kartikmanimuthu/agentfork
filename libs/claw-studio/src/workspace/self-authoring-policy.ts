import { env } from '../env';
import type { WorkspaceSlug } from './types';

export type SelfAuthoringMode = 'off' | 'user' | 'all';

/**
 * Claw learning your preferences must not nag, so writes to these pass the
 * approval gate un-prompted (see file-tools' grantedWrites).
 */
export const FREE_WRITE_SLUGS: readonly WorkspaceSlug[] = ['user', 'tools', 'heartbeat'] as const;

/** Rewriting its own persona is rare and high-consequence, so these always prompt. */
export const GATED_WRITE_SLUGS: readonly WorkspaceSlug[] = ['identity', 'soul', 'agents'] as const;

/** Bounds a reflection loop that decides to keep "improving" the same file. */
export const MAX_WRITES_PER_RUN = 5;

export function selfAuthoringMode(): SelfAuthoringMode {
  return env.CLAW_SELF_AUTHORING;
}

export function isFreeWrite(slug: WorkspaceSlug): boolean {
  return (FREE_WRITE_SLUGS as readonly string[]).includes(slug);
}

export function canClawWrite(slug: WorkspaceSlug, mode: SelfAuthoringMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return isFreeWrite(slug);
}
