/**
 * Password credentials — the fallback sign-in method next to passkeys (#1778).
 *
 * Passkeys (#1272) are the primary sign-in method, but a user whose device
 * has no platform authenticator, who cancelled the WebAuthn prompt, or who
 * lost their passkey still needs a way in. This service stores one password
 * hash per user and verifies it:
 *
 *   - Hashes use the repo's Argon2id-style KDF (`argon2Kdf.ts`); only the
 *     encoded hash is stored and comparison is constant-time.
 *   - Unknown users are verified against a dummy hash so the response time
 *     does not reveal whether an account has a password.
 *   - Repeated failures lock the account temporarily.
 *   - Changing an existing password requires the current one.
 */

import { AuthError } from '../errors';
import { hashPassword, verifyPassword, type Argon2Params } from './argon2Kdf';

export interface PasswordPolicyConfig {
  minLength: number;
  /** Upper bound keeps a single request from burning seconds of KDF time. */
  maxLength: number;
  maxFailedAttempts: number;
  /** Failures older than this no longer count towards the lockout. */
  failureWindowMs: number;
  lockoutMs: number;
  /**
   * KDF cost. `ARGON2_INTERACTIVE` maps to ~4 GiB of scrypt memory with the
   * parameter mapping used by `argon2Kdf.ts`, so this default (≈64 MiB,
   * ~200 ms on a laptop) is chosen explicitly.
   */
  kdfParams: Argon2Params;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig = {
  minLength: 12,
  maxLength: 256,
  maxFailedAttempts: 5,
  failureWindowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
  kdfParams: { memoryCost: 1024, timeCost: 1, parallelism: 4, keyLen: 32 },
};

interface StoredPassword {
  encoded: string;
  updatedAt: number;
}

interface FailureState {
  count: number;
  firstFailureAt: number;
  lockedUntil: number;
}

export class PasswordCredentialService {
  private readonly config: PasswordPolicyConfig;
  private readonly now: () => number;
  private passwords = new Map<string, StoredPassword>(); // userId → hash
  private failures = new Map<string, FailureState>(); // userId → failures
  private dummyHash: string | null = null;

  constructor(config: Partial<PasswordPolicyConfig> = {}, now: () => number = Date.now) {
    this.config = { ...DEFAULT_PASSWORD_POLICY, ...config };
    this.now = now;
  }

  hasPassword(userId: string): boolean {
    return this.passwords.has(userId);
  }

  /**
   * Set or change a user's password. When one is already set the caller must
   * supply the current password as well (a stolen session alone cannot
   * replace it).
   */
  setPassword(userId: string, newPassword: unknown, currentPassword?: unknown): void {
    if (!userId) throw AuthError.passwordPolicyViolation('userId is required');
    this.assertPolicy(newPassword);

    const existing = this.passwords.get(userId);
    if (existing) {
      if (typeof currentPassword !== 'string' || !this.verify(userId, currentPassword)) {
        throw AuthError.invalidCredentials();
      }
    }

    this.passwords.set(userId, {
      encoded: hashPassword(newPassword, this.config.kdfParams).encoded,
      updatedAt: this.now(),
    });
  }

  /**
   * Check a password. Throws `AUTH_ACCOUNT_LOCKED` while locked out and
   * `AUTH_INVALID_CREDENTIALS` for an unknown user or a wrong password — the
   * two are indistinguishable to the caller.
   */
  authenticate(userId: unknown, password: unknown): void {
    if (typeof userId !== 'string' || !userId || typeof password !== 'string' || !password) {
      throw AuthError.invalidCredentials();
    }
    if (password.length > this.config.maxLength) throw AuthError.invalidCredentials();

    const now = this.now();
    const state = this.failures.get(userId);
    if (state && state.lockedUntil > now) {
      throw AuthError.accountLocked(state.lockedUntil - now);
    }

    if (!this.verify(userId, password)) {
      this.recordFailure(userId, now);
      const after = this.failures.get(userId);
      if (after && after.lockedUntil > now) throw AuthError.accountLocked(after.lockedUntil - now);
      throw AuthError.invalidCredentials();
    }

    this.failures.delete(userId);
  }

  private verify(userId: string, password: string): boolean {
    const stored = this.passwords.get(userId);
    if (!stored) {
      // Burn the same KDF cost so timing does not reveal unknown accounts.
      verifyPassword(password, this.getDummyHash());
      return false;
    }
    return verifyPassword(password, stored.encoded);
  }

  private recordFailure(userId: string, now: number): void {
    let state = this.failures.get(userId);
    if (!state || now - state.firstFailureAt > this.config.failureWindowMs) {
      state = { count: 0, firstFailureAt: now, lockedUntil: 0 };
    }
    state.count += 1;
    if (state.count >= this.config.maxFailedAttempts) {
      state.lockedUntil = now + this.config.lockoutMs;
      state.count = 0;
      state.firstFailureAt = now;
    }
    this.failures.set(userId, state);
  }

  private assertPolicy(password: unknown): asserts password is string {
    if (typeof password !== 'string')
      throw AuthError.passwordPolicyViolation('password must be a string');
    if (password.length < this.config.minLength) {
      throw AuthError.passwordPolicyViolation(
        `must be at least ${this.config.minLength} characters`
      );
    }
    if (password.length > this.config.maxLength) {
      throw AuthError.passwordPolicyViolation(
        `must be at most ${this.config.maxLength} characters`
      );
    }
  }

  private getDummyHash(): string {
    if (!this.dummyHash) {
      this.dummyHash = hashPassword('subtrackr-dummy-password', this.config.kdfParams).encoded;
    }
    return this.dummyHash;
  }
}

export const passwordCredentialService = new PasswordCredentialService();
