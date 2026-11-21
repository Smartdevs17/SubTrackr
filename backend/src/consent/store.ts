/**
 * backend/src/consent/store.ts
 *
 * Persistence interface and thread-safe in-memory store for consent records.
 */

import type { ConsentRecord, UserConsentState } from './types';

export interface ConsentRepository {
  saveRecord(record: ConsentRecord): Promise<void>;
  saveState(state: UserConsentState): Promise<void>;
  getState(userId: string): Promise<UserConsentState | null>;
  getHistory(userId: string, limit?: number): Promise<ConsentRecord[]>;
  deleteUserData(userId: string): Promise<void>;
}

export class InMemoryConsentRepository implements ConsentRepository {
  private states = new Map<string, UserConsentState>();
  private records = new Map<string, ConsentRecord[]>();

  async saveRecord(record: ConsentRecord): Promise<void> {
    const list = this.records.get(record.userId) ?? [];
    list.push({ ...record });
    this.records.set(record.userId, list);
  }

  async saveState(state: UserConsentState): Promise<void> {
    this.states.set(state.userId, {
      ...state,
      preferences: { ...state.preferences },
    });
  }

  async getState(userId: string): Promise<UserConsentState | null> {
    const state = this.states.get(userId);
    if (!state) return null;
    return {
      ...state,
      preferences: { ...state.preferences },
    };
  }

  async getHistory(userId: string, limit = 50): Promise<ConsentRecord[]> {
    const list = this.records.get(userId) ?? [];
    // Return newest first, capped to limit
    return [...list]
      .reverse()
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async deleteUserData(userId: string): Promise<void> {
    this.states.delete(userId);
    this.records.delete(userId);
  }

  clear(): void {
    this.states.clear();
    this.records.clear();
  }
}
