/**
 * backend/src/services/invites.ts
 *
 * Issue #2255: one shared, typed state machine for every household-invite flow.
 *
 * Both the API (this file) and the React Native client
 * (`mobile/src/features/invites/index.ts`) import this module, so the set of
 * invite states, the legal transitions between them and the guards that reject
 * illegal ones live in exactly one place. A client can therefore ask
 * "can I accept this invite?" and the server will apply the very same rule.
 *
 * Lifecycle:
 *
 *   draft --send--> pending --accept--> accepted
 *                       |--decline--> declined
 *                       |--expire --> expired
 *                       `--revoke --> revoked
 *
 * The four terminal states have no outgoing transitions. Expiry is decided by
 * an injectable clock (`nowMs`), never by `Date.now()` inside a guard, which
 * keeps the machine deterministic and unit-testable.
 *
 * Zero dependencies and no I/O: every export is pure (observability is done
 * through injected no-op-by-default hooks).
 */

/** All invite states, in lifecycle order. Frozen. */
export const INVITE_STATES = Object.freeze([
  'draft',
  'pending',
  'accepted',
  'declined',
  'expired',
  'revoked',
] as const);

/** A single invite state. */
export type InviteState = (typeof INVITE_STATES)[number];

/** All invite events, frozen. */
export const INVITE_EVENTS = Object.freeze([
  'send',
  'accept',
  'decline',
  'expire',
  'revoke',
] as const);

/** An event that can be applied to an invite. */
export type InviteEvent = (typeof INVITE_EVENTS)[number];

/** States from which no further transition is legal. Frozen. */
export const TERMINAL_INVITE_STATES = Object.freeze([
  'accepted',
  'declined',
  'expired',
  'revoked',
] as const);

/** Stable, machine-readable error codes. Frozen. */
export const InviteErrorCode = Object.freeze({
  INVALID_STATE: 'INVALID_STATE',
  INVALID_EVENT: 'INVALID_EVENT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_INPUT: 'INVALID_INPUT',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  MAX_ACTIVE_EXCEEDED: 'MAX_ACTIVE_EXCEEDED',
} as const);

/** Union of {@link InviteErrorCode} values. */
export type InviteErrorCode = (typeof InviteErrorCode)[keyof typeof InviteErrorCode];

/**
 * Error thrown for every rejected invite operation.
 *
 * The `code` is stable and safe to expose to clients; `details` carries
 * non-sensitive context (states, events, limits) for logging and tests.
 */
