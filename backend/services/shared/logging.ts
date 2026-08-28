/**
 * backend/services/shared/logging.ts
 *
 * Issue #910 — Implement structured logging with correlation IDs
 *
 * Production-grade structured logger for SubTrackr backend.
 *
 * Features:
 *  - JSON-structured log output (compatible with log aggregators)
 *  - Correlation ID propagation via AsyncLocalStorage (survives async boundaries)
 *  - Module-scoped child loggers (logger.child('payments'))
 *  - Per-module log-level overrides via BACKEND_LOG_LEVELS env var
 *  - Sensitive field redaction via PiiClassifier
 *  - In-memory ring-buffer for test assertion and dashboard queries
 *  - Remote log forwarding (Elasticsearch via logStorage) for errors
 *  - runWithLogContext() for request-scoped correlation ID injection
 */

import { piiClassifier, type ClassificationLevel } from './piiClassifier';
import { AsyncLocalStorage } from 'node:async_hooks';
import { logStorage } from '../../elasticsearch/logStorage';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
  correlationId?: string;
}

export interface LogMeta {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  service: string;
  module: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  meta?: LogMeta;
}

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  /** Create a child logger with an extended module name. */
  child(moduleName: string): Logger;
  /** Run fn inside an async context that carries the given correlationId. */
  withContext<T>(context: LogContext | string, fn: () => T): T;
  /** Return the correlationId active in the current async context (or ''). */
  getCorrelationId(): string;
  /** Generate a new random correlation ID. */
  createCorrelationId(): string;
  /** Set the PII redaction level for this logger. */
  setRedactionLevel(level: ClassificationLevel): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration (environment-driven)
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_NAME = process.env.LOG_SERVICE_NAME ?? 'subtrackr-backend';
const REMOTE_LOG_ENDPOINT = process.env.LOG_REMOTE_ENDPOINT ?? '';
const DEFAULT_LOG_LEVEL: LogLevel =
  (process.env.BACKEND_LOG_LEVEL as LogLevel | undefined) ??
  (typeof (globalThis as { __DEV__?: boolean }).__DEV__ !== 'undefined' &&
  (globalThis as { __DEV__?: boolean }).__DEV__
    ? 'debug'
    : 'info');

const BUFFER_SIZE = Number(process.env.LOG_BUFFER_SIZE ?? 200);

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-module level overrides
// Format: BACKEND_LOG_LEVELS=payments:debug,auth:warn
// ─────────────────────────────────────────────────────────────────────────────

function parseModuleLevels(envValue: string): Record<string, LogLevel> {
  return envValue.split(',').reduce(
    (acc, pair) => {
      const [mod, level] = pair.split(':').map((p) => p.trim());
      if (mod && level && ['debug', 'info', 'warn', 'error'].includes(level)) {
        acc[mod] = level as LogLevel;
      }
      return acc;
    },
    {} as Record<string, LogLevel>,
  );
}

const MODULE_LOG_LEVELS = parseModuleLevels(process.env.BACKEND_LOG_LEVELS ?? '');

function getModuleLevel(moduleName: string): LogLevel {
  const exact = MODULE_LOG_LEVELS[moduleName];
  if (exact) return exact;
  const prefix = Object.keys(MODULE_LOG_LEVELS).find((k) => moduleName.startsWith(`${k}:`));
  return prefix ? MODULE_LOG_LEVELS[prefix] : DEFAULT_LOG_LEVEL;
}

function shouldLog(level: LogLevel, moduleName: string): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getModuleLevel(moduleName)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Correlation ID — stored in AsyncLocalStorage so it flows across awaits
// ─────────────────────────────────────────────────────────────────────────────

export const correlationIdStorage = new AsyncLocalStorage<string>();

export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationIdStorage.run(correlationId, fn);
}

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

// ─────────────────────────────────────────────────────────────────────────────
// PII redaction
// ─────────────────────────────────────────────────────────────────────────────

let _globalRedactionLevel: ClassificationLevel = 'standard';

export function setLogRedactionLevel(level: ClassificationLevel): void {
  _globalRedactionLevel = level;
}

