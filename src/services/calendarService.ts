import { BillingCycle } from '../types/subscription';
import type { Subscription } from '../types/subscription';
import type {
  CalendarExportPayload,
  CalendarOAuthCallbackPayload,
  CalendarEventTemplate,
  CalendarIntegration,
  CalendarProvider,
  CalendarSyncedEvent,
  OneTimeScheduledPayment,
  PendingCalendarAuthorization,
  ProratedAdjustment,
  ScheduleConflict,
} from '../types/calendar';

const DEFAULT_REDIRECT_URI = 'subtrackr://calendar/callback';
const PROVIDER_SCOPES: Record<CalendarProvider, string> = {
  google: 'https://www.googleapis.com/auth/calendar.events',
  apple: 'name email',
  outlook: 'offline_access Calendars.ReadWrite',
};

const PROVIDER_AUTH_ENDPOINTS: Record<CalendarProvider, string> = {
  google: 'https://accounts.google.com/o/oauth2/v2/auth',
  apple: 'https://appleid.apple.com/auth/authorize',
  outlook: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
};

const PROVIDER_CLIENT_IDS: Record<CalendarProvider, string> = {
  google: 'subtrackr-google-mobile',
  apple: 'subtrackr-apple-mobile',
  outlook: 'subtrackr-outlook-mobile',
};

const oauthSessions = new Map<string, PendingCalendarAuthorization>();

function randomToken(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function normalizeReminderOffsets(offsets: number[]): number[] {
  return [...new Set(offsets.filter((offset) => Number.isFinite(offset) && offset > 0))].sort(
    (left, right) => right - left
  );
}

function buildAuthorizationUrl(
  provider: CalendarProvider,
  state: string,
  verifier: string,
  redirectUri: string
): string {
  const params = new URLSearchParams({
    client_id: PROVIDER_CLIENT_IDS[provider],
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: PROVIDER_SCOPES[provider],
    state,
  });

  if (provider === 'google') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    params.set('code_challenge', verifier);
    params.set('code_challenge_method', 'plain');
  }

  if (provider === 'outlook') {
    params.set('prompt', 'select_account');
    params.set('code_challenge', verifier);
    params.set('code_challenge_method', 'plain');
  }

  if (provider === 'apple') {
    params.set('response_mode', 'query');
  }

  return `${PROVIDER_AUTH_ENDPOINTS[provider]}?${params.toString()}`;
}

function buildAccountEmail(provider: CalendarProvider): string {
  return `${provider}.calendar@subtrackr.local`;
}

function buildExternalUrl(provider: CalendarProvider, providerEventId: string): string {
  switch (provider) {
    case 'google':
      return `https://calendar.google.com/calendar/u/0/r/eventedit/${providerEventId}`;
    case 'apple':
      return `https://www.icloud.com/calendar/event/${providerEventId}`;
    case 'outlook':
      return `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&id=${providerEventId}`;
    default:
      return providerEventId;
  }
}

function buildProviderEventId(
  connectionId: string,
  subscriptionId: string,
  kind: CalendarEventTemplate['kind']
): string {
  return `${connectionId}:${subscriptionId}:${kind}`;
}

function stripQueryAndHash(url: string): string {
  const [withoutHash] = url.split('#');
  const [withoutQuery] = withoutHash.split('?');
  return withoutQuery;
}

export function createCalendarOAuthCallbackUrl(
  provider: CalendarProvider,
  authorization: PendingCalendarAuthorization
): string {
  const callback = new URL(authorization.redirectUri);
  callback.searchParams.set('code', randomToken(`${provider}_code`));
  callback.searchParams.set('state', authorization.state);
  return callback.toString();
}

export function parseCalendarOAuthCallback(redirectUrl: string): CalendarOAuthCallbackPayload {
  const callback = new URL(redirectUrl);
  const code = callback.searchParams.get('code');
  const state = callback.searchParams.get('state');

  if (!code || !state) {
    throw new Error('Calendar authorization callback is missing the required code or state.');
  }

  return {
    state,
    code,
    redirectUri: stripQueryAndHash(callback.toString()),
  };
}

export function beginCalendarOAuth(
  provider: CalendarProvider,
  redirectUri = DEFAULT_REDIRECT_URI
): PendingCalendarAuthorization {
  const state = randomToken(`${provider}_state`);
  const codeVerifier = randomToken(`${provider}_pkce`);
  const authorization = {
    provider,
    state,
    codeVerifier,
    authorizationUrl: buildAuthorizationUrl(provider, state, codeVerifier, redirectUri),
    redirectUri,
    issuedAt: new Date().toISOString(),
  };

  oauthSessions.set(`${provider}:${state}`, authorization);
  return authorization;
}

