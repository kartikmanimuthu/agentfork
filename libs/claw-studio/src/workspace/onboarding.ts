/**
 * onboarding.ts
 *
 * Decides whether Claw still needs to introduce itself and ask who it should be.
 *
 * The trigger is the STATE OF THE FILES, not "is this conversation new". A
 * first-message flag would fire once and be gone — if the user ignored the
 * questions, or closed the tab mid-answer, the persona would stay at the stock
 * template forever with nothing left to prompt it. Reading the files instead
 * means the setup keeps offering itself until it has actually happened, and
 * stops the instant either file is written — by Claw here, or by a human in
 * Mission Control, which no conversation-scoped flag would ever notice.
 *
 * Pure: takes the composed file map, touches no DB and no env, so the whole
 * matrix below is testable without a database.
 */

import { WORKSPACE_TEMPLATES } from './templates';
import type { WorkspaceSlug } from './types';
import { GATED_WRITE_SLUGS, type SelfAuthoringMode } from './self-authoring-policy';

/**
 * The two files that make Claw someone rather than something. `agents` is
 * deliberately NOT here: its template is real, usable operating procedure, so a
 * tenant who never touches it is not misconfigured — whereas the `identity`
 * template is literally a form with blank fields ("**Name:** _(pick something
 * you like)_") that reaches the model exactly as written.
 */
const PERSONA_SLUGS: readonly WorkspaceSlug[] = ['identity', 'soul'] as const;

/**
 * Untouched means blank or byte-identical to the shipped seed.
 *
 * The exact-match half is only sound because of `reseedUnedited()`: it rewrites
 * version-1 rows whenever a template changes, so "never edited" and "equals the
 * current template" stay the same set as the seeds evolve. Without that, an old
 * seed left behind by a template edit would read as customised and the setup
 * would never run for anyone who joined before the change.
 */
function isUntouched(slug: WorkspaceSlug, content: string | undefined): boolean {
  if (!content || !content.trim()) return true;
  return content === WORKSPACE_TEMPLATES[slug];
}

/**
 * True when Claw has no persona of its own yet and should offer to set one up.
 *
 * Requires BOTH persona files to be untouched, which is the anti-nag rule: a
 * user who wrote a soul but deliberately left the identity form blank has made
 * a choice, and being asked to name their agent every session would be the
 * feature working against them. One edited file is enough to consider the
 * agent configured.
 */
export function isPersonaUnconfigured(files: Map<WorkspaceSlug, string>): boolean {
  return PERSONA_SLUGS.every((slug) => isUntouched(slug, files.get(slug)));
}

/**
 * The `<toolName>:<slug>` grant keys that let first-run setup writes skip the
 * approval gate — empty whenever there is something to protect.
 *
 * The gate on identity/soul/agents exists because rewriting a persona somebody
 * built is rare and high-consequence. None of that is true of a stock template
 * the user has just been asked to replace, and the alternative is three approval
 * modals to finish a welcome flow, for content the user dictated seconds
 * earlier.
 *
 * Two properties make this safe to hand out, and both come from deriving it
 * fresh from the file state rather than storing a flag:
 *
 *  - The write that fills the files makes `isPersonaUnconfigured` false, so
 *    every run built after it re-arms the gate. There is nothing to clear and
 *    no way for the grant to outlive the setup it exists for.
 *  - Under `user`/`off` these slugs are denied at the backend anyway
 *    (`buildWorkspacePermissions`), so a grant would be a lie. Gated on the
 *    same mode `onboardingSection` is, so the prompt and the gate always agree.
 *
 * Keys are slug-scoped on purpose: a bare `write_workspace_file` grant would
 * exempt the tool for every slug it was later pointed at (see
 * `claw-deep-agent.ts`'s `isGranted`).
 */
export function onboardingWriteGrants(
  files: Map<WorkspaceSlug, string>,
  mode: SelfAuthoringMode,
): string[] {
  if (mode !== 'all' || !isPersonaUnconfigured(files)) return [];
  return GATED_WRITE_SLUGS.flatMap((slug) => [
    `write_workspace_file:${slug}`,
    `edit_workspace_file:${slug}`,
  ]);
}
