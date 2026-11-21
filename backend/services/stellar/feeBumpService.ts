/**
 * Fee-Bump (Sponsored Transaction) Service — Issue #1712
 *
 * Allows merchants to sponsor network fees for subscribers who hold no XLM,
 * unblocking checkout for new users.
 *
 * Design:
 *   - Fee-bump is opt-in per merchant via `MerchantFeeBumpConfig`.
 *   - Every sponsored fee is recorded in `FeeBumpRecord` for accounting.
 *   - `StellarNetworkClient` is injected for testability; the default
 *     implementation targets Stellar testnet, swapped to mainnet by config.
 */

import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

/** Per-merchant opt-in configuration for fee-bump sponsorship. */
export interface MerchantFeeBumpConfig {
  merchantId: string;
  /** Whether this merchant has opted in to sponsoring subscriber fees. */
  feeBumpEnabled: boolean;
  /** Stellar account address that will pay the base fee. */
  sponsorAddress: string;
  /**
   * Maximum per-transaction fee the merchant is willing to sponsor, in stroops
   * (1 XLM = 10_000_000 stroops).  Defaults to 100 stroops (the Stellar base
   * fee).
   */
  maxFeeStroops: number;
}

/** Immutable record of a sponsored fee written for accounting. */
export interface FeeBumpRecord {
  id: string;
  merchantId: string;
  subscriberId: string;
  /** The inner-transaction hash whose fee was sponsored. */
  innerTransactionHash: string;
  /** The outer fee-bump transaction hash returned by Stellar. */
  feeBumpTransactionHash: string;
  feeStroops: number;
  /** ISO-8601 timestamp of when the sponsorship was applied. */
  sponsoredAt: string;
  /** Target network: 'testnet' | 'mainnet' */
  network: 'testnet' | 'mainnet';
}

export interface FeeBumpRequest {
  merchantId: string;
  subscriberId: string;
  /**
   * XDR-encoded inner transaction built and signed by the subscriber.
   * The fee-bump wrapper re-signs this with the merchant's sponsor key.
   */
  innerTransactionXdr: string;
  /** Optional: desired max fee in stroops; falls back to config default. */
  maxFeeStroops?: number;
}

export interface FeeBumpResult {
  success: boolean;
  feeBumpTransactionHash?: string;
  innerTransactionHash?: string;
  feeStroops?: number;
  errorMessage?: string;
}

/** Slim interface for the Stellar network client — injectable for tests. */
export interface StellarNetworkClient {
  /** Submit a fee-bump wrapper around an inner XDR and return tx hashes. */
  submitFeeBump(params: {
    sponsorAddress: string;
    innerTransactionXdr: string;
    maxFeeStroops: number;
    network: 'testnet' | 'mainnet';
  }): Promise<{ feeBumpHash: string; innerHash: string; feeStroops: number }>;
}

/** In-memory store interface for merchant configs and fee records. */
export interface FeeBumpStore {
  getMerchantConfig(merchantId: string): Promise<MerchantFeeBumpConfig | null>;
  saveMerchantConfig(config: MerchantFeeBumpConfig): Promise<void>;
  saveFeeBumpRecord(record: FeeBumpRecord): Promise<void>;
  getFeeBumpRecords(merchantId: string): Promise<FeeBumpRecord[]>;
}

// ── Default in-memory store ───────────────────────────────────────────────

export class InMemoryFeeBumpStore implements FeeBumpStore {
  private configs = new Map<string, MerchantFeeBumpConfig>();
  private records: FeeBumpRecord[] = [];

  async getMerchantConfig(merchantId: string): Promise<MerchantFeeBumpConfig | null> {
    return this.configs.get(merchantId) ?? null;
  }

  async saveMerchantConfig(config: MerchantFeeBumpConfig): Promise<void> {
    this.configs.set(config.merchantId, { ...config });
  }

  async saveFeeBumpRecord(record: FeeBumpRecord): Promise<void> {
    this.records.push({ ...record });
  }

  async getFeeBumpRecords(merchantId: string): Promise<FeeBumpRecord[]> {
    return this.records.filter(r => r.merchantId === merchantId);
  }
}

