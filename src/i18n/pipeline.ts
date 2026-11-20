/**
 * src/i18n/pipeline.ts
 *
 * Issue #2037 — RTL-safe locale pipeline for every remaining untranslated
 * screen. This module is intentionally free of React Native and i18next
 * imports so the pure locale rules can be unit tested and reused by the
 * mobile shell, the app screens and server-side renderers alike.
 *
 * The pipeline owns four things the old per-screen ad-hoc formatting did not:
 *   1. one canonical locale registry (code, Intl tag, direction);
 *   2. region-tag normalisation (`ar-SA` -> `ar`, `he_IL` -> `he`);
 *   3. bidi isolation of interpolated values and formatted numbers/dates;
 *   4. plural key resolution with a documented fallback for Arabic.
 */

export type LocaleCode = 'en' | 'hi' | 'ar' | 'he' | 'fa';

export type LocaleDirection = 'ltr' | 'rtl';

export interface LocaleMetadata {
  code: LocaleCode;
  /** Human-readable name, in the language itself. */
  label: string;
  /** BCP-47 tag passed to `Intl`. */
  intlTag: string;
  direction: LocaleDirection;
}

export const LOCALES: Record<LocaleCode, LocaleMetadata> = {
  en: { code: 'en', label: 'English', intlTag: 'en-US', direction: 'ltr' },
  hi: { code: 'hi', label: 'हिन्दी', intlTag: 'hi-IN', direction: 'ltr' },
  ar: { code: 'ar', label: 'العربية', intlTag: 'ar-SA', direction: 'rtl' },
  he: { code: 'he', label: 'עברית', intlTag: 'he-IL', direction: 'rtl' },
  fa: { code: 'fa', label: 'فارسی', intlTag: 'fa-IR', direction: 'rtl' },
};

export const SUPPORTED_LOCALES = Object.keys(LOCALES) as LocaleCode[];

const RTL_LOCALES: LocaleCode[] = ['ar', 'he', 'fa'];

// Unicode bidi controls used to keep Latin numbers inside RTL sentences.
export const BIDI_MARKERS = {
  lrm: '\u200E',
  rlm: '\u200F',
  fsi: '\u2068',
  rli: '\u2067',
  pdi: '\u2069',
} as const;

const RTL_SCRIPT = /[\u0590-\u08FF\uFB1D-\uFDFD]/;

// ── Locale resolution ────────────────────────────────────────────────────────

export function isLocaleCode(value: string): value is LocaleCode {
  return Object.prototype.hasOwnProperty.call(LOCALES, value);
}

/**
 * Resolve any stored locale value to a supported base language.
 * Handles `ar-SA`, `he_IL`, `EN`, whitespace and unsupported tags.
 */
export function normalizeLocale(
  value: string | null | undefined,
  fallback: LocaleCode = 'en',
): LocaleCode {
  if (typeof value !== 'string') return fallback;
  const base = value.trim().split(/[-_]/)[0].toLowerCase();
  if (base === 'iw') return 'he'; // legacy Hebrew tag
  if (base === 'in') return 'hi'; // legacy Hindi tag
  return isLocaleCode(base) ? base : fallback;
}

export function getLocaleDirection(locale: string): LocaleDirection {
  return LOCALES[normalizeLocale(locale)].direction;
}

export function isRTLLocale(locale: string): boolean {
  return RTL_LOCALES.includes(normalizeLocale(locale));
}

export function getIntlTag(locale: string): string {
  return LOCALES[normalizeLocale(locale)].intlTag;
}

/** True when a language's own script is right-to-left. */
export function isRTLLanguage(locale: string): boolean {
  return isRTLLocale(locale);
}

/** Kept so callers that memoise on the old constant keep working. */
export const RTL_LANGUAGES = RTL_LOCALES;

// ── Bidi helpers ─────────────────────────────────────────────────────────────

/** Wrap a value in directional isolates so its order never flips in context. */
export function wrapBidi(value: string, direction: LocaleDirection): string {
  const opener = direction === 'rtl' ? BIDI_MARKERS.rli : BIDI_MARKERS.fsi;
  return `${opener}${value}${BIDI_MARKERS.pdi}`;
}

/** Remove previously inserted bidi controls (idempotent re-localisation). */
export function stripBidiControls(value: string): string {
  return value.replace(/[\u200E\u200F\u2066-\u2069]/g, '');
}

export function detectTextDirection(value: string): LocaleDirection {
  return RTL_SCRIPT.test(value) ? 'rtl' : 'ltr';
}

export interface InterpolationOptions {
  /** Isolate substituted values so numbers/latin text stay intact in RTL. */
  isolateValues?: boolean;
  /** Override auto-detection of each substituted value's direction. */
  valueDirection?: LocaleDirection | 'auto';
}