export async function connectCalendar(
  provider: CalendarProvider,
  authorization: PendingCalendarAuthorization,
  redirectUrl: string
): Promise<CalendarIntegration> {
  const key = `${provider}:${authorization.state}`;
  const storedAuthorization = oauthSessions.get(key);
  if (!storedAuthorization || storedAuthorization.codeVerifier !== authorization.codeVerifier) {
    throw new Error(`OAuth state mismatch for ${provider}. Restart the calendar connection.`);
  }

  const callbackPayload = parseCalendarOAuthCallback(redirectUrl);
  if (callbackPayload.state !== authorization.state) {
    throw new Error(`Calendar callback state mismatch for ${provider}.`);
  }

  if (callbackPayload.redirectUri !== stripQueryAndHash(authorization.redirectUri)) {
    throw new Error(`Calendar callback redirect URI mismatch for ${provider}.`);
  }

  oauthSessions.delete(key);

  const connectedAt = new Date().toISOString();
  return {
    id: randomToken(`${provider}_connection`),
    provider,
    access_token: randomToken(`${provider}_token`),
    accountEmail: buildAccountEmail(provider),
    calendarId: randomToken(`${provider}_calendar`),
    status: 'connected',
    connectedAt,
    lastSyncedAt: connectedAt,
    reminderOffsets: [24 * 60, 60],
  };
}

export function buildSubscriptionCalendarEvent(
  subscription: Subscription,
  reminderOffsets: number[]
): CalendarEventTemplate {
  const start = new Date(subscription.nextBillingDate);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const normalizedReminderOffsets = normalizeReminderOffsets(reminderOffsets);
  const description =
    subscription.description && subscription.description.trim().length > 0
      ? ` Notes: ${subscription.description.trim()}.`
      : '';

  return {
    kind: 'billing_reminder',
    title: `${subscription.name} renewal`,
    notes: [
      `${subscription.name} renews on ${start.toLocaleString()}.`,
      `Expected charge: ${subscription.currency} ${subscription.price.toFixed(2)}.`,
      `Cycle: ${subscription.billingCycle}.`,
      description,
      'Managed by SubTrackr calendar sync.',
    ].join(' '),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    reminderOffsets: normalizedReminderOffsets,
  };
}

export async function syncToCalendar(
  subscriptionId: string,
  templates: CalendarEventTemplate[],
  integration: CalendarIntegration,
  existingEvents: CalendarSyncedEvent[]
): Promise<CalendarSyncedEvent[]> {
  const now = new Date().toISOString();

  return templates.map((template) => {
    const providerEventId = buildProviderEventId(integration.id, subscriptionId, template.kind);
    const existing = existingEvents.find((event) => event.providerEventId === providerEventId);

    return {
      ...template,
      id: existing?.id ?? randomToken('calendar_event'),
      subscriptionId,
      connectionId: integration.id,
      providerEventId,
      externalUrl: buildExternalUrl(integration.provider, providerEventId),
      lastSyncedAt: now,
    };
  });
}

export async function disconnectCalendar(connectionId: string): Promise<{ connectionId: string }> {
  return { connectionId };
}

// ── iCal Export ────────────────────────────────────────────────────────────

