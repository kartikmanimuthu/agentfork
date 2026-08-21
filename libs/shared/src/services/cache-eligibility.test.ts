import { describe, it, expect } from 'vitest';
import { computeCacheEligibility, type EligibilityInput } from './cache-eligibility';
import { resolveCachingConfig } from './caching-config';

type ExactKey = 'withTools' | 'inSessions';
type SemanticKey = ExactKey | 'withAttachments' | 'withKnowledgeBase';

const build = (
  exactOverrides: Partial<Record<ExactKey, boolean>> = {},
  semanticOverrides: Partial<Record<SemanticKey, boolean>> = {},
) =>
  resolveCachingConfig({
    caching: {
      exact: { enabled: true, ttlSeconds: 60, overrides: exactOverrides },
      semantic: {
        enabled: true,
        ttlSeconds: 60,
        embeddingModel: 'titan-embed',
        threshold: 0.5,
        overrides: semanticOverrides,
      },
    },
  });

const bothTiersOn = build();

const clean: EligibilityInput = {
  noCache: false,
  hasMcpTools: false,
  hasBuiltInTools: false,
  hasSession: false,
  hasAttachments: false,
  hasKbContext: false,
  semanticKillSwitch: true,
};

const run = (caching = bothTiersOn, input: Partial<EligibilityInput> = {}) =>
  computeCacheEligibility(caching, { ...clean, ...input }, 60, 60);

describe('computeCacheEligibility', () => {
  it('enables both tiers when nothing blocks', () => {
    const r = run();
    expect(r.exactBlockers).toEqual([]);
    expect(r.semanticBlockers).toEqual([]);
    expect(r.exactEnabled).toBe(true);
    expect(r.semanticEnabled).toBe(true);
  });

  it('noCache beats every override', () => {
    const allOverridden = build(
      { withTools: true, inSessions: true },
      { withTools: true, inSessions: true, withAttachments: true, withKnowledgeBase: true },
    );
    const r = computeCacheEligibility(allOverridden, { ...clean, noCache: true }, 60, 60);
    expect(r.exactEnabled).toBe(false);
    expect(r.semanticEnabled).toBe(false);
    expect(r.exactBlockers).toContain('no_cache');
    expect(r.semanticBlockers).toContain('no_cache');
  });

  describe.each([
    ['hasMcpTools', 'withTools', 'tools'],
    ['hasBuiltInTools', 'withTools', 'tools'],
    ['hasSession', 'inSessions', 'session'],
  ] as const)('%s gates each tier against its own overrides', (flag, override, blockerName) => {
    it('blocks both tiers when neither tier overrides it', () => {
      const r = run(bothTiersOn, { [flag]: true } as Partial<EligibilityInput>);
      expect(r.exactBlockers).toContain(blockerName);
      expect(r.semanticBlockers).toContain(blockerName);
      expect(r.exactEnabled).toBe(false);
      expect(r.semanticEnabled).toBe(false);
    });

    it('allows both tiers when both tiers override it', () => {
      const caching = build({ [override]: true }, { [override]: true });
      const r = computeCacheEligibility(caching, { ...clean, [flag]: true }, 60, 60);
      expect(r.exactBlockers).toEqual([]);
      expect(r.semanticBlockers).toEqual([]);
      expect(r.exactEnabled).toBe(true);
      expect(r.semanticEnabled).toBe(true);
    });

    it('allows only the exact tier when only the exact tier overrides it', () => {
      const caching = build({ [override]: true }, {});
      const r = computeCacheEligibility(caching, { ...clean, [flag]: true }, 60, 60);
      expect(r.exactEnabled).toBe(true);
      expect(r.semanticEnabled).toBe(false);
      expect(r.exactBlockers).toEqual([]);
      expect(r.semanticBlockers).toContain(blockerName);
    });

    it('allows only the semantic tier when only the semantic tier overrides it', () => {
      const caching = build({}, { [override]: true });
      const r = computeCacheEligibility(caching, { ...clean, [flag]: true }, 60, 60);
      expect(r.exactEnabled).toBe(false);
      expect(r.semanticEnabled).toBe(true);
      expect(r.exactBlockers).toContain(blockerName);
      expect(r.semanticBlockers).toEqual([]);
    });
  });

  it('treats either kind of tool as the same blocker', () => {
    const toolsAllowed = build({ withTools: true }, { withTools: true });
    const r = computeCacheEligibility(
      toolsAllowed,
      { ...clean, hasMcpTools: true, hasBuiltInTools: true },
      60,
      60,
    );
    expect(r.exactEnabled).toBe(true);
    expect(r.semanticEnabled).toBe(true);
  });

  describe.each([
    ['hasAttachments', 'withAttachments', 'attachments'],
    ['hasKbContext', 'withKnowledgeBase', 'kb_context'],
  ] as const)('%s blocks the SEMANTIC tier only', (flag, override, blockerName) => {
    it('leaves the exact tier enabled and unblocked', () => {
      const r = run(bothTiersOn, { [flag]: true } as Partial<EligibilityInput>);
      expect(r.exactEnabled).toBe(true);
      expect(r.exactBlockers).toEqual([]);
      expect(r.semanticEnabled).toBe(false);
      expect(r.semanticBlockers).toContain(blockerName);
    });

    it('enables semantic when the override is on', () => {
      const caching = build({}, { [override]: true });
      const r = computeCacheEligibility(caching, { ...clean, [flag]: true }, 60, 60);
      expect(r.semanticEnabled).toBe(true);
      expect(r.semanticBlockers).toEqual([]);
    });
  });

  it('honours each tier toggle independently', () => {
    const exactOnly = resolveCachingConfig({
      caching: {
        exact: { enabled: true, ttlSeconds: 60, overrides: {} },
        semantic: { enabled: false, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5, overrides: {} },
      },
    });
    const semanticOnly = resolveCachingConfig({
      caching: {
        exact: { enabled: false, ttlSeconds: 60, overrides: {} },
        semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5, overrides: {} },
      },
    });
    expect(computeCacheEligibility(exactOnly, clean, 60, 60)).toMatchObject({
      exactEnabled: true,
      semanticEnabled: false,
    });
    expect(computeCacheEligibility(semanticOnly, clean, 60, 60)).toMatchObject({
      exactEnabled: false,
      semanticEnabled: true,
    });
  });

  it('disables a tier whose ttl is zero', () => {
    expect(computeCacheEligibility(bothTiersOn, clean, 0, 60).exactEnabled).toBe(false);
    expect(computeCacheEligibility(bothTiersOn, clean, 60, 0).semanticEnabled).toBe(false);
  });

  it('disables semantic with no embedding model or with the kill switch off', () => {
    const noModel = resolveCachingConfig({
      caching: {
        exact: { enabled: true, ttlSeconds: 60, overrides: {} },
        semantic: { enabled: true, ttlSeconds: 60, embeddingModel: '', threshold: 0.5, overrides: {} },
      },
    });
    const noModelResult = computeCacheEligibility(noModel, clean, 60, 60);
    expect(noModelResult.semanticEnabled).toBe(false);
    expect(noModelResult.semanticBlockers).toContain('no_embedding_model');

    const killed = run(bothTiersOn, { semanticKillSwitch: false });
    expect(killed.semanticEnabled).toBe(false);
    expect(killed.semanticBlockers).toContain('kill_switch');
    expect(killed.exactEnabled).toBe(true);
  });
});
