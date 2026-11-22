/**
 * Tenant branding for subscription portals (Issue #1110).
 *
 * Stores per-merchant look-and-feel (logo, colors, fonts) and renders it as
 * the CSS custom properties consumed by the hosted subscription portal.
 *
 * Pure functions are exported for unit testing; `PortalBrandingStore` keeps
 * the state in memory following the `publicDataStore` pattern.
 */

export interface BrandingLogo {
  uri: string;
  darkUri?: string;
  width?: number;
  height?: number;
  altText?: string;
}

export interface BrandingColors {
  primary: string;
  secondary?: string;
  accent?: string;
  background?: string;
  surface?: string;
  text?: string;
}

export interface BrandingFonts {
  heading?: string;
  body?: string;
  url?: string;
}

export interface PortalBranding {
  merchantId: string;
  brandName: string;
  logo?: BrandingLogo;
  colors: BrandingColors;
  fonts?: BrandingFonts;
  /** Extra CSS variables the merchant wants to ship to the portal. */
  customVariables?: Record<string, string>;
  updatedAt: string;
}

export interface BrandingValidation {
  valid: boolean;
  errors: string[];
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const CSS_PROPERTY_NAME = /^[a-z][a-z0-9-]*$/;

/** Validate a partial branding patch before it is persisted. */
export function validateBranding(input: Partial<PortalBranding>): BrandingValidation {
  const errors: string[] = [];

  if (input.brandName !== undefined && !input.brandName.trim()) {
    errors.push('brandName must be a non-empty string.');
  }

  if (input.colors) {
    for (const [key, value] of Object.entries(input.colors)) {
      if (value !== undefined && !HEX_COLOR.test(value)) {
        errors.push(`colors.${key} must be a hex color such as #3B82F6.`);
      }
    }
  }

  if (input.logo) {
    if (!input.logo.uri || !input.logo.uri.trim()) {
      errors.push('logo.uri must be a non-empty URL or data URI.');
    }
  }

  if (input.customVariables) {
    for (const [name, value] of Object.entries(input.customVariables)) {
      if (!CSS_PROPERTY_NAME.test(name)) {
        errors.push(`custom variable "${name}" is not a valid CSS property name.`);
      }
      if (typeof value !== 'string' || value.includes(';')) {
        errors.push(`custom variable "${name}" must be a single-line CSS value.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Render branding as the `--st-*` CSS custom properties injected into the
 * subscription portal document.
 */
export function brandingToCssVariables(branding: PortalBranding): Record<string, string> {
  const vars: Record<string, string> = {
    '--st-portal-brand-name': branding.brandName,
    '--st-portal-primary': branding.colors.primary,
  };

  if (branding.colors.secondary) vars['--st-portal-secondary'] = branding.colors.secondary;
  if (branding.colors.accent) vars['--st-portal-accent'] = branding.colors.accent;
  if (branding.colors.background) vars['--st-portal-background'] = branding.colors.background;
  if (branding.colors.surface) vars['--st-portal-surface'] = branding.colors.surface;
  if (branding.colors.text) vars['--st-portal-text'] = branding.colors.text;

  if (branding.logo?.uri) {
    vars['--st-portal-logo'] = `url(${branding.logo.uri})`;
    vars['--st-portal-logo-alt'] = branding.logo.altText ?? branding.brandName;
  }
  if (branding.logo?.darkUri) vars['--st-portal-logo-dark'] = `url(${branding.logo.darkUri})`;

  if (branding.fonts?.heading) vars['--st-portal-font-heading'] = branding.fonts.heading;
  if (branding.fonts?.body) vars['--st-portal-font-body'] = branding.fonts.body;
  if (branding.fonts?.url) vars['--st-portal-font-url'] = branding.fonts.url;

  for (const [name, value] of Object.entries(branding.customVariables ?? {})) {
    vars[`--st-${name}`] = value;
  }

  return vars;
}

/** Serialize CSS variables into a `<style>` ready stylesheet. */
export function brandingToStylesheet(branding: PortalBranding, selector = ':root'): string {
  const vars = brandingToCssVariables(branding);
  const body = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

/** Merge a patch onto an existing branding record. */
export function mergeBranding(
  current: PortalBranding,
  patch: Partial<PortalBranding>
): PortalBranding {
  return {
    ...current,
    ...patch,
    merchantId: current.merchantId,
    colors: { ...current.colors, ...(patch.colors ?? {}) },
    ...(patch.logo || current.logo
      ? { logo: patch.logo ? { ...current.logo, ...patch.logo } : current.logo }
      : {}),
    ...(patch.fonts || current.fonts
      ? { fonts: { ...current.fonts, ...(patch.fonts ?? {}) } }
      : {}),
    ...(patch.customVariables
      ? { customVariables: { ...current.customVariables, ...patch.customVariables } }
      : {}),
    updatedAt: new Date().toISOString(),
  };
}

export const DEFAULT_BRANDINGS: Array<Omit<PortalBranding, 'updatedAt'>> = [
  {
    merchantId: 'default',
    brandName: 'SubTrackr',
    colors: { primary: '#3B82F6', secondary: '#2563EB', text: '#111827' },
    fonts: { heading: 'Inter', body: 'Inter' },
  },
];

export class PortalBrandingStore {
  private items = new Map<string, PortalBranding>();

  constructor(seedDefaults = true) {
    if (seedDefaults) this.reset();
  }

  reset(): void {
    this.items.clear();
    const now = new Date().toISOString();
    for (const seed of DEFAULT_BRANDINGS) {
      this.items.set(seed.merchantId, { ...seed, colors: { ...seed.colors }, updatedAt: now });
    }
  }

  get(merchantId: string): PortalBranding | undefined {
    return this.items.get(merchantId);
  }

  upsert(merchantId: string, patch: Partial<PortalBranding>): PortalBranding {
    const existing = this.items.get(merchantId);
    const base: PortalBranding =
      existing ?? {
        merchantId,
        brandName: patch.brandName ?? merchantId,
        colors: patch.colors ?? { primary: '#3B82F6' },
        updatedAt: new Date().toISOString(),
      };

    const next: PortalBranding = existing
      ? mergeBranding(existing, { ...patch, merchantId })
      : { ...base, ...patch, merchantId, updatedAt: new Date().toISOString() };

    this.items.set(merchantId, next);
    return next;
  }
}

export const portalBrandingStore = new PortalBrandingStore();
