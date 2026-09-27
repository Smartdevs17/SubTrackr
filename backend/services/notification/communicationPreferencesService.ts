/**
 * Customer communication preferences (#1253)
 *
 * Single source of truth for "may we contact this customer, and on which
 * channel". Every outbound channel (email, SMS, voice call, push, in-app)
 * asks this service before it delivers, so consent is enforced in one place
 * instead of being re-implemented per channel.
 *
 * Responsibilities
 * ────────────────
 *   • Per-category, per-channel opt-in / opt-out with an ordered fallback
 *     waterfall (mirrors `preferenceServiceV2.ts`, but persistable).
 *   • Enforcement of regulatory opt-out: `STOP` on the SMS channel, a
 *     do-not-call flag, and unsubscribes from marketing email.
 *   • Quiet hours, so a renewal reminder never rings a phone at 03:00.
 *   • An append-only change log for audit / GDPR "why did you contact me".
 *
 * Persistence is behind `CommunicationPreferenceRepository` so the service is
 * unit-testable in isolation and swappable between the in-memory store used in
 * tests/local dev and Postgres in production (see `db/migrations/008_*`).
 */

import {
  COMM_CATEGORIES,
  COMM_CHANNELS,
  DEFAULT_WATERFALL,
  REQUIRED_CATEGORIES,
  buildDefaultPreferences,
} from './commPreferencesTypes';
import type {
  CategoryPreference,
  CommCategory,
  CommChannel,
  SubscriberPreference,
} from './commPreferencesTypes';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Why a delivery attempt was refused. Recorded on the suppression log. */
export type SuppressionReason =
  | 'channel_disabled'
  | 'category_required_bypass'
  | 'quiet_hours'
  | 'opted_out'
  | 'no_enabled_channel'
  | 'missing_contact_point';

export interface QuietHours {
  enabled: boolean;
  /** Minutes from midnight, local to the customer. 0–1439. */
  startMinute: number;
  endMinute: number;
  /** IANA timezone, e.g. `Europe/Berlin`. */
  timezone: string;
}

export interface CommunicationPreferences {
  userId: string;
  categories: Record<CommCategory, CategoryPreference>;
  quietHours: QuietHours;
  /** Hard per-channel kill switch that survives category edits. */
  globalOptOuts: Partial<Record<CommChannel, boolean>>;
  updatedAt: string;
  syncVersion: number;
}

export interface PreferenceChangeEvent {
  userId: string;
  category: CommCategory;
  channel: CommChannel;
  enabled: boolean;
  source: 'user' | 'system' | 'inbound_sms' | 'api';
  reason?: string;
  changedAt: string;
}

export interface ChannelDecision {
  channel: CommChannel;
  allowed: boolean;
  reason?: SuppressionReason;
}

export interface RouteResult {
  userId: string;
  category: CommCategory;
  /** Channels to try, in waterfall order. Empty when nothing may be sent. */
  channels: CommChannel[];
  decisions: ChannelDecision[];
  /** True when the caller should defer rather than send now. */
  deferred: boolean;
  deferUntil?: string;
}

/** Error raised when a caller tries to opt out of a legally required channel. */
export class PreferenceViolationError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'PreferenceViolationError';
  }
}

// ─── Quiet hours ───────────────────────────────────────────────────────────────

/** Minutes since local midnight for an instant, in the given IANA timezone. */
export function localMinutesOfDay(instant: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return (hour % 24) * 60 + minute;
}

/**
 * True when `instant` falls inside the customer's quiet hours.
 * A window whose start is later than its end (e.g. 22:00 → 07:00) wraps
 * midnight and is handled explicitly.
 */
export function isWithinQuietHours(
  quietHours: QuietHours,
  instant: Date = new Date()
): boolean {
  if (!quietHours.enabled) return false;

  const now = localMinutesOfDay(instant, quietHours.timezone);
  const start = normaliseMinute(quietHours.startMinute);
  const end = normaliseMinute(quietHours.endMinute);

  if (start === end) return false; // zero-length window
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // wraps midnight
}

