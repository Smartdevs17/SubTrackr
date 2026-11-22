import { ERROR_CATALOG, ERROR_CODES, ErrorCode, isErrorCode } from './catalog';
import { ERROR_LOCALES, ERROR_MESSAGES, ErrorLocale } from './locales';

export * from './catalog';
export { ERROR_LOCALES, ERROR_MESSAGES } from './locales';
export type { ErrorLocale, ErrorMessages } from './locales';

/** Accept stored region tags (`ar-SA`, `he_IL`, `EN`) and legacy aliases. */
export function normalizeErrorLocale(
  value: string | null | undefined,
  fallback: ErrorLocale = 'en'
): ErrorLocale {
  if (typeof value !== 'string') return fallback;
  const base = value.trim().split(/[-_]/)[0].toLowerCase();
  if (base === 'iw') return 'he';
  if (base === 'in') return 'hi';
  return (ERROR_LOCALES as readonly string[]).includes(base) ? (base as ErrorLocale) : fallback;
}

export interface LocalizeErrorOptions {
  locale?: string;
  variables?: Record<string, string | number>;
}

function interpolate(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match
  );
}

export function resolveErrorMessage(
  code: ErrorCode | string,
  locale: string = 'en',
  variables: Record<string, string | number> = {}
): string {
  const resolved = isErrorCode(code) ? code : 'INTERNAL_ERROR';
  const normalized = normalizeErrorLocale(locale);
  const template =
    ERROR_MESSAGES[normalized][resolved] ?? ERROR_MESSAGES.en[resolved] ?? 'Something went wrong.';
  return interpolate(template, variables);
}

const CONTRACT_CODE_MAP = new Map<number, ErrorCode>();
for (const code of ERROR_CODES) {
  for (const contractCode of ERROR_CATALOG[code].contractCodes) {
    CONTRACT_CODE_MAP.set(contractCode, code);
  }
}

export function errorCodeFromContract(contractCode: number): ErrorCode | undefined {
  return CONTRACT_CODE_MAP.get(contractCode);
}

export class LocalizedError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly locale: ErrorLocale;
  readonly userMessage: string;

  constructor(code: ErrorCode | string, options: LocalizeErrorOptions = {}) {
    const resolved = isErrorCode(code) ? code : 'INTERNAL_ERROR';
    const descriptor = ERROR_CATALOG[resolved];
    const locale = normalizeErrorLocale(options.locale);
    const userMessage = resolveErrorMessage(resolved, locale, options.variables);
    super(userMessage);

    this.name = 'LocalizedError';
    this.code = resolved;
    this.httpStatus = descriptor.httpStatus;
    this.retryable = descriptor.retryable;
    this.locale = locale;
    this.userMessage = userMessage;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.userMessage,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      locale: this.locale,
    };
  }
}
