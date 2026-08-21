export type WorkspaceSlug = 'identity' | 'soul' | 'agents' | 'user' | 'tools' | 'heartbeat';

export const WORKSPACE_SLUGS: readonly WorkspaceSlug[] = [
  'identity', 'soul', 'agents', 'user', 'tools', 'heartbeat',
] as const;

export const SLUG_CHAR_CAPS: Record<WorkspaceSlug, number> = {
  identity: 2000,
  soul: 4000,
  agents: 8000,
  user: 4000,
  tools: 2000,
  heartbeat: 2000,
};

export const SLUG_LABELS: Record<WorkspaceSlug, { title: string; blurb: string }> = {
  identity: { title: 'Identity', blurb: 'Name, emoji, and role label.' },
  soul: { title: 'Soul', blurb: 'Persona, tone, values, and boundaries.' },
  agents: { title: 'Agents', blurb: 'Operating procedure — what Claw does and how.' },
  user: { title: 'User', blurb: 'Who Claw is helping, and their preferences.' },
  tools: { title: 'Tools', blurb: 'Environment notes and tool cautions.' },
  heartbeat: { title: 'Heartbeat', blurb: 'Checklist consulted on every scheduled run.' },
};

export function isWorkspaceSlug(value: unknown): value is WorkspaceSlug {
  return typeof value === 'string' && (WORKSPACE_SLUGS as readonly string[]).includes(value);
}

export interface WorkspaceFile {
  slug: WorkspaceSlug;
  content: string;
  version: number;
  updatedBy: string;
  updatedAt: Date;
}
