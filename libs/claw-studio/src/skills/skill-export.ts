/**
 * Skill -> Markdown export, ported from nucleus lib/skill-export.ts +
 * lib/export-utils.ts (inlined here rather than a separate shared module,
 * since this is the only exporter in Claw Studio so far — split it out if a
 * second one appears, e.g. for Memory Runtimes export).
 */

export interface SkillDTO {
  id: string;
  name: string;
  description: string;
  tier: string;
  source: string;
  isEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  content?: string;
}

/** Wrap content in a code fence one backtick longer than the longest backtick run inside it. */
export function fence(content: string, lang = 'markdown'): string {
  const longestRun = content.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}${lang}\n${content}\n${marker}`;
}

/** GitHub-style heading anchor. */
export function anchor(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

export function fileSafe(text: string, fallback = 'item'): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

export function yamlScalar(value: string): string {
  const v = value ?? '';
  if (v.includes('\n')) {
    const indented = v.split('\n').map((l) => `  ${l}`).join('\n');
    return `|-\n${indented}`;
  }
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, mimeType = 'text/markdown;charset=utf-8'): void {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}

/** Build the Markdown document for a single skill. Pure. */
export function buildSkillMarkdown(skill: SkillDTO): string {
  const content = skill.content ?? '';
  return [
    `# ${skill.name}`, '', `> ${skill.description}`, '',
    '| Field | Value |', '| --- | --- |',
    `| Slug | \`${skill.id}\` |`, `| Tier | ${skill.tier} |`, `| Source | ${skill.source} |`,
    `| Status | ${skill.isEnabled ? 'Enabled' : 'Disabled'} |`,
    `| Created | ${skill.createdAt} |`, `| Updated | ${skill.updatedAt} |`,
    `| Created by | ${skill.createdBy ?? '—'} |`, '',
    '## Content', '', fence(content), '',
  ].join('\n');
}

/** Build the Markdown document for a collection of skills (table of contents + each skill). Pure. */
export function buildAllSkillsMarkdown(skills: SkillDTO[]): string {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const header: string[] = ['# Skills export', '', `Exported ${sorted.length} skill(s).`, ''];
  if (sorted.length === 0) {
    header.push('_No skills to export._', '');
    return header.join('\n');
  }
  header.push('## Table of contents', '');
  for (const s of sorted) header.push(`- [${s.name}](#${anchor(s.name)})`);
  header.push('', '---', '');
  const body = sorted.map((s) => `${buildSkillMarkdown(s)}\n---\n`);
  return `${header.join('\n')}\n${body.join('\n')}`;
}

/** Build a portable SKILL.md document: YAML frontmatter + content. Pure. */
export function buildSkillFile(skill: SkillDTO): string {
  const frontmatter = [
    '---',
    `name: ${yamlScalar(skill.name)}`,
    `description: ${yamlScalar(skill.description)}`,
    `tier: ${yamlScalar(skill.tier)}`,
    `enabled: ${skill.isEnabled ? 'true' : 'false'}`,
    '---', '',
  ].join('\n');
  return `${frontmatter}\n${skill.content ?? ''}\n`;
}

export function exportSkillToFile(skill: SkillDTO): void {
  downloadText(buildSkillFile(skill), `${skill.id || fileSafe(skill.name, 'skill')}.md`);
}

export function exportSkillToMarkdown(skill: SkillDTO): void {
  downloadText(buildSkillMarkdown(skill), `skill-${fileSafe(skill.name, 'skill')}.md`);
}

export function exportAllSkillsToMarkdown(skills: SkillDTO[]): void {
  downloadText(buildAllSkillsMarkdown(skills), `skills-export-${new Date().toISOString().slice(0, 10)}.md`);
}

/**
 * Download all skills as a `.zip` of portable SKILL.md files, one per skill
 * at `skills/<slug>/SKILL.md` (the Claude Code skill layout). jszip is
 * dynamically imported so it stays out of the main bundle for users who
 * never export.
 */
export async function exportAllSkillsToZip(skills: SkillDTO[]): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const root = zip.folder('skills');
  if (!root) throw new Error('Failed to create skills folder in zip');
  for (const s of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    root.file(`${s.id}/SKILL.md`, buildSkillFile(s));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `skills-export-${new Date().toISOString().slice(0, 10)}.zip`);
}
