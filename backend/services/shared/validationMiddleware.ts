/**
 * Issue #771 – Input Validation with Zod Schemas and Sanitization
 *
 * Provides:
 *   - Zod schema validation for request bodies, query params, and path params
 *   - XSS sanitization for string inputs
 *   - SQL injection prevention patterns
 *   - File upload validation
 *   - Request body size limits
 *   - Standardized validation error formatting
 */

import { z, type ZodSchema, type ZodError } from 'zod';
import type { IncomingMessage } from 'http';
import { ErrorCode } from './apiResponse';

// ── XSS Sanitization ─────────────────────────────────────────────────────────

const HTML_TAG_REGEX = /<[^>]*>/g;
const JS_EVENT_REGEX = /\bon\w+\s*=/gi;
const SCRIPT_REGEX = /javascript\s*:/gi;
const DATA_URI_REGEX = /data\s*:[^,]*base64/gi;

export function sanitizeXss(input: string): string {
  if (typeof input !== 'string') return input;

  let sanitized = input;
  sanitized = sanitized.replace(HTML_TAG_REGEX, '');
  sanitized = sanitized.replace(JS_EVENT_REGEX, '');
  sanitized = sanitized.replace(SCRIPT_REGEX, '');
  sanitized = sanitized.replace(DATA_URI_REGEX, '');
  return sanitized;
}

// ── SQL Injection Prevention ──────────────────────────────────────────────────

const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|FETCH|DECLARE|TRUNCATE)\b)/i,
  /(--|;|\/\*|\*\/|xp_|sp_)/i,
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i,
  /['"`]\s*(OR|AND)\s+['"`]/i,
  /;\s*(DROP|ALTER|CREATE|EXEC)/i,
];

