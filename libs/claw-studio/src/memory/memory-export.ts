/**
 * Memory -> Markdown export, ported from nucleus lib/memory-export.ts. Mirrors
 * ../skills/skill-export.ts: buildMemoryMarkdown()/buildAllMemoriesMarkdown()
 * are the human-readable "report" export; buildMemoryFile() is the portable
 * frontmatter export. The transport/format helpers (anchor, fileSafe,
 * yamlScalar, downloadBlob, downloadText) are reused from skill-export.ts
 * rather than duplicated — they have no skill-specific logic.
 */

import { anchor, fileSafe, yamlScalar, downloadBlob, downloadText } from '../skills/skill-export';
import type { MemoryKind } from './types';

export interface MemoryExportRow {
  id: string;
  namespace: string;
  key: string;
  value: Record<string, unknown>;
  kind: MemoryKind;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  supersededById: string | null;
}

const KIND_ORDER: MemoryKind[] = ['SEMANTIC', 'EPISODIC', 'PROCEDURAL'];

/** Read a string field from the raw `value` JSON, or "—" if absent/empty. */
function field(value: Record<string, unknown>, key: string): string {
  const v = value?.[key];
  return typeof v === 'string' && v.length ? v : '—';
}

/** Render the kind-specific `value` fields as labeled Markdown prose. Pure. */
function renderValueBody(memory: MemoryExportRow): string {
  const v = memory.value ?? {};
  switch (memory.kind) {
    case 'SEMANTIC':
      return [
        `**Fact:** ${field(v, 'fact')}`,
        `**Source:** ${field(v, 'source')}`,
        `**Confidence:** ${field(v, 'confidence')}`,
        '',
      ].join('\n');
    case 'EPISODIC':
      return [
        `**Context:** ${field(v, 'context')}`,
        `**Reasoning:** ${field(v, 'reasoning')}`,
        `**Action:** ${field(v, 'action')}`,
        `**Outcome:** ${field(v, 'outcome')}`,
        '',
      ].join('\n');
    case 'PROCEDURAL':
      return [
        `**Instruction:** ${field(v, 'instruction')}`,
        `**Trigger:** ${field(v, 'trigger')}`,
        `**Evidence:** ${field(v, 'evidence')}`,
        `**Confidence:** ${field(v, 'confidence')}`,
        '',
      ].join('\n');
    default:
      return '';
  }
}

/** Build the human-readable Markdown report for a single memory. Pure. */
export function buildMemoryMarkdown(memory: MemoryExportRow): string {
  return [
    `# ${memory.key}`, '',
    '| Field | Value |', '| --- | --- |',
    `| Kind | ${memory.kind} |`, `| Namespace | ${memory.namespace} |`,
    `| Created | ${memory.createdAt} |`, `| Updated | ${memory.updatedAt} |`,
    `| Superseded by | ${memory.supersededById ?? '—'} |`, '',
    renderValueBody(memory),
  ].join('\n');
}

/** Build the combined human-readable Markdown report for all memories (TOC + each memory, grouped by kind). Pure. */
export function buildAllMemoriesMarkdown(memories: MemoryExportRow[]): string {
  const header: string[] = ['# Memory export', '', `Exported ${memories.length} memory record(s).`, ''];
  if (memories.length === 0) {
    header.push('_No memories to export._', '');
    return header.join('\n');
  }
  const byKind = new Map<MemoryKind, MemoryExportRow[]>();
  for (const m of memories) {
    const arr = byKind.get(m.kind) ?? [];
    arr.push(m);
    byKind.set(m.kind, arr);
  }
  for (const arr of byKind.values()) {
    arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  header.push('## Table of contents', '');
  for (const kind of KIND_ORDER) {
    const arr = byKind.get(kind);
    if (!arr?.length) continue;
    header.push(`### ${kind}`, '');
    for (const m of arr) header.push(`- [${m.key}](#${anchor(m.key)})`);
    header.push('');
  }
  header.push('---', '');
  const body = KIND_ORDER.flatMap((kind) => (byKind.get(kind) ?? []).map((m) => `${buildMemoryMarkdown(m)}\n---\n`));
  return `${header.join('\n')}\n${body.join('\n')}`;
}

/**
 * Build a portable `.md` for a memory: YAML frontmatter (kind, namespace, key,
 * created_at, updated_at) + the kind-aware `value` body. Pure.
 */
export function buildMemoryFile(memory: MemoryExportRow): string {
  const fm = [
    '---',
    `kind: ${memory.kind}`,
    `namespace: ${yamlScalar(memory.namespace)}`,
    `key: ${yamlScalar(memory.key)}`,
    `created_at: ${memory.createdAt}`,
    `updated_at: ${memory.updatedAt}`,
    '---', '',
  ];
  return `${fm.join('\n')}\n${renderValueBody(memory)}`;
}

export function exportMemoryToMarkdown(memory: MemoryExportRow): void {
  downloadText(buildMemoryMarkdown(memory), `memory-${fileSafe(memory.key, memory.id)}.md`);
}

export function exportAllMemoriesToMarkdown(memories: MemoryExportRow[]): void {
  downloadText(buildAllMemoriesMarkdown(memories), `memories-export-${new Date().toISOString().slice(0, 10)}.md`);
}

export function exportMemoryToFile(memory: MemoryExportRow): void {
  downloadText(buildMemoryFile(memory), `${memory.id}.md`);
}

/**
 * Download all memories as a `.zip` of portable frontmatter files, one per
 * memory at `memories/<KIND>/<id>.md`. jszip is dynamically imported so it
 * stays out of the main bundle for users who never export.
 */
export async function exportAllMemoriesToZip(memories: MemoryExportRow[]): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const root = zip.folder('memories');
  if (!root) throw new Error('Failed to create memories folder in zip');
  for (const kind of KIND_ORDER) {
    for (const m of memories.filter((x) => x.kind === kind)) {
      root.file(`${kind}/${m.id}.md`, buildMemoryFile(m));
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `memories-export-${new Date().toISOString().slice(0, 10)}.zip`);
}
