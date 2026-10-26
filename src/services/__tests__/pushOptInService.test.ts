import {
  canAskAgainFor,
  isOptedIn,
  normalizePushPermission,
  optInToPushForDefaults,
  optOutOfPush,
  readPushOptIn,
  requestPushOptIn,
} from '../pushOptInService';
import type {
  OsPushPermission,
  PushOptInGateway,
  PushPreferenceSink,
  PushOptInStatus,
} from '../pushOptInService';
import {
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType,
} from '../../types/notification';

/** Gateway fake with call counters so we can assert when a prompt happened. */
function makeGateway(
  options: {
    supported?: boolean;
    permission?: OsPushPermission;
    requested?: OsPushPermission;
    token?: string | null;
    tokenThrows?: boolean;
  } = {}
): PushOptInGateway & { getPermissionCalls: number; requestPermissionCalls: number } {
  const permission = options.permission ?? { status: 'undetermined', canAskAgain: true };
  const gateway = {
    getPermissionCalls: 0,
    requestPermissionCalls: 0,
    isSupported: () => options.supported ?? true,
    getPermission: jest.fn(async () => {
      gateway.getPermissionCalls += 1;
      return permission;
    }),
    requestPermission: jest.fn(async () => {
      gateway.requestPermissionCalls += 1;
      return options.requested ?? permission;
    }),
    getDeviceToken: jest.fn(async () => {
      if (options.tokenThrows) throw new Error('no token');
      return options.token === undefined ? 'ExponentPushToken[test]' : options.token;
    }),
  };
  return gateway;
}

/**
 * Sink fake that mirrors the store rule that a required type keeps at least
 * one channel, so an opt-out cannot silence `charge_failed` completely.
 */
function makeSink(overrides: Partial<Record<NotificationType, NotificationChannel[]>> = {}) {
  const channels = new Map<NotificationType, Set<NotificationChannel>>(
    NOTIFICATION_TYPES.map((type) => [
      type,
      new Set(overrides[type] ?? NOTIFICATION_TYPE_META[type].defaultChannels),
    ])
  );

  const sink: PushPreferenceSink = {
    pushEnabledTypes: () => NOTIFICATION_TYPES.filter((type) => channels.get(type)!.has('push')),
    setPushChannel: (type, enabled) => {
      const current = channels.get(type)!;
      if (!enabled && NOTIFICATION_TYPE_META[type].required) {
        const remaining = [...current].filter((channel) => channel !== 'push');
        if (remaining.length === 0) return;
      }
      if (enabled) current.add('push');
      else current.delete('push');
    },
  };

  return { sink, channels };
}

describe('normalizePushPermission', () => {
  it('reports unsupported without looking at the status', () => {
    expect(normalizePushPermission({ status: 'granted' }, false)).toBe('unsupported');
    expect(normalizePushPermission(null, false)).toBe('unsupported');
  });

  it.each<[PushOptInStatus, string]>([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['undetermined', 'undetermined'],
  ])('normalises %s', (expected, status) => {
    expect(normalizePushPermission({ status }, true)).toBe(expected);
  });

  it('folds unknown and missing statuses into undetermined so a prompt is still possible', () => {
    expect(normalizePushPermission({ status: 'provisional' }, true)).toBe('undetermined');
    expect(normalizePushPermission({ status: '' }, true)).toBe('undetermined');
    expect(normalizePushPermission({}, true)).toBe('undetermined');
    expect(normalizePushPermission(null, true)).toBe('undetermined');
  });

  it('accepts an upper-case status', () => {
    expect(normalizePushPermission({ status: 'GRANTED' }, true)).toBe('granted');
  });
});

describe('canAskAgainFor', () => {
  it('never asks again once granted or unsupported', () => {
    expect(canAskAgainFor({ status: 'granted', canAskAgain: true }, 'granted')).toBe(false);
    expect(canAskAgainFor({ status: 'granted' }, 'unsupported')).toBe(false);
  });

  it('asks again while the permission is undetermined', () => {
    expect(canAskAgainFor({ status: 'undetermined' }, 'undetermined')).toBe(true);
  });

  it('honours an explicit canAskAgain: false after a denial', () => {
    expect(canAskAgainFor({ status: 'denied', canAskAgain: false }, 'denied')).toBe(false);
    expect(canAskAgainFor({ status: 'denied', canAskAgain: true }, 'denied')).toBe(true);
  });
});

describe('isOptedIn', () => {
  it('requires both a granted permission and a push-enabled type', () => {
    expect(isOptedIn('granted', ['renewal_reminder'])).toBe(true);
    expect(isOptedIn('granted', [])).toBe(false);
    expect(isOptedIn('undetermined', ['renewal_reminder'])).toBe(false);
    expect(isOptedIn('denied', ['renewal_reminder'])).toBe(false);
  });
});

describe('readPushOptIn', () => {
  it('never prompts', async () => {
    const gateway = makeGateway({ permission: { status: 'undetermined', canAskAgain: true } });
    const { sink } = makeSink();

    const state = await readPushOptIn(gateway, sink);

    expect(gateway.requestPermissionCalls).toBe(0);
    expect(state).toEqual({
      status: 'undetermined',
      canAskAgain: true,
      optedIn: false,
      requiresSettings: false,
    });
  });

  it('flags that only the OS settings app can undo a hard denial', async () => {
    const gateway = makeGateway({ permission: { status: 'denied', canAskAgain: false } });
    const { sink } = makeSink();

    const state = await readPushOptIn(gateway, sink);

    expect(state.status).toBe('denied');
    expect(state.canAskAgain).toBe(false);
    expect(state.requiresSettings).toBe(true);
  });

  it('reports an unsupported platform without touching the OS permission', async () => {
    const gateway = makeGateway({ supported: false });
    const { sink } = makeSink();

    const state = await readPushOptIn(gateway, sink);

    expect(gateway.getPermissionCalls).toBe(0);
    expect(state).toMatchObject({ status: 'unsupported', optedIn: false, requiresSettings: false });
  });

  it('counts a subscriber with a granted permission and one push type as opted in', async () => {
    const gateway = makeGateway({ permission: { status: 'granted' } });
    const { sink } = makeSink({ promotion: ['push', 'email'] });

    const state = await readPushOptIn(gateway, sink);

    expect(state.optedIn).toBe(true);
  });
});

