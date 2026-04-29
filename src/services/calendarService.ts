import type { Subscription } from '../types/subscription';
import type {
  CalendarOAuthCallbackPayload,
  CalendarEventTemplate,
  CalendarIntegration,
  CalendarProvider,
  CalendarSyncedEvent,
  PendingCalendarAuthorization,
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
