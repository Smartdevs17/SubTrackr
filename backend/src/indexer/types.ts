/**
 * Types for the checkpointed Soroban event indexer (Issue #2086).
 *
 * The indexer is deliberately transport-agnostic: callers inject a `scanEvents`
 * function (normally a thin wrapper around Soroban RPC `getEvents`) and an
 * `onEvents` sink. That keeps the batching / checkpoint state machine unit
 * testable without a live Stellar node.
 */

/** A single Soroban event returned by an RPC scan. */
export interface SorobanEvent {
  /** Stable, globally unique event id (normally tx hash + event sequence). */
  id: string;
  /** Ledger sequence the event was emitted in. */
  ledger: number;
  /** Opaque paging token attached to this event by the RPC node. */
  cursor: string;
  /** Emitting contract id, when the event came from a contract. */
  contractId?: string;
  /** Event type / topic name. */
  type: string;
  /** Decoded event payload. */
  value?: unknown;
}

/** One page of results from a Soroban event scan. */
export interface EventScanPage {
  events: SorobanEvent[];
  /** Cursor for the next page; `null` means the scan reached the chain tip. */
  nextCursor: string | null;
  /** Latest ledger known by the RPC node at scan time. */
  latestLedger: number;
}

/** Injected Soroban RPC adapter. */
export type ScanEvents = (cursor: string | null, limit: number) => Promise<EventScanPage>;

/** Durable position of the last fully processed batch. */
export interface IndexerCheckpoint {
  /** Opaque cursor of the last event that was persisted by `onEvents`. */
  cursor: string;
  /** Ledger of the last persisted event. */
  ledger: number;
  /** ISO timestamp of the checkpoint write. */
  savedAt: string;
}

/** Storage for the indexer checkpoint (Postgres, Redis, or a file). */
export interface CheckpointStore {
  load(): Promise<IndexerCheckpoint | null>;
  save(checkpoint: IndexerCheckpoint): Promise<void>;
}

/** Point-in-time counters exported for Prometheus / health endpoints. */
export interface IndexerMetrics {
  batchesTotal: number;
  batchesFailed: number;
  eventsTotal: number;
  retriesTotal: number;
  deduplicatedEvents: number;
  lastBatchAt: string | null;
  /** Chain tip minus last checkpointed ledger. */
  lagLedgers: number;
  isRunning: boolean;
}

/** Minimal structured logger contract so callers can inject their own. */
export interface IndexerLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Result of a single batch attempt. */
export interface BatchResult {
  processed: number;
  cursor: string;
  checkpoint: IndexerCheckpoint | null;
  latestLedger: number;
  reachedTip: boolean;
}

export interface EventScannerConfig {
  /** Soroban RPC adapter. */
  scanEvents: ScanEvents;
  /** Idempotent sink; called before the checkpoint is persisted. */
  onEvents: (events: SorobanEvent[], checkpoint: IndexerCheckpoint) => Promise<void>;
  /** Optional durable checkpoint store. Defaults to in-memory only. */
  checkpointStore?: CheckpointStore;
  /** Cursor to resume from when no stored checkpoint exists. */
  startCursor?: string | null;
  /** Maximum events requested per RPC call. Default: 200. */
  batchSize?: number;
  /** Attempts per batch before surfacing an error. Default: 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff between attempts. Default: 100 ms. */
  retryDelayMs?: number;
  /** Number of event ids kept for de-duplication across overlapping pages. Default: 2000. */
  dedupeWindow?: number;
  logger?: IndexerLogger;
  /** Called after every batch (successful or failed) with a metrics snapshot. */
  onMetrics?: (metrics: IndexerMetrics) => void;
}

/** Error codes surfaced by the scanner. */
export type EventScannerErrorCode =
  | 'SCAN_FAILED'
  | 'PERSIST_FAILED'
  | 'CHECKPOINT_FAILED'
  | 'CLOSED';
