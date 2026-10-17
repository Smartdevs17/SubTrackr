/**
 * transactionConfirmation.ts
 *
 * Shared, defensive waiting for on-chain transaction receipts.
 *
 * Every on-chain payment path in SubTrackr previously called `tx.wait()`
 * with no arguments and then only asserted that a hash came back. That is
 * unsafe in three ways:
 *
 *   1. `tx.wait()` with no timeout can hang forever if a transaction is
 *      stuck in the mempool, which also stalls the offline retry queue.
 *   2. `receipt.status === 0` means the transaction was *mined but reverted*.
 *      Treating "mined" as "succeeded" reports a failed payment as a success.
 *   3. A single confirmation is not final. On fast chains a reorg can still
 *      drop the transaction, so users need a chain-appropriate depth.
 *
 * This module centralises those three concerns so all payment paths behave
 * the same way and can be tested in isolation.
 */

import type { ethers } from 'ethers';

import { logger } from './logging';

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** The transaction was mined but the receipt reports `status === 0`. */
export class TransactionRevertedError extends Error {
  readonly code = 'TRANSACTION_REVERTED' as const;
  readonly transactionHash: string;

  constructor(transactionHash: string, detail?: string) {
    super(`Transaction ${transactionHash} was reverted on-chain${detail ? `: ${detail}` : '.'}`);
    this.name = 'TransactionRevertedError';
    this.transactionHash = transactionHash;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No receipt arrived within the allotted timeout. */
export class TransactionTimeoutError extends Error {
  readonly code = 'TRANSACTION_TIMEOUT' as const;
  readonly transactionHash: string;
  readonly timeoutMs: number;

  constructor(transactionHash: string, timeoutMs: number) {
    super(
      `Transaction ${transactionHash} was not confirmed within ${timeoutMs} ms. ` +
        `It may still be pending on-chain — check your wallet before retrying.`
    );
    this.name = 'TransactionTimeoutError';
    this.transactionHash = transactionHash;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The transaction was confirmed but never reached the required depth. */
export class TransactionInsufficientConfirmationsError extends Error {
  readonly code = 'TRANSACTION_INSUFFICIENT_CONFIRMATIONS' as const;
  readonly transactionHash: string;
  readonly actual: number;
  readonly required: number;

  constructor(transactionHash: string, actual: number, required: number) {
    super(
      `Transaction ${transactionHash} has ${actual} confirmation(s) but ${required} are required.`
    );
    this.name = 'TransactionInsufficientConfirmationsError';
    this.transactionHash = transactionHash;
    this.actual = actual;
    this.required = required;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum block confirmations before a payment is treated as settled.
 *
 * L2s reorg far less often than L1 and produce a block every ~250ms, so
 * waiting many blocks would add latency without adding safety. Ethereum
 * mainnet uses the deeper default.
 */
export const DEFAULT_CONFIRMATIONS = 2;

const L2_CHAIN_IDS = new Set([10, 137, 42161, 8453, 43114, 56, 534352]);

/** Confirmation depth appropriate for `chainId`. */
export function requiredConfirmations(chainId: number, override?: number): number {
  if (override !== undefined) {
    return Math.max(1, Math.floor(override));
  }
  return L2_CHAIN_IDS.has(chainId) ? 1 : DEFAULT_CONFIRMATIONS;
}

/**
 * Default receipt timeout. Generous enough for congested mainnet, short
 * enough that a stuck mempool transaction does not block the queue forever.
 */
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Receipt classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ethers surfaces a `wait()` timeout as a `TRANSACTION_REPLACED`-adjacent
 * error, a plain `Error` carrying `code === 'TIMEOUT'`, or — depending on
 * version — a rejected promise with a `timeout` field. Detection is done on
 * shape rather than `instanceof` so that it stays robust across ethers v5/v6.
 */
function isWaitTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as { code?: unknown; message?: unknown; reason?: unknown; timeout?: unknown };
  if (err.code === 'TIMEOUT' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
    return true;
  }

  const text = [err.message, err.reason]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();

  return (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('could not detect transaction') ||
    (typeof err.timeout === 'number' && text.includes('transaction'))
  );
}

/**
 * True when the error means "this transaction failed", as opposed to "we
 * could not observe the outcome". Used to decide whether a queued item may
 * be retried safely.
 */
export function isDefinitiveFailure(error: unknown): boolean {
  return (
    error instanceof TransactionRevertedError ||
    error instanceof TransactionInsufficientConfirmationsError
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wait
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmTransactionOptions {
  chainId?: number;
  /** Override the chain-derived confirmation depth. */
  confirmations?: number;
  /** Override the receipt timeout. */
  timeoutMs?: number;
  /** Human label used in error messages, e.g. `Sablier stream creation`. */
  operation?: string;
}

/** The subset of a transaction response this module needs. */
export interface AwaitableTransactionResponse {
  hash: string;
  wait: (confirmations?: number) => Promise<ethers.providers.TransactionReceipt | null>;
}

function label(options: ConfirmTransactionOptions): string {
  return options.operation ? `${options.operation} ` : '';
}

/**
 * Nodes expose revert reasons in several vendor-specific shapes and ethers v5
 * does not model them on `TransactionReceipt`. Read defensively so a missing
 * reason never turns into a crash inside error handling.
 */
function extractRevertReason(receipt: ethers.providers.TransactionReceipt): string | undefined {
  const candidate = receipt as unknown as {
    revertReason?: unknown;
    revertName?: unknown;
  };

  const reason = candidate.revertReason ?? candidate.revertName;
  return typeof reason === 'string' && reason.length > 0 ? reason : undefined;
}

/**
 * Waits for `txResponse` to reach the required confirmation depth and proves
 * it actually succeeded.
 *
 * Resolves with the confirmed receipt. Throws `TransactionRevertedError`,
 * `TransactionTimeoutError` or `TransactionInsufficientConfirmationsError`.
 */
export async function confirmTransaction(
  txResponse: AwaitableTransactionResponse,
  options: ConfirmTransactionOptions = {}
): Promise<ethers.providers.TransactionReceipt> {
  const {
    chainId,
    confirmations = requiredConfirmations(chainId ?? 1),
    timeoutMs = DEFAULT_CONFIRMATION_TIMEOUT_MS,
  } = options;

  const txHash = txResponse.hash;

  let receipt: ethers.providers.TransactionReceipt | null = null;
  try {
    // The timeout is enforced here rather than delegated to ethers. In ethers
    // v5 `ContractTransaction.wait(confirmations)` does not forward a timeout
    // argument at all, so relying on it left every contract-based payment
    // (ERC-20 approve, Sablier stream creation) able to hang indefinitely and
    // to stall the offline retry queue queued behind it.
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    try {
      receipt = await Promise.race([
        txResponse.wait(confirmations) as Promise<ethers.providers.TransactionReceipt | null>,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new TransactionTimeoutError(txHash, timeoutMs));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof TransactionTimeoutError) throw error;
    if (isWaitTimeout(error)) {
      throw new TransactionTimeoutError(txHash, timeoutMs);
    }
    throw error;
  }

  if (!receipt) {
    // ethers resolves `null` when the transaction was replaced/dropped rather
    // than mined. Treated as a timeout: the outcome is genuinely unknown.
    throw new TransactionTimeoutError(txHash, timeoutMs);
  }

  // A mined receipt with status 0 is a reverted transaction. Reporting this
  // as success is what previously let failed payments look confirmed.
  if (receipt.status === 0) {
    throw new TransactionRevertedError(txHash, extractRevertReason(receipt));
  }

  const actual = receipt.confirmations ?? confirmations;
  if (actual < confirmations) {
    throw new TransactionInsufficientConfirmationsError(txHash, actual, confirmations);
  }

  return receipt;
}

/**
 * Resolves the transaction hash without failing the surrounding operation.
 *
 * Used by the offline queue: when a broadcast may have succeeded but the
 * receipt could not be observed (app crash, dropped connection), the hash is
 * still the durable handle the user needs in order to check on-chain.
 */
export async function bestEffortTransactionHash(
  txResponse: AwaitableTransactionResponse | null | undefined,
  options: ConfirmTransactionOptions = {}
): Promise<string | undefined> {
  if (!txResponse?.hash) return undefined;

  try {
    await confirmTransaction(txResponse, options);
    return txResponse.hash;
  } catch (error) {
    if (error instanceof TransactionRevertedError) {
      // Definitive: the chain says it failed. Surface it, do not swallow it.
      throw error;
    }
    logger.warn(
      `${label(options)}receipt for ${txResponse.hash} could not be confirmed: ` +
        (error instanceof Error ? error.message : String(error))
    );
    return txResponse.hash;
  }
}
