/**
 * Check whether two URLs belong to the same origin (protocol + host).
 */
export function isSameDomain(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

/**
 * Glob-style pattern match. Supports `*` as a wildcard.
 * If no patterns are provided, returns true.
 */
export function matchesPatterns(url: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => globMatch(url, pattern));
}

function globMatch(text: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') +
      '$',
    'i'
  );
  return regex.test(text);
}

/**
 * Resolve a (possibly relative) URL against a base URL.
 * Strips the hash fragment. Returns null for non-HTTP(S) protocols.
 */
export function normalizeUrl(url: string, baseUrl: string): string | null {
  try {
    // If it looks like an absolute URL with a scheme, validate it directly.
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      const parsed = new URL(url);
      parsed.hash = '';
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.href;
    }

    // Reject strings that don't look like valid relative URLs
    // (e.g. "::not-valid::").
    if (!/^[\w/.?#]/i.test(url)) {
      return null;
    }

    const resolved = new URL(url, baseUrl);
    resolved.hash = '';
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}