/** The next instant at which quiet hours end — used to defer a delivery. */
export function nextQuietHoursEnd(
  quietHours: QuietHours,
  instant: Date = new Date()
): Date | null {
  if (!quietHours.enabled || !isWithinQuietHours(quietHours, instant)) return null;
  const end = normaliseMinute(quietHours.endMinute);
  const now = localMinutesOfDay(instant, quietHours.timezone);
  const delta = end > now ? end - now : 24 * 60 - now + end;
  return new Date(instant.getTime() + delta * 60_000);
}

function normaliseMinute(minute: number): number {
  if (!Number.isFinite(minute)) return 0;
  return Math.min(1439, Math.max(0, Math.floor(minute)));
}

// ─── Repository ───────────────────────────────────────────────────────────────

export interface CommunicationPreferenceRepository {
  get(userId: string): Promise<CommunicationPreferences | null>;
  save(preferences: CommunicationPreferences): Promise<CommunicationPreferences>;
  appendEvent(event: PreferenceChangeEvent): Promise<void>;
  listEvents(userId: string, limit?: number): Promise<PreferenceChangeEvent[]>;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  startMinute: 22 * 60,
  endMinute: 7 * 60,
  timezone: 'UTC',
};

/** Build the default preference document for a user who has never set any. */
export function buildDefaultCommunicationPreferences(userId: string): CommunicationPreferences {
  const base = buildDefaultPreferences(userId);
  return {
    userId,
    categories: base.categories,
    quietHours: { ...DEFAULT_QUIET_HOURS },
    globalOptOuts: {},
    updatedAt: base.updatedAt,
    syncVersion: base.syncVersion,
  };
}

