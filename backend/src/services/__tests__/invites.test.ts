import {
  INVITE_STATES,
  INVITE_EVENTS,
  TERMINAL_INVITE_STATES,
  InviteErrorCode,
  InviteError,
  DEFAULT_INVITE_CONFIG,
  transition,
  canTransition,
  normalizeInvite,
  createInviteMachine,
  isInviteState,
  isInviteEvent,
  isInviteExpired,
  isTerminalInviteState,
  noopInviteMetrics,
  noopInviteLogger,
  type InviteState,
  type InviteEvent,
  type InviteMetrics,
  type InviteLogger,
} from '../invites';

const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);

/** Return the stable code of the error thrown by `fn`. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as InviteError).code;
  }
  throw new Error('expected fn to throw');
}

describe('invite vocabulary (#2255)', () => {
  it('exposes all six states in order and freezes them', () => {
    expect(INVITE_STATES).toEqual(['draft', 'pending', 'accepted', 'declined', 'expired', 'revoked']);
    expect(Object.isFrozen(INVITE_STATES)).toBe(true);
    expect(INVITE_STATES).toHaveLength(6);
  });

  it('exposes all five events and freezes them', () => {
    expect(INVITE_EVENTS).toEqual(['send', 'accept', 'decline', 'expire', 'revoke']);
    expect(Object.isFrozen(INVITE_EVENTS)).toBe(true);
  });

  it('defines the terminal states', () => {
    expect(TERMINAL_INVITE_STATES).toEqual(['accepted', 'declined', 'expired', 'revoked']);
    expect(isTerminalInviteState('accepted')).toBe(true);
    expect(isTerminalInviteState('pending')).toBe(false);
  });

  it('exposes stable, frozen error codes', () => {
    expect(Object.isFrozen(InviteErrorCode)).toBe(true);
    expect(InviteErrorCode.INVALID_TRANSITION).toBe('INVALID_TRANSITION');
    expect(InviteErrorCode.INVITE_EXPIRED).toBe('INVITE_EXPIRED');
  });

  it('exposes a frozen default config', () => {
    expect(Object.isFrozen(DEFAULT_INVITE_CONFIG)).toBe(true);
    expect(DEFAULT_INVITE_CONFIG.ttlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(DEFAULT_INVITE_CONFIG.maxActivePerHousehold).toBe(10);
  });
});

describe('valid transitions', () => {
  it('sends a draft invite to pending', () => {
    expect(transition('draft', 'send')).toBe('pending');
  });

  it('accepts a pending invite', () => {
    expect(transition('pending', 'accept', { nowMs: T0, expiresAt: T0 + 1000 })).toBe('accepted');
  });

  it('declines a pending invite', () => {
    expect(transition('pending', 'decline')).toBe('declined');
  });

  it('expires a pending invite', () => {
    expect(transition('pending', 'expire')).toBe('expired');
  });

  it('revokes a pending invite', () => {
    expect(transition('pending', 'revoke')).toBe('revoked');
  });
});

describe('invalid transitions throw typed errors', () => {
  it('rejects accepting a draft invite', () => {
    expect(() => transition('draft', 'accept')).toThrow(InviteError);
    expect(codeOf(() => transition('draft', 'accept'))).toBe(InviteErrorCode.INVALID_TRANSITION);
  });

  it('rejects sending an already-pending invite', () => {
    expect(codeOf(() => transition('pending', 'send'))).toBe(InviteErrorCode.INVALID_TRANSITION);
  });

  it('rejects every transition out of a terminal state', () => {
    const terminals: InviteState[] = ['accepted', 'declined', 'expired', 'revoked'];
    const events: InviteEvent[] = ['send', 'accept', 'decline', 'expire', 'revoke'];
    for (const state of terminals) {
      for (const event of events) {
        expect(codeOf(() => transition(state, event))).toBe(InviteErrorCode.INVALID_TRANSITION);
      }
    }
  });

  it('rejects an unknown state', () => {
    expect(codeOf(() => transition('bananas' as InviteState, 'send'))).toBe(InviteErrorCode.INVALID_STATE);
  });

  it('rejects an unknown event', () => {
    expect(codeOf(() => transition('draft', 'teleport' as InviteEvent))).toBe(InviteErrorCode.INVALID_EVENT);
  });

  it('attaches non-sensitive details to the error', () => {
    try {
      transition('draft', 'accept');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as InviteError;
      expect(err.name).toBe('InviteError');
      expect(err.code).toBe(InviteErrorCode.INVALID_TRANSITION);
      expect(err.details.state).toBe('draft');
      expect(err.details.event).toBe('accept');
      expect(Object.isFrozen(err.details)).toBe(true);
    }
  });
});

describe('guards', () => {
  it('blocks sending when the household is at its active limit', () => {
    expect(codeOf(() => transition('draft', 'send', { activeInvites: 10 }))).toBe(
      InviteErrorCode.MAX_ACTIVE_EXCEEDED,
    );
  });

  it('allows sending when a slot is free', () => {
    expect(transition('draft', 'send', { activeInvites: 9 })).toBe('pending');
  });

  it('honours a per-transition active-invite override', () => {
    const ctx = { activeInvites: 3, maxActivePerHousehold: 3 };
    expect(codeOf(() => transition('draft', 'send', ctx))).toBe(InviteErrorCode.MAX_ACTIVE_EXCEEDED);
    expect(transition('draft', 'send', { activeInvites: 1, maxActivePerHousehold: 3 })).toBe('pending');
  });

  it('rejects a non-positive active limit as invalid config', () => {
    expect(codeOf(() => transition('draft', 'send', { maxActivePerHousehold: 0 }))).toBe(
      InviteErrorCode.INVALID_CONFIG,
    );
  });

  it('rejects malformed active counts as invalid input', () => {
    expect(codeOf(() => transition('draft', 'send', { activeInvites: -1 }))).toBe(
      InviteErrorCode.INVALID_INPUT,
    );
  });

  it('refuses to accept an expired invite using the injectable clock', () => {
    expect(codeOf(() => transition('pending', 'accept', { nowMs: T0 + 1001, expiresAt: T0 + 1000 }))).toBe(
      InviteErrorCode.INVITE_EXPIRED,
    );
  });

  it('accepts an invite one millisecond before expiry', () => {
    expect(transition('pending', 'accept', { nowMs: T0 + 999, expiresAt: T0 + 1000 })).toBe('accepted');
  });

  it('rejects a non-finite clock value', () => {
    expect(codeOf(() => transition('pending', 'accept', { nowMs: Number.NaN }))).toBe(
      InviteErrorCode.INVALID_INPUT,
    );
  });
});

describe('canTransition', () => {
  it('is true for legal, guard-passing transitions', () => {
    expect(canTransition('draft', 'send', { activeInvites: 0 })).toBe(true);
    expect(canTransition('pending', 'accept', { nowMs: T0, expiresAt: T0 + 1 })).toBe(true);
  });

  it('is false for illegal transitions and failed guards', () => {
    expect(canTransition('accepted', 'accept')).toBe(false);
    expect(canTransition('draft', 'send', { activeInvites: 10 })).toBe(false);
    expect(canTransition('pending', 'accept', { nowMs: T0 + 5000, expiresAt: T0 + 1 })).toBe(false);
  });

  it('never throws on unknown states or events', () => {
    expect(canTransition('nope' as InviteState, 'send')).toBe(false);
    expect(canTransition('draft', 'nope' as InviteEvent)).toBe(false);
  });
});

describe('pure helpers', () => {
  it('detects valid states and events', () => {
    expect(isInviteState('pending')).toBe(true);
    expect(isInviteState('nope')).toBe(false);
    expect(isInviteEvent('revoke')).toBe(true);
    expect(isInviteEvent('nope')).toBe(false);
  });

  it('checks expiry against an injectable clock', () => {
    expect(isInviteExpired(T0 + 1000, T0 + 999)).toBe(false);
    expect(isInviteExpired(T0 + 1000, T0 + 1000)).toBe(true);
    expect(codeOf(() => isInviteExpired(Number.NaN, T0))).toBe(InviteErrorCode.INVALID_INPUT);
  });
});

describe('normalizeInvite', () => {
  it('applies all defaults and freezes the result', () => {
    const invite = normalizeInvite({ id: 'a-1', householdId: 'h-1' }, T0);
    expect(invite.id).toBe('a-1');
    expect(invite.householdId).toBe('h-1');
    expect(invite.state).toBe('draft');
    expect(invite.token).toBe('inv_a-1');
    expect(invite.issuedAt).toBe(T0);
    expect(invite.expiresAt).toBe(T0 + DEFAULT_INVITE_CONFIG.ttlMs);
    expect(Object.isFrozen(invite)).toBe(true);
  });

  it('preserves explicitly supplied fields and trims identifiers', () => {
    const invite = normalizeInvite(
      {
        id: '  a-2  ',
        householdId: '  h-2  ',
        state: 'pending',
        token: 'tok-2',
        issuedAt: T0,
        expiresAt: T0 + 100,
      },
      T0 + 999,
    );
    expect(invite.id).toBe('a-2');
    expect(invite.householdId).toBe('h-2');
    expect(invite.state).toBe('pending');
    expect(invite.token).toBe('tok-2');
    expect(invite.expiresAt).toBe(T0 + 100);
  });

  it('rejects malformed input', () => {
    expect(codeOf(() => normalizeInvite({ id: '', householdId: 'h' }, T0))).toBe(
      InviteErrorCode.INVALID_INPUT,
    );
    expect(codeOf(() => normalizeInvite({ id: 'a', householdId: ' ' }, T0))).toBe(
      InviteErrorCode.INVALID_INPUT,
    );
    expect(codeOf(() => normalizeInvite({ id: 'a', householdId: 'h', state: 'bogus' }, T0))).toBe(
      InviteErrorCode.INVALID_STATE,
    );
    expect(
      codeOf(() => normalizeInvite({ id: 'a', householdId: 'h', expiresAt: T0 - 1 }, T0)),
    ).toBe(InviteErrorCode.INVALID_INPUT);
  });
});

describe('observability hooks', () => {
  it('calls metrics.transition on success and metrics.rejection on failure', () => {
    const events: string[] = [];
    const metrics: InviteMetrics = {
      transition: (from, event, to) => events.push(`${from}:${event}:${to}`),
      rejection: (code) => events.push(`reject:${code}`),
    };
    const machine = createInviteMachine({}, metrics);
    expect(machine.transition('draft', 'send')).toBe('pending');
    expect(events).toEqual(['draft:send:pending']);
    try {
      machine.transition('draft', 'accept');
    } catch {
      /* expected */
    }
    expect(events).toHaveLength(2);
    expect(events[1]).toBe('reject:INVALID_TRANSITION');
  });

  it('calls the logger with non-sensitive context', () => {
    const messages: string[] = [];
    const logger: InviteLogger = {
      debug: (message) => messages.push(message),
    };
    const machine = createInviteMachine({}, noopInviteMetrics, logger);
    machine.transition('draft', 'send');
    machine.canTransition('pending', 'accept', { nowMs: T0 + 5000, expiresAt: T0 });
    expect(messages[0]).toBe('invite transition applied');
    expect(messages).toContain('invite transition rejected');
  });

  it('exports usable no-op hooks', () => {
    expect(typeof noopInviteMetrics.transition).toBe('function');
    expect(typeof noopInviteMetrics.rejection).toBe('function');
    expect(typeof noopInviteLogger.debug).toBe('function');
    expect(() => noopInviteMetrics.rejection(InviteErrorCode.INVALID_STATE, 'draft', 'send')).not.toThrow();
  });
});