describe('requestPushOptIn', () => {
  it('prompts once while the permission is undetermined and returns the device token', async () => {
    const gateway = makeGateway({
      permission: { status: 'undetermined', canAskAgain: true },
      requested: { status: 'granted', canAskAgain: false },
      token: 'ExponentPushToken[granted]',
    });
    const { sink } = makeSink();

    const result = await requestPushOptIn(gateway, sink);

    expect(gateway.requestPermissionCalls).toBe(1);
    expect(result.status).toBe('granted');
    expect(result.token).toBe('ExponentPushToken[granted]');
    expect(result.changed).toBe(true);
    expect(result.requiresSettings).toBe(false);
  });

  it('reuses an existing grant instead of prompting again', async () => {
    const gateway = makeGateway({
      permission: { status: 'granted', canAskAgain: false },
      token: 'ExponentPushToken[existing]',
    });
    const { sink } = makeSink({ promotion: ['push'] });

    const result = await requestPushOptIn(gateway, sink);

    expect(gateway.requestPermissionCalls).toBe(0);
    expect(result.status).toBe('granted');
    expect(result.token).toBe('ExponentPushToken[existing]');
  });

  it('does not prompt after a denial and asks for settings instead', async () => {
    const gateway = makeGateway({ permission: { status: 'denied', canAskAgain: false } });
    const { sink } = makeSink();

    const result = await requestPushOptIn(gateway, sink);

    expect(gateway.requestPermissionCalls).toBe(0);
    expect(result).toMatchObject({
      status: 'denied',
      token: null,
      changed: false,
      requiresSettings: true,
    });
  });

  it('reports a still-askable denial without sending the user to settings', async () => {
    const gateway = makeGateway({ permission: { status: 'denied', canAskAgain: true } });
    const { sink } = makeSink();

    const result = await requestPushOptIn(gateway, sink);

    expect(result.requiresSettings).toBe(false);
    expect(result.canAskAgain).toBe(true);
  });

  it('returns no token when the permission stays undetermined after the prompt', async () => {
    const gateway = makeGateway({
      permission: { status: 'undetermined', canAskAgain: true },
      requested: { status: 'undetermined', canAskAgain: true },
    });
    const { sink } = makeSink();

    const result = await requestPushOptIn(gateway, sink);

    expect(result.status).toBe('undetermined');
    expect(result.token).toBeNull();
    expect(result.changed).toBe(false);
  });

  it('survives a device-token failure without losing the grant', async () => {
    const gateway = makeGateway({
      permission: { status: 'undetermined', canAskAgain: true },
      requested: { status: 'granted', canAskAgain: false },
      tokenThrows: true,
    });
    const { sink } = makeSink({ promotion: ['push'] });

    const result = await requestPushOptIn(gateway, sink);

    expect(result.status).toBe('granted');
    expect(result.token).toBeNull();
    expect(result.changed).toBe(true);
  });

  it('never calls the OS on an unsupported platform', async () => {
    const gateway = makeGateway({ supported: false });
    const { sink } = makeSink();

    const result = await requestPushOptIn(gateway, sink);

    expect(gateway.getPermissionCalls).toBe(0);
    expect(gateway.requestPermissionCalls).toBe(0);
    expect(result).toMatchObject({ status: 'unsupported', token: null, changed: false });
  });
});

describe('optOutOfPush', () => {
  it('turns the push channel off for every type and reports opted out', async () => {
    const gateway = makeGateway({ permission: { status: 'granted' } });
    const { sink, channels } = makeSink();

    const state = await optOutOfPush(gateway, sink);

    for (const type of NOTIFICATION_TYPES) {
      expect(channels.get(type)!.has('push')).toBe(false);
    }
    expect(state.optedIn).toBe(false);
    expect(state.status).toBe('granted');
  });

  it('respects a required type whose only remaining channel was push', async () => {
    const gateway = makeGateway({ permission: { status: 'granted' } });
    const { sink, channels } = makeSink({ security_alert: ['push'] });

    await optOutOfPush(gateway, sink);

    expect(NOTIFICATION_TYPE_META.security_alert.required).toBe(true);
    expect(channels.get('security_alert')!.has('push')).toBe(true);
    expect(channels.get('promotion')!.has('push')).toBe(false);
  });
});

describe('optInToPushForDefaults', () => {
  it('re-enables push only for the types that default to it', async () => {
    const gateway = makeGateway({ permission: { status: 'granted' } });
    const { sink, channels } = makeSink();
    await optOutOfPush(gateway, sink);

    const state = await optInToPushForDefaults(gateway, sink);

    expect(channels.get('renewal_reminder')!.has('push')).toBe(true);
    expect(channels.get('promotion')!.has('push')).toBe(false);
    expect(channels.get('product_update')!.has('push')).toBe(false);
    expect(state.optedIn).toBe(true);
  });
});
