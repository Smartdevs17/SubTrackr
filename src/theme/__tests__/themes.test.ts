import { darkTheme, lightTheme, createBrandTheme } from '../../theme/themes';

describe('themes', () => {
  it('darkTheme has mode dark', () => {
    expect(darkTheme.mode).toBe('dark');
  });

  it('lightTheme has mode light', () => {
    expect(lightTheme.mode).toBe('light');
  });

  it('createBrandTheme overrides brand colors and preserves base', () => {
    const brand = { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' };
    const t = createBrandTheme(darkTheme, brand, 'test-brand', 'Test Brand');
    expect(t.id).toBe('test-brand');
    expect(t.name).toBe('Test Brand');
    expect(t.colors.primary).toBe('#ff0000');
    expect(t.colors.secondary).toBe('#00ff00');
    expect(t.colors.accent).toBe('#0000ff');
    // non-brand colors preserved
    expect(t.colors.background).toBe(darkTheme.colors.background);
    expect(t.colors.error).toBe(darkTheme.colors.error);
  });
});
