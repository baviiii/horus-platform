/**
 * SSRF guard for user-supplied URLs. The playground fetches arbitrary URLs
 * server-side, so private/loopback/link-local targets must be rejected.
 *
 * Hostname + IP-literal checks cover the practical cases. Full DNS-rebinding
 * protection (resolve → pin → verify) is the production hardening step when
 * this moves beyond the demo tenant.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', 'broadcasthost']);
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa'];

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes(':')) return false;
  return (
    h === '::1' ||
    h === '::' ||
    h.startsWith('fe80') || // link-local
    h.startsWith('fc') || // unique-local
    h.startsWith('fd') ||
    h.startsWith('::ffff:') // v4-mapped — conservative block
  );
}

/** Returns a human-readable reason when the URL must not be fetched; null when OK. */
export function blockedUrlReason(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http(s) URLs are allowed';
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return 'Host is not allowed';
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return 'Host is not allowed';
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return 'Private addresses are not allowed';
  if (!host.includes('.') && !host.includes(':')) return 'Bare hostnames are not allowed';
  return null;
}
