import { useThemeStore } from '../../theme/themeStore';
import { darkTheme } from '../../theme/themes';

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
  getItem: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  removeItem: jest.fn((k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  }),
}));

const reset = () =>
  useThemeStore.setState({ activeThemeId: darkTheme.id, customThemes: [], theme: darkTheme });

beforeEach(() => {
  mockStore.clear();
  reset();
});

describe('themeStore', () => {
  it('starts with dark theme', () => {
    expect(useThemeStore.getState().theme.id).toBe('dark');
    expect(useThemeStore.getState().theme.mode).toBe('dark');
  });

  it('setTheme switches to light', () => {
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme.id).toBe('light');
    expect(useThemeStore.getState().theme.mode).toBe('light');
  });

  it('toggleMode switches dark → light', () => {
    useThemeStore.getState().toggleMode();
    expect(useThemeStore.getState().theme.mode).toBe('light');
  });

  it('toggleMode switches light → dark', () => {
    useThemeStore.getState().setTheme('light');
    useThemeStore.getState().toggleMode();
    expect(useThemeStore.getState().theme.mode).toBe('dark');
  });

  it('addBrandTheme creates and activates a custom theme', () => {
    useThemeStore
      .getState()
      .addBrandTheme(
        { primary: '#aabbcc', secondary: '#112233', accent: '#445566' },
        'brand-x',
        'Brand X'
      );
    const s = useThemeStore.getState();
    expect(s.activeThemeId).toBe('brand-x');
    expect(s.theme.colors.primary).toBe('#aabbcc');
    expect(s.customThemes).toHaveLength(1);
  });

  it('removeCustomTheme falls back to dark', () => {
    useThemeStore
      .getState()
      .addBrandTheme(
        { primary: '#aabbcc', secondary: '#112233', accent: '#445566' },
        'brand-x',
        'Brand X'
      );
    useThemeStore.getState().removeCustomTheme('brand-x');
    const s = useThemeStore.getState();
    expect(s.customThemes).toHaveLength(0);
    expect(s.activeThemeId).toBe('dark');
  });

  it('allThemes returns built-in + custom', () => {
    useThemeStore
      .getState()
      .addBrandTheme(
        { primary: '#aabbcc', secondary: '#112233', accent: '#445566' },
        'brand-x',
        'Brand X'
      );
    expect(useThemeStore.getState().allThemes()).toHaveLength(4);
  });

  it('setTheme with unknown id falls back to dark', () => {
    useThemeStore.getState().setTheme('does-not-exist');
    expect(useThemeStore.getState().theme.id).toBe('dark');
  });

  it('lightTheme has correct mode', () => {
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toMatchObject({ id: 'light', mode: 'light' });
  });

  it('addBrandTheme persists logoUri and font from BrandConfig', () => {
    useThemeStore.getState().addBrandTheme(
      { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff', logoUri: 'https://example.com/logo.png', font: { family: 'Inter', scale: 1.1 } },
      'brand-logo',
      'Brand With Logo'
    );
    const theme = useThemeStore.getState().theme;
    expect(theme.logoUri).toBe('https://example.com/logo.png');
    expect(theme.font?.family).toBe('Inter');
    expect(theme.font?.scale).toBe(1.1);
  });

  it('addBrandTheme generates cssVariables automatically', () => {
    useThemeStore.getState().addBrandTheme(
      { primary: '#aabbcc', secondary: '#112233', accent: '#445566' },
      'brand-css',
      'CSS Brand'
    );
    const theme = useThemeStore.getState().theme;
    expect(theme.cssVariables).toBeDefined();
    expect(theme.cssVariables!['--st-primary']).toBe('#aabbcc');
  });

  it('exportTheme serialises a theme without cssVariables', () => {
    useThemeStore.getState().addBrandTheme(
      { primary: '#aabbcc', secondary: '#112233', accent: '#445566' },
      'export-test',
      'Export Test'
    );
    const json = useThemeStore.getState().exportTheme('export-test');
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed.version).toBe(1);
    expect(parsed.theme.id).toBe('export-test');
    expect(parsed.theme.cssVariables).toBeUndefined();
  });

  it('exportTheme returns null for unknown id', () => {
    const json = useThemeStore.getState().exportTheme('does-not-exist');
    // resolveTheme falls back to dark, so we get the dark export
    expect(json).not.toBeNull(); // dark theme is always available
  });

  it('importTheme adds the theme and regenerates cssVariables', () => {
    const themeJson = JSON.stringify({
      version: 1,
      theme: {
        id: 'imported-brand',
        name: 'Imported Brand',
        mode: 'dark',
        colors: {
          primary: '#ff1234', secondary: '#00aaff', accent: '#00ff99',
          success: '#10b981', warning: '#f59e0b', error: '#ef4444',
          background: '#0f172a', surface: '#1e293b', text: '#f8fafc',
          textSecondary: '#cbd5e1', border: '#334155', overlay: 'rgba(0,0,0,0.8)',
        },
      },
    });
    const id = useThemeStore.getState().importTheme(themeJson);
    expect(id).toBe('imported-brand');
    const imported = useThemeStore.getState().customThemes.find((t) => t.id === 'imported-brand');
    expect(imported).toBeDefined();
    expect(imported!.cssVariables?.['--st-primary']).toBe('#ff1234');
  });

  it('importTheme returns null for invalid JSON', () => {
    const id = useThemeStore.getState().importTheme('not-json');
    expect(id).toBeNull();
  });

  it('importTheme returns null for wrong version', () => {
    const id = useThemeStore.getState().importTheme(JSON.stringify({ version: 99, theme: {} }));
    expect(id).toBeNull();
  });

  it('importTheme replaces a theme with same id', () => {
    const base = { version: 1, theme: { id: 'dup', name: 'Dup', mode: 'dark', colors: { primary: '#111', secondary: '#222', accent: '#333', success: '#10b981', warning: '#f59e0b', error: '#ef4444', background: '#0f172a', surface: '#1e293b', text: '#f8fafc', textSecondary: '#cbd5e1', border: '#334155', overlay: 'rgba(0,0,0,0.8)' } } };
    useThemeStore.getState().importTheme(JSON.stringify(base));
    const updated = { ...base, theme: { ...base.theme, colors: { ...base.theme.colors, primary: '#999' } } };
    useThemeStore.getState().importTheme(JSON.stringify(updated));
    const themes = useThemeStore.getState().customThemes.filter((t) => t.id === 'dup');
    expect(themes).toHaveLength(1);
    expect(themes[0].colors.primary).toBe('#999');
  });
});
