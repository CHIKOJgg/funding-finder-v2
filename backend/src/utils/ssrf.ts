// SSRF protection for outbound HTTP requests to user-supplied URLs (B2B webhooks).
// Blocks private/reserved/loopback/link-local addresses and localhost hostnames
// so the server can't be used as a relay into internal networks or cloud metadata.

import { lookup } from 'node:dns/promises';

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local, cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24 (IETF protocol assignments)
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 (benchmarking)
  [0xe0000000, 0xffffffff], // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = parseInt(p, 10);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

function isPrivateIpv4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  if (int === null) return true; // malformed -> treat as blocked
  return PRIVATE_V4_RANGES.some(([start, end]) => int >= start && int <= end);
}

function isPrivateIpv6(addr: string): boolean {
  const a = addr.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded IPv4.
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (a === '::' || a === '::1') return true; // unspecified / loopback
  if (a.startsWith('fc') || a.startsWith('fd')) return true; // fc00::/7 ULA
  if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true; // fe80::/10 link-local
  if (a.startsWith('2001:db8')) return true; // documentation range
  return false;
}

function isPrivateIp(address: string): boolean {
  return address.includes(':') ? isPrivateIpv6(address) : isPrivateIpv4(address);
}

/**
 * Resolve and validate a URL for server-side fetching.
 * Returns null when the URL is safe, otherwise a human-readable reason.
 */
export async function validatePublicUrl(urlStr: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return 'Invalid URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'Only http(s) URLs are allowed';
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return 'localhost / .local hostnames are not allowed';
  }

  // Literal IP in the URL.
  if (/^[\d.]+$/.test(hostname) && isPrivateIpv4(hostname)) {
    return 'Private/reserved IP addresses are not allowed';
  }

  // Resolve the hostname and reject any address in a private/reserved range.
  try {
    const records = await lookup(hostname, { all: true });
    for (const { address } of records) {
      if (isPrivateIp(address)) {
        return `Host resolves to a private/reserved address (${address})`;
      }
    }
  } catch {
    return 'Hostname could not be resolved';
  }

  return null;
}
