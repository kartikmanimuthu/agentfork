/**
 * promote.ts — procedural memory -> Skill draft mapping, ported from nucleus
 * lib/agent-memory/promote.ts. Pure; persistence happens through the normal
 * create-skill path (Task 7's API route), human-approved via a UI action —
 * not consumed yet (ships ahead of Memory Runtimes, which will add the
 * "Promote to skill" button that calls this).
 */

export interface MemoryRowLike {
  kind: string;
  key: string;
  value: Record<string, unknown>;
}

export interface SkillDraft {
  name: string;
  description: string;
  tier: string;
  content: string;
}

function humanize(key: string): string {
  return key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (w[0]?.toUpperCase() ?? '') + w.slice(1))
    .join(' ');
}

export function buildSkillDraftFromMemory(row: MemoryRowLike): SkillDraft | null {
  if (row.kind !== 'PROCEDURAL') return null;
  const v = row.value as { instruction?: string; trigger?: string; evidence?: string };
  if (!v?.instruction || !v?.trigger) return null;
  return {
    name: humanize(row.key),
    description: v.trigger,
    tier: 'read-only',
    content:
      `## Rule\n${v.instruction}\n\n` +
      `## When it applies\n${v.trigger}\n\n` +
      `## Why (evidence)\n${v.evidence || '(not recorded)'}\n\n` +
      `_Learned by Claw; promoted from procedural memory._`,
  };
}
