import { createLogger } from '@chatbot/shared/workers';
import type { ChunkResult, Chunker } from '../types';

const chunkerLogger = createLogger('kb:chunker');

// ─── Token counting ───────────────────────────────────────────────────────────

/**
 * Approximate token count using the GPT-3/4 heuristic: ~4 chars per token.
 * Avoids a hard dependency on tiktoken for the core chunking logic.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Fixed-size chunker ───────────────────────────────────────────────────────

export class FixedSizeChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    try {
      const results: ChunkResult[] = [];
      const words = text.split(/\s+/).filter(Boolean);
      let i = 0;

      while (i < words.length) {
        const slice: string[] = [];
        let tokens = 0;

        for (let j = i; j < words.length; j++) {
          const wordTokens = estimateTokens(words[j] + ' ');
          if (tokens + wordTokens > chunkSize && slice.length > 0) break;
          slice.push(words[j]);
          tokens += wordTokens;
        }

        const content = slice.join(' ');
        results.push({ content, metadata: { chunkIndex: results.length }, tokenCount: estimateTokens(content) });

        // Advance by (chunkSize - chunkOverlap) tokens worth of words
        const overlapTokens = chunkOverlap;
        let advanced = 0;
        let step = 0;
        while (step < slice.length && advanced < chunkSize - overlapTokens) {
          advanced += estimateTokens(slice[step] + ' ');
          step++;
        }
        i += Math.max(1, step);
      }

      chunkerLogger.info({ strategy: 'FIXED_SIZE', chunkCount: results.length, textLength: text.length }, 'Chunked text');
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      chunkerLogger.error({ strategy: 'FIXED_SIZE', textLength: text.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to chunk text');
      throw error;
    }
  }
}

// ─── Recursive character chunker ─────────────────────────────────────────────

const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ', ''];

export class RecursiveCharacterChunker implements Chunker {
  private readonly separators: string[];

  constructor(separators: string[] = DEFAULT_SEPARATORS) {
    this.separators = separators;
  }

  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    try {
      if (!text.trim()) return [];
      const rawChunks = this._split(text, chunkSize, chunkOverlap, this.separators);
      const results = rawChunks.map((content, idx) => ({
        content,
        metadata: { chunkIndex: idx },
        tokenCount: estimateTokens(content),
      }));
      chunkerLogger.info({ strategy: 'RECURSIVE_CHARACTER', chunkCount: results.length, textLength: text.length }, 'Chunked text');
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      chunkerLogger.error({ strategy: 'RECURSIVE_CHARACTER', textLength: text.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to chunk text');
      throw error;
    }
  }

  private _split(
    text: string,
    chunkSize: number,
    chunkOverlap: number,
    separators: string[]
  ): string[] {
    if (estimateTokens(text) <= chunkSize) return [text];

    const [sep, ...rest] = separators;
    if (sep === undefined) return [text];

    const parts = sep === '' ? text.split('') : text.split(sep);
    const chunks: string[] = [];
    let current = '';

    for (const part of parts) {
      const candidate = current ? current + sep + part : part;
      if (estimateTokens(candidate) <= chunkSize) {
        current = candidate;
      } else {
        if (current) {
          chunks.push(current);
          // Overlap: keep the tail of current
          const overlapChars = Math.floor(chunkOverlap * 4);
          current = current.length > overlapChars
            ? current.slice(-overlapChars) + sep + part
            : sep + part;
        } else {
          // Part itself is too large — recurse with next separator
          const sub = this._split(part, chunkSize, chunkOverlap, rest);
          chunks.push(...sub.slice(0, -1));
          current = sub[sub.length - 1] ?? '';
        }
      }
    }

    if (current.trim()) chunks.push(current);
    return chunks.filter(Boolean);
  }
}

// ─── Markdown-aware chunker ───────────────────────────────────────────────────

export class MarkdownAwareChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    try {
      const sections = text.split(/(?=^#{1,6}\s)/m).filter(Boolean);
      const results: ChunkResult[] = [];

      for (const section of sections) {
        if (estimateTokens(section) <= chunkSize) {
          results.push({
            content: section.trim(),
            metadata: { chunkIndex: results.length, type: 'markdown-section' },
            tokenCount: estimateTokens(section),
          });
        } else {
          const sub = new RecursiveCharacterChunker().chunk(section, chunkSize, chunkOverlap);
          for (const s of sub) {
            results.push({ ...s, metadata: { ...s.metadata, chunkIndex: results.length, type: 'markdown-section' } });
          }
        }
      }

      chunkerLogger.info({ strategy: 'MARKDOWN_AWARE', chunkCount: results.length, textLength: text.length }, 'Chunked text');
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      chunkerLogger.error({ strategy: 'MARKDOWN_AWARE', textLength: text.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to chunk text');
      throw error;
    }
  }
}

// ─── Code-aware chunker ───────────────────────────────────────────────────────

export class CodeAwareChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    try {
      const boundaries = /(?=^(?:export\s+)?(?:async\s+)?(?:function|class|const\s+\w+\s*=\s*(?:async\s+)?\(|interface|type\s+\w+\s*=)\s)/m;
      const sections = text.split(boundaries).filter(Boolean);
      const results: ChunkResult[] = [];

      for (const section of sections) {
        if (estimateTokens(section) <= chunkSize) {
          results.push({
            content: section.trim(),
            metadata: { chunkIndex: results.length, type: 'code-block' },
            tokenCount: estimateTokens(section),
          });
        } else {
          const sub = new RecursiveCharacterChunker(['\n\n', '\n', ' ', '']).chunk(
            section,
            chunkSize,
            chunkOverlap
          );
          for (const s of sub) {
            results.push({ ...s, metadata: { ...s.metadata, chunkIndex: results.length, type: 'code-block' } });
          }
        }
      }

      chunkerLogger.info({ strategy: 'CODE_AWARE', chunkCount: results.length, textLength: text.length }, 'Chunked text');
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      chunkerLogger.error({ strategy: 'CODE_AWARE', textLength: text.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to chunk text');
      throw error;
    }
  }
}

// ─── Semantic chunker ─────────────────────────────────────────────────────────

/**
 * Semantic chunker groups sentences into chunks where consecutive sentences
 * are semantically related. Without an embedding model at chunk time, we use
 * a sliding-window sentence grouping as a lightweight proxy.
 */
