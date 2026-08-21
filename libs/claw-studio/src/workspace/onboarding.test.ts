import { describe, expect, it } from 'vitest';
import { isPersonaUnconfigured, onboardingWriteGrants } from './onboarding';
import { WORKSPACE_TEMPLATES } from './templates';
import type { WorkspaceSlug } from './types';

/** A freshly seeded tenant: every slug carries exactly its shipped template. */
function seeded(): Map<WorkspaceSlug, string> {
  return new Map(Object.entries(WORKSPACE_TEMPLATES) as Array<[WorkspaceSlug, string]>);
}

describe('isPersonaUnconfigured', () => {
  it('is true for a tenant with no workspace files at all', () => {
    expect(isPersonaUnconfigured(new Map())).toBe(true);
  });

  it('is true straight after seeding, when both persona files are still templates', () => {
    expect(isPersonaUnconfigured(seeded())).toBe(true);
  });

  it('is true when the persona files exist but are blank or whitespace', () => {
    const files = seeded();
    files.set('identity', '');
    files.set('soul', '   \n\t  ');
    expect(isPersonaUnconfigured(files)).toBe(true);
  });

  it('is false once identity has been written', () => {
    const files = seeded();
    files.set('identity', '# IDENTITY.md\n\n- **Name:** Pixel\n- **Emoji:** 🦊\n');
    expect(isPersonaUnconfigured(files)).toBe(false);
  });

  it('is false once soul has been written', () => {
    const files = seeded();
    files.set('soul', '# SOUL.md\n\nYou are terse and a little sardonic.\n');
    expect(isPersonaUnconfigured(files)).toBe(false);
  });

  // The anti-nag rule: one edited persona file is enough to consider the agent
  // configured, so a user who deliberately left the identity form blank is not
  // asked to name their agent again every session.
  it('is false when only one of the two persona files was edited', () => {
    const editedSoul = seeded();
    editedSoul.set('soul', 'custom soul');
    expect(isPersonaUnconfigured(editedSoul)).toBe(false);

    const editedIdentity = seeded();
    editedIdentity.set('identity', 'custom identity');
    expect(isPersonaUnconfigured(editedIdentity)).toBe(false);
  });

  // `agents` is excluded on purpose — its template is real operating procedure,
  // so leaving it alone is not a sign of an unconfigured agent.
  it('ignores every non-persona file', () => {
    const files = seeded();
    files.set('agents', 'a totally rewritten operating procedure');
    files.set('user', '# USER.md\n\nWorks in IST, wants short answers.\n');
    files.set('tools', 'prefer jira over email');
    files.set('heartbeat', 'always state the no-op case');
    expect(isPersonaUnconfigured(files)).toBe(true);
  });

  // Guards the exact-match half of the check against a template edit that
  // forgets `reseedUnedited()` — if this ever fails, the seeds have drifted and
  // every existing tenant silently reads as "already configured".
  it('treats the current shipped templates as untouched', () => {
    expect(isPersonaUnconfigured(new Map([
      ['identity', WORKSPACE_TEMPLATES.identity],
      ['soul', WORKSPACE_TEMPLATES.soul],
    ]))).toBe(true);
  });
});

describe('onboardingWriteGrants', () => {
  it('grants both write tools for all three gated slugs while unconfigured', () => {
    expect(onboardingWriteGrants(seeded(), 'all').sort()).toEqual([
      'edit_workspace_file:agents',
      'edit_workspace_file:identity',
      'edit_workspace_file:soul',
      'write_workspace_file:agents',
      'write_workspace_file:identity',
      'write_workspace_file:soul',
    ]);
  });

  // The property that makes this safe: the setup write itself revokes the
  // grant, because the grant is derived from the file state rather than stored.
  it('grants nothing once the persona has been written', () => {
    const files = seeded();
    files.set('identity', '# IDENTITY.md\n\n- **Name:** Pixel\n');
    expect(onboardingWriteGrants(files, 'all')).toEqual([]);
  });

  // Under user/off these slugs are denied at the backend by
  // buildWorkspacePermissions, so a grant would promise something the gate
  // refuses — and onboardingSection() is withheld on the same condition.
  it('grants nothing under a self-authoring mode that denies these slugs', () => {
    expect(onboardingWriteGrants(seeded(), 'user')).toEqual([]);
    expect(onboardingWriteGrants(seeded(), 'off')).toEqual([]);
  });

  // Slug-scoped keys, never a bare tool name: claw-deep-agent's isGranted falls
  // back to the bare name, so a bare grant here would exempt the tool for every
  // slug it was later pointed at.
  it('never emits a bare tool name', () => {
    for (const key of onboardingWriteGrants(seeded(), 'all')) {
      expect(key).toContain(':');
    }
  });
});
