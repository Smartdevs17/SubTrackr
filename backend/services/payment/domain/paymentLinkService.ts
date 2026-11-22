/**
 * Payment link generation with configurable expiry and HMAC-signed tokens.
 *
 * Issue #1713 — Links are signed and unguessable, expiry is configurable,
 * and revoked links are rejected.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaymentLinkStatus = 'active' | 'expired' | 'revoked';

/** Per-merchant configuration controlling default expiry and the signing key. */
export interface PaymentLinkConfig {
  merchantId: string;
  /** How many seconds a newly-created link is valid for. Default: 86400 (24 h). */
  defaultExpirySeconds: number;
  /** Secret used to generate HMAC-SHA256 tokens. Must remain confidential. */
  signingSecret: string;
}

/** A payment link record as stored in the repository. */
export interface PaymentLink {
  id: string;
  merchantId: string;
  amount: number;
  currency: string;
  memo?: string;
  /**
   * HMAC-SHA256 hex of `id + merchantId + amount + currency + expiresAt`
   * computed with the merchant's `signingSecret`.
   */
  token: string;
  /** Unix timestamp (ms) at which the link expires. */
  expiresAt: number;
  /** Unix timestamp (ms) at which the link was created. */
  createdAt: number;
  /** Unix timestamp (ms) at which the link was revoked, if applicable. */
  revokedAt?: number;
  status: PaymentLinkStatus;
}

/** Input accepted by {@link PaymentLinkService.createLink}. */
export interface CreateLinkInput {
  merchantId: string;
  amount: number;
  currency: string;
  memo?: string;
  /** Override the per-merchant default. Must be a positive integer (seconds). */
  expirySeconds?: number;
}

/** Result returned by {@link PaymentLinkService.validateLink}. */
export interface ValidationResult {
  valid: boolean;
  link?: PaymentLink;
  reason?: 'not_found' | 'invalid_token' | 'expired' | 'revoked';
}

// ---------------------------------------------------------------------------
// Store interface + default in-memory implementation
// ---------------------------------------------------------------------------

export interface PaymentLinkStore {
  save(link: PaymentLink): Promise<PaymentLink>;
  findById(id: string): Promise<PaymentLink | null>;
  update(id: string, updates: Partial<PaymentLink>): Promise<PaymentLink>;
  listByMerchant(merchantId: string): Promise<PaymentLink[]>;
}

export class InMemoryPaymentLinkStore implements PaymentLinkStore {
  private links = new Map<string, PaymentLink>();

  async save(link: PaymentLink): Promise<PaymentLink> {
    this.links.set(link.id, { ...link });
    return { ...link };
  }

  async findById(id: string): Promise<PaymentLink | null> {
    const link = this.links.get(id);
    return link ? { ...link } : null;
  }

  async update(id: string, updates: Partial<PaymentLink>): Promise<PaymentLink> {
    const existing = this.links.get(id);
    if (!existing) {
      throw new Error(`PaymentLink ${id} not found`);
    }
    const updated: PaymentLink = { ...existing, ...updates };
    this.links.set(id, updated);
    return { ...updated };
  }