export class InviteError extends Error {
  /** Stable machine-readable code. */
  readonly code: InviteErrorCode;
  /** Additional non-sensitive context about the rejection. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: InviteErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'InviteError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** Tunable policy for an invite machine. */
export interface InviteConfig {
  /** Time-to-live of a freshly issued invite, in milliseconds. */
  readonly ttlMs: number;
  /** Maximum number of simultaneously pending invites per household. */
  readonly maxActivePerHousehold: number;
}

/** Default policy: one week TTL, ten concurrently pending invites. Frozen. */
export const DEFAULT_INVITE_CONFIG: Readonly<InviteConfig> = Object.freeze({
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxActivePerHousehold: 10,
});

/** Context available to guards while evaluating a transition. */
export interface InviteTransitionContext {
  /** Current time in milliseconds. Defaults to `Date.now()`. */
  readonly nowMs?: number;
  /** Expiry timestamp of the invite in milliseconds, when one has been issued. */
  readonly expiresAt?: number;
  /** Number of currently pending invites for the household. */
  readonly activeInvites?: number;
  /** Overrides `config.maxActivePerHousehold` for this transition. */
  readonly maxActivePerHousehold?: number;
  /** Optional actor identifier, forwarded to metrics/logging only. */
  readonly actor?: string;
}

/** Observability hooks called on accepted and rejected transitions. */
export interface InviteMetrics {
  /** Called after a transition succeeds. */
  transition(from: InviteState, event: InviteEvent, to: InviteState): void;
  /** Called after a transition is rejected by a guard. */
  rejection(code: InviteErrorCode, from: InviteState, event: InviteEvent): void;
}

/** No-op metrics, safe to use in pure/browser contexts. Frozen. */
export const noopInviteMetrics: InviteMetrics = Object.freeze({
  transition() {},
  rejection() {},
});

/** Minimal structured logger interface. Receives no secrets. */
export interface InviteLogger {
  /** Emit a debug-level event with optional non-sensitive context. */
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
}

/** No-op logger. Frozen. */
export const noopInviteLogger: InviteLogger = Object.freeze({
  debug() {},
});

/**
 * The single transition table. `undefined` means "no legal transition", which
 * is turned into an {@link InviteErrorCode.INVALID_TRANSITION} error.
 */
const TRANSITION_TABLE: Readonly<
  Record<InviteState, Readonly<Partial<Record<InviteEvent, InviteState>>>>
> = Object.freeze({
  draft: Object.freeze({ send: 'pending' }),
  pending: Object.freeze({
    accept: 'accepted',
    decline: 'declined',
    expire: 'expired',
    revoke: 'revoked',
  }),
  accepted: Object.freeze({}),
  declined: Object.freeze({}),
  expired: Object.freeze({}),
  revoked: Object.freeze({}),
});

/** Input accepted by {@link normalizeInvite}. */
export interface InviteInput {
  /** Stable invite identifier. Must be a non-empty string. */
  readonly id: string;
  /** Household the invite belongs to. Must be a non-empty string. */
  readonly householdId: string;
  /** Desired state; defaults to `draft`. */
  readonly state?: unknown;
  /** Opaque invite token; defaults to `inv_<id>`. */
  readonly token?: string;
  /** Issue time in milliseconds; defaults to `nowMs`. */
  readonly issuedAt?: number;
  /** Expiry time in milliseconds; defaults to `issuedAt + config.ttlMs`. */
  readonly expiresAt?: number;
}

/** A normalized, fully populated invite record. All fields are read-only. */
export interface Invite {
  readonly id: string;
  readonly householdId: string;
  readonly state: InviteState;
  readonly token: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Result of a successful transition (kept for callers that want detail). */
export interface InviteTransitionResult {
  readonly from: InviteState;
  readonly event: InviteEvent;
  readonly to: InviteState;
  readonly changed: boolean;
}

/** A bound invite machine. */
export interface InviteMachine {
  /** Apply `event` to `state`, throwing {@link InviteError} on rejection. */
  transition(state: InviteState, event: InviteEvent, ctx?: InviteTransitionContext): InviteState;
  /** Whether the transition (including its guards) would succeed. */
  canTransition(state: InviteState, event: InviteEvent, ctx?: InviteTransitionContext): boolean;
  /** All states, shared and frozen. */
  readonly states: readonly InviteState[];
  /** The validated, frozen configuration in use. */
  readonly config: Readonly<InviteConfig>;
}

/** Type guard for {@link InviteState}. */
export function isInviteState(value: unknown): value is InviteState {
  return typeof value === 'string' && (INVITE_STATES as readonly string[]).includes(value);
}

/** Type guard for {@link InviteEvent}. */
export function isInviteEvent(value: unknown): value is InviteEvent {
  return typeof value === 'string' && (INVITE_EVENTS as readonly string[]).includes(value);
}

/** Whether a state is terminal (accept/decline/expire/revoke are final). */
export function isTerminalInviteState(state: InviteState): boolean {
  return (TERMINAL_INVITE_STATES as readonly string[]).includes(state);
}

/**
 * Pure expiry check against an injectable clock.
 *
 * @param expiresAt Expiry timestamp in milliseconds.
 * @param nowMs Current time in milliseconds (defaults to `Date.now()`).
 */
export function isInviteExpired(expiresAt: number, nowMs: number = Date.now()): boolean {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(nowMs)) {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'expiresAt and nowMs must be finite numbers', {
      expiresAt,
      nowMs,
    });
  }
  return nowMs >= expiresAt;
}

