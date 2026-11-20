import {
  BIDI_MARKERS,
  LOCALES,
  RTL_LANGUAGES,
  createLocalePipeline,
  detectTextDirection,
  formatDate,
  formatMoney,
  getIntlTag,
  getLocaleDirection,
  interpolate,
  isRTLLanguage,
  isRTLLocale,
  normalizeLocale,
  resolvePluralKey,
  stripBidiControls,
  wrapBidi,
} from '../pipeline';
import en from '../locales/en.json';
import ar from '../locales/ar.json';

const resources = { en, ar };

describe('locale resolution', () => {
  it('normalises region tags, underscores and legacy codes', () => {
    expect(normalizeLocale('ar-SA')).toBe('ar');
    expect(normalizeLocale('he_IL')).toBe('he');
    expect(normalizeLocale('iw')).toBe('he');
    expect(normalizeLocale('in')).toBe('hi');
    expect(normalizeLocale(' EN ')).toBe('en');
    expect(normalizeLocale('xx')).toBe('en');
    expect(normalizeLocale(null, 'hi')).toBe('hi');
  });

  it('reports direction and Intl tag from the base language', () => {
    expect(getLocaleDirection('ar-SA')).toBe('rtl');
    expect(getLocaleDirection('hi-IN')).toBe('ltr');
    expect(getIntlTag('fa')).toBe('fa-IR');
    expect(isRTLLocale('he-IL')).toBe(true);
    expect(isRTLLanguage('en')).toBe(false);
    expect(RTL_LANGUAGES).toEqual(['ar', 'he', 'fa']);
    expect(LOCALES.ar.label).toBe('العربية');
  });
});

describe('bidi helpers', () => {
  it('isolates values with the correct opener and a shared PDI', () => {
    expect(wrapBidi('42', 'ltr')).toBe(`${BIDI_MARKERS.fsi}42${BIDI_MARKERS.pdi}`);
    expect(wrapBidi('مرحبا', 'rtl')).toBe(`${BIDI_MARKERS.rli}مرحبا${BIDI_MARKERS.pdi}`);
  });

  it('detects script direction and strips controls idempotently', () => {
    expect(detectTextDirection('Stripe')).toBe('ltr');
    expect(detectTextDirection('اشتراك')).toBe('rtl');
    expect(stripBidiControls(wrapBidi('42', 'ltr'))).toBe('42');
    expect(stripBidiControls('42')).toBe('42');
  });
});

describe('interpolation', () => {
  it('replaces i18next-style placeholders without touching unknown ones', () => {
    expect(interpolate('Hello {{name}}', { name: 'Ada' })).toBe('Hello Ada');
    expect(interpolate('{{name}} {{missing}}', { name: 'Ada' })).toBe('Ada {{missing}}');
  });

  it('isolates substituted values when asked', () => {
    expect(interpolate('{{provider}}', { provider: 'Stripe' }, { isolateValues: true })).toBe(
      `${BIDI_MARKERS.fsi}Stripe${BIDI_MARKERS.pdi}`
    );
    expect(
      interpolate('{{value}}', { value: 42 }, { isolateValues: true, valueDirection: 'rtl' })
    ).toBe(`${BIDI_MARKERS.rli}42${BIDI_MARKERS.pdi}`);
  });
});

describe('formatters', () => {
  it('formats minor units as currency', () => {
    expect(formatMoney(1999, 'USD', 'en')).toBe('$19.99');
    expect(formatMoney(1999, 'USD', 'hi')).toContain('19.99');
  });

  it('isolates currency in RTL locales and falls back for bad input', () => {
    expect(formatMoney(1999, 'USD', 'ar')).toContain(BIDI_MARKERS.fsi);
    expect(formatMoney(100, 'ZZZ', 'en')).toContain('ZZZ');
  });

  it('formats dates and returns empty string for invalid dates', () => {
    expect(formatDate('2024-01-02T00:00:00Z', 'en')).toContain('2024');
    expect(formatDate('not-a-date', 'en')).toBe('');
  });
});

describe('plural keys', () => {
  it('uses one/other for Latin locales', () => {
    expect(resolvePluralKey('renewal.count', 1, 'en')).toBe('renewal.count_one');
    expect(resolvePluralKey('renewal.count', 0, 'en')).toBe('renewal.count_other');
  });

  it('treats Arabic 0, 1 and 2 as the one form', () => {
    expect(resolvePluralKey('renewal.count', 0, 'ar')).toBe('renewal.count_one');
    expect(resolvePluralKey('renewal.count', 2, 'ar-SA')).toBe('renewal.count_one');
    expect(resolvePluralKey('renewal.count', 3, 'ar')).toBe('renewal.count_other');
  });
});

describe('createLocalePipeline', () => {
  it('resolves real translations with isolation enabled', () => {
    const l10n = createLocalePipeline({ locale: 'ar', resources });
    const text = l10n.translate('status.affected', { provider: 'Stripe' });

    expect(l10n.locale).toBe('ar');
    expect(l10n.direction).toBe('rtl');
    expect(l10n.isRTL).toBe(true);
    expect(text).toContain('المتأثرة');
    expect(text).toContain(BIDI_MARKERS.fsi);
  });

  it('falls back to English and finally to the key', () => {
    const l10n = createLocalePipeline({ locale: 'ar', resources });
    expect(l10n.translate('status.retry')).toBe('إعادة المحاولة');
    expect(l10n.translate('nonexistent.key')).toBe('nonexistent.key');
  });

  it('supports namespace separators and plural lookup', () => {
    const l10n = createLocalePipeline({ locale: 'en', resources });
    expect(l10n.translate('status:retry')).toBe('Try again');
    expect(l10n.plural('renewal.count', 2)).toBe('2 renewals due');
  });

  it('exposes the t alias and can switch locale', () => {
    const l10n = createLocalePipeline({ locale: 'en', resources });
    const key = 'status.retry';
    expect(l10n.t(key)).toBe('Try again');

    const rtl = l10n.withLocale('he');
    expect(rtl.locale).toBe('he');
    expect(rtl.isolate('Stripe')).toContain(BIDI_MARKERS.fsi);
  });
});
