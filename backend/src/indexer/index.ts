/** Public API for the checkpointed Soroban event indexer (Issue #2086). */

export { SorobanEventScanner, EventScannerError, createSorobanEventScanner } from './eventScanner';
export {
  compareCursors,
  cursorLedger,
  decodeCursor,
  encodeCursor,
  isValidCursor,
} from './cursor';
export type { DecodedCursor } from './cursor';
export type {
  BatchResult,
  CheckpointStore,
  EventScanPage,
  EventScannerConfig,
  EventScannerErrorCode,
  IndexerCheckpoint,
  IndexerLogger,
  IndexerMetrics,
  ScanEvents,
  SorobanEvent,
} from './types';
