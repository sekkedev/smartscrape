import { promises as dns } from 'node:dns';
import net from 'node:net';

// RFC 1918 + link-local + loopback + documentation + cloud metadata,
// IPv4 + IPv6 equivalents.
function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a = 0, b = 0] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique-local fc00::/7
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true; // link-local fe80::/10
  }
  // IPv4-mapped: ::ffff:a.b.c.d
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]!);
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateV4(ip);
  if (version === 6) return isPrivateV6(ip);
  return false;
}

export type UrlCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate a URL for scraping:
 *   - HTTP(S) only
 *   - hostname does not resolve to a private / loopback / metadata IP
 *
 * DNS is resolved and every returned address is checked, so CNAME or
 * mixed AAAA records pointing at internal addresses are rejected too.
 */
export async function assertSafeUrl(input: string): Promise<UrlCheckResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs are supported' };
  }
  // Node's URL keeps the brackets on IPv6 hostnames (e.g. `[::1]`), but
  // net.isIP wants the bare address. Strip them before any check.
  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
  if (!hostname) return { ok: false, reason: 'Missing hostname' };

  // Literal IPs: check directly.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) return { ok: false, reason: 'URL resolves to a private network' };
    return { ok: true };
  }

  // Block localhost even if DNS would return a public IP.
  if (/^(localhost|localhost\.localdomain)$/i.test(hostname)) {
    return { ok: false, reason: 'URL resolves to a private network' };
  }

  // DNS resolve both families; reject if any address is private.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: 'Hostname does not resolve' };
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) return { ok: false, reason: 'URL resolves to a private network' };
  }
  return { ok: true };
}

// Exported for tests / internal reuse.
export const _internal = { isPrivateIp };