export class SemanticChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    try {
      const sentences = text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const results: ChunkResult[] = [];
      let current = '';

      for (const sentence of sentences) {
        const candidate = current ? current + ' ' + sentence : sentence;
        if (estimateTokens(candidate) <= chunkSize) {
          current = candidate;
        } else {
          if (current) {
            results.push({
              content: current,
              metadata: { chunkIndex: results.length, type: 'semantic' },
              tokenCount: estimateTokens(current),
            });
            const overlapChars = chunkOverlap * 4;
            current = current.length > overlapChars
              ? current.slice(-overlapChars) + ' ' + sentence
              : sentence;
          } else {
            results.push({
              content: sentence,
              metadata: { chunkIndex: results.length, type: 'semantic' },
              tokenCount: estimateTokens(sentence),
            });
            current = '';
          }
        }
      }

      if (current.trim()) {
        results.push({
          content: current,
          metadata: { chunkIndex: results.length, type: 'semantic' },
          tokenCount: estimateTokens(current),
        });
      }

      chunkerLogger.info({ strategy: 'SEMANTIC', chunkCount: results.length, textLength: text.length }, 'Chunked text');
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      chunkerLogger.error({ strategy: 'SEMANTIC', textLength: text.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to chunk text');
      throw error;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type ChunkStrategyName =
  | 'FIXED_SIZE'
  | 'RECURSIVE_CHARACTER'
  | 'SEMANTIC'
  | 'MARKDOWN_AWARE'
  | 'CODE_AWARE';

export function getChunker(strategy: ChunkStrategyName): Chunker {
  switch (strategy) {
    case 'FIXED_SIZE':
      return new FixedSizeChunker();
    case 'RECURSIVE_CHARACTER':
      return new RecursiveCharacterChunker();
    case 'SEMANTIC':
      return new SemanticChunker();
    case 'MARKDOWN_AWARE':
      return new MarkdownAwareChunker();
    case 'CODE_AWARE':
      return new CodeAwareChunker();
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unknown chunk strategy: ${_exhaustive}`);
    }
  }
}
