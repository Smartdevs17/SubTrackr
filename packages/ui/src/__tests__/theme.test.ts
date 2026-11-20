import { configureUI, darkUIColors, lightUIColors, resetUI, useUIColors } from '../theme';
import { borderRadius, shadows, spacing, typography } from '../tokens';
import * as appConstants from '../../../../src/utils/constants';

describe('@subtrackr/ui theme bridge', () => {
  afterEach(() => resetUI());

  it('defaults to the light palette when unconfigured', () => {
    expect(useUIColors()).toBe(lightUIColors);
  });

  it('uses the host-provided hook after configureUI', () => {
    configureUI({ useColors: () => darkUIColors });
    expect(useUIColors()).toBe(darkUIColors);
  });

  it('resetUI restores the default', () => {
    configureUI({ useColors: () => darkUIColors });
    resetUI();
    expect(useUIColors()).toBe(lightUIColors);
  });

  it('light and dark palettes define every token the components read', () => {
    for (const p of [lightUIColors, darkUIColors]) {
      expect(p.background.card).toBeTruthy();
      expect(p.text.primary).toBeTruthy();
      expect(p.text.secondary).toBeTruthy();
      expect(p.border.default).toBeTruthy();
      expect(p.brand.primary).toBeTruthy();
      expect(p.onPrimary).toBeTruthy();
    }
  });
});

describe('design tokens', () => {
  it('app constants re-export the package tokens (single source of truth)', () => {
    expect(appConstants.spacing).toBe(spacing);
    expect(appConstants.borderRadius).toBe(borderRadius);
    expect(appConstants.typography).toBe(typography);
    expect(appConstants.shadows).toBe(shadows);
  });

  it('keeps the values existing screens rely on', () => {
    expect(spacing).toMatchObject({ xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 });
    expect(borderRadius.lg).toBe(12);
    expect(typography.fontSize.sm).toBe(14);
    expect(typography.h3).toBeDefined();
    expect(typography.body).toBeDefined();
    expect(shadows.md.elevation).toBe(4);
  });
});
