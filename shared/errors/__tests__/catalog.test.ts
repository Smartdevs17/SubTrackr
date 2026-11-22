import fs from 'node:fs';
import path from 'node:path';
import {
  ERROR_CATALOG,
  ERROR_CODES,
  ERROR_LOCALES,
  ERROR_MESSAGES,
  LocalizedError,
  errorCodeFromContract,
  isErrorCode,
  normalizeErrorLocale,
  resolveErrorMessage,
} from '..';

describe('domain error catalog', () => {
  it('defines a message for every code in every locale', () => {
    for (const locale of ERROR_LOCALES) {
      for (const code of ERROR_CODES) {
        expect(ERROR_MESSAGES[locale][code]).toEqual(expect.any(String));
        expect(ERROR_MESSAGES[locale][code].length).toBeGreaterThan(0);
      }
    }
  });

  it('mirrors the stable Soroban contract error discriminants', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../contracts/subscription/src/errors.rs'),
      'utf8'
    );
    const variants = [...source.matchAll(/^\s{4}(\w+) = (\d+),$/gm)];

    expect(variants).toHaveLength(25);
    for (const [, variant, discriminant] of variants) {
      const code = variant.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
      expect(isErrorCode(code)).toBe(true);
      expect(errorCodeFromContract(Number(discriminant))).toBe(code);
      expect(ERROR_CATALOG[code as keyof typeof ERROR_CATALOG].contractCodes).toContain(
        Number(discriminant)
      );
    }
  });

  it('normalizes region tags and legacy locale aliases', () => {
    expect(normalizeErrorLocale('ar-SA')).toBe('ar');
    expect(normalizeErrorLocale('he_IL')).toBe('he');
    expect(normalizeErrorLocale('iw')).toBe('he');
    expect(normalizeErrorLocale('EN')).toBe('en');
    expect(normalizeErrorLocale('de')).toBe('en');
  });

  it('resolves localized messages with interpolation and fallback', () => {
    expect(resolveErrorMessage('PLAN_NOT_FOUND', 'hi')).toBe(ERROR_MESSAGES.hi.PLAN_NOT_FOUND);
    expect(resolveErrorMessage('RATE_LIMITED', 'fr')).toBe(ERROR_MESSAGES.en.RATE_LIMITED);
    expect(resolveErrorMessage('UNKNOWN_CODE', 'en')).toBe(ERROR_MESSAGES.en.INTERNAL_ERROR);
    expect(resolveErrorMessage('MAX_PAUSE_DURATION_EXCEEDED', 'en', { days: 30 })).toContain(
      '30 days'
    );
  });

  it('maps contract codes to canonical error codes', () => {
    expect(errorCodeFromContract(1)).toBe('UNAUTHORIZED');
    expect(errorCodeFromContract(16)).toBe('RATE_LIMITED');
    expect(errorCodeFromContract(25)).toBe('EXPORT_WINDOW_EXCEEDED');
    expect(errorCodeFromContract(999)).toBeUndefined();
  });

  it('builds errors with consistent code, status and metadata', () => {
    const error = new LocalizedError('RATE_LIMITED', { locale: 'ar-SA' });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.httpStatus).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.locale).toBe('ar');
    expect(error.userMessage).toBe(ERROR_MESSAGES.ar.RATE_LIMITED);
    expect(error.toJSON()).toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
  });
});
