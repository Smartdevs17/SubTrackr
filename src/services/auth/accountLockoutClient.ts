import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_PREFIX = '@subtrackr_account_lockout_';

export interface LockoutTier {
  threshold: number;
  lockoutMinutes: number;
}

export interface LockoutStatus {
  locked: boolean;
  remainingMs: number;
  failedAttempts: number;
}

export interface AccountLockoutClientConfig {
  tiers: LockoutTier[];
}

const DEFAULT_CONFIG: AccountLockoutClientConfig = {
  tiers: [
    { threshold: 3, lockoutMinutes: 5 },
    { threshold: 6, lockoutMinutes: 15 },
    { threshold: 9, lockoutMinutes: 60 },
  ],
};

interface StoredLockoutData {
  failedAttempts: number;
  lockoutUntil: number;
  lastUpdated: number;
}

export class AccountLockoutClient {
  private readonly config: AccountLockoutClientConfig;

  constructor(config: Partial<AccountLockoutClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.config.tiers = [...this.config.tiers].sort((a, b) => b.threshold - a.threshold);
  }

  private getStorageKey(identifier: string): string {
    return `${STORAGE_KEY_PREFIX}${identifier}`;
  }

  private async getStoredData(identifier: string): Promise<StoredLockoutData> {
    const raw = await AsyncStorage.getItem(this.getStorageKey(identifier));
    if (!raw) {
      return { failedAttempts: 0, lockoutUntil: 0, lastUpdated: Date.now() };
    }
    try {
      return JSON.parse(raw) as StoredLockoutData;
    } catch {
      return { failedAttempts: 0, lockoutUntil: 0, lastUpdated: Date.now() };
    }
  }

  private async saveStoredData(identifier: string, data: StoredLockoutData): Promise<void> {
    await AsyncStorage.setItem(this.getStorageKey(identifier), JSON.stringify(data));
  }

  /**
   * Checks if the account identifier is currently locked out on this device.
   */
  async checkLockout(identifier: string): Promise<LockoutStatus> {
    const data = await this.getStoredData(identifier);
    const now = Date.now();

    if (data.lockoutUntil > now) {
      return {
        locked: true,
        remainingMs: data.lockoutUntil - now,
        failedAttempts: data.failedAttempts,
      };
    }

    return {
      locked: false,
      remainingMs: 0,
      failedAttempts: data.failedAttempts,
    };
  }

  /**
   * Records a failed authentication attempt locally to update lockout status.
   */
  async recordFailure(identifier: string): Promise<LockoutStatus> {
    const now = Date.now();
    const data = await this.getStoredData(identifier);

    if (data.lockoutUntil > now) {
      return {
        locked: true,
        remainingMs: data.lockoutUntil - now,
        failedAttempts: data.failedAttempts,
      };
    }

    data.failedAttempts += 1;
    data.lastUpdated = now;

    let applyLockoutMinutes = 0;
    for (const tier of this.config.tiers) {
      if (data.failedAttempts >= tier.threshold) {
        applyLockoutMinutes = tier.lockoutMinutes;
        break;
      }
    }

    if (applyLockoutMinutes > 0) {
      data.lockoutUntil = now + applyLockoutMinutes * 60 * 1000;
    }

    await this.saveStoredData(identifier, data);

    const locked = applyLockoutMinutes > 0;
    return {
      locked,
      remainingMs: locked ? applyLockoutMinutes * 60 * 1000 : 0,
      failedAttempts: data.failedAttempts,
    };
  }

  /**
   * Resets local lockout tracking on successful login.
   */
  async resetFailures(identifier: string): Promise<void> {
    await AsyncStorage.removeItem(this.getStorageKey(identifier));
  }
}

export const accountLockoutClient = new AccountLockoutClient();