/** In-memory repository — default for tests and local development. */
export class InMemoryCommunicationPreferenceRepository
  implements CommunicationPreferenceRepository
{
  private readonly store = new Map<string, CommunicationPreferences>();
  private readonly events: PreferenceChangeEvent[] = [];

  async get(userId: string): Promise<CommunicationPreferences | null> {
    return this.store.get(userId) ?? null;
  }

  async save(preferences: CommunicationPreferences): Promise<CommunicationPreferences> {
    this.store.set(preferences.userId, preferences);
    return preferences;
  }

  async appendEvent(event: PreferenceChangeEvent): Promise<void> {
    this.events.push(event);
  }

  async listEvents(userId: string, limit = 50): Promise<PreferenceChangeEvent[]> {
    return this.events.filter((e) => e.userId === userId).slice(-limit).reverse();
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

/** Resolves whether a specific contact point (phone/email) is suppressed. */
export type ContactPointOptOutLookup = (userId: string, channel: CommChannel) => boolean;

export interface CommunicationPreferenceServiceDeps {
  repository: CommunicationPreferenceRepository;
  /** Injected so channel-level opt-outs (STOP / do-not-call) stay centralised. */
  isContactPointOptedOut?: ContactPointOptOutLookup;
  /** Injectable clock keeps quiet-hours tests deterministic. */
  now?: () => Date;
}

export class CommunicationPreferenceService {
  private readonly repository: CommunicationPreferenceRepository;
  private readonly isContactPointOptedOut: ContactPointOptOutLookup;
  private readonly now: () => Date;

  constructor(deps: CommunicationPreferenceServiceDeps) {
    this.repository = deps.repository;
    this.isContactPointOptedOut = deps.isContactPointOptedOut ?? (() => false);
    this.now = deps.now ?? (() => new Date());
  }

  /** Read preferences, materialising defaults on first access. */
  async getPreferences(userId: string): Promise<CommunicationPreferences> {
    const existing = await this.repository.get(userId);
    if (existing) return existing;
    const created = buildDefaultCommunicationPreferences(userId);
    return this.repository.save(created);
  }

  /**
   * Enable or disable one channel for one category.
   *
   * Throws `PreferenceViolationError` when the change would leave a required
   * category (billing, security) with no reachable channel, or when it would
   * disable a channel the customer already hard-opted out of globally.
   */
  async setChannelEnabled(
    userId: string,
    category: CommCategory,
    channel: CommChannel,
    enabled: boolean,
    source: PreferenceChangeEvent['source'] = 'user',
    reason?: string
  ): Promise<CommunicationPreferences> {
    if (!COMM_CATEGORIES.includes(category)) {
      throw new PreferenceViolationError(
        `Unknown communication category "${category}"`,
        'UNKNOWN_CATEGORY'
      );
    }
    if (!COMM_CHANNELS.includes(channel)) {
      throw new PreferenceViolationError(
        `Unknown communication channel "${channel}"`,
        'UNKNOWN_CHANNEL'
      );
    }

    const prefs = await this.getPreferences(userId);
    const catPref = prefs.categories[category];

    if (!enabled && catPref.required) {
      const others = this.enabledChannels(catPref).filter((c) => c !== channel);
      if (others.length === 0) {
        throw new PreferenceViolationError(
          `Cannot disable "${channel}" for required category "${category}" — ` +
            'at least one channel must stay enabled',
          'REQUIRED_CATEGORY_EMPTY'
        );
      }
    }

    if (!enabled && prefs.globalOptOuts[channel] === true) {
      throw new PreferenceViolationError(
        `Channel "${channel}" is globally opted out for this customer`,
        'GLOBAL_OPT_OUT'
      );
    }

    const updated: CommunicationPreferences = {
      ...prefs,
      categories: {
        ...prefs.categories,
        [category]: {
          ...catPref,
          channels: {
            ...catPref.channels,
            [channel]: {
              ...catPref.channels[channel],
              enabled,
              fallbackOrder: DEFAULT_WATERFALL[category].filter((c) => c !== channel),
            },
          },
        },
      },
      updatedAt: this.now().toISOString(),
      syncVersion: prefs.syncVersion + 1,
    };

    await this.repository.save(updated);
    await this.repository.appendEvent({
      userId,
      category,
      channel,
      enabled,
      source,
      reason,
      changedAt: updated.updatedAt,
    });
    return updated;
  }

  /** Bulk patch — every entry is validated before anything is written. */
  async updatePreferences(
    userId: string,
    patch: {
      categories?: Partial<Record<CommCategory, Partial<Record<CommChannel, boolean>>>>;
      quietHours?: Partial<QuietHours>;
      globalOptOuts?: Partial<Record<CommChannel, boolean>>;
    },
    source: PreferenceChangeEvent['source'] = 'api'
  ): Promise<CommunicationPreferences> {
    const current = await this.getPreferences(userId);
    let quietHours = current.quietHours;
    let globalOptOuts = { ...current.globalOptOuts };

    if (patch.quietHours) {
      const merged = { ...current.quietHours, ...patch.quietHours };
      if (
        merged.startMinute < 0 ||
        merged.startMinute > 1439 ||
        merged.endMinute < 0 ||
        merged.endMinute > 1439
      ) {
        throw new PreferenceViolationError(
          'quietHours minutes must be between 0 and 1439',
          'INVALID_QUIET_HOURS'
        );
      }
      quietHours = merged;
    }

    if (patch.globalOptOuts) {
      for (const [channel, value] of Object.entries(patch.globalOptOuts)) {
        if (value !== undefined) globalOptOuts[channel as CommChannel] = value;
      }
    }

    if (patch.categories) {
      for (const [category, channels] of Object.entries(patch.categories)) {
        if (!channels) continue;
        for (const [channel, enabled] of Object.entries(channels)) {
          if (enabled === undefined) continue;
          await this.setChannelEnabled(
            userId,
            category as CommCategory,
            channel as CommChannel,
            enabled,
            source
          );
        }
      }
    }

    // setChannelEnabled bumps the version per channel, so re-read before saving.
    const latest = await this.getPreferences(userId);
    return this.repository.save({
      ...latest,
      quietHours,
      globalOptOuts,
      updatedAt: this.now().toISOString(),
    });
  }

  /** Record a channel-level opt-out (STOP, unsubscribe, do-not-call). */
  async optOutChannel(
    userId: string,
    channel: CommChannel,
    reason: string,
    source: PreferenceChangeEvent['source'] = 'inbound_sms'
  ): Promise<CommunicationPreferences> {
    const prefs = await this.getPreferences(userId);
    const updated: CommunicationPreferences = {
      ...prefs,
      globalOptOuts: { ...prefs.globalOptOuts, [channel]: true },
      updatedAt: this.now().toISOString(),
      syncVersion: prefs.syncVersion + 1,
    };
    await this.repository.save(updated);
    await this.repository.appendEvent({
      userId,
      category: 'marketing',
      channel,
      enabled: false,
      source,
      reason,
      changedAt: updated.updatedAt,
    });
    return updated;
  }

  /** Lift a channel-level opt-out (START, resubscribe). */
  async optInChannel(
    userId: string,
    channel: CommChannel,
    source: PreferenceChangeEvent['source'] = 'inbound_sms'
  ): Promise<CommunicationPreferences> {
    const prefs = await this.getPreferences(userId);
    const updated: CommunicationPreferences = {
      ...prefs,
      globalOptOuts: { ...prefs.globalOptOuts, [channel]: false },
      updatedAt: this.now().toISOString(),
      syncVersion: prefs.syncVersion + 1,
    };
    await this.repository.save(updated);
    await this.repository.appendEvent({
      userId,
      category: 'marketing',
      channel,
      enabled: true,
      source,
      changedAt: updated.updatedAt,
    });
    return updated;
  }

  /**
   * Decide which channels a notification may travel on, in fallback order.
   *
   * @param contactPoints which contact details the caller actually holds, e.g.
   *        `{ email: 'a@b.c', phone: '+1555…' }`. A channel with no contact
   *        point is skipped rather than attempted and failed.
   */
  async resolveRoutes(
    userId: string,
    category: CommCategory,
    contactPoints: Partial<Record<CommChannel, string>> = {},
    instant: Date = this.now()
  ): Promise<RouteResult> {
    const prefs = await this.getPreferences(userId);
    const catPref = prefs.categories[category];
    const decisions: ChannelDecision[] = [];
    const enabled = this.enabledChannels(catPref);

    // Waterfall order first, then anything enabled outside the waterfall.
    const ordered: CommChannel[] = [
      ...DEFAULT_WATERFALL[category].filter((channel) => enabled.includes(channel)),
      ...enabled.filter((channel) => !DEFAULT_WATERFALL[category].includes(channel)),
    ];

    for (const channel of ordered) {
      if (!contactPoints[channel]) {
        decisions.push({ channel, allowed: false, reason: 'missing_contact_point' });
        continue;
      }
      if (prefs.globalOptOuts[channel] === true || this.isContactPointOptedOut(userId, channel)) {
        decisions.push({ channel, allowed: false, reason: 'opted_out' });
        continue;
      }
      decisions.push({ channel, allowed: true });
    }

    const deferred = isWithinQuietHours(prefs.quietHours, instant);
    const channels = deferred
      ? []
      : decisions.filter((d) => d.allowed).map((d) => d.channel);

    if (!channels.length && !deferred) {
      decisions.push({
        channel: ordered[0] ?? 'email',
        allowed: false,
        reason: 'no_enabled_channel',
      });
    }

    return {
      userId,
      category,
      channels,
      decisions,
      deferred,
      deferUntil: nextQuietHoursEnd(prefs.quietHours, instant)?.toISOString(),
    };
  }

  /** Audit trail for a customer, newest first. */
  async listChanges(userId: string, limit = 50): Promise<PreferenceChangeEvent[]> {
    return this.repository.listEvents(userId, limit);
  }

  private enabledChannels(catPref: CategoryPreference): CommChannel[] {
    return COMM_CHANNELS.filter((channel) => catPref.channels[channel]?.enabled === true);
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const communicationPreferenceRepository =
  new InMemoryCommunicationPreferenceRepository();

export const communicationPreferenceService = new CommunicationPreferenceService({
  repository: communicationPreferenceRepository,
});

export { REQUIRED_CATEGORIES };