// ── Default Stellar client (testnet) ─────────────────────────────────────

/**
 * Stub Stellar client that simulates testnet submission.
 * Replace with a real stellar-sdk implementation for production.
 */
export class TestnetStellarClient implements StellarNetworkClient {
  async submitFeeBump(params: {
    sponsorAddress: string;
    innerTransactionXdr: string;
    maxFeeStroops: number;
    network: 'testnet' | 'mainnet';
  }): Promise<{ feeBumpHash: string; innerHash: string; feeStroops: number }> {
    // Derive a deterministic-ish hash from the XDR for testnet simulation.
    const innerHash = `inner_${Buffer.from(params.innerTransactionXdr).toString('hex').slice(0, 32)}`;
    const feeBumpHash = `feebump_${params.sponsorAddress.slice(0, 8)}_${Date.now()}`;
    return {
      feeBumpHash,
      innerHash,
      feeStroops: Math.min(params.maxFeeStroops, 100),
    };
  }
}

// ── FeeBumpService ────────────────────────────────────────────────────────

export class FeeBumpService {
  private readonly network: 'testnet' | 'mainnet';

  constructor(
    private readonly store: FeeBumpStore = new InMemoryFeeBumpStore(),
    private readonly stellarClient: StellarNetworkClient = new TestnetStellarClient(),
    network: 'testnet' | 'mainnet' = 'testnet',
  ) {
    this.network = network;
  }

  /**
   * Register or update a merchant's fee-bump configuration.
   * This is how a merchant opts in (or out) of sponsoring fees.
   */
  async configureMerchant(config: MerchantFeeBumpConfig): Promise<void> {
    if (!config.merchantId) throw new Error('merchantId is required');
    if (!config.sponsorAddress) throw new Error('sponsorAddress is required');
    if (config.maxFeeStroops < 0) throw new Error('maxFeeStroops must be non-negative');
    await this.store.saveMerchantConfig(config);
  }

  /**
   * Attempt to sponsor the fee for a subscriber's transaction.
   *
   * Returns a successful `FeeBumpResult` when the merchant has opted in and
   * the Stellar submission succeeds.  Returns an error result (no exception)
   * when the merchant has not opted in — the caller should fall back to a
   * regular (non-sponsored) transaction.
   */
  async sponsorTransaction(request: FeeBumpRequest): Promise<FeeBumpResult> {
    const config = await this.store.getMerchantConfig(request.merchantId);

    if (!config || !config.feeBumpEnabled) {
      return {
        success: false,
        errorMessage: `Merchant ${request.merchantId} has not enabled fee-bump sponsorship`,
      };
    }

    const maxFee = request.maxFeeStroops ?? config.maxFeeStroops;

    let submission: { feeBumpHash: string; innerHash: string; feeStroops: number };
    try {
      submission = await this.stellarClient.submitFeeBump({
        sponsorAddress: config.sponsorAddress,
        innerTransactionXdr: request.innerTransactionXdr,
        maxFeeStroops: maxFee,
        network: this.network,
      });
    } catch (err) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    // Record the sponsorship for accounting.
    const record: FeeBumpRecord = {
      id: randomUUID(),
      merchantId: request.merchantId,
      subscriberId: request.subscriberId,
      innerTransactionHash: submission.innerHash,
      feeBumpTransactionHash: submission.feeBumpHash,
      feeStroops: submission.feeStroops,
      sponsoredAt: new Date().toISOString(),
      network: this.network,
    };
    await this.store.saveFeeBumpRecord(record);

    return {
      success: true,
      feeBumpTransactionHash: submission.feeBumpHash,
      innerTransactionHash: submission.innerHash,
      feeStroops: submission.feeStroops,
    };
  }

  /** Retrieve all fee-bump records for a merchant (for accounting/reporting). */
  async getAccountingRecords(merchantId: string): Promise<FeeBumpRecord[]> {
    return this.store.getFeeBumpRecords(merchantId);
  }

  /** Get a merchant's current fee-bump configuration. */
  async getMerchantConfig(merchantId: string): Promise<MerchantFeeBumpConfig | null> {
    return this.store.getMerchantConfig(merchantId);
  }
}
