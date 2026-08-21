/**
 * Ollama exposes two HTTP surfaces on the same host: its native API under
 * `/api` (used by model discovery) and an OpenAI-compatible one under `/v1`
 * (used for chat). Callers store a single `baseUrl` per provider, so whichever
 * spelling they saved has to be translated for the surface being called —
 * otherwise a base of `https://ollama.com` POSTs to
 * `https://ollama.com/chat/completions`, which is a website route, not an API
 * one, and returns an HTML 404 that surfaces as MODEL_NOT_FOUND.
 */

/** `https://ollama.com` → `https://ollama.com/v1`; already-suffixed input is left alone. */
export function toOllamaOpenAIBaseUrl(baseUrl: string): string;
export function toOllamaOpenAIBaseUrl(baseUrl: undefined): undefined;
export function toOllamaOpenAIBaseUrl(baseUrl?: string): string | undefined;
export function toOllamaOpenAIBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return baseUrl;
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/** `https://ollama.com/v1` → `https://ollama.com`, for the native `/api/*` routes. */
export function toOllamaNativeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}
