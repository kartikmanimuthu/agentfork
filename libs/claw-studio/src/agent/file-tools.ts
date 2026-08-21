/**
 * file-tools.ts — the tools that let Claw read and rewrite its own workspace files.
 *
 * Two things to know before changing this:
 *
 * 1. Approval gating is free. `write_workspace_file` and `edit_workspace_file` both
 *    match /\bwrite\b/i in tool-classifier.ts, so they already classify as mutative
 *    and route to mutative_approval_gate. Do NOT add entries to the classifier — it
 *    would risk reclassifying unrelated tools. Free-slug writes skip the gate via
 *    `grantedWrites`, which claw-runtime passes to the graph as `grantedTools`.
 *
 * 2. These tools never throw. A thrown LangChain tool error aborts the whole run, so
 *    every failure path returns a string the model can recover from — the same
 *    convention every integration tool here follows.
 */

import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { WorkspaceFileService, WorkspaceFileTooLargeError } from '../workspace/workspace-file-service';
import { SLUG_CHAR_CAPS, WORKSPACE_SLUGS, isWorkspaceSlug, type WorkspaceSlug } from '../workspace/types';
import {
  MAX_WRITES_PER_RUN, canClawWrite, isFreeWrite, selfAuthoringMode,
  type SelfAuthoringMode,
} from '../workspace/self-authoring-policy';

const logger = createLogger('claw-studio:file-tools');

const SLUG_LIST = WORKSPACE_SLUGS.join(', ');

export interface FileToolsHandle {
  tools: StructuredTool[];
  /** Tool names pre-granted for this run. Populated lazily as free-slug writes
   *  happen, so the graph must hold this exact Set reference, not a copy. */
  grantedWrites: Set<string>;
}

export interface FileToolsOptions {
  service?: WorkspaceFileService;
  sourceRunId?: string;
  mode?: SelfAuthoringMode;
}

