/**
 * Multi-signature approval service for charges above a per-merchant threshold.
 *
 * Architecture
 * ------------
 * This module provides M-of-N threshold signing for large charges. Before a
 * charge above `thresholdAmount` is executed, it must collect at least
 * `requiredApprovals` independent approvals from the merchant's registered
 * `signerAddresses`.
 *
 * The store is intentionally abstracted behind `MultiSigStore` so it can be
 * backed by an in-process Map (tests / dev) or a Redis / Postgres adapter
 * in production without changing the service layer.
 *
 * Key properties
 * --------------
 * * Idempotent approvals — a signer who calls `submitApproval` twice has the
 *   same effect as calling it once.
 * * Any single authorised signer can veto a request via `submitRejection`.
 * * Requests that are not resolved before `expiresAt` are marked `expired`
 *   during the next `expireStaleRequests` sweep.
 * * `isChargeApproved` returns `true` for charges that were below the
 *   threshold and therefore never required an approval request.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Per-merchant M-of-N multi-sig policy. */
export interface MerchantMultiSigConfig {
  merchantId: string;
  /** Charges >= this value (in `currency`) require multi-sig approval. */
  thresholdAmount: number;
  /** Currency the threshold applies to (e.g. 'XLM', 'USDC'). */
  currency: string;
  /** M in M-of-N — number of approvals needed to authorise the charge. */
  requiredApprovals: number;
  /** N in M-of-N — total number of registered signers. */
  totalSigners: number;
  /** Authorised signer IDs / Stellar addresses (length must equal totalSigners). */
  signerAddresses: string[];
}

/** A pending (or resolved) approval request for a single charge. */
export interface MultiSigApprovalRequest {
  id: string;
  merchantId: string;
  chargeId: string;
  amount: number;
  currency: string;
  requiredApprovals: number;
  /** Signer addresses that have approved. */
  approvals: string[];
  /** Signer addresses that have rejected. */
  rejections: string[];
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  /** Unix milliseconds — when the request was created. */
  createdAt: number;
  /** Unix milliseconds — deadline after which the request expires. */
  expiresAt: number;
  /** Unix milliseconds — when the request was resolved (approved/rejected/expired). */
  resolvedAt?: number;
}

/** Result returned from `submitApproval` and `submitRejection`. */
export interface ApprovalResult {
  approved: boolean;
  reason?:
    | 'below_threshold'
    | 'already_approved'
    | 'not_authorized'
    | 'already_resolved'
    | 'expired';
  request?: MultiSigApprovalRequest;
}

// ─── Store abstraction ────────────────────────────────────────────────────────

/**
 * Minimal persistence interface for approval requests and merchant configs.
 * Implementations must guarantee that writes are visible to subsequent reads
 * within the same process (the in-memory implementation below) or via a
 * shared store in multi-process deployments.
 */
export interface MultiSigStore {
  /** Persist a new or updated request. */
  saveRequest(request: MultiSigApprovalRequest): Promise<void>;

  /** Look up a request by its unique id. */
  getRequest(requestId: string): Promise<MultiSigApprovalRequest | null>;

  /**
   * Return the most recent request associated with `chargeId`, or `null`
   * if no request exists.
   */
  getRequestByChargeId(chargeId: string): Promise<MultiSigApprovalRequest | null>;

  /**
   * Return all requests whose status is `pending` and whose `expiresAt`
   * is <= `now`.
   */
  getPendingExpiredRequests(now: number): Promise<MultiSigApprovalRequest[]>;

  /** Retrieve the merchant config, or `null` if not registered. */
  getMerchantConfig(merchantId: string): Promise<MerchantMultiSigConfig | null>;

  /** Register or update a merchant config. */
  saveMerchantConfig(config: MerchantMultiSigConfig): Promise<void>;
}

// ─── In-Memory store implementation ──────────────────────────────────────────

/** In-process store — suitable for tests and single-node development. */
export class InMemoryMultiSigStore implements MultiSigStore {
  private readonly requests = new Map<string, MultiSigApprovalRequest>();
  private readonly chargeIndex = new Map<string, string>(); // chargeId → requestId
  private readonly configs = new Map<string, MerchantMultiSigConfig>();

  async saveRequest(request: MultiSigApprovalRequest): Promise<void> {
    this.requests.set(request.id, { ...request });
    this.chargeIndex.set(request.chargeId, request.id);
  }

  async getRequest(requestId: string): Promise<MultiSigApprovalRequest | null> {
    return this.requests.get(requestId) ?? null;
  }

