/**
 * url-guard.ts — SSRF guard for every model-supplied URL.
 *
 * Ported from OpenWorker's `coworker/web/guard.py` (`check_url`). A URL that
 * reaches `page.goto()` or `fetch()` comes from the model, which in turn may be
 * repeating something it read off an attacker-controlled page — so it is
 * untrusted input pointed at our own network. Without this, a request to
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` reads the
 * task role's credentials, and anything on the VPC is reachable.
 */

import { lookup } from 'node:dns/promises';

export interface UrlGuardOptions {
  /**
   * Permits loopback/private destinations. Exists so unit tests can drive a
   * fixture server on 127.0.0.1 without reaching the internet; production code
   * sources this from `env.WEB_GUARD_ALLOW_PRIVATE_HOSTS`, default false.
   */
  allowPrivateHosts?: boolean;
}

export interface UrlGuardResult {
  allowed: boolean;
  /** Present only when `allowed` is false. Safe to surface to the model. */
  reason?: string;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function deny(reason: string): UrlGuardResult {
  return { allowed: false, reason };
}

/**
 * Expands any IPv6 textual form — `::`, embedded dotted-quad, or fully written
 * out — into its eight 16-bit groups. Returns null if the input is not IPv6.
 */
function expandIpv6(address: string): number[] | null {
  let text = address.trim().toLowerCase();
  if (!text.includes(':')) return null;

  // Drop a zone index (`fe80::1%eth0`) — irrelevant to classification.
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  // Rewrite a trailing dotted quad (`::ffff:127.0.0.1`) into two hex groups so
  // the rest of the expansion only has to deal with hextets.
  const dotted = text.lastIndexOf(':');
  const tail = text.slice(dotted + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map((part) => Number(part));
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, dotted + 1)}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const groups: number[] = [];
    for (const chunk of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      groups.push(parseInt(chunk, 16));
    }
    return groups;
  };

  const head = parse(halves[0]);
  const tailGroups = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tailGroups) return null;

  if (halves.length === 2) {
    const fill = 8 - head.length - tailGroups.length;
    if (fill < 0) return null;
    return [...head, ...Array<number>(fill).fill(0), ...tailGroups];
  }

  return head.length === 8 ? head : null;
}

/** Returns a denial reason for a blocked IPv4 address, or null if it is routable. */
function classifyIpv4(address: string): string | null {
  const octets = address.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return `unparseable IPv4 address ${address}`;
  }
  const [a, b] = octets;

  if (a === 0) return `unspecified/this-network address ${address}`;
  if (a === 127) return `loopback address ${address}`;
  if (a === 10) return `private address ${address}`;
  if (a === 172 && b >= 16 && b <= 31) return `private address ${address}`;
  if (a === 192 && b === 168) return `private address ${address}`;
  // 169.254.0.0/16 — includes the cloud instance metadata endpoint.
  if (a === 169 && b === 254) return `link-local address ${address} (cloud metadata range)`;
  if (a === 100 && b >= 64 && b <= 127) return `carrier-grade NAT address ${address}`;
  if (a === 198 && (b === 18 || b === 19)) return `benchmarking address ${address}`;
  if (a >= 224 && a <= 239) return `multicast address ${address}`;
  if (a >= 240) return `reserved address ${address}`;

  return null;
}

/** Returns a denial reason for a blocked IPv6 address, or null if it is routable. */
function classifyIpv6(address: string): string | null {
  const groups = expandIpv6(address);
  if (!groups) return `unparseable IPv6 address ${address}`;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) forms reach an
  // IPv4 destination, so they must be judged by the IPv4 rules — otherwise
  // `::ffff:169.254.169.254` sails straight past an IPv6-only check.
  const leadingZero = groups.slice(0, 5).every((g) => g === 0);
  if (leadingZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const mapped = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
    if (groups[5] === 0xffff) return classifyIpv4(mapped);
    // `::` and `::1` are unspecified/loopback rather than mapped addresses.
    if (groups[6] === 0 && groups[7] <= 1) {
      return groups[7] === 0 ? `unspecified address ${address}` : `loopback address ${address}`;
    }
    return classifyIpv4(mapped);
  }

  if ((groups[0] & 0xffc0) === 0xfe80) return `link-local address ${address}`;
  if ((groups[0] & 0xfe00) === 0xfc00) return `unique-local address ${address}`;
  if ((groups[0] & 0xff00) === 0xff00) return `multicast address ${address}`;

  return null;
}

function classifyAddress(address: string): string | null {
  return address.includes(':') ? classifyIpv6(address) : classifyIpv4(address);
}

export async function checkUrl(raw: string, options: UrlGuardOptions = {}): Promise<UrlGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return deny(`not a valid URL: ${raw.slice(0, 100)}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return deny(`unsupported scheme "${parsed.protocol}" — only http and https are allowed`);
  }

  if (!parsed.hostname) {
    return deny('URL has no host');
  }

  // An IPv6 literal arrives bracketed from the URL parser; DNS wants it bare.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    return deny(`could not resolve host ${host}`);
  }

  if (!resolved.length) {
    return deny(`could not resolve host ${host}`);
  }

  if (options.allowPrivateHosts) {
    return { allowed: true };
  }

  // Every answer must be routable, not just the first — a record set mixing a
  // public address with a private one is the standard DNS-rebinding shape.
  for (const { address } of resolved) {
    const reason = classifyAddress(address);
    if (reason) {
      return deny(`blocked destination for ${host}: ${reason}`);
    }
  }

  return { allowed: true };
}
