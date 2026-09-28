/**
 * Unit tests for tenant portal branding (Issue #1110).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  brandingToCssVariables,
  brandingToStylesheet,
  mergeBranding,
  portalBrandingStore,
  validateBranding,
  PortalBrandingStore,
  type PortalBranding,
} from '../portalBranding';

const branding: PortalBranding = {
  merchantId: 'merchant_1',
  brandName: 'Acme',
  logo: { uri: 'https://cdn.acme.test/logo.png', altText: 'Acme logo' },
  colors: { primary: '#3B82F6', secondary: '#2563EB', text: '#111827' },
  fonts: { heading: 'Poppins', body: 'Inter', url: 'https://fonts.acme.test' },
  customVariables: { 'radius-md': '8px' },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('validateBranding', () => {
  it('accepts a complete branding payload', () => {
    const result = validateBranding(branding);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects an empty brand name', () => {
    const result = validateBranding({ brandName: '   ' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('brandName');
  });

  it('rejects malformed colors', () => {
    const result = validateBranding({ colors: { primary: 'blue-ish' } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('colors.primary');
  });

  it('accepts shorthand hex colors', () => {
    expect(validateBranding({ colors: { primary: '#abc' } }).valid).toBe(true);
  });

  it('requires a logo uri when a logo is supplied', () => {
    const result = validateBranding({ logo: { uri: '' } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('logo.uri');
  });

  it('rejects unsafe custom variables', () => {
    expect(validateBranding({ customVariables: { 'bad name': 'x' } }).valid).toBe(false);
    expect(validateBranding({ customVariables: { ok: 'color: red' } }).valid).toBe(false);
    expect(validateBranding({ customVariables: { ok: 'red' } }).valid).toBe(true);
  });
});

describe('brandingToCssVariables', () => {
  it('emits the core portal tokens', () => {
    const vars = brandingToCssVariables(branding);
    expect(vars['--st-portal-primary']).toBe('#3B82F6');
    expect(vars['--st-portal-secondary']).toBe('#2563EB');
    expect(vars['--st-portal-logo']).toBe('url(https://cdn.acme.test/logo.png)');
    expect(vars['--st-portal-logo-alt']).toBe('Acme logo');
    expect(vars['--st-portal-font-heading']).toBe('Poppins');
    expect(vars['--st-radius-md']).toBe('8px');
  });

  it('omits optional tokens that were not configured', () => {
    const vars = brandingToCssVariables({
      merchantId: 'm',
      brandName: 'Solo',
      colors: { primary: '#000000' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(vars['--st-portal-secondary']).toBeUndefined();
    expect(vars['--st-portal-logo']).toBeUndefined();
    expect(vars['--st-portal-font-body']).toBeUndefined();
  });

  it('falls back to the brand name for the logo alt text', () => {
    const vars = brandingToCssVariables({
      merchantId: 'm',
      brandName: 'Solo',
      logo: { uri: 'https://cdn/x.png' },
      colors: { primary: '#000000' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(vars['--st-portal-logo-alt']).toBe('Solo');
  });
});

describe('brandingToStylesheet', () => {
  it('wraps variables in a selector', () => {
    const css = brandingToStylesheet(branding);
    expect(css.startsWith(':root {')).toBe(true);
    expect(css).toContain('--st-portal-primary: #3B82F6;');
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('supports a custom selector', () => {
    expect(brandingToStylesheet(branding, '.portal')).toMatch(/^\.portal \{/);
  });
});

describe('mergeBranding', () => {
  it('merges nested color and logo patches', () => {
    const merged = mergeBranding(branding, {
      colors: { primary: '#FF0000' },
      logo: { uri: 'https://cdn.acme.test/new.png' },
    });
    expect(merged.colors.primary).toBe('#FF0000');
    expect(merged.colors.secondary).toBe('#2563EB');
    expect(merged.logo?.uri).toBe('https://cdn.acme.test/new.png');
    expect(merged.logo?.altText).toBe('Acme logo');
    expect(merged.merchantId).toBe('merchant_1');
  });

  it('always stamps updatedAt', () => {
    expect(mergeBranding(branding, {}).updatedAt).not.toBe(branding.updatedAt);
  });
});

describe('PortalBrandingStore', () => {
  let store: PortalBrandingStore;

  beforeEach(() => {
    store = new PortalBrandingStore();
  });

  it('seeds a default branding', () => {
    expect(store.get('default')?.brandName).toBe('SubTrackr');
  });

  it('creates branding for an unknown merchant', () => {
    const created = store.upsert('merchant_9', { brandName: 'Nine' });
    expect(created.merchantId).toBe('merchant_9');
    expect(created.brandName).toBe('Nine');
    expect(store.get('merchant_9')).toEqual(created);
  });

  it('merges repeated updates', () => {
    store.upsert('m1', { brandName: 'First', colors: { primary: '#111111' } });
    const updated = store.upsert('m1', { colors: { secondary: '#222222' } });
    expect(updated.brandName).toBe('First');
    expect(updated.colors.primary).toBe('#111111');
    expect(updated.colors.secondary).toBe('#222222');
  });

  it('reset restores the seeded state', () => {
    store.upsert('m2', { brandName: 'Temp' });
    store.reset();
    expect(store.get('m2')).toBeUndefined();
    expect(store.get('default')).toBeDefined();
  });

  it('is exported as a shared singleton', () => {
    expect(portalBrandingStore.get('default')).toBeDefined();
  });
});