function fail(
  code: InviteErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>>,
  from: InviteState,
  event: InviteEvent,
  metrics: InviteMetrics,
  logger: InviteLogger,
): never {
  const error = new InviteError(code, message, details);
  metrics.rejection(code, from, event);
  logger.debug('invite transition rejected', { from, event, code, details });
  throw error;
}

function runTransition(
  state: InviteState,
  event: InviteEvent,
  ctx: InviteTransitionContext,
  config: Readonly<InviteConfig>,
  metrics: InviteMetrics,
  logger: InviteLogger,
): InviteState {
  if (!isInviteState(state)) {
    throw new InviteError(InviteErrorCode.INVALID_STATE, `Unknown invite state: ${String(state)}`, {
      state,
    });
  }
  if (!isInviteEvent(event)) {
    throw new InviteError(InviteErrorCode.INVALID_EVENT, `Unknown invite event: ${String(event)}`, {
      event,
    });
  }

  const next = TRANSITION_TABLE[state][event];
  if (next === undefined) {
    fail(
      InviteErrorCode.INVALID_TRANSITION,
      `Cannot ${event} an invite in state ${state}`,
      { state, event },
      state,
      event,
      metrics,
      logger,
    );
  }

  const now = ctx.nowMs ?? Date.now();
  if (!Number.isFinite(now)) {
    fail(
      InviteErrorCode.INVALID_INPUT,
      'nowMs must be a finite number',
      { nowMs: ctx.nowMs },
      state,
      event,
      metrics,
      logger,
    );
  }

  if (event === 'send') {
    const max = ctx.maxActivePerHousehold ?? config.maxActivePerHousehold;
    const active = ctx.activeInvites ?? 0;
    if (!Number.isFinite(max) || max < 1) {
      fail(
        InviteErrorCode.INVALID_CONFIG,
        'maxActivePerHousehold must be at least 1',
        { max },
        state,
        event,
        metrics,
        logger,
      );
    }
    if (!Number.isFinite(active) || active < 0) {
      fail(
        InviteErrorCode.INVALID_INPUT,
        'activeInvites must be a non-negative finite number',
        { active },
        state,
        event,
        metrics,
        logger,
      );
    }
    if (active >= max) {
      fail(
        InviteErrorCode.MAX_ACTIVE_EXCEEDED,
        `Household already has ${active} active invites (limit ${max})`,
        { active, max },
        state,
        event,
        metrics,
        logger,
      );
    }
  }

  if (event === 'accept' && ctx.expiresAt !== undefined) {
    if (!Number.isFinite(ctx.expiresAt)) {
      fail(
        InviteErrorCode.INVALID_INPUT,
        'expiresAt must be a finite number',
        { expiresAt: ctx.expiresAt },
        state,
        event,
        metrics,
        logger,
      );
    }
    if (now >= ctx.expiresAt) {
      fail(
        InviteErrorCode.INVITE_EXPIRED,
        `Invite expired at ${ctx.expiresAt} (now ${now})`,
        { expiresAt: ctx.expiresAt, nowMs: now },
        state,
        event,
        metrics,
        logger,
      );
    }
  }

  metrics.transition(state, event, next);
  logger.debug('invite transition applied', { from: state, event, to: next, actor: ctx.actor });
  return next;
}

/**
 * Apply `event` to `state` using the default configuration and no-op hooks.
 *
 * @throws {@link InviteError} for unknown states/events, illegal transitions or
 * failed guards.
 */
export function transition(
  state: InviteState,
  event: InviteEvent,
  ctx: InviteTransitionContext = {},
): InviteState {
  return runTransition(state, event, ctx, DEFAULT_INVITE_CONFIG, noopInviteMetrics, noopInviteLogger);
}

/**
 * Whether a transition would succeed, including all guards. Never throws.
 */
