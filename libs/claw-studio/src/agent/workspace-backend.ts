/**
 * workspace-backend.ts — exposes Claw's six DB-backed workspace files to
 * deepagents as a filesystem.
 *
 * Deliberately NOT deepagents' own `StoreBackend`: that requires a LangGraph
 * `BaseStore`, and this codebase's `PostgresMemoryStore` implements a local
 * `MemoryStoreInterface` whose `batch()` writes embedded SEMANTIC rows into
 * `claw_memories`. Routing files through it would embed every write, pollute
 * the memory table, and bypass `claw_workspace_files` entirely. Implementing
 * the protocol directly over `WorkspaceFileService` keeps rows as rows and
 * preserves `ClawFileRevision` audit.
 *
 * Every method returns an error object rather than throwing: a thrown error
 * inside the agent loop aborts the whole run.
 */
import type {
  BackendProtocolV2,
  EditResult,
  ExecuteResponse,
  FileInfo,
  GlobResult,
  GrepMatch,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  WriteResult,
} from 'deepagents';
import type { WorkspaceFileService } from '../workspace/workspace-file-service';
import { SLUG_CHAR_CAPS, WORKSPACE_SLUGS, isWorkspaceSlug, type WorkspaceSlug } from '../workspace/types';
import { MAX_WRITES_PER_RUN } from '../workspace/self-authoring-policy';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:workspace-backend');

export function slugToPath(slug: WorkspaceSlug): string {
  return `/${slug}.md`;
}

export function pathToSlug(path: string): WorkspaceSlug | null {
  const name = path.replace(/^\/+/, '').replace(/\.md$/i, '');
  return isWorkspaceSlug(name) ? name : null;
}

const UNKNOWN = (path: string) =>
  `"${path}" is not a Claw workspace file. Available: ${WORKSPACE_SLUGS.map(slugToPath).join(', ')}`;

export class ClawWorkspaceBackend implements BackendProtocolV2 {
  /**
   * Fix round 3, Critical 2 (remaining item): `MAX_WRITES_PER_RUN` bounds a
   * reflection loop that decides to keep "improving" the same file
   * (self-authoring-policy.ts:15-16). `file-tools.ts`'s own `writes` counter
   * only bounds ITS four custom tools (`write_workspace_file`/
   * `edit_workspace_file`) — it has no reach into deepagents' forced
   * `write_file`/`edit_file`, which call THIS class. The `permissions` deny
   * rule added in round 2 blocks the GATED slugs (identity/soul/agents)
   * outright, but `user`/`tools`/`heartbeat` are free-write slugs and were
   * writable an unbounded number of times per run through the forced tools
   * without this counter.
   *
   * Instance-scoped, NOT module-level or static: `ClawWorkspaceBackend` is
   * constructed once per run (one instance per `resolveClawRuntime()` call in
   * `claw-runtime.ts`), so a private instance field is exactly the run's
   * lifetime — a module-level counter would leak across runs AND across
   * tenants, since backend instances for different tenants would share it.
   */
  private writeCount = 0;

  constructor(
    private readonly service: WorkspaceFileService,
    private readonly opts: { sourceRunId?: string } = {},
  ) {}

