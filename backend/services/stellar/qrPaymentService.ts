/**
 * QR code payment requests for in-person checkout (Issue #1714).
 *
 * Builds SEP-0007 `web+stellar:pay` URIs and encodes them as base64 data-URIs
 * that a client can render as a QR code.  No external QR library is required —
 * the client already knows how to turn a data-URI into a scannable image.
 *
 * SEP-0007 spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

// ── Network passphrases ───────────────────────────────────────────────────────

export const STELLAR_NETWORK_PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QRPaymentRequest {
  /** Unique request ID (caller-supplied or auto-generated). */
  id: string;
  merchantId: string;
  /** Stellar G… destination address. */
  destinationAddress: string;
  /** Payment amount as a string to avoid IEEE-754 precision loss. */
  amount: string;
  /** Asset code, e.g. 'XLM' or 'USDC'. */
  asset: string;
  /** Stellar issuer address for non-native assets. */
  issuer?: string;
  /** Optional SEP-0007 memo text. */
  memo?: string;
  network: 'testnet' | 'mainnet';
  /** Unix timestamp (ms) when the request was created. */
  createdAt: number;
  /** Unix timestamp (ms) after which the request should be considered expired. */
  expiresAt?: number;
}

export interface CreateQRInput {
  merchantId: string;
  destinationAddress: string;
  amount: string;
  asset: string;
  issuer?: string;
  memo?: string;
  network: 'testnet' | 'mainnet';
  /** Optional TTL in milliseconds from now. */
  ttlMs?: number;
  /** Override the auto-generated ID. */
  id?: string;
}

export interface QRPaymentResult {
  request: QRPaymentRequest;
  /**
   * SEP-0007 URI, e.g.
   * `web+stellar:pay?destination=G…&amount=10.00&memo=order-42&network_passphrase=…`
   */
  sep007Uri: string;
  /**
   * `data:text/plain;base64,<base64(sep007Uri)>` — the client renders this as
   * a QR code image using any standard QR library or canvas API.
   */
  qrDataUri: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ── Store interface ───────────────────────────────────────────────────────────

export interface QRPaymentStore {
  save(request: QRPaymentRequest): Promise<void>;
  findById(id: string): Promise<QRPaymentRequest | null>;
}

// ── In-memory store implementation ───────────────────────────────────────────

export class InMemoryQRPaymentStore implements QRPaymentStore {
  private readonly store = new Map<string, QRPaymentRequest>();

  async save(request: QRPaymentRequest): Promise<void> {
    this.store.set(request.id, { ...request });
  }

  async findById(id: string): Promise<QRPaymentRequest | null> {
    return this.store.get(id) ?? null;
  }

  /** Test helper: clear all records. */
  clear(): void {
    this.store.clear();
  }

  /** Test helper: access the underlying map directly. */
  get size(): number {
    return this.store.size;
  }
}

// ── Clock abstraction (injectable for testing) ───────────────────────────────

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

// ── ID generator abstraction (injectable for testing) ────────────────────────

export interface IdGenerator {
  generate(): string;
}

export class RandomIdGenerator implements IdGenerator {
  generate(): string {
    return `qr_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`;
  }
}

// ── SEP-0007 URI builder (pure function) ─────────────────────────────────────

/**
 * Builds a SEP-0007 `web+stellar:pay` URI from the given payment request.
 *
 * Rules:
 * - For XLM (native asset): `asset_code` and `asset_issuer` are omitted.
 * - For non-native assets: `asset_code` and optionally `asset_issuer` are
 *   included.
 * - All parameter values are URL-encoded.
 * - `network_passphrase` is always included so wallets know which network to
 *   use without out-of-band configuration.
 */
export function buildSep007Uri(request: QRPaymentRequest): string {
  // Build pairs manually so we can use encodeURIComponent (RFC 3986, %20 for
  // spaces) instead of URLSearchParams which uses form-encoding (+ for spaces).
  const pairs: [string, string][] = [];

  pairs.push(['destination', request.destinationAddress]);
  pairs.push(['amount', request.amount]);

  const isNative = request.asset.toUpperCase() === 'XLM';
  if (!isNative) {
    pairs.push(['asset_code', request.asset]);
    if (request.issuer) {
      pairs.push(['asset_issuer', request.issuer]);
    }
  }

  if (request.memo) {
    pairs.push(['memo', request.memo]);
  }

  pairs.push(['network_passphrase', STELLAR_NETWORK_PASSPHRASES[request.network]]);

  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `web+stellar:pay?${qs}`;
}

/**
 * Encodes a SEP-0007 URI as a base64 data-URI.
 * The data-URI type is `text/plain` — clients use the decoded string directly
 * as the QR code payload, which Stellar wallets read and parse.
 */
export function buildQrDataUri(sep007Uri: string): string {
  const encoded = Buffer.from(sep007Uri, 'utf8').toString('base64');
  return `data:text/plain;base64,${encoded}`;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * QRPaymentService — creates SEP-0007 payment requests and encodes them as
 * base64 data-URIs suitable for QR code rendering.
 *
 * Dependencies are injectable so the service is easily tested without I/O.
 */
export class QRPaymentService {
  constructor(
    private readonly store: QRPaymentStore,
    private readonly clock: Clock = new SystemClock(),
    private readonly idGen: IdGenerator = new RandomIdGenerator(),
  ) {}

  /**
   * Creates a new QR payment request, persists it and returns the SEP-0007 URI
   * together with the base64 data-URI.
   */
  async createPaymentRequest(input: CreateQRInput): Promise<QRPaymentResult> {
    const now = this.clock.now();

    const request: QRPaymentRequest = {
      id: input.id ?? this.idGen.generate(),
      merchantId: input.merchantId,
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      asset: input.asset,
      issuer: input.issuer,
      memo: input.memo,
      network: input.network,
      createdAt: now,
      expiresAt: input.ttlMs !== undefined ? now + input.ttlMs : undefined,
    };

    await this.store.save(request);

    const sep007Uri = buildSep007Uri(request);
    const qrDataUri = buildQrDataUri(sep007Uri);

    return { request, sep007Uri, qrDataUri };
  }

  /**
   * Validates whether a stored QR payment request is still usable.
   *
   * Returns:
   * - `{ valid: true }` — request exists and has not expired.
   * - `{ valid: false, reason: 'not_found' }` — no request with this ID.
   * - `{ valid: false, reason: 'expired' }` — request exists but `expiresAt`
   *   is in the past.
   */
  async validatePaymentRequest(id: string): Promise<ValidationResult> {
    const request = await this.store.findById(id);

    if (!request) {
      return { valid: false, reason: 'not_found' };
    }

    if (request.expiresAt !== undefined && request.expiresAt < this.clock.now()) {
      return { valid: false, reason: 'expired' };
    }

    return { valid: true };
  }

  /**
   * Retrieves a stored QR payment request by ID, or `null` if not found.
   */
  async getPaymentRequest(id: string): Promise<QRPaymentRequest | null> {
    return this.store.findById(id);
  }
}