describe('createInviteMachine', () => {
  it('merges config overrides and freezes the machine', () => {
    const machine = createInviteMachine({ ttlMs: 1000, maxActivePerHousehold: 2 });
    expect(machine.config.ttlMs).toBe(1000);
    expect(machine.config.maxActivePerHousehold).toBe(2);
    expect(Object.isFrozen(machine.config)).toBe(true);
    expect(Object.isFrozen(machine)).toBe(true);
    expect(machine.states).toBe(INVITE_STATES);
  });

  it('rejects invalid configuration', () => {
    expect(codeOf(() => createInviteMachine({ ttlMs: 0 }))).toBe(InviteErrorCode.INVALID_CONFIG);
    expect(codeOf(() => createInviteMachine({ maxActivePerHousehold: 0 }))).toBe(
      InviteErrorCode.INVALID_CONFIG,
    );
  });

  it('applies its own config in bound guards', () => {
    const machine = createInviteMachine({ maxActivePerHousehold: 2 });
    expect(machine.transition('draft', 'send', { activeInvites: 1 })).toBe('pending');
    expect(codeOf(() => machine.transition('draft', 'send', { activeInvites: 2 }))).toBe(
      InviteErrorCode.MAX_ACTIVE_EXCEEDED,
    );
    expect(machine.canTransition('draft', 'send', { activeInvites: 2 })).toBe(false);
  });
});
