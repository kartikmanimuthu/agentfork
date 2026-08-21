import { describe, it, expect } from 'vitest';
import { toOllamaOpenAIBaseUrl, toOllamaNativeBaseUrl } from './ollama-url';

describe('toOllamaOpenAIBaseUrl', () => {
  it('appends /v1 when absent', () => {
    expect(toOllamaOpenAIBaseUrl('https://ollama.com')).toBe('https://ollama.com/v1');
    expect(toOllamaOpenAIBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
  });

  it('is idempotent and tolerates trailing slashes and padding', () => {
    expect(toOllamaOpenAIBaseUrl('https://ollama.com/v1')).toBe('https://ollama.com/v1');
    expect(toOllamaOpenAIBaseUrl('https://ollama.com/v1/')).toBe('https://ollama.com/v1');
    expect(toOllamaOpenAIBaseUrl('  https://ollama.com//  ')).toBe('https://ollama.com/v1');
  });

  it('passes through empty input so callers keep their own defaulting', () => {
    expect(toOllamaOpenAIBaseUrl(undefined)).toBeUndefined();
    expect(toOllamaOpenAIBaseUrl('')).toBe('');
  });
});

describe('toOllamaNativeBaseUrl', () => {
  it('strips a /v1 suffix so native /api routes resolve', () => {
    expect(toOllamaNativeBaseUrl('https://ollama.com/v1')).toBe('https://ollama.com');
    expect(toOllamaNativeBaseUrl('https://ollama.com/v1/')).toBe('https://ollama.com');
    expect(toOllamaNativeBaseUrl('http://localhost:11434')).toBe('http://localhost:11434');
  });
});