export function createFileTools(
  tenantId: string,
  clawId: string,
  options: FileToolsOptions = {},
): FileToolsHandle {
  const svc = options.service ?? new WorkspaceFileService(tenantId, clawId);
  const mode = options.mode ?? selfAuthoringMode();
  // Keyed `<toolName>:<slug>`, and seeded HERE rather than lazily after a
  // successful write. Both details are load-bearing:
  //
  //  - Bare tool names leaked across slugs. `buildInterruptOn`'s `when` asks
  //    `granted.has(request.toolCall.name)`, and the slug is an ARGUMENT, so a
  //    single `write_workspace_file` grant exempted the tool for every slug it
  //    was later pointed at — identity and soul included. In
  //    CLAW_SELF_AUTHORING=user the backend deny rule hid this; in 'all' that
  //    deny list is empty and nothing else stood in the way.
  //  - Granting only after the first successful write meant the FIRST write to
  //    a free slug always prompted, which is the exact nagging the free-write
  //    set exists to prevent. Seeding up front is what makes the policy true on
  //    call one instead of call two.
  //
  // edit_workspace_file is seeded alongside write_workspace_file because it
  // reaches the same `persist()` and is just as mutative; it was never granted
  // at all before, so it prompted every time even for `user`.
  //
  // Under `all`, the persona slugs are granted too. The gate was there to stop Claw
  // rewriting its own soul off the back of a routine note-to-self — but in practice
  // it fired on the one case that is never a surprise: the user saying "call yourself
  // X" and expecting it to take effect. It cost a modal on an edit they had just
  // asked for, and any turn where they missed the prompt silently left the file
  // unchanged while the reply implied otherwise.
  //
  // What still bounds it: MAX_WRITES_PER_RUN (5) caps churn per turn, every write
  // records a ClawFileRevision with Claw's stated reason, and the /agent history
  // dialog offers one-click restore. Under `user`/`off` these slugs remain denied
  // outright by canClawWrite, so this widens nothing in the restricted modes.
  const grantedWrites = new Set<string>();
  for (const slug of WORKSPACE_SLUGS) {
    if (!canClawWrite(slug, mode)) continue;
    const unattended = isFreeWrite(slug) || mode === 'all';
    if (!unattended) continue;
    grantedWrites.add(`write_workspace_file:${slug}`);
    grantedWrites.add(`edit_workspace_file:${slug}`);
  }
  const ctx = { tenantId, clawId };
  let writes = 0;

  function rejectSlug(slug: string): string {
    return `"${slug}" is not a workspace file. Valid files: ${SLUG_LIST}.`;
  }

  function blockedReason(slug: WorkspaceSlug): string | null {
    if (mode === 'off') return 'Editing workspace files is disabled for this agent.';
    if (!canClawWrite(slug, mode)) {
      return `You are not permitted to edit "${slug}". Ask the user to change it in Mission Control → Agent.`;
    }
    if (writes >= MAX_WRITES_PER_RUN) {
      return `Write limit reached (${MAX_WRITES_PER_RUN} per run). Make no further file edits this turn.`;
    }
    return null;
  }

  async function persist(slug: WorkspaceSlug, content: string, reason: string): Promise<string> {
    try {
      const saved = await svc.write(slug, content, {
        updatedBy: 'claw',
        reason,
        sourceRunId: options.sourceRunId,
      });
      writes += 1;
      // No grant added here — grants are seeded per-slug at construction (see
      // `grantedWrites` above). Adding one lazily on success was what put the
      // bare tool name in the set and unlocked every other slug with it.
      logger.info({ ...ctx, slug, version: saved.version }, 'Claw wrote a workspace file');
      return `Saved ${slug} (now v${saved.version}).`;
    } catch (error) {
      if (error instanceof WorkspaceFileTooLargeError) {
        return `Cannot save: ${error.message}. Shorten it and try again.`;
      }
      logger.error({ error, ...ctx, slug }, 'Claw workspace write failed');
      return `Could not save ${slug}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const list_workspace_files = tool(
    async () => {
      try {
        const files = await svc.list();
        if (!files.length) return 'No workspace files exist yet.';
        return files
          .map((f) => `${f.slug}: ${f.content.length}/${SLUG_CHAR_CAPS[f.slug]} chars, v${f.version}, last edited by ${f.updatedBy}`)
          .join('\n');
      } catch (error) {
        logger.error({ error, ...ctx }, 'list_workspace_files failed');
        return `Could not list workspace files: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'list_workspace_files',
      description: `List your workspace files (${SLUG_LIST}) with their sizes and versions. These define who you are and what you know about the user.`,
      schema: z.object({}),
    },
  );

  const read_workspace_file = tool(
    async ({ slug }: { slug: string }) => {
      try {
        if (!isWorkspaceSlug(slug)) return rejectSlug(slug);
        const file = await svc.read(slug);
        if (!file) return `"${slug}" is empty.`;
        return file.content;
      } catch (error) {
        logger.error({ error, ...ctx, slug }, 'read_workspace_file failed');
        return `Could not read ${slug}: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'read_workspace_file',
      description: `Read one of your workspace files. Valid slugs: ${SLUG_LIST}. Read before editing so you preserve what is already there.`,
      schema: z.object({ slug: z.string().describe(`One of: ${SLUG_LIST}`) }),
    },
  );

  const write_workspace_file = tool(
    async ({ slug, content, reason }: { slug: string; content: string; reason: string }) => {
      if (!isWorkspaceSlug(slug)) return rejectSlug(slug);
      const blocked = blockedReason(slug);
      if (blocked) return blocked;
      return persist(slug, content, reason);
    },
    {
      name: 'write_workspace_file',
      description: 'Replace a workspace file\'s entire contents. Use "user" to record durable facts and preferences about the person you\'re helping, and "heartbeat" for standing checks on scheduled runs. When the user asks you to behave, talk, or present yourself differently going forward — not just for this one reply — proactively update "identity" or "soul" to match. That instruction IS the request to edit the file; do not wait for the user to separately say "edit your file." The approval prompt this triggers is the safety check, not a reason to hold back. Prefer edit_workspace_file for small changes.',
      schema: z.object({
        slug: z.string().describe(`One of: ${SLUG_LIST}`),
        content: z.string().describe('The complete new contents'),
        reason: z.string().describe('Why you are making this change — stored in the revision history'),
      }),
    },
  );

  const edit_workspace_file = tool(
    async (args: {
      slug: string;
      old_text?: string; new_text?: string;
      oldText?: string; newText?: string;
      reason?: string;
    }) => {
      const { slug } = args;
      // Both spellings accepted. The parameters were camelCase only, and the model
      // called this with `old_text`/`new_text` — snake_case, matching the tool's own
      // name and every other snake_case tool around it. Zod stripped the unknown
      // keys, leaving the required camelCase ones undefined, and LangChain threw
      // "Received tool input did not match expected schema" BEFORE this function
      // ran, so the usual "tools never throw, return a recoverable string" guarantee
      // could not apply. Renaming the canonical form to snake_case matches what the
      // model reaches for; the camelCase aliases keep any existing caller working.
      const oldText = args.old_text ?? args.oldText;
      const newText = args.new_text ?? args.newText;
      const reason = args.reason ?? 'Edited by Claw';
      // A recoverable message rather than a throw, so a malformed call costs one
      // retry instead of the whole turn — and names the parameters so the retry has
      // what it needs.
      if (typeof oldText !== 'string' || typeof newText !== 'string') {
        const missing = [
          typeof oldText !== 'string' ? 'old_text' : null,
          typeof newText !== 'string' ? 'new_text' : null,
        ].filter(Boolean).join(' and ');
        return `Missing ${missing}. Call edit_workspace_file with { slug, old_text, new_text, reason } — old_text must be text that appears in the file exactly once.`;
      }
      if (!isWorkspaceSlug(slug)) return rejectSlug(slug);
      const blocked = blockedReason(slug);
      if (blocked) return blocked;
      try {
        const file = await svc.read(slug);
        const current = file?.content ?? '';
        const occurrences = current.split(oldText).length - 1;
        if (occurrences === 0) {
          return `oldText not found in ${slug}. Read the file first, then pass text that appears in it exactly.`;
        }
        if (occurrences > 1) {
          return `oldText appears ${occurrences} times in ${slug} — ambiguous. Include more surrounding text so it matches exactly once.`;
        }
        return persist(slug, current.replace(oldText, newText), reason);
      } catch (error) {
        logger.error({ error, ...ctx, slug }, 'edit_workspace_file failed');
        return `Could not edit ${slug}: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'edit_workspace_file',
      description: 'Replace one exact snippet in a workspace file, leaving the rest untouched. oldText must appear exactly once. Prefer this over write_workspace_file so you do not discard content you did not mean to change. A request to change how you behave, talk, or present yourself going forward belongs in "identity" or "soul" — make that edit proactively, without waiting for the user to explicitly say "edit your file."',
      // snake_case is canonical because that is what models actually send for a
      // snake_case-named tool; the camelCase aliases are accepted but undocumented
      // here so the model is shown one obvious spelling rather than a choice.
      // Everything except `slug` is optional at the schema level so a malformed call
      // reaches the handler and gets a usable error back, instead of LangChain
      // throwing on validation before any of our own error handling can run.
      schema: z.object({
        slug: z.string().describe(`One of: ${SLUG_LIST}`),
        old_text: z.string().optional().describe('Exact text to replace; must occur exactly once'),
        new_text: z.string().optional().describe('Replacement text'),
        reason: z.string().optional().describe('Why you are making this change — stored in the revision history'),
        oldText: z.string().optional(),
        newText: z.string().optional(),
      }),
    },
  );

  return {
    tools: [list_workspace_files, read_workspace_file, write_workspace_file, edit_workspace_file],
    grantedWrites,
  };
}