export function detectSqlInjection(input: string): boolean {
  if (typeof input !== 'string') return false;
  return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

// ── File Upload Validation ───────────────────────────────────────────────────

export interface FileUploadConfig {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maxFiles: number;
}

export const DEFAULT_FILE_CONFIG: FileUploadConfig = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: ['application/json', 'text/csv', 'application/pdf', 'image/png', 'image/jpeg'],
  allowedExtensions: ['.json', '.csv', '.pdf', '.png', '.jpg', '.jpeg'],
  maxFiles: 5,
};

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateFileUpload(
  file: { name: string; size: number; type: string },
  config: Partial<FileUploadConfig> = {}
): FileValidationResult {
  const cfg = { ...DEFAULT_FILE_CONFIG, ...config };
  const errors: string[] = [];

  if (file.size > cfg.maxFileSizeBytes) {
    errors.push(`File size ${file.size} exceeds maximum ${cfg.maxFileSizeBytes} bytes`);
  }

  if (!cfg.allowedMimeTypes.includes(file.type)) {
    errors.push(`MIME type '${file.type}' is not allowed. Allowed: ${cfg.allowedMimeTypes.join(', ')}`);
  }

  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!cfg.allowedExtensions.includes(ext)) {
    errors.push(`Extension '${ext}' is not allowed. Allowed: ${cfg.allowedExtensions.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Request Body Size Limits ─────────────────────────────────────────────────

export const BODY_SIZE_LIMITS = {
  small: 1024,           // 1KB – simple forms
  medium: 100 * 1024,    // 100KB – standard JSON
  large: 1024 * 1024,    // 1MB – file metadata
  max: 10 * 1024 * 1024, // 10MB – bulk operations
} as const;

export type BodySizeLimit = keyof typeof BODY_SIZE_LIMITS;

export function getBodySizeLimit(limit: BodySizeLimit): number {
  return BODY_SIZE_LIMITS[limit];
}

// ── Zod Validation Middleware ─────────────────────────────────────────────────

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export interface ValidationOptions {
  /** Strip unknown properties instead of rejecting them. Default: true */
  stripUnknown?: boolean;
  /** Sanitize XSS in string fields. Default: true */
  sanitizeXss?: boolean;
  /** Detect SQL injection in string fields. Default: true */
  detectSqlInjection?: boolean;
  /** Max body size in bytes. Default: 100KB */
  maxBodySize?: number;
}

export interface ValidationResult {
  success: boolean;
  data?: {
    body?: unknown;
    query?: unknown;
    params?: unknown;
  };
  errors?: ValidationErrorDetail[];
}

export interface ValidationErrorDetail {
  field: string;
  code: string;
  message: string;
  path: (string | number)[];
}

function formatZodError(error: ZodError, source: string): ValidationErrorDetail[] {
  return error.issues.map((issue) => ({
    field: `${source}.${issue.path.join('.')}`,
    code: issue.code,
    message: issue.message,
    path: [source, ...issue.path],
  }));
}

function sanitizeObjectStrings(obj: unknown): unknown {
  if (typeof obj === 'string') return sanitizeXss(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObjectStrings);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeObjectStrings(value);
    }
    return result;
  }
  return obj;
}

function checkSqlInjection(obj: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof obj === 'string') {
    if (detectSqlInjection(obj)) {
      errors.push(`Potential SQL injection detected at ${path}`);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      errors.push(...checkSqlInjection(item, `${path}[${i}]`));
    });
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      errors.push(...checkSqlInjection(value, `${path}.${key}`));
    }
  }
  return errors;
}

export function validateRequest(
  data: { body?: unknown; query?: unknown; params?: unknown },
  schemas: ValidationSchemas,
  options: ValidationOptions = {}
): ValidationResult {
  const opts: Required<ValidationOptions> = {
    stripUnknown: true,
    sanitizeXss: true,
    detectSqlInjection: true,
    maxBodySize: BODY_SIZE_LIMITS.medium,
    ...options,
  };

  const allErrors: ValidationErrorDetail[] = [];

  // Validate body
  if (schemas.body && data.body !== undefined) {
    const result = schemas.body.safeParse(data.body);
    if (!result.success) {
      allErrors.push(...formatZodError(result.error, 'body'));
    } else {
      data.body = result.data;
    }
  }

  // Validate query
  if (schemas.query && data.query !== undefined) {
    const result = schemas.query.safeParse(data.query);
    if (!result.success) {
      allErrors.push(...formatZodError(result.error, 'query'));
    } else {
      data.query = result.data;
    }
  }

  // Validate params
  if (schemas.params && data.params !== undefined) {
    const result = schemas.params.safeParse(data.params);
    if (!result.success) {
      allErrors.push(...formatZodError(result.error, 'params'));
    } else {
      data.params = result.data;
    }
  }

  if (allErrors.length > 0) {
    return { success: false, errors: allErrors };
  }

  // Sanitize XSS
  if (opts.sanitizeXss) {
    if (data.body) data.body = sanitizeObjectStrings(data.body);
    if (data.query) data.query = sanitizeObjectStrings(data.query);
    if (data.params) data.params = sanitizeObjectStrings(data.params);
  }

  // Detect SQL injection
  if (opts.detectSqlInjection) {
    const sqlErrors: string[] = [];
    if (data.body) sqlErrors.push(...checkSqlInjection(data.body, 'body'));
    if (data.query) sqlErrors.push(...checkSqlInjection(data.query, 'query'));
    if (data.params) sqlErrors.push(...checkSqlInjection(data.params, 'params'));

    if (sqlErrors.length > 0) {
      return {
        success: false,
        errors: sqlErrors.map((msg) => ({
          field: 'security',
          code: 'SQL_INJECTION_DETECTED',
          message: msg,
          path: [],
        })),
      };
    }
  }

  return { success: true, data };
}

// ── Express-style Middleware Factory ──────────────────────────────────────────

export function createValidationMiddleware(
  schemas: ValidationSchemas,
  options: ValidationOptions = {}
) {
  return function validationMiddleware(
    req: { body?: unknown; query?: unknown; params?: unknown; method?: string; url?: string },
    res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body: string) => void },
    next: () => void
  ): void {
    // Check body size for POST/PUT/PATCH
    if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method ?? '')) {
      const bodyStr = JSON.stringify(req.body);
      if (bodyStr.length > (options.maxBodySize ?? BODY_SIZE_LIMITS.medium)) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Request body exceeds maximum size of ${options.maxBodySize ?? BODY_SIZE_LIMITS.medium} bytes`,
          },
        }));
        return;
      }
    }

    const result = validateRequest(
      { body: req.body, query: req.query, params: req.params },
      schemas,
      options
    );

    if (!result.success) {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Request validation failed',
          details: result.errors?.reduce((acc, e) => {
            acc[e.field] = e.message;
            return acc;
          }, {} as Record<string, string>),
        },
      }));
      return;
    }

    // Update request with parsed/validated data
    if (result.data?.body !== undefined) req.body = result.data.body;
    if (result.data?.query !== undefined) req.query = result.data.query;
    if (result.data?.params !== undefined) req.params = result.data.params;

    next();
  };
}

// ── Common Reusable Schemas ──────────────────────────────────────────────────

export const commonSchemas = {
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
  }),

  uuid: z.string().uuid(),

  ethereumAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),

  email: z.string().email('Invalid email address'),

  currency: z.string().length(3, 'Currency must be 3 characters').toUpperCase(),

  amount: z.number().positive('Amount must be positive'),

  timestamp: z.string().datetime('Invalid ISO timestamp'),

  searchQuery: z.string().max(500).optional(),

  subscriptionId: z.string().min(1).max(255),

  planId: z.string().min(1).max(255),

  metadata: z.record(z.string(), z.string()).optional(),
};

// ── HTTP Request Body Reader ─────────────────────────────────────────────────

export function readBodyWithLimit(
  req: IncomingMessage,
  maxBytes: number = BODY_SIZE_LIMITS.medium
): Promise<{ body: unknown; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        truncated = true;
        req.destroy();
        reject(new Error(`Request body exceeds ${maxBytes} byte limit`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({ body: {}, truncated });
        return;
      }
      try {
        resolve({ body: JSON.parse(raw), truncated });
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });

    req.on('error', reject);
  });
}
