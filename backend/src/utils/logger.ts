/**
 * backend/src/utils/logger.ts
 *
 * PII-redacting structured logger for SubTrackr backend and workers.
 *
 * Wraps the shared logger with an explicit PII-scrubbing pass on every
 * metadata object before it reaches the output sinks.  Sensitive fields
 * (email, password, token, card numbers, SSNs, …) are replaced with
 * "[REDACTED]" so they never appear in log aggregators or worker stdout.
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('User registered', { userId, plan });   // safe — PII stripped
 */

import { createLoggerFor, setLogRedactionLevel } from '../../services/shared/logging';
import type { Logger, LogMeta } from '../../services/shared/logging';

// ── PII field patterns ────────────────────────────────────────────────────────

/**
 * Field names (exact, case-insensitive) whose values must always be redacted.
 * Add new names here when new PII-carrying fields are introduced.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'passwordconfirm',
  'confirmpassword',
  'newpassword',
  'oldpassword',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'email',
  'phone',
  'phonenumber',
  'ssn',
  'socialsecuritynumber',
  'creditcard',
  'cardnumber',
  'cvv',
  'cvc',
  'pan',
  'iban',
  'bankaccount',
  'routingnumber',
  'dateofbirth',
  'dob',
  'address',
  'streetaddress',
  'postalcode',
  'zipcode',
  'ipaddress',
  'ip',
  'passportid',
  'nationalid',
  'drivinglicense',
  'taxid',
  'ein',
  'privatekey',
  'private_key',
  'webhooksecret',
  'webhook_secret',
  'client_secret',
  'clientsecret',
]);

/**
 * Patterns that match PII-like values regardless of field name.
 * Applied as a last-resort scan on string values.
 */
const VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/, // email
  /\b(?:\d[ -]?){13,16}\b/,                                  // payment card
  /\b\d{3}-\d{2}-\d{4}\b/,                                   // US SSN
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,                         // Bearer token
];

// ── Redaction logic ───────────────────────────────────────────────────────────

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_\-\s]/g, ''));
}

function containsPiiValue(value: string): boolean {
  return VALUE_PATTERNS.some((re) => re.test(value));
}

function redactObject(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 5) return { '[truncated]': true };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
      continue;
    }
    if (typeof value === 'string') {
      result[key] = containsPiiValue(value) ? '[REDACTED]' : value;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>, depth + 1);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? redactObject(item as Record<string, unknown>, depth + 1)
          : typeof item === 'string' && containsPiiValue(item)
            ? '[REDACTED]'
            : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function redactMeta(meta: LogMeta | undefined): LogMeta | undefined {
  if (!meta) return undefined;
  return redactObject(meta as Record<string, unknown>) as LogMeta;
}

// ── Wrapped logger factory ────────────────────────────────────────────────────

function wrapLogger(inner: Logger): Logger {
  const wrap =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, meta?: LogMeta): void =>
      inner[level](message, redactMeta(meta));

  return {
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    child: (moduleName) => wrapLogger(inner.child(moduleName)),
    withContext: (ctx, fn) => inner.withContext(ctx, fn),
    getCorrelationId: () => inner.getCorrelationId(),
    createCorrelationId: () => inner.createCorrelationId(),
    setRedactionLevel: (level) => inner.setRedactionLevel(level),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Root logger with PII redaction enabled. Use `.child('module')` to scope. */
export const logger: Logger = wrapLogger(createLoggerFor('backend'));

/** Create a PII-redacting logger scoped to the given module name. */
export function createPiiSafeLogger(moduleName: string): Logger {
  return wrapLogger(createLoggerFor(moduleName));
}

export { setLogRedactionLevel };
export type { Logger, LogMeta };
