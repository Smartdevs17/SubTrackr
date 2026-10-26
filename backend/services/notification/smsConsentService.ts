/**
 * SMS consent ledger (#1747)
 *
 * A phone number's SMS consent is a legal record: we must be able to say, for
 * any number, *whether* we may text it, *when* that decision was made, *where*
 * it came from (a web form, an inbound STOP, an admin action), and *why*. The
 * bare `optOutStore` in the provider package answers only the first — it is a
 * set of opted-out numbers with no provenance.
 *
 * This service keeps the missing provenance. Each number has one current
 * `SmsConsent` record plus an append-only event log, so a "why did you text
 * me?" question is answerable after the fact. It mirrors the event-log shape of
 * `CommunicationPreferenceService` (which tracks channel-level opt-outs per
 * user) — this one is keyed by *phone number*, because a number can change
 * hands before a user id is known.
 *
 * Opt-out is honoured in two places by design:
 *   • `optOutStore` (shared package) is written so the low-level send path
 *     refuses to text an opted-out number even if a caller skips this service.
 *   • `isOptedOut` lets higher layers check before attempting a send.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * The slice of the shared provider opt-out registry this service writes to.
 *
 * Declared here rather than imported from `smsProvider` so the ledger has no
 * dependency on the notification-providers package — the container wires the
 * real registry in. That also makes the service trivially unit-testable with a
 * plain in-memory stub.
 */
export interface OptOutRegistry {
  optOut(phoneNumber: string): void;
  optIn(phoneNumber: string): void;
  isOptedOut(phoneNumber: string): boolean;
}

export type ConsentStatus = 'opted_in' | 'opted_out';

/** Where a consent decision came from. Doubles as the audit `source`. */
export type ConsentSource =
  | 'web_form'
  | 'inbound_sms'
  | 'admin'
  | 'import'
  | 'api'
  | 'system';

export interface SmsConsent {
  /** Normalised E.164 number this record belongs to. */
  phone: string;
  status: ConsentStatus;
  /** Registered owner of the number, when known. */
  userId: string | null;
  /** How the current status came to be. */
  source: ConsentSource;
  /** Human-readable explanation, e.g. the inbound keyword. */
  reason?: string;
  /** True when the number was ever opted in with express consent. */
  explicitOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SmsConsentEvent {
  phone: string;
  userId: string | null;
  status: ConsentStatus;
  source: ConsentSource;
  reason?: string;
  /** Twilio MessageSid when the change came from an inbound message. */
  messageSid?: string;
  at: string;
}

export interface RecordConsentInput {
  phone: string;
  status: ConsentStatus;
  source: ConsentSource;
  userId?: string | null;
  reason?: string;
  messageSid?: string;
}

// ─── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Canonicalise a phone number for consent lookups.
 *
 * Only formatting is normalised — spaces, dashes, parens and dots are stripped
 * and a leading `+` preserved. This deliberately does not try to resolve a
 * national number to E.164 without a country, since guessing one could map two
 * different numbers onto the same consent record.
 */
export function normalisePhone(phone: string): string {
  const stripped = phone.replace(/[\s\-().]/g, '');
  return stripped.startsWith('+') ? `+${stripped.slice(1)}` : stripped;
}

// ─── Repository ────────────────────────────────────────────────────────────────

export interface SmsConsentRepository {
  get(phone: string): Promise<SmsConsent | null>;
  save(consent: SmsConsent): Promise<void>;
  appendEvent(event: SmsConsentEvent): Promise<void>;
  listEvents(phone: string, limit?: number): Promise<SmsConsentEvent[]>;
  listAllEvents(): Promise<SmsConsentEvent[]>;
}

/** In-memory repository — tests and local development. */
export class InMemorySmsConsentRepository implements SmsConsentRepository {
  private readonly consents = new Map<string, SmsConsent>();
  private readonly events: SmsConsentEvent[] = [];

  async get(phone: string): Promise<SmsConsent | null> {
    const found = this.consents.get(normalisePhone(phone));
    return found ? { ...found } : null;
  }

  async save(consent: SmsConsent): Promise<void> {
    this.consents.set(consent.phone, { ...consent });
  }

