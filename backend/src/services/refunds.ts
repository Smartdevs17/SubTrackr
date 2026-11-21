/**
 * Replay-safe refund workflow with a signed admin challenge (#2102).
 *
 * Flow:
 *   1. An admin asks for a refund. The server stores a single-use challenge
 *      (random nonce, expiry, and the exact refund details) and returns the
 *      canonical message the admin must sign with their Ed25519 key.
 *   2. The admin signs the message and submits { adminId, nonce, signature }.
 *   3. The server checks the challenge exists, belongs to that admin, and has not
 *      expired. It verifies the signature against the admin's registered public
 *      key. Only then does it consume the nonce, so a valid signature cannot be
 *      replayed. It also claims the refund ID, so one refund executes at most once.
 *
 * The store must make `consume` and `claimRefund` atomic (for example with a
 * unique constraint or a conditional write). The in-memory store below is for
 * tests and single-process use only.
 */

import { createPublicKey, randomBytes, verify } from 'crypto';

export interface RefundRequest {
  refundId: string;
  paymentId: string;
  /** Integer minor units (for example cents). Never a float. */
  amountCents: number;
  currency: string;
  reason: string;
}

export interface AdminChallenge {
  nonce: string;
  adminId: string;
  refund: RefundRequest;
  expiresAt: number;
}

export interface ChallengeStore {
  save(challenge: AdminChallenge): Promise<void>;
  get(nonce: string): Promise<AdminChallenge | undefined>;
  /** Marks the nonce used. Returns false when it was already used. */
  consume(nonce: string): Promise<boolean>;
  /** Claims a refund ID. Returns false when it was already claimed. */
  claimRefund(refundId: string): Promise<boolean>;
  /** Releases a claim after the executor failed, so the refund can be retried. */
  releaseRefund(refundId: string): Promise<void>;
}

export interface RefundExecutor {
  execute(refund: RefundRequest): Promise<{ refundId: string; status: string }>;
}

export interface RefundServiceOptions {
  store: ChallengeStore;
  executor: RefundExecutor;
  /** Returns the admin's Ed25519 public key as PEM, or undefined if unknown. */
  getAdminPublicKeyPem: (adminId: string) => Promise<string | undefined>;
  /** Challenge lifetime. Default: 5 minutes. */
  ttlMs?: number;
  now?: () => number;
}

export type RefundErrorCode =
  | 'INVALID_REFUND'
  | 'UNKNOWN_CHALLENGE'
  | 'CHALLENGE_EXPIRED'
  | 'INVALID_SIGNATURE'
  | 'CHALLENGE_REPLAYED'
  | 'REFUND_ALREADY_PROCESSED';

export class RefundError extends Error {
  constructor(public readonly code: RefundErrorCode, message: string) {
    super(message);
    this.name = 'RefundError';
  }
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function validateRefund(refund: RefundRequest): void {
  if (!refund.refundId || !refund.paymentId) {
    throw new RefundError('INVALID_REFUND', 'refundId and paymentId are required');
  }
  if (!Number.isSafeInteger(refund.amountCents) || refund.amountCents <= 0) {
    throw new RefundError('INVALID_REFUND', 'amountCents must be a positive integer');
  }
  if (!/^[A-Z]{3}$/.test(refund.currency)) {
    throw new RefundError('INVALID_REFUND', 'currency must be a 3-letter ISO code');
  }
  if (!refund.reason || refund.reason.length > 500) {
    throw new RefundError('INVALID_REFUND', 'reason is required and must be at most 500 characters');
  }
}

/**
 * The exact bytes the admin signs. Field order is fixed, so the same challenge
 * always yields the same message.
 */
export function canonicalChallengeMessage(challenge: AdminChallenge): string {
  return JSON.stringify({
    nonce: challenge.nonce,
    adminId: challenge.adminId,
    refundId: challenge.refund.refundId,
    paymentId: challenge.refund.paymentId,
    amountCents: challenge.refund.amountCents,
    currency: challenge.refund.currency,
    reason: challenge.refund.reason,
    expiresAt: challenge.expiresAt,
  });
}

export function createRefundService(options: RefundServiceOptions) {
  const { store, executor, getAdminPublicKeyPem } = options;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());

  /** Step 1: create a single-use challenge for the admin to sign. */
  async function createChallenge(adminId: string, refund: RefundRequest) {
    if (!adminId) throw new RefundError('UNKNOWN_CHALLENGE', 'adminId is required');
    validateRefund(refund);
    const challenge: AdminChallenge = {
      nonce: randomBytes(32).toString('hex'),
      adminId,
      refund: { ...refund },
      expiresAt: now() + ttlMs,
    };
    await store.save(challenge);
    return {
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      message: canonicalChallengeMessage(challenge),
    };
  }

  /** Step 2: verify the signed challenge and execute the refund exactly once. */
  async function executeSignedRefund(input: { adminId: string; nonce: string; signature: string }) {
    const challenge = await store.get(input.nonce);
    if (!challenge || challenge.adminId !== input.adminId) {
      throw new RefundError('UNKNOWN_CHALLENGE', 'challenge not found for this admin');
    }
    if (now() > challenge.expiresAt) {
      throw new RefundError('CHALLENGE_EXPIRED', 'challenge has expired');
    }

    // Verify before consuming, so a bad signature cannot burn an admin's challenge.
    const pem = await getAdminPublicKeyPem(input.adminId);
    if (!pem) {
      throw new RefundError('INVALID_SIGNATURE', 'no public key registered for this admin');
    }
    let signatureOk = false;
    try {
      signatureOk = verify(
        null,
        Buffer.from(canonicalChallengeMessage(challenge), 'utf8'),
        createPublicKey(pem),
        Buffer.from(input.signature, 'base64'),
      );
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) {
      throw new RefundError('INVALID_SIGNATURE', 'signature does not match the challenge');
    }

    // Replay guard: a valid nonce is usable exactly once.
    if (!(await store.consume(challenge.nonce))) {
      throw new RefundError('CHALLENGE_REPLAYED', 'challenge has already been used');
    }

    // Idempotency: a refund ID executes at most once.
    if (!(await store.claimRefund(challenge.refund.refundId))) {
      throw new RefundError('REFUND_ALREADY_PROCESSED', 'this refund has already been processed');
    }

    try {
      return await executor.execute(challenge.refund);
    } catch (err) {
      await store.releaseRefund(challenge.refund.refundId);
      throw err;
    }
  }

  return { createChallenge, executeSignedRefund };
}

/**
 * In-memory store for tests and single-process use. Operations are synchronous
 * under the hood, so `consume` and `claimRefund` are atomic within one process.
 */
export function createInMemoryChallengeStore(): ChallengeStore {
  const challenges = new Map<string, AdminChallenge>();
  const used = new Set<string>();
  const claimed = new Set<string>();
  return {
    async save(challenge) {
      challenges.set(challenge.nonce, challenge);
    },
    async get(nonce) {
      return challenges.get(nonce);
    },
    async consume(nonce) {
      if (used.has(nonce)) return false;
      used.add(nonce);
      return true;
    },
    async claimRefund(refundId) {
      if (claimed.has(refundId)) return false;
      claimed.add(refundId);
      return true;
    },
    async releaseRefund(refundId) {
      claimed.delete(refundId);
    },
  };
}
