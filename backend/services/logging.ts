/**
 * backend/services/logging.ts
 *
 * Issue #910 — Structured logging with correlation IDs
 *
 * Top-level re-export so service files can import from the shorter path
 * `../services/logging` instead of the full shared path.
 *
 * All heavy logic lives in backend/services/shared/logging.ts.
 */

export {
  logger,
  createLoggerFor,
  runWithLogContext,
  withCorrelationId,
  correlationIdStorage,
  queryLogs,
  clearLogBuffer,
  setLogRedactionLevel,
} from './shared/logging';

export type { LogLevel, LogContext, LogMeta, LogEntry, Logger } from './shared/logging';