export type TranslationVars = Record<string, string | number>;

/** i18next-style `{{name}}` interpolation with optional bidi isolation. */
export function interpolate(
  template: string,
  vars: TranslationVars = {},
  options: InterpolationOptions = {},
): string {
  let result = template;
  for (const [key, rawValue] of Object.entries(vars)) {
    const value = String(rawValue);
    const substituted =
      options.isolateValues === true
        ? wrapBidi(
            value,
            options.valueDirection && options.valueDirection !== 'auto'
              ? options.valueDirection
              : detectTextDirection(value),
          )
        : value;
    result = result.split(`{{${key}}}`).join(substituted);
  }
  return result;
}

// ── Locale-aware formatters ──────────────────────────────────────────────────

/** Format integer minor units as localized currency, isolated inside RTL text. */
export function formatMoney(
  valueMinor: number,
  currency: string,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const direction = getLocaleDirection(locale);
  const isolate = (text: string): string =>
    direction === 'rtl' ? wrapBidi(text, 'ltr') : text;

  try {
    const formatted = new Intl.NumberFormat(getIntlTag(locale), {
      style: 'currency',
      currency,
      ...options,
    }).format(valueMinor / 100);
    return isolate(formatted);
  } catch {
    return isolate(`${(valueMinor / 100).toFixed(2)} ${currency}`);
  }
}

/** Localised date formatting. Invalid dates produce an empty string. */
export function formatDate(
  value: Date | string | number,
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  try {
    return new Intl.DateTimeFormat(getIntlTag(locale), options).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Resolve an i18next v4 plural key. Arabic uses one form for 0, 1 and 2 and
 * the `other` form for the rest, matching the shipped locale resources.
 */
export function resolvePluralKey(baseKey: string, count: number, locale: string): string {
  const normalized = normalizeLocale(locale);
  const isOne =
    normalized === 'ar'
      ? Number.isInteger(count) && count >= 0 && count <= 2
      : count === 1;
  return `${baseKey}_${isOne ? 'one' : 'other'}`;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export type LocaleResources = Partial<Record<LocaleCode, Record<string, unknown>>>;

export interface LocalePipelineConfig {
  locale: string;
  resources?: LocaleResources;
  fallbackLocale?: LocaleCode;
  /** Defaults to true: any interpolated value is bidi-isolated. */
  isolateValues?: boolean;
}

export interface LocalePipeline {
  readonly locale: LocaleCode;
  readonly direction: LocaleDirection;
  readonly isRTL: boolean;
  readonly intlTag: string;
  translate(key: string, vars?: TranslationVars): string;
  /** Alias for `translate`, matching the familiar i18next call shape. */
  t: (key: string, vars?: TranslationVars) => string;
  plural(baseKey: string, count: number, vars?: TranslationVars): string;
  formatMoney(valueMinor: number, currency: string): string;
  formatDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
  isolate(value: string): string;
  withLocale(nextLocale: string): LocalePipeline;
}

function lookup(resources: LocaleResources, locale: LocaleCode, key: string): string | undefined {
  const tree = resources[locale];
  if (!tree) return undefined;

  let current: unknown = tree;
  for (const part of key.replace(/:/g, '.').split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Build a self-contained locale pipeline. Missing keys fall back to English
 * and finally to the key itself, so a newly added screen never renders blank.
 */
export function createLocalePipeline(config: LocalePipelineConfig): LocalePipeline {
  const locale = normalizeLocale(config.locale);
  const fallbackLocale = config.fallbackLocale ?? 'en';
  const resources = config.resources ?? {};
  const isolateValues = config.isolateValues ?? true;

  const resolve = (key: string): string =>
    lookup(resources, locale, key) ??
    lookup(resources, fallbackLocale, key) ??
    key;

  const translate = (key: string, vars: TranslationVars = {}): string =>
    interpolate(resolve(key), vars, { isolateValues });

  const pipeline: LocalePipeline = {
    locale,
    direction: LOCALES[locale].direction,
    isRTL: isRTLLocale(locale),
    intlTag: LOCALES[locale].intlTag,
    translate,
    t: translate,
    plural(baseKey, count, vars = {}) {
      return translate(resolvePluralKey(baseKey, count, locale), { count, ...vars });
    },
    formatMoney(valueMinor, currency) {
      return formatMoney(valueMinor, currency, locale);
    },
    formatDate(value, options) {
      return formatDate(value, locale, options);
    },
    isolate(value) {
      return pipeline.direction === 'rtl' ? wrapBidi(value, 'ltr') : value;
    },
    withLocale(nextLocale) {
      return createLocalePipeline({ ...config, locale: nextLocale });
    },
  };

  return pipeline;
}
