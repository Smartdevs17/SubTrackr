import { darkTheme, lightTheme, highContrastTheme, createBrandTheme } from '../../theme/themes';

describe('themes', () => {
  it('darkTheme has mode dark', () => {
    expect(darkTheme.mode).toBe('dark');
  });

  it('lightTheme has mode light', () => {
    expect(lightTheme.mode).toBe('light');
  });

  it('highContrastTheme has high contrast colors', () => {
    expect(highContrastTheme.id).toBe('high-contrast');
    expect(highContrastTheme.colors.background).toBe('#000000');
    expect(highContrastTheme.colors.text).toBe('#ffffff');
  });

  it('createBrandTheme overrides brand colors and preserves base', () => {
    const brand = { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' };
    const t = createBrandTheme(darkTheme, brand, 'test-brand', 'Test Brand');
    expect(t.id).toBe('test-brand');
    expect(t.name).toBe('Test Brand');
    expect(t.colors.primary).toBe('#ff0000');
    expect(t.colors.secondary).toBe('#00ff00');
    expect(t.colors.accent).toBe('#0000ff');
    expect(t.colors.background).toBe(darkTheme.colors.background);
    expect(t.colors.error).toBe(darkTheme.colors.error);
  });

  it('createBrandTheme generates extended colors', () => {
    const brand = { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' };
    const t = createBrandTheme(darkTheme, brand, 'test-brand', 'Test Brand');
    expect(t.extendedColors).toBeDefined();
    expect(t.extendedColors?.onPrimary).toBeDefined();
    expect(t.extendedColors?.primaryLight).toBeDefined();
  });

  it('createBrandTheme marks theme as custom', () => {
    const brand = { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' };
    const t = createBrandTheme(darkTheme, brand, 'test-brand', 'Test Brand');
    expect(t.isCustom).toBe(true);
    expect(t.createdAt).toBeDefined();
    expect(t.updatedAt).toBeDefined();
  });
});