  async getRequestByChargeId(chargeId: string): Promise<MultiSigApprovalRequest | null> {
    const id = this.chargeIndex.get(chargeId);
    if (!id) return null;
    return this.requests.get(id) ?? null;
  }

  async getPendingExpiredRequests(now: number): Promise<MultiSigApprovalRequest[]> {
    const result: MultiSigApprovalRequest[] = [];
    for (const req of this.requests.values()) {
      if (req.status === 'pending' && req.expiresAt <= now) {
        result.push({ ...req });
      }
    }
    return result;
  }

  async getMerchantConfig(merchantId: string): Promise<MerchantMultiSigConfig | null> {
    return this.configs.get(merchantId) ?? null;
  }

  async saveMerchantConfig(config: MerchantMultiSigConfig): Promise<void> {
    this.configs.set(config.merchantId, { ...config });
  }
}

// ─── ID generation ────────────────────────────────────────────────────────────

let _counter = 0;

/** Deterministic-enough ID for testing; replace with uuid in production. */
function generateId(prefix: string): string {
  _counter += 1;
  return `${prefix}_${Date.now()}_${_counter}`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/** Default time-to-live for approval requests (24 hours). */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

export interface MultiSigApprovalServiceOptions {
  /** Duration before a pending request is considered stale. Default: 24 h. */
  requestTtlMs?: number;
  /** Override the clock for deterministic testing. */
  now?: () => number;
}

/**
 * Multi-signature approval service.
 *
 * Typical flow
 * ------------
 * 1. Merchant registers their policy via `configureMerchant`.
 * 2. Before executing a charge the billing layer calls `initiateApproval`.
 *    - Returns `null`  → charge is below threshold, proceed immediately.
 *    - Returns request → charge is blocked until the request is resolved.
 * 3. Each authorised signer calls `submitApproval` or `submitRejection`.
 * 4. Once `status === 'approved'` the billing layer may proceed.
 * 5. A background job periodically calls `expireStaleRequests`.
 */
export class MultiSigApprovalService {
  private readonly store: MultiSigStore;
  private readonly requestTtlMs: number;
  private readonly clock: () => number;

  constructor(store: MultiSigStore, options: MultiSigApprovalServiceOptions = {}) {
    this.store = store;
    this.requestTtlMs = options.requestTtlMs ?? DEFAULT_TTL_MS;
    this.clock = options.now ?? (() => Date.now());
  }

  // ── Config management ───────────────────────────────────────────────────

  /** Register or update a merchant's multi-sig policy. */
  async configureMerchant(config: MerchantMultiSigConfig): Promise<void> {
    if (config.signerAddresses.length !== config.totalSigners) {
      throw new Error(
        `signerAddresses length (${config.signerAddresses.length}) must equal totalSigners (${config.totalSigners})`
      );
    }
    if (config.requiredApprovals > config.totalSigners) {
      throw new Error(
        `requiredApprovals (${config.requiredApprovals}) cannot exceed totalSigners (${config.totalSigners})`
      );
    }
    await this.store.saveMerchantConfig(config);
  }

  // ── Approval lifecycle ──────────────────────────────────────────────────

  /**
   * Initiate an approval request for a charge.
   *
   * Returns `null` if the charge amount is strictly below the merchant's
   * threshold — meaning no approval is required and the charge can proceed.
   *
   * Returns a new `MultiSigApprovalRequest` in `'pending'` status otherwise.
   */
  async initiateApproval(
    merchantId: string,
    chargeId: string,
    amount: number,
    currency: string
  ): Promise<MultiSigApprovalRequest | null> {
    const config = await this.store.getMerchantConfig(merchantId);
    if (!config) {
      throw new Error(`No multi-sig config found for merchant '${merchantId}'`);
    }

    // Currency mismatch — treat as below threshold (no approval needed).
    if (currency !== config.currency) {
      return null;
    }

    // Charge is strictly below threshold — no approval needed.
    if (amount < config.thresholdAmount) {
      return null;
    }

    const now = this.clock();
    const request: MultiSigApprovalRequest = {
      id: generateId('msa'),
      merchantId,
      chargeId,
      amount,
      currency,
      requiredApprovals: config.requiredApprovals,
      approvals: [],
      rejections: [],
      status: 'pending',
      createdAt: now,
      expiresAt: now + this.requestTtlMs,
    };

    await this.store.saveRequest(request);
    return { ...request };
  }

  /**
   * Submit an approval from an authorised signer.
   *
   * Semantics
   * ---------
   * * Idempotent: calling with the same signer twice returns `approved: true`
   *   with reason `'already_approved'` on the second call.
   * * Returns `approved: false` with reason `'not_authorized'` if
   *   `signerAddress` is not in the merchant's `signerAddresses`.
   * * Returns `approved: false` with reason `'already_resolved'` if the
   *   request has already been approved or rejected.
   * * Returns `approved: false` with reason `'expired'` if the request has
   *   passed its `expiresAt` deadline.
   * * When the approval count reaches `requiredApprovals` the request is
   *   transitioned to `'approved'` and `resolvedAt` is set.
   */
  async submitApproval(requestId: string, signerAddress: string): Promise<ApprovalResult> {
    const request = await this.store.getRequest(requestId);
    if (!request) {
      return { approved: false };
    }

    // Check expiry first (before checking resolved, so expired requests that
    // were never explicitly swept are handled correctly here too).
    const now = this.clock();
    if (request.status === 'pending' && request.expiresAt <= now) {
      request.status = 'expired';
      request.resolvedAt = now;
      await this.store.saveRequest(request);
      return { approved: false, reason: 'expired', request: { ...request } };
    }

    if (request.status !== 'pending') {
      return { approved: false, reason: 'already_resolved', request: { ...request } };
    }

    const config = await this.store.getMerchantConfig(request.merchantId);
    if (!config || !config.signerAddresses.includes(signerAddress)) {
      return { approved: false, reason: 'not_authorized', request: { ...request } };
    }

    // Idempotent — signer has already approved.
    if (request.approvals.includes(signerAddress)) {
      return { approved: true, reason: 'already_approved', request: { ...request } };
    }

    request.approvals.push(signerAddress);

    if (request.approvals.length >= request.requiredApprovals) {
      request.status = 'approved';
      request.resolvedAt = now;
    }

    await this.store.saveRequest(request);
    return { approved: request.status === 'approved', request: { ...request } };
  }

  /**
   * Submit a rejection from an authorised signer.
   *
   * Any single authorised signer can reject. The request transitions to
   * `'rejected'` immediately and no further approvals are accepted.
   */
  async submitRejection(requestId: string, signerAddress: string): Promise<ApprovalResult> {
    const request = await this.store.getRequest(requestId);
    if (!request) {
      return { approved: false };
    }

    const now = this.clock();
    if (request.status === 'pending' && request.expiresAt <= now) {
      request.status = 'expired';
      request.resolvedAt = now;
      await this.store.saveRequest(request);
      return { approved: false, reason: 'expired', request: { ...request } };
    }

    if (request.status !== 'pending') {
      return { approved: false, reason: 'already_resolved', request: { ...request } };
    }

    const config = await this.store.getMerchantConfig(request.merchantId);
    if (!config || !config.signerAddresses.includes(signerAddress)) {
      return { approved: false, reason: 'not_authorized', request: { ...request } };
    }

    request.rejections.push(signerAddress);
    request.status = 'rejected';
    request.resolvedAt = now;

    await this.store.saveRequest(request);
    return { approved: false, request: { ...request } };
  }

  /**
   * Retrieve the current state of an approval request.
   *
   * Returns `null` if no request with `requestId` exists.
   */
  async getApprovalStatus(requestId: string): Promise<MultiSigApprovalRequest | null> {
    const request = await this.store.getRequest(requestId);
    if (!request) return null;
    return { ...request };
  }

  /**
   * Check whether a charge is approved to proceed.
   *
   * Returns `true` when:
   * - The charge's amount was below the threshold (no request was created), OR
   * - An approval request for the charge exists and its status is `'approved'`.
   *
   * Returns `false` when an approval request exists and is still `'pending'`,
   * `'rejected'`, or `'expired'`.
   */
  async isChargeApproved(chargeId: string): Promise<boolean> {
    const request = await this.store.getRequestByChargeId(chargeId);
    if (!request) {
      // No request exists → charge was below threshold.
      return true;
    }
    return request.status === 'approved';
  }

  /**
   * Mark stale pending requests as `'expired'`.
   *
   * Should be called by a background job on a regular schedule.
   *
   * @param now - Current Unix timestamp in milliseconds (injected for testability).
   * @returns The number of requests that were expired.
   */
  async expireStaleRequests(now: number): Promise<number> {
    const stale = await this.store.getPendingExpiredRequests(now);
    for (const request of stale) {
      request.status = 'expired';
      request.resolvedAt = now;
      await this.store.saveRequest(request);
    }
    return stale.length;
  }
}
