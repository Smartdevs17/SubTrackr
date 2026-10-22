/**
 * outboundUrlGuard.ts
 *
 * Validation for URLs the server will fetch on a user's behalf.
 *
 * Several integration routes accept an operator- or merchant-supplied
 * `targetUrl` and later call `fetch()` with it. Without validation that is a
 * server-side request forgery primitive: an attacker can reach the cloud
 * metadata endpoint, loopback services, or RFC1918 hosts that are only
 * reachable from inside the network.
 *
 * The rules below reject the obvious cases statically (scheme, obvious host
 * names, literal private/loopback/link-local addresses). DNS rebinding and
 * internal names that resolve to private space are not covered here — for
 * those, pair this with an egress proxy or a resolved-address check at
 * connection time.
 */

import { isIP } from 'node:net';

/** Hostnames that always denote the local machine or a container escape. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/** Suffixes used by cloud metadata services. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain']);

/** Only plain web schemes; `file:`, `gopher:`, `dict:` etc. are refused. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export class OutboundUrlError extends Error {
  readonly code = 'OUTBOUND_URL_REJECTED' as const;

  constructor(reason: string) {
    super(`Rejected outbound URL: ${reason}`);
    this.name = 'OutboundUrlError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Parses IPv4 dotted-quads into octets.
 * Returns `null` for anything that is not exactly four numeric parts.
 */
function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }

  return octets;
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;

  if (a === 0) return true; // "this" network
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast + reserved

  return false;
}

function isPrivateIPv6(host: string): boolean {
  const normalized = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();

  if (normalized === '::' || normalized === '::1') return true; // unspecified, loopback

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms embed an IPv4 address.
  const embeddedIPv4 = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embeddedIPv4) {
    const octets = parseIPv4(embeddedIPv4[1]);
    if (octets && isPrivateIPv4(octets)) return true;
  }

  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true;

  return false;
}

/**
 * Returns true when `hostname` cannot be reached from the public internet.
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');

  if (host === '') return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = parseIPv4(host);
    // A malformed dotted quad is treated as unsafe rather than trusted.
    return octets === null ? true : isPrivateIPv4(octets);
  }
  if (ipVersion === 6) {
    return isPrivateIPv6(host);
  }

  // A host made only of digits and dots is an *attempted* IP literal. If it
  // did not parse as one, some other layer (a resolver, a proxy, a downstream
  // parser) may interpret it differently than we just did, so refuse it.
  if (/^[\d.]+$/.test(host)) {
    return true;
  }

  return false;
}

export interface ValidateOutboundUrlOptions {
  /** When set, only these hostnames (and their subdomains) are permitted. */
  allowedHosts?: readonly string[];
}

/**
 * Validates and normalises a URL the server is about to fetch.
 *
 * @throws {OutboundUrlError} when the URL is malformed, uses a non-HTTP
 *   scheme, points at private/loopback/link-local space, or is not on the
 *   allowlist.
 */
export function validateOutboundUrl(
  rawUrl: unknown,
  options: ValidateOutboundUrlOptions = {}
): URL {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new OutboundUrlError('value must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new OutboundUrlError('value is not a valid absolute URL');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new OutboundUrlError(`protocol '${parsed.protocol}' is not allowed`);
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new OutboundUrlError('embedded credentials are not allowed');
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new OutboundUrlError(`host '${parsed.hostname}' resolves to non-public address space`);
  }

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    const host = parsed.hostname.toLowerCase();
    const allowed = options.allowedHosts.some((entry) => {
      const candidate = entry.toLowerCase();
      return host === candidate || host.endsWith(`.${candidate}`);
    });

    if (!allowed) {
      throw new OutboundUrlError(`host '${parsed.hostname}' is not on the allowlist`);
    }
  }

  return parsed;
}