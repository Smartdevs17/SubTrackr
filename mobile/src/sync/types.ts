/**
 * Types for offline-first subscription edits (Issue #1987).
 *
 * Edits are written to a persisted outbox together with the server version
 * they were made against (`baseVersion`). The server is authoritative: it
 * applies a write only when its current version equals `baseVersion`. Any
 * other outcome is a version conflict, and the local edit is held for a user
 * decision instead of being silently overwritten. See README.md for the policy.
 */

import type { SubscriptionListItem } from '../queries/subscriptions';

export type SyncedSubscriptionPatch = Partial<Omit<SubscriptionListItem, 'id'>>;

/** Authoritative server state of one subscription, with its version. */
export interface RemoteSubscriptionRecord {
  id: string;
  version: number;
  item: SubscriptionListItem;
}

/** A queued local edit waiting to be pushed. */
export interface PendingUpdate {
  mutationId: string;
  id: string;
  /** Server version the local edits were made against. */
  baseVersion: number;
  patch: SyncedSubscriptionPatch;
  enqueuedAt: number;
  /** Transient failed push attempts so far. */
  attempts: number;
}

export type HeldReason = 'version_conflict' | 'rejected';

/** An edit that will not be pushed until the user resolves it. */
export interface HeldUpdate {
  heldId: string;
  reason: HeldReason;
  id: string;
  baseVersion: number;
  patch: SyncedSubscriptionPatch;
  /** Set for `version_conflict`: the server state that won. */
  remote?: RemoteSubscriptionRecord;
  /** Set for `rejected`: a short description of the failure. */
  message?: string;
  heldAt: number;
}

export type PushResult =
  | { status: 'applied'; version: number }
  | { status: 'conflict'; remote: RemoteSubscriptionRecord };

/**
 * Pushes one queued edit. Implementations must send `baseVersion` to the
 * server and return `conflict` (not throw) when the server version differs.
 * Throw for transport and HTTP failures; `isRetryableQueryError` decides retry.
 */
export interface SyncTransport {
  pushUpdate(update: PendingUpdate, signal: AbortSignal): Promise<PushResult>;
}

/**
 * Minimal async key/value contract. The app's `asyncStorageAdapter` is
 * structurally compatible, but it swallows errors and returns null on read
 * failure. Use a storage that throws so an unreadable outbox is never treated
 * as empty.
 */
export interface SyncStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type SyncEventType =
  | 'enqueued'
  | 'push_start'
  | 'push_success'
  | 'push_conflict'
  | 'push_error'
  | 'held'
  | 'held_resolved';

/** Telemetry carries identifiers and counts only, never patch values. */
export interface SyncEvent {
  type: SyncEventType;
  at: number;
  id?: string;
  mutationId?: string;
  heldId?: string;
  version?: number;
  attempts?: number;
  durationMs?: number;
  retryable?: boolean;
  reason?: string;
}

export interface SyncTelemetry {
  emit(event: SyncEvent): void;
}

export interface SyncLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export type SyncState = 'idle' | 'pending' | 'syncing' | 'conflict' | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  held: number;
  lastError?: string;
}
