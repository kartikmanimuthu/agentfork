import { describe, it, expect } from 'vitest';
import {
  resolveCachingConfig,
  DEFAULT_CACHE_TTL_SECONDS,
  MAX_CACHE_TTL_SECONDS,
  type ExactCacheOverrides,
  type SemanticCacheOverrides,
} from './caching-config';

const NO_EXACT_OVERRIDES: ExactCacheOverrides = {
  withTools: false,
  inSessions: false,
};

const NO_SEMANTIC_OVERRIDES: SemanticCacheOverrides = {
  ...NO_EXACT_OVERRIDES,
  withAttachments: false,
  withKnowledgeBase: false,
};

describe('resolveCachingConfig', () => {
  describe('defaults', () => {
    it('disables both tiers when there is no caching config at all', () => {
      const r = resolveCachingConfig({});
      expect(r.exact).toEqual({
        enabled: false,
        ttlSeconds: DEFAULT_CACHE_TTL_SECONDS,
        overrides: NO_EXACT_OVERRIDES,
      });
      expect(r.semantic.enabled).toBe(false);
      expect(r.semantic.overrides).toEqual(NO_SEMANTIC_OVERRIDES);
    });

    it('distinguishes an unconfigured agent from one that explicitly set cacheTtlMinutes', () => {
      expect(resolveCachingConfig({}).exact.enabled).toBe(false);
      expect(resolveCachingConfig({ cacheTtlMinutes: 60 }).exact.enabled).toBe(true);
    });

    it('leaves the semantic tier off when only a semanticCache block survives', () => {
      const r = resolveCachingConfig({ semanticCache: { enabled: true, embeddingModel: 'titan-embed' } });
      expect(r.semantic.enabled).toBe(false);
      expect(r.exact.enabled).toBe(false);
    });

    it('exposes the documented constants', () => {
      expect(DEFAULT_CACHE_TTL_SECONDS).toBe(86400);
      expect(MAX_CACHE_TTL_SECONDS).toBe(604800);
    });

    it('tolerates null and undefined', () => {
      expect(resolveCachingConfig(null).exact.enabled).toBe(false);
      expect(resolveCachingConfig(undefined).exact.overrides).toEqual(NO_EXACT_OVERRIDES);
      expect(resolveCachingConfig(undefined).semantic.overrides).toEqual(NO_SEMANTIC_OVERRIDES);
    });
  });

  describe('per-tier shape', () => {
    it('passes a full caching object through', () => {
      const r = resolveCachingConfig({
        caching: {
          exact: { enabled: false, ttlSeconds: 30, overrides: { withTools: true, inSessions: false } },
          semantic: {
            enabled: true,
            ttlSeconds: 120,
            embeddingModel: 'm',
            threshold: 0.6,
            overrides: { withTools: false, inSessions: true, withAttachments: true, withKnowledgeBase: false },
          },
        },
      });
      expect(r.exact).toEqual({
        enabled: false,
        ttlSeconds: 30,
        overrides: { withTools: true, inSessions: false },
      });
      expect(r.semantic).toEqual({
        enabled: true,
        ttlSeconds: 120,
        embeddingModel: 'm',
        threshold: 0.6,
        overrides: { withTools: false, inSessions: true, withAttachments: true, withKnowledgeBase: false },
      });
    });

    it('keeps the two tiers independent', () => {
      const r = resolveCachingConfig({
        caching: {
          exact: { enabled: true, ttlSeconds: 60, overrides: { inSessions: true } },
          semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5, overrides: {} },
        },
      });
      expect(r.exact.overrides.inSessions).toBe(true);
      expect(r.semantic.overrides.inSessions).toBe(false);
    });

    it('fills missing overrides with false rather than dropping them', () => {
      const r = resolveCachingConfig({
        caching: { exact: { enabled: true, ttlSeconds: 60, overrides: { withTools: true } } },
      });
      expect(r.exact.overrides).toEqual({ ...NO_EXACT_OVERRIDES, withTools: true });
      expect(r.semantic.overrides).toEqual(NO_SEMANTIC_OVERRIDES);
    });

    it('ignores attachment and knowledge-base keys smuggled onto the exact tier', () => {
      const r = resolveCachingConfig({
        caching: {
          exact: {
            enabled: true,
            ttlSeconds: 60,
            overrides: { withTools: true, withAttachments: true, withKnowledgeBase: true },
          },
        },
      });
      expect(r.exact.overrides).toEqual({ withTools: true, inSessions: false });
    });

    it('clamps a ttl above the maximum and rejects a negative one', () => {
      expect(resolveCachingConfig({ caching: { exact: { enabled: true, ttlSeconds: 999999 } } }).exact.ttlSeconds)
        .toBe(MAX_CACHE_TTL_SECONDS);
      expect(resolveCachingConfig({ caching: { exact: { enabled: true, ttlSeconds: -5 } } }).exact.ttlSeconds)
        .toBe(0);
    });
  });

  describe('shared-overrides shape', () => {
    it('maps one shared set onto both tiers', () => {
      const r = resolveCachingConfig({
        caching: {
          exact: { enabled: true, ttlSeconds: 60 },
          semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5 },
          overrides: {
            withMcpTools: false,
            withBuiltInTools: false,
            inSessions: true,
            withAttachments: true,
            withKnowledgeBase: true,
          },
        },
      });
      expect(r.exact.overrides).toEqual({ withTools: false, inSessions: true });
      expect(r.semantic.overrides).toEqual({
        withTools: false,
        inSessions: true,
        withAttachments: true,
        withKnowledgeBase: true,
      });
    });

    it.each([
      [{ withMcpTools: true, withBuiltInTools: false }, true],
      [{ withMcpTools: false, withBuiltInTools: true }, true],
      [{ withMcpTools: true, withBuiltInTools: true }, true],
      [{ withMcpTools: false, withBuiltInTools: false }, false],
    ])('ORs the two old tool flags into withTools (%j)', (overrides, expected) => {
      const r = resolveCachingConfig({
        caching: {
          exact: { enabled: true, ttlSeconds: 60 },
          semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5 },
          overrides,
        },
      });
      expect(r.exact.overrides.withTools).toBe(expected);
      expect(r.semantic.overrides.withTools).toBe(expected);
    });

    it('keeps attachment and knowledge-base overrides off the exact tier', () => {
      const r = resolveCachingConfig({
        caching: {
          exact: { enabled: true, ttlSeconds: 60 },
          overrides: { withAttachments: true, withKnowledgeBase: true },
        },
      });
      expect(Object.keys(r.exact.overrides).sort()).toEqual(['inSessions', 'withTools']);
    });

    it('lets a per-tier set win over a leftover shared set', () => {
      const r = resolveCachingConfig({
        caching: {
          exact: { enabled: true, ttlSeconds: 60, overrides: { withTools: false } },
          semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5, overrides: {} },
          overrides: { withMcpTools: true, inSessions: true },
        },
      });
      expect(r.exact.overrides).toEqual({ withTools: false, inSessions: false });
      expect(r.semantic.overrides).toEqual(NO_SEMANTIC_OVERRIDES);
    });
  });

  describe('legacy shape', () => {
    it('converts cacheTtlMinutes to seconds exactly once', () => {
      const r = resolveCachingConfig({ cacheTtlMinutes: 60 });
      expect(r.exact.ttlSeconds).toBe(3600);
      expect(r.exact.enabled).toBe(true);
    });

    it('treats cacheTtlMinutes 0 as the exact tier disabled', () => {
      const r = resolveCachingConfig({ cacheTtlMinutes: 0 });
      expect(r.exact.enabled).toBe(false);
      expect(r.exact.ttlSeconds).toBe(0);
    });

    it('carries the old semanticCache across and gives it the same ttl', () => {
      const r = resolveCachingConfig({
        cacheTtlMinutes: 10,
        semanticCache: { enabled: true, embeddingModel: 'titan-embed', threshold: 0.5 },
      });
      expect(r.semantic.enabled).toBe(true);
      expect(r.semantic.embeddingModel).toBe('titan-embed');
      expect(r.semantic.threshold).toBe(0.5);
      expect(r.semantic.ttlSeconds).toBe(600);
    });

    it('defaults every override on both tiers to false for a legacy config', () => {
      const r = resolveCachingConfig({ cacheTtlMinutes: 10, semanticCache: { enabled: true } });
      expect(r.exact.overrides).toEqual(NO_EXACT_OVERRIDES);
      expect(r.semantic.overrides).toEqual(NO_SEMANTIC_OVERRIDES);
    });

    it('prefers the new shape when both are present', () => {
      const r = resolveCachingConfig({
        cacheTtlMinutes: 999,
        caching: { exact: { enabled: true, ttlSeconds: 42 } },
      });
      expect(r.exact.ttlSeconds).toBe(42);
    });
  });
});
