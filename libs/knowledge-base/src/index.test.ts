import { describe, it, expect } from 'vitest';
import {
  FixedSizeChunker,
  RecursiveCharacterChunker,
  MarkdownAwareChunker,
  CodeAwareChunker,
  SemanticChunker,
  getChunker,
} from '../src/chunkers/index';
import { TextParser, HtmlParser, MarkdownParser, stripHtml, stripMarkdown } from '../src/parsers/index';
import { runPreProcessingPipeline } from '../src/preprocessing/index';
import { reciprocalRankFusion } from '../src/search/index';
import type { DetailedRetrievalResult } from '../src/types';

// ─── Chunkers ─────────────────────────────────────────────────────────────────

describe('FixedSizeChunker', () => {
  it('splits text into chunks within token budget', () => {
    const chunker = new FixedSizeChunker();
    const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunker.chunk(text, 50, 10);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => {
      expect(c.tokenCount).toBeGreaterThan(0);
      expect(c.content.length).toBeGreaterThan(0);
    });
  });

  it('returns single chunk for short text', () => {
    const chunker = new FixedSizeChunker();
    const chunks = chunker.chunk('Hello world', 512, 50);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Hello world');
  });
});

describe('RecursiveCharacterChunker', () => {
  it('splits on paragraph boundaries first', () => {
    const chunker = new RecursiveCharacterChunker();
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = chunker.chunk(text, 20, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty text', () => {
    const chunker = new RecursiveCharacterChunker();
    const chunks = chunker.chunk('', 512, 50);
    expect(chunks).toHaveLength(0);
  });
});

describe('MarkdownAwareChunker', () => {
  it('splits on heading boundaries', () => {
    const chunker = new MarkdownAwareChunker();
    const text = '# Section 1\nContent one.\n\n## Section 2\nContent two.\n\n# Section 3\nContent three.';
    const chunks = chunker.chunk(text, 30, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SemanticChunker', () => {
  it('groups sentences into chunks', () => {
    const chunker = new SemanticChunker();
    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.';
    const chunks = chunker.chunk(text, 20, 5);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    chunks.forEach((c) => expect(c.content.length).toBeGreaterThan(0));
  });
});

describe('getChunker factory', () => {
  it('returns correct chunker for each strategy', () => {
    expect(getChunker('FIXED_SIZE')).toBeInstanceOf(FixedSizeChunker);
    expect(getChunker('RECURSIVE_CHARACTER')).toBeInstanceOf(RecursiveCharacterChunker);
    expect(getChunker('MARKDOWN_AWARE')).toBeInstanceOf(MarkdownAwareChunker);
    expect(getChunker('CODE_AWARE')).toBeInstanceOf(CodeAwareChunker);
    expect(getChunker('SEMANTIC')).toBeInstanceOf(SemanticChunker);
  });
});

// ─── Parsers ──────────────────────────────────────────────────────────────────

describe('TextParser', () => {
  it('returns buffer as UTF-8 string', async () => {
    const parser = new TextParser();
    const result = await parser.parse(Buffer.from('hello world'), 'text/plain');
    expect(result).toBe('hello world');
  });
});

describe('HtmlParser / stripHtml', () => {
  it('strips HTML tags', () => {
    const result = stripHtml('<p>Hello <b>world</b></p>');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<b>');
  });

  it('removes script blocks', () => {
    const result = stripHtml('<script>alert("xss")</script><p>Safe</p>');
    expect(result).not.toContain('alert');
    expect(result).toContain('Safe');
  });

  it('decodes HTML entities', () => {
    const result = stripHtml('&amp; &lt; &gt; &quot;');
    expect(result).toContain('&');
    expect(result).toContain('<');
    expect(result).toContain('>');
  });
});

describe('MarkdownParser / stripMarkdown', () => {
  it('removes heading markers', () => {
    const result = stripMarkdown('# Heading\n## Sub');
    expect(result).not.toContain('#');
    expect(result).toContain('Heading');
  });

  it('removes bold/italic markers', () => {
    const result = stripMarkdown('**bold** and *italic*');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).not.toContain('**');
    expect(result).not.toContain('*');
  });

  it('keeps link text, removes URL', () => {
    const result = stripMarkdown('[click here](https://example.com)');
    expect(result).toContain('click here');
    expect(result).not.toContain('https://example.com');
  });
});

// ─── Pre-processing pipeline ──────────────────────────────────────────────────

describe('runPreProcessingPipeline', () => {
  it('strips HTML when configured', () => {
    const { text, appliedSteps } = runPreProcessingPipeline('<p>Hello</p>', {
      htmlStripping: true,
      piiRedaction: false,
      ocrEnabled: false,
      tableExtraction: false,
    });
    expect(text).toContain('Hello');
    expect(text).not.toContain('<p>');
    expect(appliedSteps).toContain('html-stripping');
  });

  it('redacts email addresses when PII redaction is on', () => {
    const { text } = runPreProcessingPipeline('Contact user@example.com for help', {
      htmlStripping: false,
      piiRedaction: true,
      ocrEnabled: false,
      tableExtraction: false,
    });
    expect(text).not.toContain('user@example.com');
    expect(text).toContain('[EMAIL]');
  });

  it('always normalizes whitespace', () => {
    const { text, appliedSteps } = runPreProcessingPipeline('  hello   world  ', {
      htmlStripping: false,
      piiRedaction: false,
      ocrEnabled: false,
      tableExtraction: false,
    });
    expect(text).toBe('hello world');
    expect(appliedSteps).toContain('whitespace-normalization');
  });
});

// ─── RRF search ───────────────────────────────────────────────────────────────

describe('reciprocalRankFusion', () => {
  const makeResult = (id: string, score: number): DetailedRetrievalResult => ({
    chunkId: id,
    content: `content ${id}`,
    score,
    metadata: {},
    documentId: 'doc1',
    documentName: 'doc.txt',
    compressionKept: true,
  });

  it('merges dense and sparse results', () => {
    const dense = [makeResult('a', 0.9), makeResult('b', 0.8), makeResult('c', 0.7)];
    const sparse = [makeResult('b', 0.95), makeResult('d', 0.85), makeResult('a', 0.75)];
    const merged = reciprocalRankFusion(dense, sparse, 3, 0.7);
    expect(merged).toHaveLength(3);
    // 'b' appears in both lists so should rank highly
    const ids = merged.map((r) => r.chunkId);
    expect(ids).toContain('b');
  });

  it('respects topK limit', () => {
    const dense = Array.from({ length: 10 }, (_, i) => makeResult(`d${i}`, 1 - i * 0.05));
    const sparse = Array.from({ length: 10 }, (_, i) => makeResult(`s${i}`, 1 - i * 0.05));
    const merged = reciprocalRankFusion(dense, sparse, 5, 0.5);
    expect(merged).toHaveLength(5);
  });

  it('returns empty array for empty inputs', () => {
    const merged = reciprocalRankFusion([], [], 10, 0.7);
    expect(merged).toHaveLength(0);
  });
});
