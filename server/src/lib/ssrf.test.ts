import { describe, it, expect } from 'vitest';
import { _internal, assertSafeUrl } from './ssrf.js';

const { isPrivateIp } = _internal;

describe('isPrivateIp (IPv4)', () => {
  it.each([
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '127.10.20.30',
    '169.254.1.1',
    '169.254.169.254', // cloud metadata
    '172.16.0.1',
    '172.31.255.254',
    '192.168.0.1',
    '192.168.255.255',
    '0.0.0.0',
    '224.0.0.1', // multicast
    '255.255.255.255',
  ])('flags %s as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1', // just outside 172.16/12
    '172.32.0.1',
    '93.184.216.34', // example.com
  ])('treats %s as public', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('isPrivateIp (IPv6)', () => {
  it.each(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'feab::1'])(
    'flags %s as private',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    },
  );

  it.each(['2001:4860:4860::8888', '2606:4700:4700::1111'])('treats %s as public', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it('flags IPv4-mapped private addresses', () => {
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('treats IPv4-mapped public addresses as public', () => {
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  it('rejects non-http(s) protocols', async () => {
    expect((await assertSafeUrl('file:///etc/passwd')).ok).toBe(false);
    expect((await assertSafeUrl('javascript:alert(1)')).ok).toBe(false);
    expect((await assertSafeUrl('ftp://example.com')).ok).toBe(false);
  });

  it('rejects malformed URLs', async () => {
    expect((await assertSafeUrl('not a url')).ok).toBe(false);
    expect((await assertSafeUrl('')).ok).toBe(false);
  });

  it.each([
    'http://127.0.0.1',
    'http://127.0.0.1:8080/foo',
    'http://10.0.0.1',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1',
    'http://[::1]',
  ])('rejects literal private IP %s', async (url) => {
    const r = await assertSafeUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/private/i);
  });

  it('rejects localhost by name', async () => {
    // Whether localhost resolves to 127.0.0.1 (Windows / dev box with IPv6
    // enabled) or fails to resolve at all (some CI containers without local
    // resolver), the result is the same: `ok: false`. We don't assert on the
    // reason text — it's an implementation detail.
    const r = await assertSafeUrl('http://localhost');
    expect(r.ok).toBe(false);
  });

  it('accepts a literal public IP', async () => {
    const r = await assertSafeUrl('http://93.184.216.34/');
    expect(r.ok).toBe(true);
  });
});
