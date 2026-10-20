/**
 * Merchant asset allowlist/denylist policy service.
 */

import { randomUUID } from 'crypto';

export type AssetPolicyChain = 'stellar' | 'evm' | 'fiat';

export type AssetPolicyMode = 'allow' | 'deny';

export interface AssetPolicyRule {
  id: string;
  merchantId: string;
  chain: AssetPolicyChain;
  assetCode: string;
  assetIssuer?: string;
  mode: AssetPolicyMode;
  createdAt: number;
}

export interface AssetPolicyRepository {
  listForMerchant(merchantId: string): Promise<AssetPolicyRule[]>;
  addRule(rule: AssetPolicyRule): Promise<AssetPolicyRule>;
  removeRule(ruleId: string): Promise<void>;
  clearForMerchant(merchantId: string): Promise<void>;
}

export class InMemoryAssetPolicyRepository implements AssetPolicyRepository {
  private rules = new Map<string, AssetPolicyRule>();

  async listForMerchant(merchantId: string): Promise<AssetPolicyRule[]> {
    const results: AssetPolicyRule[] = [];
    for (const rule of this.rules.values()) {
      if (rule.merchantId === merchantId) {
        results.push({ ...rule });
      }
    }
    return results;
  }

  async addRule(rule: AssetPolicyRule): Promise<AssetPolicyRule> {
    this.rules.set(rule.id, { ...rule });
    return { ...rule };
  }

  async removeRule(ruleId: string): Promise<void> {
    this.rules.delete(ruleId);
  }

  async clearForMerchant(merchantId: string): Promise<void> {
    for (const [id, rule] of Array.from(this.rules.entries())) {
      if (rule.merchantId === merchantId) {
        this.rules.delete(id);
      }
    }
  }
}

let defaultRepo: AssetPolicyRepository | null = null;

export function getDefaultAssetPolicyRepository(): AssetPolicyRepository {
  if (!defaultRepo) {
    defaultRepo = new InMemoryAssetPolicyRepository();
  }
  return defaultRepo;
}

export function setDefaultAssetPolicyRepository(repo: AssetPolicyRepository): void {
  defaultRepo = repo;
}

export class AssetNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetNotAllowedError';
  }
}

export interface AssetCheckInput {
  merchantId: string;
  chain: AssetPolicyChain;
  asset: string;
  issuer?: string;
}

export class AssetPolicyService {
  constructor(private repo: AssetPolicyRepository = getDefaultAssetPolicyRepository()) {}

  async assertAllowed(input: AssetCheckInput): Promise<void> {
    const allowed = await this.isAllowed(input);
    if (!allowed) {
      throw new AssetNotAllowedError(
        `Asset ${input.asset}${input.issuer ? `:${input.issuer}` : ''} not allowed for merchant ${input.merchantId}`
      );
    }
  }

  async isAllowed(input: AssetCheckInput): Promise<boolean> {
    const rules = await this.repo.listForMerchant(input.merchantId);
    if (rules.length === 0) {
      return true;
    }

    const assetUpper = input.asset.toUpperCase();
    const issuerUpper = input.issuer ? input.issuer.toUpperCase() : undefined;

    for (const rule of rules) {
      if (rule.chain !== input.chain) {
        continue;
      }
      if (rule.assetCode.toUpperCase() !== assetUpper) {
        continue;
      }
      if (issuerUpper) {
        if (!rule.assetIssuer) {
          continue;
        }
        if (rule.assetIssuer.toUpperCase() !== issuerUpper) {
          continue;
        }
      } else {
        if (rule.assetIssuer) {
          continue;
        }
      }
      if (rule.mode === 'deny') {
        return false;
      }
      if (rule.mode === 'allow') {
        return true;
      }
    }

    // If allowlist exists but no matching allow rule found, deny
    const hasAllow = rules.some((r) => r.mode === 'allow');
    if (hasAllow) {
      return false;
    }
    return true;
  }

  async setPolicy(merchantId: string, rules: Omit<AssetPolicyRule, 'id' | 'createdAt'>[]): Promise<AssetPolicyRule[]> {
    await this.repo.clearForMerchant(merchantId);
    const results: AssetPolicyRule[] = [];
    const now = Date.now();
    for (const rule of rules) {
      const created = await this.repo.addRule({
        ...rule,
        id: randomUUID(),
        createdAt: now,
      } as AssetPolicyRule);
      results.push(created);
    }
    return results;
  }

  async getPolicy(merchantId: string): Promise<AssetPolicyRule[]> {
    return this.repo.listForMerchant(merchantId);
  }
}

export const assetPolicyService = new AssetPolicyService();
export const defaultAssetPolicyService = assetPolicyService;
