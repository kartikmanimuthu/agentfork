import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookup = vi.fn();

vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => lookup(...args) },
  lookup: (...args: unknown[]) => lookup(...args),
}));

import { checkUrl } from './url-guard';

/** Shapes a dns.lookup(host, { all: true }) result. */
function resolvesTo(...addresses: string[]) {
  lookup.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
}

describe('checkUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvesTo('93.184.216.34');
  });

  it('allows a public https URL', async () => {
    const result = await checkUrl('https://example.com/page');

    expect(result.allowed).toBe(true);
  });

  it('rejects a non-http(s) scheme without resolving it', async () => {
    const result = await checkUrl('file:///etc/passwd');

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/scheme/i);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a URL with an empty authority', async () => {
    // WHATWG normalises `https:///path` by shifting the first path segment up
    // into the host, so the only genuinely hostless form is one that fails to
    // parse at all.
    const result = await checkUrl('https://');

    expect(result.allowed).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a string that is not a URL at all', async () => {
    const result = await checkUrl('not a url');

    expect(result.allowed).toBe(false);
  });
});

describe('checkUrl blocked address classes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const blocked: Array<[label: string, address: string]> = [
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv4 loopback (non-canonical)', '127.99.42.7'],
    ['link-local / cloud metadata', '169.254.169.254'],
    ['RFC-1918 10/8', '10.0.0.5'],
    ['RFC-1918 172.16/12', '172.16.31.9'],
    ['RFC-1918 192.168/16', '192.168.1.1'],
    ['CGNAT 100.64/10', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
    ['unspecified', '0.0.0.0'],
    ['reserved 240/4', '240.0.0.1'],
    ['IPv6 loopback', '::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique-local', 'fc00::1'],
    ['IPv6 unspecified', '::'],
    ['IPv4-mapped IPv6 loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped IPv6 metadata', '::ffff:169.254.169.254'],
  ];

  it.each(blocked)('rejects %s (%s)', async (_label, address) => {
    resolvesTo(address);

    const result = await checkUrl('https://evil.example.com');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('rejects when only one of several resolved addresses is blocked', async () => {
    // DNS rebinding: a public A record alongside a private one. Checking only
    // the first answer would let this through.
    resolvesTo('93.184.216.34', '10.0.0.5');

    const result = await checkUrl('https://rebind.example.com');

    expect(result.allowed).toBe(false);
  });

  it('allows a host that resolves only to public addresses', async () => {
    resolvesTo('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946');

    const result = await checkUrl('https://example.com');

    expect(result.allowed).toBe(true);
  });

  it('strips brackets from an IPv6 literal host before resolving', async () => {
    resolvesTo('2606:2800:220::1');

    await checkUrl('https://[2606:2800:220::1]/path');

    expect(lookup).toHaveBeenCalledWith('2606:2800:220::1', expect.anything());
  });

  it('allows a loopback address when allowPrivateHosts is set', async () => {
    resolvesTo('127.0.0.1');

    const result = await checkUrl('http://localhost:3005/fixture', { allowPrivateHosts: true });

    expect(result.allowed).toBe(true);
  });

  it('rejects a host that fails to resolve', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));

    const result = await checkUrl('https://nonexistent.example.com');

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/resolve/i);
  });
});
