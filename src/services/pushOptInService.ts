/**
 * Push notification opt-in.
 *
 * Owns the whole life of a push opt-in:
 *
 *   • reading the OS permission without ever showing a prompt,
 *   • asking the OS exactly once while the permission is still undetermined,
 *   • collecting the device token once the permission is granted,
 *   • telling the caller when the only route left is the OS settings app,
 *   • opting the subscriber back out by switching the `push` channel off for
 *     every notification type, and reporting what is still push-enabled.
 *
 * The OS and the preferences store are injected (`PushOptInGateway`,
 * `PushPreferenceSink`) so the whole flow is unit testable without a device and
 * callers can drive it with fakes. The Expo / Zustand wiring lives in
 * `pushOptInExpo.ts`.
 */

import { NOTIFICATION_TYPE_META, NOTIFICATION_TYPES } from '../types/notification';
import type { NotificationType } from '../types/notification';

/** Normalised push permission, with `unsupported` folded in. */
export type PushOptInStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** The slice of an OS permission object this service cares about. */
export interface OsPushPermission {
  status?: string | null;
  /**
   * Whether the OS will still show a permission prompt. iOS reports `false`
   * once the subscriber has denied and used up the single prompt.
   */
  canAskAgain?: boolean;
}

/** Everything the flow needs from the platform. */
export interface PushOptInGateway {
  /** Whether this platform can receive push at all (false on web, for example). */
  isSupported(): boolean;
  /** Current permission, without prompting. */
  getPermission(): Promise<OsPushPermission>;
  /** Show the OS prompt. Resolves with the resulting permission. */
  requestPermission(): Promise<OsPushPermission>;
  /** Device push token — only meaningful once the permission is granted. */
  getDeviceToken(): Promise<string | null>;
}

/** Everything the flow needs from the preferences store. */
export interface PushPreferenceSink {
  /** Notification types that currently have the `push` channel enabled. */
  pushEnabledTypes(): NotificationType[];
  /** Turn the `push` channel for one type on or off. */
  setPushChannel(type: NotificationType, enabled: boolean): void;
}

export interface PushOptInState {
  status: PushOptInStatus;
  /** The OS would still show a prompt, so opting in is worth attempting. */
  canAskAgain: boolean;
  /** Permission granted *and* at least one type still routes over push. */
  optedIn: boolean;
  /** Denied for good — the subscriber has to change it in the OS settings app. */
  requiresSettings: boolean;
}

export interface PushOptInResult extends PushOptInState {
  /** Device token, present only for a granted opt-in. */
  token: string | null;
  /** True when this call actually moved the opt-in state. */
  changed: boolean;
}

const PERMISSION_STATUSES: readonly string[] = ['granted', 'denied', 'undetermined'];

/**
 * Map a raw OS permission status onto our vocabulary. Anything we do not
 * recognise — including a missing status — is treated as `undetermined` so a
 * caller still asks rather than silently giving up on push.
 */
export function normalizePushPermission(
  permission: OsPushPermission | null | undefined,
  supported: boolean
): PushOptInStatus {
  if (!supported) return 'unsupported';
  const status = permission?.status;
  if (typeof status !== 'string') return 'undetermined';
  const normalised = status.toLowerCase();
  return PERMISSION_STATUSES.includes(normalised) ? (normalised as PushOptInStatus) : 'undetermined';
}

/**
 * Whether the OS will still show a prompt for this permission. A granted or
 * unsupported permission has nothing left to ask for, and an explicit
 * `canAskAgain: false` wins over the status.
 */
export function canAskAgainFor(
  permission: OsPushPermission | null | undefined,
  status: PushOptInStatus
): boolean {
  if (status === 'granted' || status === 'unsupported') return false;
  return permission?.canAskAgain !== false;
}

/**
 * Whether a granted permission still counts as an opt-in: the subscriber must
 * also have kept push on for at least one notification type. Required types
 * keep a route after an opt-out (the store refuses to strip their last
 * channel), so a fully opted-out subscriber still reports `false` here.
 */
export function isOptedIn(status: PushOptInStatus, pushEnabledTypes: NotificationType[]): boolean {
  return status === 'granted' && pushEnabledTypes.length > 0;
}

function buildState(
  permission: OsPushPermission | null | undefined,
  supported: boolean,
  sink: PushPreferenceSink
): PushOptInState {
  const status = normalizePushPermission(permission, supported);
  const canAskAgain = canAskAgainFor(permission, status);
  const pushEnabledTypes = supported ? sink.pushEnabledTypes() : [];

  return {
    status,
    canAskAgain,
    optedIn: isOptedIn(status, pushEnabledTypes),
    requiresSettings: status === 'denied' && !canAskAgain,
  };
}

/**
 * Read the current opt-in state without prompting. Safe to call on every
 * settings-screen render.
 */
export async function readPushOptIn(
  gateway: PushOptInGateway,
  sink: PushPreferenceSink
): Promise<PushOptInState> {
  const supported = gateway.isSupported();
  const permission = supported ? await gateway.getPermission() : null;
  return buildState(permission, supported, sink);
}

/**
 * Drive the opt-in.
 *
 * The OS prompt is only shown while the permission is `undetermined` — asking
 * again after a denial is a no-op on both iOS and Android, and on iOS it
 * consumes the one prompt the app gets. When the permission is already granted
 * the flow just re-collects the device token and reports the preferences.
 */
export async function requestPushOptIn(
  gateway: PushOptInGateway,
  sink: PushPreferenceSink
): Promise<PushOptInResult> {
  const supported = gateway.isSupported();
  const before = buildState(supported ? await gateway.getPermission() : null, supported, sink);

  if (before.status === 'unsupported' || before.status === 'denied') {
    return { ...before, token: null, changed: false };
  }

  const permission =
    before.status === 'undetermined'
      ? await gateway.requestPermission()
      : await gateway.getPermission();
  const after = buildState(permission, supported, sink);

  // A token can only be minted while the permission is granted, and a mint
  // failure must not undo the grant the subscriber just gave us.
  let token: string | null = null;
  if (after.status === 'granted') {
    try {
      token = await gateway.getDeviceToken();
    } catch {
      token = null;
    }
  }

  return {
    ...after,
    token,
    changed:
      after.status !== before.status ||
      after.optedIn !== before.optedIn ||
      (token !== null && token !== ''),
  };
}

/**
 * Opt out of push delivery: switch the `push` channel off for every
 * notification type and report the resulting state. Required types keep their
 * guaranteed route (the store refuses to remove their last channel), which is
 * why the returned state is read back from the sink rather than assumed.
 */
export async function optOutOfPush(
  gateway: PushOptInGateway,
  sink: PushPreferenceSink
): Promise<PushOptInState> {
  for (const type of NOTIFICATION_TYPES) {
    sink.setPushChannel(type, false);
  }
  return readPushOptIn(gateway, sink);
}

/** Opt back in for every type that has push among its defaults. */
export async function optInToPushForDefaults(
  gateway: PushOptInGateway,
  sink: PushPreferenceSink
): Promise<PushOptInState> {
  for (const type of NOTIFICATION_TYPES) {
    if (NOTIFICATION_TYPE_META[type].defaultChannels.includes('push')) {
      sink.setPushChannel(type, true);
    }
  }
  return readPushOptIn(gateway, sink);
}