export function canTransition(
  state: InviteState,
  event: InviteEvent,
  ctx: InviteTransitionContext = {},
): boolean {
  try {
    runTransition(state, event, ctx, DEFAULT_INVITE_CONFIG, noopInviteMetrics, noopInviteLogger);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize untrusted invite input into a frozen, complete record.
 *
 * Defaults: `state` becomes `draft`, `issuedAt` becomes `nowMs`, `expiresAt`
 * becomes `issuedAt + config.ttlMs`, and `token` becomes `inv_<id>`.
 *
 * @throws {@link InviteError} for missing identifiers, unknown states or
 * malformed timestamps.
 */
export function normalizeInvite(
  input: InviteInput,
  nowMs: number = Date.now(),
  config: Readonly<InviteConfig> = DEFAULT_INVITE_CONFIG,
): Invite {
  if (!input || typeof input !== 'object') {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'invite input must be an object');
  }
  if (typeof input.id !== 'string' || input.id.trim().length === 0) {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'id must be a non-empty string', {
      id: input.id,
    });
  }
  if (typeof input.householdId !== 'string' || input.householdId.trim().length === 0) {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'householdId must be a non-empty string', {
      householdId: input.householdId,
    });
  }
  if (!Number.isFinite(nowMs)) {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'nowMs must be a finite number', { nowMs });
  }

  const state: InviteState = input.state === undefined ? 'draft' : (input.state as InviteState);
  if (!isInviteState(state)) {
    throw new InviteError(InviteErrorCode.INVALID_STATE, `Unknown invite state: ${String(state)}`, {
      state: input.state,
    });
  }

  const issuedAt = input.issuedAt ?? nowMs;
  const expiresAt = input.expiresAt ?? issuedAt + config.ttlMs;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'issuedAt and expiresAt must be finite numbers', {
      issuedAt,
      expiresAt,
    });
  }
  if (expiresAt < issuedAt) {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'expiresAt must not precede issuedAt', {
      issuedAt,
      expiresAt,
    });
  }

  const token = input.token ?? `inv_${input.id}`;
  if (typeof token !== 'string' || token.length === 0) {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'token must be a non-empty string', { token });
  }

  return Object.freeze({
    id: input.id.trim(),
    householdId: input.householdId.trim(),
    state,
    token,
    issuedAt,
    expiresAt,
  });
}

function validateConfig(config: Readonly<InviteConfig>): void {
  if (
    !Number.isFinite(config.ttlMs) ||
    config.ttlMs <= 0 ||
    !Number.isFinite(config.maxActivePerHousehold) ||
    config.maxActivePerHousehold < 1
  ) {
    throw new InviteError(InviteErrorCode.INVALID_CONFIG, 'Invalid invite configuration', {
      ttlMs: config.ttlMs,
      maxActivePerHousehold: config.maxActivePerHousehold,
    });
  }
}

/**
 * Create a bound machine with a custom configuration and observability hooks.
 *
 * @param config Partial overrides merged onto {@link DEFAULT_INVITE_CONFIG}.
 * @param metrics Called on every successful/rejected transition.
 * @param logger Receives non-sensitive debug events.
 */
export function createInviteMachine(
  config: Partial<InviteConfig> = {},
  metrics: InviteMetrics = noopInviteMetrics,
  logger: InviteLogger = noopInviteLogger,
): InviteMachine {
  const merged: Readonly<InviteConfig> = Object.freeze({
    ...DEFAULT_INVITE_CONFIG,
    ...config,
  });
  validateConfig(merged);

  const machine: InviteMachine = {
    transition: (state, event, ctx = {}) => runTransition(state, event, ctx, merged, metrics, logger),
    canTransition: (state, event, ctx = {}) => {
      try {
        runTransition(state, event, ctx, merged, metrics, logger);
        return true;
      } catch {
        return false;
      }
    },
    states: INVITE_STATES,
    config: merged,
  };
  return Object.freeze(machine);
}