function sanitizeMeta(meta: LogMeta | undefined, level: ClassificationLevel): LogMeta | undefined {
  if (!meta) return undefined;
  return piiClassifier.redact(meta as Record<string, unknown>, { level }) as LogMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory ring buffer (for tests + dashboard queries)
// ─────────────────────────────────────────────────────────────────────────────

const inMemoryLogBuffer: LogEntry[] = [];

function enqueue(entry: LogEntry): void {
  inMemoryLogBuffer.push(entry);
  while (inMemoryLogBuffer.length > BUFFER_SIZE) {
    inMemoryLogBuffer.shift();
  }
}

/** Query the in-memory log buffer. Useful in tests and the log dashboard. */
export function queryLogs(
  filter: {
    level?: LogLevel;
    module?: string;
    correlationId?: string;
    text?: string;
    from?: string;
    to?: string;
  } = {},
): LogEntry[] {
  return inMemoryLogBuffer.filter((entry) => {
    if (filter.level && entry.level !== filter.level) return false;
    if (filter.module && !entry.module.includes(filter.module)) return false;
    if (filter.correlationId && entry.correlationId !== filter.correlationId) return false;
    if (
      filter.text &&
      !entry.message.includes(filter.text) &&
      !(entry.meta && JSON.stringify(entry.meta).includes(filter.text))
    )
      return false;
    if (filter.from && entry.timestamp < filter.from) return false;
    if (filter.to && entry.timestamp > filter.to) return false;
    return true;
  });
}

/** Clear the in-memory buffer — useful in beforeEach test hooks. */
export function clearLogBuffer(): void {
  inMemoryLogBuffer.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output sinks
// ─────────────────────────────────────────────────────────────────────────────

function sendToConsole(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

async function sendToRemote(entry: LogEntry): Promise<void> {
  // Forward errors to Elasticsearch logStorage if configured
  try {
    await logStorage.insertLog(entry);
  } catch (e) {
    // Don't throw — logging must never crash the application
    console.error('Failed to forward log to logStorage', e);
  }

  // Optional HTTP sink for critical alerts
  if (!REMOTE_LOG_ENDPOINT) return;
  try {
    await fetch(REMOTE_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch {
    // Silently swallow — remote logging is best-effort
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core log function
// ─────────────────────────────────────────────────────────────────────────────

function logRecord(
  level: LogLevel,
  message: string,
  meta: LogMeta | undefined,
  moduleName: string,
  redactionLevel: ClassificationLevel,
): void {
  if (!shouldLog(level, moduleName)) return;

  const correlationId = correlationIdStorage.getStore() ?? undefined;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    module: moduleName,
    level,
    message,
    correlationId,
    meta: sanitizeMeta(meta, redactionLevel),
  };

  // Strip undefined keys for clean JSON
  if (entry.correlationId === undefined) delete entry.correlationId;
  if (entry.meta === undefined) delete entry.meta;

  enqueue(entry);
  sendToConsole(entry);

  // Forward errors (and remote-endpoint-configured logs) asynchronously
  if (level === 'error' || REMOTE_LOG_ENDPOINT) {
    void sendToRemote(entry);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger factory
// ─────────────────────────────────────────────────────────────────────────────

function createLogger(moduleName: string, redactionLevel: ClassificationLevel = _globalRedactionLevel): Logger {
  let _redactionLevel = redactionLevel;

  const instance: Logger = {
    debug: (message, meta) => logRecord('debug', message, meta, moduleName, _redactionLevel),
    info: (message, meta) => logRecord('info', message, meta, moduleName, _redactionLevel),
    warn: (message, meta) => logRecord('warn', message, meta, moduleName, _redactionLevel),
    error: (message, meta) => logRecord('error', message, meta, moduleName, _redactionLevel),

    child: (childModule) => createLogger(`${moduleName}:${childModule}`, _redactionLevel),

    withContext: <T>(context: LogContext | string, fn: () => T): T => {
      const correlationId =
        typeof context === 'string' ? context : (context.correlationId ?? generateId());
      return correlationIdStorage.run(correlationId, fn);
    },

    getCorrelationId: () => correlationIdStorage.getStore() ?? '',

    createCorrelationId: generateId,

    setRedactionLevel: (level) => {
      _redactionLevel = level;
    },
  };

  return instance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Root logger — use `.child('module')` to get module-scoped loggers. */
export const logger = createLogger('backend');

/** Create a named logger for a specific module. */
export const createLoggerFor = (moduleName: string): Logger => createLogger(moduleName);

/**
 * Run `fn` in an async context that carries the given correlation ID (or full
 * LogContext). All logger calls inside fn (and any awaited code) will
 * automatically attach this correlation ID.
 *
 * @example
 *   app.use((req, res, next) => {
 *     runWithLogContext(req.headers['x-correlation-id'] || generateId(), next);
 *   });
 */
export const runWithLogContext = <T>(context: LogContext | string, fn: () => T): T => {
  const correlationId =
    typeof context === 'string' ? context : (context.correlationId ?? generateId());
  return correlationIdStorage.run(correlationId, fn);
};
