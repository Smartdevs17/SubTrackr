export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_LOG_LEVEL: LogLevel = 'info';
const GLOBAL_LOG_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || DEFAULT_LOG_LEVEL;

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /ssn/i,
  /creditcard/i,
  /cardnumber/i,
  /email/i,
  /phone/i,
  /accountnumber/i,
  /routingnumber/i,
];

export interface LogMeta {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  module: string;
  correlationId?: string;
  meta?: LogMeta;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key));
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [key, item]) => {
        acc[key] = isSensitiveField(key)
          ? '[REDACTED]'
          : redactSensitiveFields(item);
        return acc;
      },
      {} as Record<string, unknown>
    );
  }

  return value;
}

function sanitizeMeta(meta?: LogMeta): LogMeta | undefined {
  if (!meta) return undefined;
  return redactSensitiveFields(meta as Record<string, unknown>) as LogMeta;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[GLOBAL_LOG_LEVEL];
}

function buildLogEntry(
  level: LogLevel,
  message: string,
  module: string,
  meta?: LogMeta,
  correlationId?: string
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    module,
    correlationId,
    meta: meta && Object.keys(meta).length ? sanitizeMeta(meta) : undefined,
  };
}

function sendToConsole(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

function createLogger(moduleName: string) {
  const log = (level: LogLevel, message: string, meta?: LogMeta, correlationId?: string) => {
    if (!shouldLog(level)) return;
    const entry = buildLogEntry(level, message, moduleName, meta, correlationId);
    sendToConsole(entry);
  };

  return {
    debug: (message: string, meta?: LogMeta, correlationId?: string) =>
      log('debug', message, meta, correlationId),
    info: (message: string, meta?: LogMeta, correlationId?: string) =>
      log('info', message, meta, correlationId),
    warn: (message: string, meta?: LogMeta, correlationId?: string) =>
      log('warn', message, meta, correlationId),
    error: (message: string, meta?: LogMeta, correlationId?: string) =>
      log('error', message, meta, correlationId),
    child: (childModule: string) => createLogger(`${moduleName}:${childModule}`),
    createCorrelationId: generateId,
  };
}

export const logger = createLogger('app');
