/**
 * Signed deep-link verification for sensitive routes.
 *
 * Problem: an attacker who can craft an arbitrary deep link (via QR code,
 * SMS, in-app redirect from a third-party WebView, etc.) could navigate the
 * user directly to a privileged screen such as /billing/confirm or
 * /settings/payment-method without going through the normal app flow.
 *
 * Solution: the server appends an HMAC-SHA256 signature to any deep link that
 * leads to a sensitive route. The mobile app verifies the signature before
 * processing the route's parameters. Links without a valid signature are
 * rejected and the user is redirected to the home screen.
 *
 * Key management:
 *   - `EXPO_PUBLIC_DEEPLINK_SIGNING_KEY` — build-time secret embedded via
 *     Expo's public environment variable mechanism. Rotate by rebuilding.
 *   - For higher assurance, the server can issue per-session signing keys via
 *     a /auth/deeplink-token endpoint and the app verifies against that value
 *     retrieved from the secure token store.
 *
 * Wire format:
 *   subtrackr://billing/confirm?subscriptionId=abc&_sig=<hex>&_ts=<epoch-secs>
 *
 * The signed payload is:  `<path>?<sorted-params-without-_sig>|<_ts>`
 */

import { createHmac, timingSafeEqual } from 'crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SensitiveRoute =
  | 'billing/confirm'
  | 'billing/cancel'
  | 'settings/payment-method'
  | 'settings/plan-change'
  | 'subscription/delete';

export interface SignedLinkParams {
  /** The route path without the scheme, e.g. "billing/confirm". */
  route: SensitiveRoute;
  /** Business parameters to attach to the link (must not include _sig or _ts). */
  params: Record<string, string>;
  /** Epoch seconds for the link (defaults to now). */
  issuedAt?: number;
}

export interface VerifyResult {
  valid: boolean;
  route?: SensitiveRoute;
  params?: Record<string, string>;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** All routes that require a valid signature before navigation. */
export const SENSITIVE_ROUTES: ReadonlySet<string> = new Set<SensitiveRoute>([
  'billing/confirm',
  'billing/cancel',
  'settings/payment-method',
  'settings/plan-change',
  'subscription/delete',
]);

/** Maximum age of a signed link in seconds (5 minutes). */
const MAX_AGE_SECONDS = 5 * 60;

const SIG_PARAM = '_sig';
const TS_PARAM = '_ts';

// ── Core helpers ──────────────────────────────────────────────────────────────

function buildSigningPayload(
  route: string,
  params: Record<string, string>,
  ts: number,
): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== SIG_PARAM)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  return `${route}?${sorted}|${ts}`;
}

function computeHmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function constantTimeHexEqual(a: string, b: string): boolean {
  try {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a signed deep link URL for a sensitive route.
 *
 * @param opts  Route, business params and optional issuedAt timestamp.
 * @param secret  HMAC-SHA256 signing key (server-managed).
 * @returns  Full deep link string with _sig and _ts appended.
 */
export function buildSignedDeepLink(opts: SignedLinkParams, secret: string): string {
  const ts = opts.issuedAt ?? Math.floor(Date.now() / 1000);
  const payload = buildSigningPayload(opts.route, opts.params, ts);
  const sig = computeHmac(payload, secret);

  const allParams: Record<string, string> = { ...opts.params, [TS_PARAM]: String(ts), [SIG_PARAM]: sig };
  const query = Object.keys(allParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  return `subtrackr://${opts.route}?${query}`;
}

/**
 * Verify a deep link URL and extract its route + parameters.
 *
 * @param url     The raw deep link URL received by the app.
 * @param secret  HMAC-SHA256 verification key.
 * @param nowSecs Optional override for "now" (seconds since epoch) — for testing.
 */
export function verifySignedDeepLink(
  url: string,
  secret: string,
  nowSecs?: number,
): VerifyResult {
  let parsed: URL;
  try {
    // `URL` requires a valid scheme; replace `subtrackr://` with `https://`
    // for parsing only.
    parsed = new URL(url.replace(/^subtrackr:\/\//, 'https://subtrackr.app/'));
  } catch {
    return { valid: false, error: 'Malformed URL' };
  }

  // Reconstruct the route from pathname (strip leading /)
  const route = parsed.pathname.replace(/^\//, '');

  if (!SENSITIVE_ROUTES.has(route)) {
    // Non-sensitive routes do not need a signature.
    return { valid: true, route: route as SensitiveRoute, params: Object.fromEntries(parsed.searchParams) };
  }

  const sig = parsed.searchParams.get(SIG_PARAM);
  const tsStr = parsed.searchParams.get(TS_PARAM);

  if (!sig || !tsStr) {
    return { valid: false, error: 'Missing signature or timestamp' };
  }

  const ts = parseInt(tsStr, 10);
  if (isNaN(ts)) {
    return { valid: false, error: 'Invalid timestamp' };
  }

  const now = nowSecs ?? Math.floor(Date.now() / 1000);
  if (now - ts > MAX_AGE_SECONDS) {
    return { valid: false, error: 'Link has expired' };
  }
  if (ts > now + 60) {
    // Reject links dated more than 60 s in the future (clock skew guard).
    return { valid: false, error: 'Link timestamp is in the future' };
  }

  // Reconstruct the payload from all params except _sig.
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    if (key !== SIG_PARAM) params[key] = value;
  });

  const payload = buildSigningPayload(route, params, ts);
  const expected = computeHmac(payload, secret);

  if (!constantTimeHexEqual(sig, expected)) {
    return { valid: false, error: 'Signature mismatch' };
  }

  // Strip internal params before returning to the caller.
  const { [TS_PARAM]: _ts, ...businessParams } = params;

  return { valid: true, route: route as SensitiveRoute, params: businessParams };
}