  async listByMerchant(merchantId: string): Promise<PaymentLink[]> {
    const results: PaymentLink[] = [];
    for (const link of this.links.values()) {
      if (link.merchantId === merchantId) {
        results.push({ ...link });
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PaymentLinkService {
  constructor(
    private store: PaymentLinkStore = new InMemoryPaymentLinkStore(),
    /** Called with `Date.now()` semantics; injectable for testing. */
    private clock: () => number = () => Date.now(),
  ) {}

  // -------------------------------------------------------------------------
  // Token helpers
  // -------------------------------------------------------------------------

  /**
   * Builds the canonical message that is HMAC-signed.
   * Order is fixed so validation always reproduces the same string.
   */
  private buildMessage(
    id: string,
    merchantId: string,
    amount: number,
    currency: string,
    expiresAt: number,
  ): string {
    return `${id}|${merchantId}|${amount}|${currency}|${expiresAt}`;
  }

  private sign(message: string, secret: string): string {
    return createHmac('sha256', secret).update(message).digest('hex');
  }

  private tokensEqual(a: string, b: string): boolean {
    try {
      const ba = Buffer.from(a, 'hex');
      const bb = Buffer.from(b, 'hex');
      if (ba.length !== bb.length) return false;
      return timingSafeEqual(ba, bb);
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Creates a new payment link signed with the merchant's `signingSecret`.
   * Expiry defaults to `config.defaultExpirySeconds` unless overridden in
   * `input.expirySeconds`.
   */
  async createLink(
    input: CreateLinkInput,
    config: PaymentLinkConfig,
  ): Promise<PaymentLink> {
    if (input.merchantId !== config.merchantId) {
      throw new Error(
        `Config merchantId (${config.merchantId}) does not match input merchantId (${input.merchantId})`,
      );
    }

    const now = this.clock();
    const expirySeconds =
      input.expirySeconds != null
        ? input.expirySeconds
        : config.defaultExpirySeconds;

    if (expirySeconds <= 0) {
      throw new Error('expirySeconds must be a positive integer');
    }

    const id = randomUUID();
    const expiresAt = now + expirySeconds * 1000;
    const message = this.buildMessage(id, input.merchantId, input.amount, input.currency, expiresAt);
    const token = this.sign(message, config.signingSecret);

    const link: PaymentLink = {
      id,
      merchantId: input.merchantId,
      amount: input.amount,
      currency: input.currency,
      memo: input.memo,
      token,
      expiresAt,
      createdAt: now,
      status: 'active',
    };

    return this.store.save(link);
  }

  /**
   * Validates a payment link by checking:
   * 1. The link exists.
   * 2. The supplied token matches the stored HMAC signature.
   * 3. The link has not expired (`expiresAt > now`).
   * 4. The link has not been revoked.
   *
   * The `config` must belong to the link's `merchantId` (the signing key is
   * looked up via the config, not stored on the link itself).
   */
  async validateLink(
    id: string,
    token: string,
    config: PaymentLinkConfig,
  ): Promise<ValidationResult> {
    const link = await this.store.findById(id);
    if (!link) {
      return { valid: false, reason: 'not_found' };
    }

    // Recompute the expected token using the canonical message and the config's secret.
    const message = this.buildMessage(
      link.id,
      link.merchantId,
      link.amount,
      link.currency,
      link.expiresAt,
    );
    const expected = this.sign(message, config.signingSecret);

    if (!this.tokensEqual(expected, token)) {
      return { valid: false, link, reason: 'invalid_token' };
    }

    const now = this.clock();

    if (link.revokedAt != null) {
      return { valid: false, link, reason: 'revoked' };
    }

    if (link.expiresAt <= now) {
      return { valid: false, link, reason: 'expired' };
    }

    return { valid: true, link };
  }

  /**
   * Marks a link as revoked. Subsequent calls to {@link validateLink} for this
   * link will return `{ valid: false, reason: 'revoked' }`.
   *
   * @throws If the link does not exist.
   */
  async revokeLink(id: string): Promise<void> {
    const link = await this.store.findById(id);
    if (!link) {
      throw new Error(`PaymentLink ${id} not found`);
    }
    await this.store.update(id, { revokedAt: this.clock(), status: 'revoked' });
  }

  /** Returns the stored link or `null` if it does not exist. */
  async getLink(id: string): Promise<PaymentLink | null> {
    return this.store.findById(id);
  }

  /** Returns all links belonging to `merchantId`. */
  async listLinks(merchantId: string): Promise<PaymentLink[]> {
    return this.store.listByMerchant(merchantId);
  }
}

// ---------------------------------------------------------------------------
// Default singleton (overridable via setDefaultPaymentLinkService)
// ---------------------------------------------------------------------------

let _defaultService: PaymentLinkService | null = null;

export function getDefaultPaymentLinkService(): PaymentLinkService {
  if (!_defaultService) {
    _defaultService = new PaymentLinkService();
  }
  return _defaultService;
}

export function setDefaultPaymentLinkService(service: PaymentLinkService): void {
  _defaultService = service;
}
