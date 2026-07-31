import { piiClassifier, type ClassificationLevel } from './piiClassifier';
import { AsyncLocalStorage } from 'node:async_hooks';
import { logStorage } from '../../elasticsearch/logStorage';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const correlationIdStorage = new AsyncLocalStorage<string>();

export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationIdStorage.run(correlationId, fn);
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Change this via env later (__DEV__ is an Expo/RN global; absent in plain Node)
const CURRENT_LEVEL: LogLevel =
  typeof (globalThis as { __DEV__?: boolean }).__DEV__ !== 'undefined' &&
  (globalThis as { __DEV__?: boolean }).__DEV__
    ? 'debug'
    : 'info';

// Correlation ID generator (simple version)
const generateId = () => {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

export interface LogContext {
  [key: string]: any;
  correlationId?: string;
}

// ─── PII redaction for structured log context ─────────────────────────────────

let _logRedactionLevel: ClassificationLevel = 'standard';

/** Set the classification level used for log PII redaction (default: standard). */
export function setLogRedactionLevel(level: ClassificationLevel): void {
  _logRedactionLevel = level;
}

function sanitizeContext(ctx: LogContext | undefined): LogContext | undefined {
  if (!ctx) return ctx;
  return piiClassifier.redact(ctx, { level: _logRedactionLevel }) as LogContext;
}

function shouldLog(level: LogLevel) {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[CURRENT_LEVEL];
}

function formatLog(level: LogLevel, message: string, context?: LogContext) {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };
}

function sendToConsole(logEntry: any) {
  console.log(JSON.stringify(logEntry));
}

async function sendToRemote(logEntry: any) {
  try {
    await logStorage.insertLog(logEntry);
  } catch (e) {
    console.error('Failed to forward log to logStorage', e);
  }
}

function log(level: LogLevel, message: string, context?: LogContext) {
  if (!shouldLog(level)) return;

  const currentCorrelationId = correlationIdStorage.getStore();
  const mergedContext = {
    correlationId: currentCorrelationId,
    ...context
  };

  const logEntry = formatLog(level, message, sanitizeContext(mergedContext));

  sendToConsole(logEntry);
  void sendToRemote(logEntry);
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),

  createCorrelationId: generateId,
  setRedactionLevel: setLogRedactionLevel,
};
