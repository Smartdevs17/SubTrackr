/**
 * Certificate pinning for the mobile API client.
 *
 * `fetch` in React Native performs the TLS handshake in native code, so the JS
 * layer never sees the peer certificate directly. This module implements the
 * *policy* half of pinning:
 *
 *   1. A configurable set of SPKI SHA-256 pins per host (`CertificatePinner`).
 *   2. A verification step the API client runs before every HTTPS request.
 *   3. A peer-certificate provider hook — the native TLS layer (OkHttp /
 *      NSURLSession pinning or a certificate-transparency hook) registers
 *      `globalThis.__SUBTRACKR_TLS_PEER_CERT__(url)` and the default provider
 *      picks the observed SPKI hash up from there.
 *
 * Modes:
 *   - `enforce` — a pin mismatch aborts the request (`CertificatePinningError`).
 *   - `report`  — mismatches are recorded on the span but the request proceeds
 *                 (safe fallback while pins are rolled out).
 *   - `disabled`— verification is skipped entirely.
 *
 * When no peer certificate can be observed (no native hook, provider error, or
 * no active pin set for the host) the configurable `onUnavailable` fallback
 * decides whether the request is allowed (`allow`, default) or blocked
 * (`block`), so deployments can choose fail-open telemetry or fail-closed
 * security.
 */

export type PinningMode = 'enforce' | 'report' | 'disabled';

export interface PinSet {
  /** Exact host (`api.example.com`) or wildcard (`*.example.com`). */
  host: string;
  /** SPKI SHA-256 pins: `sha256/<base64>` or bare base64. */
  pins: string[];
  /** ISO-8601 date after which this pin set is ignored (rotation). */
  expiresAt?: string;
}

export interface CertificatePinningConfig {
  mode?: PinningMode;
  pinSets?: PinSet[];
  /** Fallback when the peer certificate or a matching pin set is unavailable. */
  onUnavailable?: 'allow' | 'block';
}

export interface PeerCertificateInfo {
  /** Base64-encoded SHA-256 digest of the certificate's SPKI. */
  spkiSha256: string;
}

export type PeerCertificateProvider = (url: string) => Promise<PeerCertificateInfo | null>;

export type PinVerifyStatus = 'match' | 'mismatch' | 'unavailable' | 'no_pins' | 'disabled';

export interface PinVerifyResult {
  status: PinVerifyStatus;
  /** True when the request may proceed. */
  ok: boolean;
  hostname: string;
  detail: string;
}

export class CertificatePinningError extends Error {
  readonly status: PinVerifyStatus;
  readonly hostname: string;

  constructor(result: PinVerifyResult) {
    super(`Certificate pinning ${result.status} for ${result.hostname}: ${result.detail}`);
    this.name = 'CertificatePinningError';
    this.status = result.status;
    this.hostname = result.hostname;
  }
}

