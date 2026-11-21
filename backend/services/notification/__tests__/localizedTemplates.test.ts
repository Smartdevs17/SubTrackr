/**
 * Tests for LocalisedTemplateService (#1752)
 *
 * Covers:
 *   • Locale selection — requested locale is honoured when available.
 *   • Fallback locale — missing translations fall back to the default (`en`).
 *   • Variable substitution and missing-variable reporting.
 *   • Locale alias normalisation (en-US → en).
 *   • Unknown template throws.
 */

import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_LOCALE,
  LocalizedTemplateService,
  SUPPORTED_LOCALES,
  default as defaultExport,
  localizedTemplateService,
  resolveLocale,
  substituteVariables,
  DEFAULT_TEMPLATE_CATALOG,
} from '../localizedTemplates';

describe('resolveLocale', () => {
  it('returns the locale when it is directly supported', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('ar')).toBe('ar');
  });

  it('normalises case and whitespace', () => {
    expect(resolveLocale('  EN ')).toBe('en');
    expect(resolveLocale('FR')).toBe('fr');
  });

  it('maps common locale tags to their base', () => {
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('es-MX')).toBe('es');
    expect(resolveLocale('fr-CA')).toBe('fr');
    expect(resolveLocale('ar-SA')).toBe('ar');
  });

  it('falls back to the default locale for unknown input', () => {
    expect(resolveLocale('de')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
  });
});

describe('substituteVariables', () => {
  it('replaces {{variable}} placeholders with values', () => {
    const result = substituteVariables('Hello {{name}}, you owe {{currency}} {{amount}}.', {
      name: 'Dana',
      currency: 'USD',
      amount: '49.00',
    });
    expect(result.text).toBe('Hello Dana, you owe USD 49.00.');
    expect(result.missing).toEqual([]);
  });

  it('records missing variables and renders an empty string', () => {
    const result = substituteVariables('Hi {{name}}, plan: {{plan}}', { name: 'Dana' });
    expect(result.text).toBe('Hi Dana, plan: ');
    expect(result.missing).toEqual(['plan']);
  });

  it('de-duplicates missing variables', () => {
    const result = substituteVariables('{{a}} and {{a}}', {});
    expect(result.missing).toEqual(['a']);
  });

  it('treats an empty-string value as missing', () => {
    const result = substituteVariables('v={{x}}', { x: '' });
    expect(result.text).toBe('v=');
    expect(result.missing).toEqual(['x']);
  });
});

describe('LocalizedTemplateService', () => {
  it('lists locales that have at least one template', () => {
    const service = new LocalizedTemplateService();
    const locales = service.listLocales();
    for (const supported of SUPPORTED_LOCALES) {
      expect(locales).toContain(supported);
    }
  });

  it('lists the union of template ids across locales', () => {
    const service = new LocalizedTemplateService();
    const ids = service.listTemplateIds();
    expect(ids).toContain('receipt_payment_succeeded');
    expect(ids).toContain('payment_failed');
    expect(ids).toContain('password_reset');
  });

  // ── Locale selection ──────────────────────────────────────────────────────────

  it('renders in the requested locale when a translation exists', () => {
    const service = new LocalizedTemplateService();
    const result = service.renderLocalized('payment_failed', 'es', {
      subscription_name: 'Pro Plan',
      currency: 'EUR',
      amount: '49.00',
    });
    expect(result.resolvedLocale).toBe('es');
    expect(result.fellBack).toBe(false);
    expect(result.subject).toBe('Tu pago de Pro Plan ha fallado');
    expect(result.body).toContain('No pudimos procesar tu pago de EUR 49.00 por Pro Plan');
    expect(result.missingVariables).toEqual([]);
  });

  it('renders Arabic copy for the ar locale', () => {
    const service = new LocalizedTemplateService();
    const result = service.renderLocalized('subscription_renewed', 'ar', {
      subscription_name: 'Pro Plan',
      currency: 'USD',
      amount: '10.00',
      next_billing_date: '2026-11-01',
    });
    expect(result.resolvedLocale).toBe('ar');
    expect(result.subject).toBe('تم تجديد اشتراك Pro Plan');
    expect(result.body).toContain('2026-11-01');
  });

  // ── Fallback locale ───────────────────────────────────────────────────────────

  it('falls back to the default locale when the requested one has no translation', () => {
    // German has no translations bundled — should fall back to English.
    const service = new LocalizedTemplateService();
    const result = service.renderLocalized('payment_failed', 'de', {
      subscription_name: 'Pro Plan',
      currency: 'USD',
      amount: '49.00',
    });
    expect(result.resolvedLocale).toBe('en');
    expect(result.fellBack).toBe(true);
    expect(result.subject).toBe('Your payment for Pro Plan failed');
  });

  it('falls back when a specific template is missing from a supported locale', () => {
    // Build a catalog where Spanish only has one template; everything else
    // falls back to English.
    const partialCatalog = {
      en: DEFAULT_TEMPLATE_CATALOG.en,
      es: { payment_failed: DEFAULT_TEMPLATE_CATALOG.es!.payment_failed },
    };
    const service = new LocalizedTemplateService(partialCatalog as any);

    const fallback = service.renderLocalized('receipt_payment_succeeded', 'es', {
      subscription_name: 'Pro Plan',
      currency: 'USD',
      amount: '49.00',
      paid_at: '2026-10-19',
    });
    expect(fallback.resolvedLocale).toBe('en');
    expect(fallback.fellBack).toBe(true);
    expect(fallback.subject).toBe('Receipt for your Pro Plan payment');

    // The one Spanish template that does exist renders in Spanish.
    const spanish = service.renderLocalized('payment_failed', 'es', {
      subscription_name: 'Pro Plan',
      currency: 'USD',
      amount: '49.00',
    });
    expect(spanish.resolvedLocale).toBe('es');
    expect(spanish.fellBack).toBe(false);
    expect(spanish.subject).toBe('Tu pago de Pro Plan ha fallado');
  });

  it('throws when neither the requested nor default locale has the template', () => {
    const service = new LocalizedTemplateService({ en: {}, es: {} } as any);
    expect(() =>
      service.renderLocalized('payment_failed', 'es', { subscription_name: 'X', currency: 'USD', amount: '1' }),
    ).toThrow(/No template "payment_failed"/);
  });

  // ── Variable substitution through renderLocalized ────────────────────────────

  it('reports missing variables without leaking placeholders', () => {
    const service = new LocalizedTemplateService();
    const result = service.renderLocalized('receipt_payment_succeeded', 'en', {
      subscription_name: 'Pro Plan',
      // amount and currency deliberately omitted
    });
    expect(result.subject).toBe('Receipt for your Pro Plan payment');
    expect(result.body).not.toContain('{{');
    expect(result.missingVariables).toContain('amount');
    expect(result.missingVariables).toContain('currency');
    expect(result.missingVariables).toContain('paid_at');
  });

  it('uses the singleton service by default', () => {
    expect(localizedTemplateService).toBeInstanceOf(LocalizedTemplateService);
    const result = localizedTemplateService.renderLocalized('password_reset', 'fr', {
      merchant_name: 'Acme',
      reset_url: 'https://example.com/reset',
      expires_in_minutes: '30',
    });
    expect(result.resolvedLocale).toBe('fr');
    expect(result.subject).toBe('Réinitialisez votre mot de passe Acme');
  });
});