function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function formatICalDate(isoString: string): string {
  const d = new Date(isoString);
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function generateICalendarExport(
  events: CalendarEventTemplate[],
  timezone?: string
): CalendarExportPayload {
  const now = new Date().toISOString();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SubTrackr//Subscription Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  if (timezone) {
    lines.push('BEGIN:VTIMEZONE');
    lines.push(`TZID:${escapeICalText(timezone)}`);
    lines.push('END:VTIMEZONE');
  }

  for (const event of events) {
    const uid = `${event.kind}_${event.startAt}_${Math.random().toString(36).slice(2, 8)}`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}@subtrackr`);
    lines.push(`DTSTAMP:${formatICalDate(now)}`);
    lines.push(`DTSTART:${formatICalDate(event.startAt)}`);
    lines.push(`DTEND:${formatICalDate(event.endAt)}`);
    lines.push(`SUMMARY:${escapeICalText(event.title)}`);
    lines.push(`DESCRIPTION:${escapeICalText(event.notes)}`);

    if (timezone) {
      lines.push(`TZID:${escapeICalText(timezone)}`);
    }

    for (const offsetMinutes of event.reminderOffsets) {
      const trigger = offsetMinutes > 0 ? `-PT${offsetMinutes}M` : `PT${Math.abs(offsetMinutes)}M`;
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`TRIGGER:${trigger}`);
      lines.push(`DESCRIPTION:Reminder: ${escapeICalText(event.title)}`);
      lines.push('END:VALARM');
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return {
    ical: lines.join('\r\n'),
    filename: `subtrackr_events_${Date.now()}.ics`,
    events,
  };
}

// ── Schedule Conflict Detection ────────────────────────────────────────────

export function detectScheduleConflicts(
  subscriptions: Subscription[],
  existingEvents: CalendarSyncedEvent[]
): ScheduleConflict[] {
  const conflictsByDate = new Map<string, ScheduleConflict>();

  for (const sub of subscriptions) {
    if (!sub.isActive) continue;
    const dateKey = new Date(sub.nextBillingDate).toISOString().split('T')[0];

    if (!conflictsByDate.has(dateKey)) {
      conflictsByDate.set(dateKey, {
        date: dateKey,
        conflictingSubscriptions: [],
        totalAmount: 0,
      });
    }

    const entry = conflictsByDate.get(dateKey)!;
    entry.conflictingSubscriptions.push({
      id: sub.id,
      name: sub.name,
      amount: sub.price,
      currency: sub.currency,
    });
    entry.totalAmount += sub.price;
  }

  return Array.from(conflictsByDate.values()).filter((c) => c.conflictingSubscriptions.length > 1);
}

// ── Prorated Adjustment ────────────────────────────────────────────────────

export function calculateProratedAdjustment(
  subscription: Subscription,
  newDate: Date,
  reason: string
): ProratedAdjustment {
  const now = new Date();
  const nextBilling = new Date(subscription.nextBillingDate);
  const daysInCycle = getDaysInCycle(subscription.billingCycle);

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.max(0, Math.round((nextBilling.getTime() - now.getTime()) / msPerDay));

  const proratedAmount = Number(((subscription.price / daysInCycle) * daysRemaining).toFixed(2));

  return {
    originalAmount: subscription.price,
    proratedAmount,
    daysRemaining,
    daysInCycle,
    effectiveDate: newDate.toISOString(),
    reason,
  };
}

function getDaysInCycle(cycle: BillingCycle): number {
  switch (cycle) {
    case BillingCycle.WEEKLY:
      return 7;
    case BillingCycle.MONTHLY:
      return 30;
    case BillingCycle.YEARLY:
      return 365;
    default:
      return 30;
  }
}

// ── One-Time Scheduled Payment ─────────────────────────────────────────────

export function scheduleOneTimePayment(
  subscriptionId: string,
  amount: number,
  currency: string,
  scheduledDate: Date,
  description: string
): OneTimeScheduledPayment {
  return {
    id: `onetime_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    subscriptionId,
    amount,
    currency,
    scheduledDate: scheduledDate.toISOString(),
    description,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

// ── Timezone-Aware Event Building ─────────────────────────────────────────

export function buildTimezoneAwareEvent(
  subscription: Subscription,
  reminderOffsets: number[]
): CalendarEventTemplate {
  const event = buildSubscriptionCalendarEvent(subscription, reminderOffsets);
  const tz = subscription.timezone || 'UTC';

  if (tz !== 'UTC') {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    event.notes += ` Timezone: ${tz}.`;
    event.startAt = start.toISOString();
    event.endAt = end.toISOString();
  }

  return event;
}

export function formatDateInTimezone(isoString: string, timezone: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', { timeZone: timezone });
  } catch {
    return new Date(isoString).toLocaleString();
  }
}

export function convertToTimezone(isoString: string, targetTimezone: string): string {
  const date = new Date(isoString);
  const offset = getTimezoneOffset(date, targetTimezone);
  const adjusted = new Date(date.getTime() + offset);
  return adjusted.toISOString();
}

function getTimezoneOffset(date: Date, timezone: string): number {
  try {
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    return tzDate.getTime() - date.getTime();
  } catch {
    return 0;
  }
}

// ── Check for DST Transition ──────────────────────────────────────────────

export function isDSTTransitionPeriod(date: Date, timezone: string): boolean {
  const oneWeekLater = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
  const currentOffset = getTimezoneOffset(date, timezone);
  const laterOffset = getTimezoneOffset(oneWeekLater, timezone);
  return currentOffset !== laterOffset;
}

export function adjustForDST(
  event: CalendarEventTemplate,
  timezone: string
): CalendarEventTemplate {
  const startDate = new Date(event.startAt);
  if (isDSTTransitionPeriod(startDate, timezone)) {
    const offset = getTimezoneOffset(startDate, timezone);
    const adjusted = new Date(startDate.getTime() - offset);
    return {
      ...event,
      startAt: adjusted.toISOString(),
      endAt: new Date(adjusted.getTime() + 30 * 60 * 1000).toISOString(),
      notes: `${event.notes} (DST adjusted for ${timezone})`,
    };
  }
  return event;
}
