import { AsyncLocalStorage } from 'async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_LOG_LEVEL: LogLevel = 'info';
const DEFAULT_BUFFER_SIZE = 200;
const SERVICE_NAME = process.env.LOG_SERVICE_NAME || 'subtrackr-backend';
const REMOTE_LOG_ENDPOINT = process.env.LOG_REMOTE_ENDPOINT || '';
const GLOBAL_LOG_LEVEL = (process.env.BACKEND_LOG_LEVEL as LogLevel) || DEFAULT_LOG_LEVEL;
const BUFFER_SIZE = Number(process.env.LOG_BUFFER_SIZE || DEFAULT_BUFFER_SIZE);

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /ssn/i,
  /creditcard/i,
  /cardNumber/i,
  /email/i,
  /phone/i,
  /accountNumber/i,
  /routingNumber/i,
];

const asyncLocalStorage = new AsyncLocalStorage<LogContext>();
const inMemoryLogBuffer: LogEntry[] = [];

export interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
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

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

function parseModuleLevels(envValue: string): Record<string, LogLevel> {
  return envValue.split(',').reduce((acc, pair) => {
    const [module, level] = pair.split(':').map((part) => part.trim());
    if (module && level && ['debug', 'info', 'warn', 'error'].includes(level)) {
      acc[module] = level as LogLevel;
    }
    return acc;
  }, {} as Record<string, LogLevel>);
}

const MODULE_LOG_LEVELS = parseModuleLevels(process.env.BACKEND_LOG_LEVELS || '');

function getModuleLevel(moduleName: string): LogLevel {
  const exactMatch = MODULE_LOG_LEVELS[moduleName];
  if (exactMatch) return exactMatch;

  const partialMatch = Object.keys(MODULE_LOG_LEVELS).find((key) => moduleName.startsWith(`${key}:`));
  if (partialMatch) return MODULE_LOG_LEVELS[partialMatch];

  return GLOBAL_LOG_LEVEL;
}

function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key));
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    return isSensitiveField(key) ? '[REDACTED]' : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item));
  }

  if (value && typeof value === 'object') {
    return redactSensitiveFields(value as Record<string, unknown>);
  }

  return value;
}

function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    if (isSensitiveField(key)) {
      acc[key] = '[REDACTED]';
    } else if (Array.isArray(value)) {
      acc[key] = value.map((item) => (typeof item === 'object' ? redactSensitiveFields(item as Record<string, unknown>) : item));
    } else if (value && typeof value === 'object') {
      acc[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, unknown>);
}

function sanitizeMeta(meta?: LogMeta): LogMeta | undefined {
  if (!meta) return undefined;
  return redactSensitiveFields(meta as Record<string, unknown>);
}

function shouldLog(level: LogLevel, moduleName: string) {
  const moduleLevel = getModuleLevel(moduleName);
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[moduleLevel];
}

function formatLog(level: LogLevel, message: string, meta: LogMeta | undefined, moduleName: string, context: LogContext): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    module: moduleName,
    level,
    message,
    correlationId: context.correlationId,
    meta: meta && Object.keys(meta).length ? sanitizeMeta(meta) : undefined,
  };
}

function enqueueLog(entry: LogEntry) {
  inMemoryLogBuffer.push(entry);
  while (inMemoryLogBuffer.length > BUFFER_SIZE) {
    inMemoryLogBuffer.shift();
  }
}

function sendToConsole(entry: LogEntry) {
  console.log(JSON.stringify(entry));
}

async function sendToRemote(entry: LogEntry) {
  if (!REMOTE_LOG_ENDPOINT) return;

  try {
    await fetch(REMOTE_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'Failed to send log to remote endpoint',
      endpoint: REMOTE_LOG_ENDPOINT,
      error: String(error),
      correlationId: entry.correlationId,
    }));
  }
}

function getCurrentContext(): LogContext {
  return asyncLocalStorage.getStore() ?? {};
}

function buildLogEntry(level: LogLevel, message: string, meta: LogMeta | undefined, moduleName: string): LogEntry {
  const context = getCurrentContext();
  const correlationId = context.correlationId || generateId();

  return formatLog(level, message, meta, moduleName, {
    ...context,
    correlationId,
  });
}

function recordLog(entry: LogEntry) {
  enqueueLog(entry);
  sendToConsole(entry);
  if (entry.level === 'error') {
    void sendToRemote(entry);
  }
}

function log(level: LogLevel, message: string, meta: LogMeta | undefined, moduleName: string) {
  if (!shouldLog(level, moduleName)) return;

  const entry = buildLogEntry(level, message, meta, moduleName);
  recordLog(entry);
}

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  child(moduleName: string): Logger;
  withContext<T>(context: LogContext | string, fn: () => T): T;
  getCorrelationId(): string;
  createCorrelationId(): string;
}

function createLogger(moduleName: string): Logger {
  const logger = {
    debug: (message: string, meta?: LogMeta) => log('debug', message, meta, moduleName),
    info: (message: string, meta?: LogMeta) => log('info', message, meta, moduleName),
    warn: (message: string, meta?: LogMeta) => log('warn', message, meta, moduleName),
    error: (message: string, meta?: LogMeta) => log('error', message, meta, moduleName),
    child: (childModule: string) => createLogger(`${moduleName}:${childModule}`),
    withContext: <T>(context: LogContext | string, fn: () => T): T => {
      const store: LogContext = typeof context === 'string' ? { correlationId: context } : context;
      return asyncLocalStorage.run(store, fn);
    },
    getCorrelationId: (): string => getCurrentContext().correlationId || '',
    createCorrelationId: generateId,
  };

  return logger;
}

export function queryLogs(filter: {
  level?: LogLevel;
  module?: string;
  correlationId?: string;
  text?: string;
  from?: string;
  to?: string;
} = {}): LogEntry[] {
  return inMemoryLogBuffer.filter((entry) => {
    if (filter.level && entry.level !== filter.level) return false;
    if (filter.module && !entry.module.includes(filter.module)) return false;
    if (filter.correlationId && entry.correlationId !== filter.correlationId) return false;
    if (filter.text && !entry.message.includes(filter.text) && !(entry.meta && JSON.stringify(entry.meta).includes(filter.text))) return false;
    if (filter.from && entry.timestamp < filter.from) return false;
    if (filter.to && entry.timestamp > filter.to) return false;
    return true;
  });
}

export function clearLogBuffer(): void {
  inMemoryLogBuffer.length = 0;
}

export const logger = createLogger('backend');
export const createLoggerFor = createLogger;
export const runWithLogContext = <T>(context: LogContext | string, fn: () => T): T => {
  const store: LogContext = typeof context === 'string' ? { correlationId: context } : context;
  return asyncLocalStorage.run(store, fn);
};
