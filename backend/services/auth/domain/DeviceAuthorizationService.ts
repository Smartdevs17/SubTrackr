/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) — SubTrackr, issue #1779
 *
 * Lets input-constrained clients (the CLI, TVs, kiosks) sign a user in:
 *
 *   1. The device calls the device authorization endpoint and receives a
 *      `device_code` (secret, kept by the device), a short `user_code` and a
 *      `verification_uri`.
 *   2. The user opens the URI on a device where they are already signed in,
 *      enters the user code, reviews the requested scopes and approves or
 *      denies.
 *   3. Meanwhile the device polls the token endpoint with the device code and
 *      gets `authorization_pending` / `slow_down` until the user decides, then
 *      either tokens or `access_denied`, or `expired_token` after the codes
 *      lapse.
 *
 * Security properties:
 *   - Device and user codes are stored only as HMAC-SHA256 digests keyed with
 *     a per-process secret, never in plaintext.
 *   - User codes are single-use: the first approve/deny consumes them. Device
 *     codes are single-use: the first successful token response consumes them.
 *   - Codes expire (default 10 minutes); polling faster than the interval
 *     returns `slow_down` and widens the interval by 5 s as RFC 8628 §3.5
 *     requires.
 *   - Requested scopes must be registered for the client; the approver can
 *     only grant scopes they hold themselves and may narrow the request; the
 *     issued session is limited to exactly the granted scopes.
 *   - Repeated wrong user codes from the same approver are rate limited.
 */

import { createHmac, randomBytes, randomInt } from 'crypto';
import { AuthError } from '../errors';
import { hasScope } from './ApiKeyRotationService';

/** RFC 8628 §6.1: no vowels (no accidental words), no easily confused characters. */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const DEVICE_CODE_BYTES = 32;
export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export interface DeviceClient {
  name: string;
  /** Scopes this client may request. `*` and `auth:manage` are never grantable. */
  allowedScopes: string[];
  /** Requested when the client omits `scope`. Defaults to `allowedScopes`. */
  defaultScopes?: string[];
}

export interface DeviceFlowConfig {
  verificationUri: string;
  codeTtlMs: number;
  /** Minimum polling interval in seconds (RFC 8628 default: 5). */
  pollIntervalSeconds: number;
  userCodeLength: number;
  clients: Record<string, DeviceClient>;
  /** Wrong user codes an approver may enter per window before being blocked. */
  maxUserCodeFailures: number;
  userCodeFailureWindowMs: number;
}

/** Scopes that a device can never obtain, whatever the client registration says. */
const NON_DELEGABLE_SCOPES = new Set(['*', 'auth:manage']);

function parseClients(raw: string | undefined): Record<string, DeviceClient> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, DeviceClient>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export const DEFAULT_DEVICE_FLOW_CONFIG: DeviceFlowConfig = {
  verificationUri: process.env['DEVICE_FLOW_VERIFICATION_URI'] ?? 'http://localhost:8081/device',
  codeTtlMs: 10 * 60 * 1000,
  pollIntervalSeconds: 5,
  userCodeLength: 8,
  clients: parseClients(process.env['DEVICE_FLOW_CLIENTS']) ?? {
    'subtrackr-cli': {
      name: 'SubTrackr CLI',
      allowedScopes: ['profile:read', 'subscriptions:read', 'subscriptions:write', 'sessions:read'],
      defaultScopes: ['profile:read', 'subscriptions:read'],
    },
  },
  maxUserCodeFailures: 10,
  userCodeFailureWindowMs: 15 * 60 * 1000,
};

export type DeviceGrantStatus = 'pending' | 'approved' | 'denied' | 'consumed';

interface DeviceGrant {
  deviceCodeHash: string;
  userCodeHash: string | null; // null once the user code has been used
  clientId: string;
  requestedScopes: string[];
  grantedScopes: string[];
  status: DeviceGrantStatus;
  userId: string | null;
  createdAt: number;
  expiresAt: number;
  intervalSeconds: number;
  lastPolledAt: number | null;
}

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface PendingDeviceRequest {
  clientId: string;
  clientName: string;
  scopes: string[];
  expiresAt: number;
}

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'unsupported_grant_type'
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token';

/** An RFC 6749 §5.2 / RFC 8628 §3.5 error for the OAuth endpoints. */
export class OAuthError extends Error {
  constructor(
    readonly error: OAuthErrorCode,
    readonly description: string,
    readonly status: number = error === 'invalid_client' ? 401 : 400
  ) {
    super(description);
    this.name = 'OAuthError';
  }

  toJSON(): { error: OAuthErrorCode; error_description: string } {
    return { error: this.error, error_description: this.description };
  }
}

export interface ApprovedDeviceGrant {
  userId: string;
  clientId: string;
  scopes: string[];
}