  /** Full, unsliced read — used internally by `edit()`, which must see the
   *  WHOLE file regardless of `read()`'s offset/limit windowing (see `read()`'s
   *  doc comment for why sharing `read()` there would silently truncate edits). */
  private async readFull(filePath: string): Promise<{ content?: string; error?: string }> {
    const slug = pathToSlug(filePath);
    if (!slug) return { error: UNKNOWN(filePath) };
    try {
      const file = await this.service.read(slug);
      if (!file) return { error: `"${filePath}" has no content yet.` };
      return { content: file.content };
    } catch (err) {
      logger.warn({ filePath, err }, 'workspace read failed');
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Fix round 2, Important 6: the protocol is `read(filePath, offset?,
   *  limit?)` (BackendProtocolV2) and the `read_file` tool
   *  (node_modules/deepagents/dist/langsmith-*.js:1766-1814) passes both
   *  through, then labels the RETURNED content starting at line `offset + 1`
   *  via `formatContentWithLineNumbers`. Previously this ignored both params
   *  and always returned the full file from line 1 — so
   *  `read_file('/agents.md', { offset: 100 })` returned lines 1-100 but
   *  LABELLED them 101-200, and the model would edit against text it never
   *  actually read. `offset`/`limit` are 0-indexed LINE counts, matching the
   *  tool's own default of `offset=0, limit=100`. */
  async read(filePath: string, offset = 0, limit = 500): Promise<ReadResult> {
    const full = await this.readFull(filePath);
    if (full.error) return { error: full.error };
    const lines = (full.content ?? '').split('\n');
    return { content: lines.slice(offset, offset + limit).join('\n') };
  }

  /** NOTE: readRaw returns `{ data: FileData }`, NOT `{ content }` — verified
   *  against node_modules/deepagents/dist/agent-*.d.ts (`interface
   *  ReadRawResult`). FileDataV2 requires content, mimeType, created_at,
   *  modified_at. */
  async readRaw(filePath: string): Promise<ReadRawResult> {
    const slug = pathToSlug(filePath);
    if (!slug) return { error: UNKNOWN(filePath) };
    try {
      const file = await this.service.read(slug);
      if (!file) return { error: `"${filePath}" has no content yet.` };
      const now = new Date().toISOString();
      return {
        data: {
          content: file.content,
          mimeType: 'text/markdown',
          created_at: now,
          modified_at: now,
        },
      };
    } catch (err) {
      logger.warn({ filePath, err }, 'workspace readRaw failed');
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** REQUIRED. `BackendProtocolV2 extends Omit<BackendProtocolV1, "read" |
   *  "readRaw" | "grepRaw" | "lsInfo" | "globInfo">` — `edit` is inherited
   *  unchanged from BackendProtocolV1 and must be implemented. (`execute` is
   *  NOT part of BackendProtocolV1/V2 at all — it belongs only to
   *  SandboxBackendProtocolV1/V2 — but is implemented below anyway since the
   *  test exercises it and TS interfaces don't forbid extra members.) */
  async edit(filePath: string, oldString: string, newString: string, replaceAll = false): Promise<EditResult> {
    try {
      // Must read the WHOLE file here, not through `read()`'s offset/limit
      // windowing (default limit 500 lines) — matching against a truncated
      // window would silently drop the tail of the file on write-back.
      const current = await this.readFull(filePath);
      if (current.error) return { error: current.error };
      const text = String(current.content ?? '');
      if (!text.includes(oldString)) {
        return { error: `"${oldString.slice(0, 40)}" not found in ${filePath}.` };
      }
      // Fix round 2, Important 7: the tool renders
      // `Successfully replaced ${result.occurrences} occurrence(s)`
      // (node_modules/deepagents/dist/langsmith-*.js:1885) — previously
      // `occurrences` was never set, so the model was told
      // "replaced undefined occurrence(s)".
      const occurrences = replaceAll ? text.split(oldString).length - 1 : 1;
      const next = replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, newString);
      const written = await this.write(filePath, next);
      return written.error ? { error: written.error } : { path: filePath, occurrences };
    } catch (err) {
      logger.warn({ filePath, err }, 'workspace edit failed');
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    const slug = pathToSlug(filePath);
    if (!slug) return { error: UNKNOWN(filePath) };
    // Checked before the char-cap/service call so a write past the cap never
    // reaches `WorkspaceFileService.write` — and BEFORE incrementing, so a
    // rejected write never itself counts against the cap. `edit()` calls this
    // method internally rather than duplicating the check, so a single edit
    // counts once, not twice.
    if (this.writeCount >= MAX_WRITES_PER_RUN) {
      return { error: `Write limit reached (${MAX_WRITES_PER_RUN} per run). Make no further file edits this turn.` };
    }
    const cap = SLUG_CHAR_CAPS[slug];
    if (content.length > cap) {
      return { error: `${filePath} exceeds its ${cap}-character cap (got ${content.length}).` };
    }
    try {
      await this.service.write(slug, content, {
        updatedBy: 'claw',
        reason: 'agent write',
        sourceRunId: this.opts.sourceRunId,
      });
      this.writeCount += 1;
      return { path: filePath };
    } catch (err) {
      logger.warn({ filePath, err }, 'workspace write failed');
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async ls(_path?: string): Promise<LsResult> {
    try {
      const files = await this.service.list();
      const infos: FileInfo[] = files
        .filter((f) => f.content && f.content.length > 0)
        .map((f) => ({ path: slugToPath(f.slug), is_dir: false, size: f.content.length }));
      return { files: infos };
    } catch (err) {
      logger.warn({ err }, 'workspace ls failed');
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async glob(pattern: string, _path?: string): Promise<GlobResult> {
    const ls = await this.ls();
    if (ls.error) return { error: ls.error };
    // The namespace is six fixed files; a substring match is sufficient and
    // avoids pulling in a glob dependency for a closed set.
    const needle = pattern.replace(/[*?]/g, '');
    return { files: (ls.files ?? []).filter((f) => f.path.includes(needle)) };
  }

  /** `GrepMatch`'s real fields (node_modules/deepagents/dist/agent-*.d.ts):
   *  `path`, `line` (1-indexed number), `text` (the matching line's content).
   *  The brief guessed `path`/`line_number`/`line` — corrected here. */
  async grep(pattern: string, _path?: string | null, _glob?: string | null): Promise<GrepResult> {
    try {
      const files = await this.service.list();
      const matches: GrepMatch[] = [];
      for (const file of files) {
        const lines = (file.content ?? '').split('\n');
        lines.forEach((line, i) => {
          if (line.includes(pattern)) {
            matches.push({ path: slugToPath(file.slug), line: i + 1, text: line });
          }
        });
      }
      return { matches };
    } catch (err) {
      logger.warn({ err }, 'workspace grep failed');
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async execute(_command: string): Promise<ExecuteResponse> {
    return {
      output: 'Shell execution is not supported against the Claw workspace backend.',
      exitCode: 1,
      truncated: false,
    };
  }
}