  async appendEvent(event: SmsConsentEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async listEvents(phone: string, limit = 50): Promise<SmsConsentEvent[]> {
    const target = normalisePhone(phone);
    return this.events.filter((event) => event.phone === target).slice(-limit).reverse();
  }

  async listAllEvents(): Promise<SmsConsentEvent[]> {
    return this.events.map((event) => ({ ...event }));
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

export interface SmsConsentServiceDeps {
  repository: SmsConsentRepository;
  /** Injectable clock keeps timestamps deterministic in tests. */
  now?: () => Date;
  /**
   * Shared provider opt-out registry. When omitted, consent changes are not
   * mirrored to the low-level send path — the container always supplies the
   * real one in production.
   */
  optOutRegistry?: OptOutRegistry;
}

export class SmsConsentService {
  private readonly repository: SmsConsentRepository;
  private readonly now: () => Date;
  private readonly optOutRegistry: OptOutRegistry | null;

  constructor(deps: SmsConsentServiceDeps) {
    this.repository = deps.repository;
    this.now = deps.now ?? (() => new Date());
    this.optOutRegistry = deps.optOutRegistry ?? null;
  }

  /**
   * Record a consent decision, upserting the current record and appending an
   * audit event.
   *
   * Returns the resulting record and whether the status actually changed, so a
   * replayed inbound STOP does not look like a fresh opt-out in the audit.
   */
  async recordConsent(
    input: RecordConsentInput
  ): Promise<{ consent: SmsConsent; changed: boolean }> {
    const phone = normalisePhone(input.phone);
    const existing = await this.repository.get(phone);
    const at = this.now().toISOString();

    const changed = !existing || existing.status !== input.status;
    // Express consent latches: once a number has been opted in deliberately, a
    // later preference reset should not silently revoke it.
    const explicitOptIn =
      existing?.explicitOptIn === true ||
      (input.status === 'opted_in' && input.source !== 'system');

    const consent: SmsConsent = {
      phone,
      status: input.status,
      userId: input.userId ?? existing?.userId ?? null,
      source: input.source,
      reason: input.reason ?? existing?.reason,
      explicitOptIn,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await this.repository.save(consent);

    // Always append an event, even for a no-op, so the attempt is auditable.
    await this.repository.appendEvent({
      phone,
      userId: consent.userId,
      status: input.status,
      source: input.source,
      reason: input.reason,
      messageSid: input.messageSid,
      at,
    });

    if (this.optOutRegistry) {
      if (input.status === 'opted_out') this.optOutRegistry.optOut(phone);
      else this.optOutRegistry.optIn(phone);
    }

    return { consent, changed };
  }

  /** Opt a number out (STOP, unsubscribe, do-not-call). */
  async optOut(
    phone: string,
    source: ConsentSource = 'inbound_sms',
    options: { userId?: string | null; reason?: string; messageSid?: string } = {}
  ): Promise<SmsConsent> {
    const { consent } = await this.recordConsent({
      phone,
      status: 'opted_out',
      source,
      userId: options.userId,
      reason: options.reason,
      messageSid: options.messageSid,
    });
    return consent;
  }

  /** Opt a number back in (START, web form consent). */
  async optIn(
    phone: string,
    source: ConsentSource = 'inbound_sms',
    options: { userId?: string | null; reason?: string; messageSid?: string } = {}
  ): Promise<SmsConsent> {
    const { consent } = await this.recordConsent({
      phone,
      status: 'opted_in',
      source,
      userId: options.userId,
      reason: options.reason,
      messageSid: options.messageSid,
    });
    return consent;
  }

  async getConsent(phone: string): Promise<SmsConsent | null> {
    return this.repository.get(phone);
  }

  /** True when we must not send SMS to this number. */
  async isOptedOut(phone: string): Promise<boolean> {
    const consent = await this.repository.get(phone);
    return consent?.status === 'opted_out';
  }

  /** Consent audit trail for a number, newest first. */
  async listEvents(phone: string, limit = 50): Promise<SmsConsentEvent[]> {
    return this.repository.listEvents(phone, limit);
  }

  /**
   * Consent records owned by a user.
   *
   * The repository lists events, not records, so this reconstructs the owner
   * from the most recent event per number that carries a matching `userId`.
   */
  async listForUser(userId: string): Promise<SmsConsent[]> {
    const events = await this.repository.listAllEvents();
    const phones = new Set(
      events.filter((event) => event.userId === userId).map((event) => event.phone)
    );
    const consents: SmsConsent[] = [];
    for (const phone of phones) {
      const consent = await this.repository.get(phone);
      if (consent) consents.push(consent);
    }
    return consents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

/**
 * In-memory singleton for local development.
 *
 * The container re-registers a fully-wired instance (with the shared provider
 * opt-out registry) under `ISmsConsentService`; this default has no registry so
 * the module stays free of a notification-providers dependency.
 */
export const smsConsentRepository = new InMemorySmsConsentRepository();
export const smsConsentService = new SmsConsentService({ repository: smsConsentRepository });