export function parseScopeParam(scope: unknown): string[] | null {
  if (scope === undefined || scope === null || scope === '') return null;
  if (typeof scope !== 'string') return [];
  return [...new Set(scope.split(' ').filter(Boolean))];
}

export class DeviceAuthorizationService {
  private readonly config: DeviceFlowConfig;
  private readonly now: () => number;
  private readonly hmacKey = randomBytes(32);
  private grants = new Map<string, DeviceGrant>(); // device code hash → grant
  private userCodes = new Map<string, string>(); // user code hash → device code hash
  private failures = new Map<string, { count: number; windowStart: number }>(); // approver → failures

  constructor(config: Partial<DeviceFlowConfig> = {}, now: () => number = Date.now) {
    this.config = { ...DEFAULT_DEVICE_FLOW_CONFIG, ...config };
    this.now = now;
  }

  // ── Step 1: device authorization request (RFC 8628 §3.1-3.2) ─────────────

  requestAuthorization(input: {
    clientId?: unknown;
    scope?: unknown;
  }): DeviceAuthorizationResponse {
    const clientId = typeof input.clientId === 'string' ? input.clientId : '';
    const client = clientId ? this.config.clients[clientId] : undefined;
    if (!client) throw new OAuthError('invalid_client', 'Unknown client_id');

    const requested = parseScopeParam(input.scope) ?? client.defaultScopes ?? client.allowedScopes;
    if (requested.length === 0) throw new OAuthError('invalid_scope', 'scope must not be empty');
    for (const scope of requested) {
      if (NON_DELEGABLE_SCOPES.has(scope) || !client.allowedScopes.includes(scope)) {
        throw new OAuthError('invalid_scope', `Scope not allowed for this client: ${scope}`);
      }
    }

    this.sweep();
    const now = this.now();
    const deviceCode = randomBytes(DEVICE_CODE_BYTES).toString('base64url');
    const deviceCodeHash = this.digest(`device:${deviceCode}`);
    let userCode = this.generateUserCode();
    let userCodeHash = this.digest(`user:${normalizeUserCode(userCode)}`);
    while (this.userCodes.has(userCodeHash)) {
      userCode = this.generateUserCode();
      userCodeHash = this.digest(`user:${normalizeUserCode(userCode)}`);
    }

    this.grants.set(deviceCodeHash, {
      deviceCodeHash,
      userCodeHash,
      clientId,
      requestedScopes: requested,
      grantedScopes: [],
      status: 'pending',
      userId: null,
      createdAt: now,
      expiresAt: now + this.config.codeTtlMs,
      intervalSeconds: this.config.pollIntervalSeconds,
      lastPolledAt: null,
    });
    this.userCodes.set(userCodeHash, deviceCodeHash);

    const separator = this.config.verificationUri.includes('?') ? '&' : '?';
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: this.config.verificationUri,
      verification_uri_complete: `${this.config.verificationUri}${separator}user_code=${encodeURIComponent(userCode)}`,
      expires_in: Math.floor(this.config.codeTtlMs / 1000),
      interval: this.config.pollIntervalSeconds,
    };
  }

  // ── Step 2: user review / approval (RFC 8628 §3.3) ────────────────────────

  /** What the approval screen shows. Does not consume the code. */
  describe(userCode: unknown, approverId: string): PendingDeviceRequest {
    const grant = this.findPendingByUserCode(userCode, approverId);
    const client = this.config.clients[grant.clientId];
    return {
      clientId: grant.clientId,
      clientName: client?.name ?? grant.clientId,
      scopes: [...grant.requestedScopes],
      expiresAt: grant.expiresAt,
    };
  }

  /**
   * Approve the request identified by `userCode` on behalf of `approverId`.
   * `scopes` optionally narrows the requested scopes; every granted scope
   * must be one the approver's own session holds.
   */
  approve(input: {
    userCode: unknown;
    approverId: string;
    approverScopes: string[];
    scopes?: string[];
  }): PendingDeviceRequest & { grantedScopes: string[] } {
    const grant = this.findPendingByUserCode(input.userCode, input.approverId);

    const granted = input.scopes
      ? [...new Set(input.scopes)].filter((scope) => grant.requestedScopes.includes(scope))
      : [...grant.requestedScopes];
    if (input.scopes && granted.length !== new Set(input.scopes).size) {
      throw AuthError.userCodeInvalid('scopes must be a subset of the requested scopes');
    }
    if (granted.length === 0) throw AuthError.userCodeInvalid('at least one scope must be granted');
    for (const scope of granted) {
      if (!hasScope(input.approverScopes, scope)) throw AuthError.insufficientScope(scope);
    }

    this.consumeUserCode(grant);
    grant.status = 'approved';
    grant.userId = input.approverId;
    grant.grantedScopes = granted;
    const client = this.config.clients[grant.clientId];
    return {
      clientId: grant.clientId,
      clientName: client?.name ?? grant.clientId,
      scopes: [...grant.requestedScopes],
      grantedScopes: [...granted],
      expiresAt: grant.expiresAt,
    };
  }

  deny(input: { userCode: unknown; approverId: string }): void {
    const grant = this.findPendingByUserCode(input.userCode, input.approverId);
    this.consumeUserCode(grant);
    grant.status = 'denied';
    grant.userId = input.approverId;
  }

  // ── Step 3: device polls the token endpoint (RFC 8628 §3.4-3.5) ──────────

  /**
   * Returns the approved grant exactly once; otherwise throws an `OAuthError`
   * with the RFC 8628 error code the device should act on.
   */
  poll(input: { clientId?: unknown; deviceCode?: unknown }): ApprovedDeviceGrant {
    if (typeof input.deviceCode !== 'string' || !input.deviceCode) {
      throw new OAuthError('invalid_request', 'device_code is required');
    }
    if (typeof input.clientId !== 'string' || !this.config.clients[input.clientId]) {
      throw new OAuthError('invalid_client', 'Unknown client_id');
    }

    const grant = this.grants.get(this.digest(`device:${input.deviceCode}`));
    if (!grant || grant.clientId !== input.clientId || grant.status === 'consumed') {
      throw new OAuthError('invalid_grant', 'Unknown, foreign or already used device_code');
    }

    const now = this.now();
    if (now > grant.expiresAt) {
      throw new OAuthError('expired_token', 'The device_code has expired; start a new request');
    }

    if (grant.status === 'denied') {
      grant.status = 'consumed';
      throw new OAuthError('access_denied', 'The user denied the request');
    }

    if (grant.status === 'pending') {
      const tooFast =
        grant.lastPolledAt !== null && now - grant.lastPolledAt < grant.intervalSeconds * 1000;
      grant.lastPolledAt = now;
      if (tooFast) {
        grant.intervalSeconds += 5;
        throw new OAuthError('slow_down', `Polling too fast; wait ${grant.intervalSeconds}s`);
      }
      throw new OAuthError('authorization_pending', 'The user has not completed authorization');
    }

    // approved → hand out tokens once
    grant.status = 'consumed';
    return {
      userId: grant.userId as string,
      clientId: grant.clientId,
      scopes: [...grant.grantedScopes],
    };
  }

  /** Current polling interval for a device code (exposed for tests and docs). */
  getInterval(deviceCode: string): number | undefined {
    return this.grants.get(this.digest(`device:${deviceCode}`))?.intervalSeconds;
  }

  /** Remove grants well past expiry. Called opportunistically on new requests. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [hash, grant] of this.grants) {
      // Keep expired grants for one extra TTL so late polls still get `expired_token`.
      if (now > grant.expiresAt + this.config.codeTtlMs) {
        if (grant.userCodeHash) this.userCodes.delete(grant.userCodeHash);
        this.grants.delete(hash);
        removed++;
      }
    }
    return removed;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private findPendingByUserCode(userCode: unknown, approverId: string): DeviceGrant {
    const now = this.now();
    const failures = this.failures.get(approverId);
    if (
      failures &&
      now - failures.windowStart <= this.config.userCodeFailureWindowMs &&
      failures.count >= this.config.maxUserCodeFailures
    ) {
      throw AuthError.userCodeAttemptsExceeded(
        failures.windowStart + this.config.userCodeFailureWindowMs - now
      );
    }

    const normalized = typeof userCode === 'string' ? normalizeUserCode(userCode) : '';
    const deviceHash =
      normalized.length === this.config.userCodeLength
        ? this.userCodes.get(this.digest(`user:${normalized}`))
        : undefined;
    const grant = deviceHash ? this.grants.get(deviceHash) : undefined;

    if (!grant || grant.status !== 'pending') {
      this.recordFailure(approverId, now);
      throw AuthError.userCodeInvalid('unknown or already used code');
    }
    if (now > grant.expiresAt) {
      throw AuthError.userCodeInvalid('code expired');
    }
    return grant;
  }

  private consumeUserCode(grant: DeviceGrant): void {
    if (grant.userCodeHash) this.userCodes.delete(grant.userCodeHash);
    grant.userCodeHash = null;
  }

  private recordFailure(approverId: string, now: number): void {
    const current = this.failures.get(approverId);
    if (!current || now - current.windowStart > this.config.userCodeFailureWindowMs) {
      this.failures.set(approverId, { count: 1, windowStart: now });
    } else {
      current.count += 1;
    }
  }

  private generateUserCode(): string {
    let code = '';
    for (let i = 0; i < this.config.userCodeLength; i++) {
      code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
    }
    const half = Math.ceil(code.length / 2);
    return `${code.slice(0, half)}-${code.slice(half)}`;
  }

  private digest(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value).digest('hex');
  }
}

/** Case-insensitive; ignores the dash and spaces users type (RFC 8628 §6.1). */
export function normalizeUserCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export const deviceAuthorizationService = new DeviceAuthorizationService();
