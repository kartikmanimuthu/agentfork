import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildScopeKey,
  extractDigits,
  digitsMatch,
  negationMatch,
  getThresholdBand,
  getPresetThreshold,
  presetForThreshold,
  THRESHOLD_PRESETS,
  sanitiseThreshold,
  SemanticCacheService,
  type SemanticCacheDb,
} from './semantic-cache-service';

const TITAN = 'amazon.titan-embed-text-v2:0';
const OTHER_MODEL = 'text-embedding-3-small';

const base = {
  agentVersionId: 'ver-1',
  systemPrompt: 'You are helpful.',
  model: 'anthropic.claude-sonnet-4-20250514',
  temperature: 0.7,
  embeddingModel: 'amazon.titan-embed-text-v2:0',
};

describe('buildScopeKey', () => {
  it('is stable for identical input', () => {
    expect(buildScopeKey(base)).toBe(buildScopeKey({ ...base }));
  });

  it('changes when any component changes', () => {
    const original = buildScopeKey(base);
    expect(buildScopeKey({ ...base, agentVersionId: 'ver-2' })).not.toBe(original);
    expect(buildScopeKey({ ...base, systemPrompt: 'Be terse.' })).not.toBe(original);
    expect(buildScopeKey({ ...base, model: 'other-model' })).not.toBe(original);
    expect(buildScopeKey({ ...base, temperature: 0.8 })).not.toBe(original);
    expect(buildScopeKey({ ...base, embeddingModel: 'text-embedding-3-large' })).not.toBe(original);
  });

  it('returns a hex sha256', () => {
    expect(buildScopeKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('extractDigits', () => {
  it('returns digit runs in order', () => {
    expect(extractDigits('show Q3 revenue for 2025')).toEqual(['3', '2025']);
  });

  it('returns an empty array when there are no digits', () => {
    expect(extractDigits('how do I reset my password')).toEqual([]);
  });
});

describe('digitsMatch', () => {
  it('accepts prompts with no digits', () => {
    expect(digitsMatch('reset my password', 'reset the password')).toBe(true);
  });

  it('accepts identical digits', () => {
    expect(digitsMatch('status of order 4821', 'order 4821 status')).toBe(true);
  });

  it('rejects different digits', () => {
    expect(digitsMatch('show Q3 revenue', 'show Q4 revenue')).toBe(false);
  });

  it('rejects reordered digits', () => {
    expect(digitsMatch('transfer 500 to 200', 'transfer 200 to 500')).toBe(false);
  });

  it('rejects when one side has digits and the other does not', () => {
    expect(digitsMatch('invoice 77', 'invoice')).toBe(false);
  });
});

describe('negationMatch', () => {
  // The measured failure: 0.8638 cosine on Titan v2 between these two.
  it('rejects a negated question against its affirmative form', () => {
    expect(negationMatch('is the API rate limited', 'is the API not rate limited')).toBe(false);
  });

  it('accepts when both sides are negated', () => {
    expect(negationMatch('is the API not rate limited', "isn't the API rate limited")).toBe(true);
  });

  it('accepts when neither side is negated', () => {
    expect(negationMatch('how do I reset my password', 'I need to reset my password')).toBe(true);
  });

  it("rejects isn't against is", () => {
    expect(negationMatch("isn't the plan free", 'is the plan free')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(negationMatch('is the API NOT rate limited', 'is the API rate limited')).toBe(false);
    expect(negationMatch('is the API NOT rate limited', 'is the API not rate limited')).toBe(true);
  });

  it('counts the other negation markers', () => {
    expect(negationMatch('can I export without an API key', 'can I export with an API key')).toBe(false);
    expect(negationMatch('I cannot log in', 'I can log in')).toBe(false);
    expect(negationMatch("I can't log in", 'I can log in')).toBe(false);
    expect(negationMatch('I am unable to log in', 'I am able to log in')).toBe(false);
    expect(negationMatch('there is no refund', 'there is a refund')).toBe(false);
    expect(negationMatch('it never expires', 'it expires')).toBe(false);
  });

  it('does not count negation markers embedded in other words', () => {
    expect(negationMatch('what is a note', 'what is a nothing')).toBe(true);
  });
});

describe('getThresholdBand', () => {
  // The floor sits above the highest measured unguarded Titan non-match (0.3841) and
  // below the lowest measured true paraphrase (0.4951) — the negation and numeric guards
  // reject the two higher non-match pairs (0.8638 and 0.8122).
  it('returns the same single band whatever the embedding model', () => {
    const band = { min: 0.45, default: 0.75, max: 0.99 };
    expect(getThresholdBand(TITAN)).toEqual(band);
    expect(getThresholdBand('amazon.titan-embed-text-v1')).toEqual(band);
    expect(getThresholdBand(OTHER_MODEL)).toEqual(band);
    expect(getThresholdBand('')).toEqual(band);
    expect(getThresholdBand(OTHER_MODEL)).toBe(getThresholdBand(TITAN));
  });
});

describe('getPresetThreshold', () => {
  it('resolves each preset to its fixed point', () => {
    expect(getPresetThreshold(TITAN, 'strict')).toBe(0.95);
    expect(getPresetThreshold(TITAN, 'balanced')).toBe(0.75);
    expect(getPresetThreshold(TITAN, 'loose')).toBe(0.45);
  });

  it('resolves to the same number for every model', () => {
    for (const preset of THRESHOLD_PRESETS) {
      expect(getPresetThreshold(OTHER_MODEL, preset)).toBe(getPresetThreshold(TITAN, preset));
      expect(getPresetThreshold('', preset)).toBe(getPresetThreshold(TITAN, preset));
    }
  });

  it('keeps every preset distinct', () => {
    // A 0.01 gap between balanced and strict is not a real choice, and renders as two
    // markers on top of each other.
    for (const model of [TITAN, OTHER_MODEL]) {
      const values = THRESHOLD_PRESETS.map((p) => getPresetThreshold(model, p));
      expect(new Set(values).size).toBe(values.length);
      const sorted = [...values].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0.015);
      }
    }
  });

  it('returns values rounded to 2 decimal places', () => {
    for (const model of [TITAN, OTHER_MODEL]) {
      for (const preset of THRESHOLD_PRESETS) {
        const value = getPresetThreshold(model, preset);
        expect(value).toBe(Math.round(value * 100) / 100);
      }
    }
  });

  it('stays inside the band', () => {
    for (const model of [TITAN, OTHER_MODEL]) {
      const band = getThresholdBand(model);
      for (const preset of THRESHOLD_PRESETS) {
        const value = getPresetThreshold(model, preset);
        expect(value).toBeGreaterThanOrEqual(band.min);
        expect(value).toBeLessThanOrEqual(band.max);
      }
    }
  });
});

describe('presetForThreshold', () => {
  it('round-trips every preset', () => {
    for (const model of [TITAN, OTHER_MODEL]) {
      for (const preset of THRESHOLD_PRESETS) {
        expect(presetForThreshold(model, getPresetThreshold(model, preset))).toBe(preset);
      }
    }
  });

  it('reports the zone a value falls in, at every boundary', () => {
    expect(presetForThreshold(TITAN, 0.94)).toBe('balanced');
    expect(presetForThreshold(TITAN, 0.95)).toBe('strict');
    expect(presetForThreshold(TITAN, 0.59)).toBe('loose');
    expect(presetForThreshold(TITAN, 0.6)).toBe('balanced');
  });

  it('reports a zone for values outside the band', () => {
    expect(presetForThreshold(TITAN, 0.1)).toBe('loose');
    expect(presetForThreshold(TITAN, 1.5)).toBe('strict');
    expect(presetForThreshold(OTHER_MODEL, 0.2)).toBe('loose');
  });

  it('reports the same zone whatever the embedding model', () => {
    for (const value of [0.2, 0.59, 0.6, 0.75, 0.94, 0.95]) {
      expect(presetForThreshold(OTHER_MODEL, value)).toBe(presetForThreshold(TITAN, value));
    }
  });

  it('falls back to balanced for a non-finite value', () => {
    expect(presetForThreshold(TITAN, Number.NaN)).toBe('balanced');
    expect(presetForThreshold(TITAN, 'loose' as unknown as number)).toBe('balanced');
  });
});

describe('sanitiseThreshold', () => {
  it('accepts a value inside the band', () => {
    expect(sanitiseThreshold(0.55, TITAN)).toBe(0.55);
    expect(sanitiseThreshold(0.95, OTHER_MODEL)).toBe(0.95);
  });

  it('falls back to the band default outside it', () => {
    expect(sanitiseThreshold(0.2, TITAN)).toBe(0.75);
    expect(sanitiseThreshold(1.2, OTHER_MODEL)).toBe(0.75);
    expect(sanitiseThreshold('high', TITAN)).toBe(0.75);
    expect(sanitiseThreshold(Number.NaN, OTHER_MODEL)).toBe(0.75);
  });
});

const NOW = new Date('2026-01-01T00:00:00.000Z');
const response = { text: 'Go to Settings > Security.', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };

function makeDb() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    llmSemanticCache: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as SemanticCacheDb & {
    $queryRaw: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    llmSemanticCache: Record<string, ReturnType<typeof vi.fn>>;
  };
}

describe('SemanticCacheService', () => {
  let db: ReturnType<typeof makeDb>;
  let service: SemanticCacheService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db = makeDb();
    service = new SemanticCacheService(db);
  });

  afterEach(() => vi.useRealTimers());

  describe('lookup', () => {
    it('returns null when nothing is found', async () => {
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1, 0.2], promptText: 'hello', threshold: 0.97, embeddingModel: TITAN,
      });
      expect(hit).toBeNull();
    });

    it('returns null when similarity is below the threshold', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'hi there', similarity: 0.95 },
      ]);
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'hello', threshold: 0.97, embeddingModel: TITAN,
      });
      expect(hit).toBeNull();
    });

    it('returns the row when similarity meets the threshold exactly', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.97 },
      ]);
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'reset my password', threshold: 0.97, embeddingModel: TITAN,
      });
      expect(hit).toEqual({ id: 'r1', response, promptText: 'reset the password', similarity: 0.97 });
    });

    it('rejects a high-similarity row whose digits differ', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'show Q4 revenue', similarity: 0.99 },
      ]);
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'show Q3 revenue', threshold: 0.97, embeddingModel: TITAN,
      });
      expect(hit).toBeNull();
    });

    // Measured at 0.8638 cosine on Titan v2 — above any usable threshold.
    it('rejects a high-similarity row whose negation count differs', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'is the API not rate limited', similarity: 0.99 },
      ]);
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'is the API rate limited', threshold: 0.93,
        embeddingModel: TITAN,
      });
      expect(hit).toBeNull();
      expect(db.llmSemanticCache.update).not.toHaveBeenCalled();
    });

    it('honours a configured threshold near the bottom of the band', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.5 },
      ]);
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'reset my password', threshold: 0.46, embeddingModel: TITAN,
      });
      expect(hit?.id).toBe('r1');
    });

    it('applies the same threshold identically for a titan and a non-titan model', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.89 },
      ]);
      const params = { scopeKey: 's1', embedding: [0.1], promptText: 'reset my password' };

      expect(await service.lookup({ ...params, threshold: 0.88, embeddingModel: TITAN })).toEqual(
        await service.lookup({ ...params, threshold: 0.88, embeddingModel: OTHER_MODEL }),
      );
      expect(await service.lookup({ ...params, threshold: 0.88, embeddingModel: TITAN })).not.toBeNull();

      expect(await service.lookup({ ...params, threshold: 0.95, embeddingModel: TITAN })).toBeNull();
      expect(await service.lookup({ ...params, threshold: 0.95, embeddingModel: OTHER_MODEL })).toBeNull();
    });

    it('returns null instead of throwing when the db fails', async () => {
      db.$queryRaw.mockRejectedValue(new Error('connection terminated'));
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'hello', threshold: 0.97, embeddingModel: TITAN,
      });
      expect(hit).toBeNull();
    });

    // `config: z.any()` lets an arbitrary threshold be persisted. A non-numeric one
    // would make `similarity < threshold` false and serve the nearest row regardless.
    describe('threshold sanitisation', () => {
      const invalid: Array<[string, unknown]> = [
        ['NaN', Number.NaN],
        ['a string', 'high'],
        ['zero', 0],
        ['negative', -1],
        ['above the maximum', 2],
        ['Infinity', Number.POSITIVE_INFINITY],
      ];

      for (const [label, threshold] of invalid) {
        it(`falls back to the default for ${label} and rejects a below-default candidate`, async () => {
          db.$queryRaw.mockResolvedValue([
            { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.7 },
          ]);
          const hit = await service.lookup({
            scopeKey: 's1',
            embedding: [0.1],
            promptText: 'reset my password',
            threshold: threshold as number,
            embeddingModel: OTHER_MODEL,
          });
          expect(hit).toBeNull();
          expect(db.llmSemanticCache.update).not.toHaveBeenCalled();
        });

        it(`falls back to the default for ${label} and accepts an above-default candidate`, async () => {
          db.$queryRaw.mockResolvedValue([
            { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.8 },
          ]);
          const hit = await service.lookup({
            scopeKey: 's1',
            embedding: [0.1],
            promptText: 'reset my password',
            threshold: threshold as number,
            embeddingModel: OTHER_MODEL,
          });
          expect(hit?.id).toBe('r1');
        });
      }

      it('honours a valid in-range threshold', async () => {
        const params = {
          scopeKey: 's1', embedding: [0.1], promptText: 'reset my password', threshold: 0.9,
          embeddingModel: OTHER_MODEL,
        };

        db.$queryRaw.mockResolvedValue([
          { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.93 },
        ]);
        expect((await service.lookup(params))?.id).toBe('r1');

        // Above the 0.75 default but below the configured 0.9 — only rejected if the
        // configured value is the one being applied.
        db.$queryRaw.mockResolvedValue([
          { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.8 },
        ]);
        expect(await service.lookup(params)).toBeNull();
      });
    });

    it('increments hitCount on a hit', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.99 },
      ]);
      await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'reset my password', threshold: 0.97, embeddingModel: TITAN,
      });
      expect(db.llmSemanticCache.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { hitCount: { increment: 1 } },
      });
    });
  });

  describe('store', () => {
    const storeParams = {
      scopeKey: 's1',
      tenantId: 't1',
      agentVersionId: 'v1',
      promptText: 'how do I reset my password',
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      response,
      ttlSeconds: 3600,
    };

    it('writes a row with measured dimensions and the correct expiry', async () => {
      await service.store(storeParams);
      expect(db.$executeRaw).toHaveBeenCalledTimes(1);

      const [strings, ...values] = db.$executeRaw.mock.calls[0] as [string[], ...unknown[]];
      expect(strings.join('')).toContain('llm_semantic_cache');

      const [id, scopeKey, tenantId, agentVersionId, promptText, vector, embeddingModel, dims, json, expiresAt] =
        values;

      expect(typeof id).toBe('string');
      expect(scopeKey).toBe('s1');
      expect(tenantId).toBe('t1');
      expect(agentVersionId).toBe('v1');
      expect(promptText).toBe('how do I reset my password');
      expect(vector).toBe('[0.1,0.2,0.3]');
      expect(embeddingModel).toBe('amazon.titan-embed-text-v2:0');
      expect(dims).toBe(3);
      expect(json).toBe(JSON.stringify(response));
      expect(expiresAt).toEqual(new Date(NOW.getTime() + 60 * 60 * 1000));
    });

    it('measures dimensions from the vector rather than assuming a fixed size', async () => {
      await service.store({ ...storeParams, embedding: new Array(1536).fill(0.01) });
      const values = db.$executeRaw.mock.calls[0].slice(1);
      expect(values[7]).toBe(1536);
    });

    it('writes nothing when the TTL is zero or negative', async () => {
      await service.store({ ...storeParams, ttlSeconds: 0 });
      await service.store({ ...storeParams, ttlSeconds: -5 });
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('writes nothing when the response text is empty or whitespace', async () => {
      await service.store({ ...storeParams, response: { ...response, text: '' } });
      await service.store({ ...storeParams, response: { ...response, text: '   ' } });
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('writes nothing when the embedding is empty', async () => {
      await service.store({ ...storeParams, embedding: [] });
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('cleanupExpired', () => {
    it('deletes expired rows and returns the count', async () => {
      db.llmSemanticCache.deleteMany.mockResolvedValue({ count: 4 });
      expect(await service.cleanupExpired()).toBe(4);
      expect(db.llmSemanticCache.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: NOW } },
      });
    });
  });
});