/** Normalises a pin to `sha256/<base64>` (lower-case prefix, trimmed). */
export function normalizePin(raw: string): string {
  const value = raw.trim();
  const withoutScheme = value.replace(/^sha256:/i, '').trim();
  const prefixed = /^sha256\//i.test(withoutScheme)
    ? withoutScheme.replace(/^sha256\//i, 'sha256/')
    : `sha256/${withoutScheme}`;
  return prefixed.toLowerCase();
}

/** Extracts the lower-case hostname from an absolute URL (or bare host). */
export function hostnameOf(url: string): string {
  const withoutScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const authority = withoutScheme.split(/[/?#]/)[0];
  const host = authority.replace(/^[^\@]*\@/, ''); // strip userinfo
  return host.replace(/:\d+$/, '').toLowerCase();
}

/** Matches `hostname` against an exact or `*.` wildcard pattern. */
export function hostMatches(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  const pat = pattern.trim().toLowerCase();
  if (pat === host) return true;
  if (pat.startsWith('*.')) {
    const suffix = pat.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return false;
}

/**
 * Default peer-certificate provider. Reads the SPKI hash observed by the
 * native TLS layer via `globalThis.__SUBTRACKR_TLS_PEER_CERT__`. Returns
 * `null` (→ `unavailable` fallback) when no hook is registered or it errors,
 * which keeps the app working before the native half ships.
 */
export const defaultPeerCertificateProvider: PeerCertificateProvider = async (url) => {
  const hook = (
    globalThis as unknown as {
      __SUBTRACKR_TLS_PEER_CERT__?: (target: string) => unknown;
    }
  ).__SUBTRACKR_TLS_PEER_CERT__;
  if (typeof hook !== 'function') return null;
  try {
    const info = await hook(url);
    if (info && typeof info === 'object' && 'spkiSha256' in info) {
      return info as PeerCertificateInfo;
    }
    return null;
  } catch {
    return null;
  }
};

export class CertificatePinner {
  private readonly mode: PinningMode;
  private readonly pinSets: PinSet[];
  private readonly onUnavailable: 'allow' | 'block';

  constructor(config: CertificatePinningConfig = {}) {
    this.mode = config.mode ?? 'enforce';
    this.pinSets = (config.pinSets ?? []).map((set) => ({
      ...set,
      pins: set.pins.map(normalizePin),
    }));
    this.onUnavailable = config.onUnavailable ?? 'allow';
  }

  /**
   * Builds a pinner from environment configuration:
   *   - `EXPO_PUBLIC_CERT_PINNING_MODE` — enforce (default) | report | disabled
   *   - `EXPO_PUBLIC_CERT_PIN_SETS` — JSON array of `PinSet` objects
   *   - `EXPO_PUBLIC_CERT_PINS` — comma-separated pins applied to the host of
   *     `EXPO_PUBLIC_API_BASE_URL` (convenient single-host setup)
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): CertificatePinner {
    const mode = env.EXPO_PUBLIC_CERT_PINNING_MODE as PinningMode | undefined;
    const onUnavailable =
      (env.EXPO_PUBLIC_CERT_PIN_UNAVAILABLE as 'allow' | 'block' | undefined) ?? 'allow';

    let pinSets: PinSet[] = [];
    const rawSets = env.EXPO_PUBLIC_CERT_PIN_SETS;
    if (rawSets) {
      try {
        const parsed = JSON.parse(rawSets) as PinSet[];
        if (Array.isArray(parsed)) pinSets = parsed;
      } catch {
        // Invalid configuration is treated as "no pins" (documented fallback).
        pinSets = [];
      }
    }

    const rawPins = env.EXPO_PUBLIC_CERT_PINS;
    if (pinSets.length === 0 && rawPins && env.EXPO_PUBLIC_API_BASE_URL) {
      const host = hostnameOf(env.EXPO_PUBLIC_API_BASE_URL);
      if (host) {
        pinSets = [
          {
            host,
            pins: rawPins
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean),
          },
        ];
      }
    }

    return new CertificatePinner({ mode, pinSets, onUnavailable });
  }

  getMode(): PinningMode {
    return this.mode;
  }

  /** Pin sets whose host matches and whose rotation window is still open. */
  activePinSets(hostname: string, now: number = Date.now()): PinSet[] {
    return this.pinSets.filter((set) => {
      if (!hostMatches(hostname, set.host)) return false;
      if (!set.expiresAt) return true;
      const expires = Date.parse(set.expiresAt);
      return Number.isNaN(expires) || expires > now;
    });
  }

  /**
   * Verifies a peer certificate against the configured pins.
   * Never throws — the caller decides what to do with `ok === false`.
   */
  verify(hostname: string, peer: PeerCertificateInfo | null): PinVerifyResult {
    const host = hostname.toLowerCase();

    if (this.mode === 'disabled') {
      return { status: 'disabled', ok: true, hostname: host, detail: 'pinning disabled' };
    }

    const active = this.activePinSets(host);
    if (active.length === 0) {
      const ok = this.onUnavailable === 'allow';
      return {
        status: 'no_pins',
        ok,
        hostname: host,
        detail: ok
          ? 'no active pin set for host; fallback allows request'
          : 'no active pin set for host; fallback blocks request',
      };
    }

    if (!peer || typeof peer.spkiSha256 !== 'string' || !peer.spkiSha256.trim()) {
      const ok = this.onUnavailable === 'allow';
      return {
        status: 'unavailable',
        ok,
        hostname: host,
        detail: ok
          ? 'peer certificate unavailable; fallback allows request'
          : 'peer certificate unavailable; fallback blocks request',
      };
    }

    const presented = normalizePin(peer.spkiSha256);
    const matched = active.some((set) => set.pins.includes(presented));
    if (matched) {
      return {
        status: 'match',
        ok: true,
        hostname: host,
        detail: 'peer SPKI matches a pinned key',
      };
    }

    const ok = this.mode === 'report';
    return {
      status: 'mismatch',
      ok,
      hostname: host,
      detail: ok
        ? 'pin mismatch recorded in report mode; request proceeds'
        : 'peer SPKI does not match any configured pin',
    };
  }

  /** Verify and throw `CertificatePinningError` when the request must not proceed. */
  assert(hostname: string, peer: PeerCertificateInfo | null): PinVerifyResult {
    const result = this.verify(hostname, peer);
    if (!result.ok) throw new CertificatePinningError(result);
    return result;
  }
}
