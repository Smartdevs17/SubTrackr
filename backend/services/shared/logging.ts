import { piiClassifier, type ClassificationLevel } from './piiClassifier';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
  console.log(JSON.stringify(logEntry, null, 2));
}

//  future: plug Sentry / API here
async function sendToRemote(_logEntry: any) {
  // Example:
  // await fetch("https://your-api/logs", { method: "POST", body: JSON.stringify(logEntry) });
}

function log(level: LogLevel, message: string, context?: LogContext) {
  if (!shouldLog(level)) return;

  const logEntry = formatLog(level, message, sanitizeContext(context));

  sendToConsole(logEntry);

  if (level === 'error') {
    sendToRemote(logEntry);
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),

  createCorrelationId: generateId,
  setRedactionLevel: setLogRedactionLevel,
};
