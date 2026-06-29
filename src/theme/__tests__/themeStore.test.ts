import { useThemeStore } from '../../theme/themeStore';
import { darkTheme } from '../../theme/themes';
import type { ThemeConfig, ThemeExportData, ThemeVariantPair } from '../types';

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
  useThemeStore.setState({
    activeThemeId: darkTheme.id,
    customThemes: [],
    themeVariantPairs: [],
    theme: darkTheme,
  });

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

  it('addBrandTheme creates and activates a custom theme with accessibility info', () => {
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
    expect(s.theme.accessibility).toBeDefined();
    expect(s.theme.isCustom).toBe(true);
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

  it('allThemes returns built-in + custom + variant pair themes', () => {
    useThemeStore
      .getState()
      .addBrandTheme(
        { primary: '#aabbcc', secondary: '#112233', accent: '#445566' },
        'brand-x',
        'Brand X'
      );
    expect(useThemeStore.getState().allThemes().length).toBeGreaterThanOrEqual(4);
  });

  it('setTheme with unknown id falls back to dark', () => {
    useThemeStore.getState().setTheme('does-not-exist');
    expect(useThemeStore.getState().theme.id).toBe('dark');
  });

  it('updateCustomTheme modifies theme and recomputes accessibility', () => {
    const store = useThemeStore.getState();
    store.addBrandTheme(
      { primary: '#aabbcc', secondary: '#112233', accent: '#445566' },
      'brand-x',
      'Brand X'
    );
    useThemeStore.getState().updateCustomTheme('brand-x', {
      colors: { primary: '#ff0000', secondary: '#112233', accent: '#445566' },
    });
    const s = useThemeStore.getState();
    expect(s.theme.colors.primary).toBe('#ff0000');
    expect(s.theme.accessibility).toBeDefined();
  });

  it('startPreview enters preview mode with original theme saved', () => {
    useThemeStore.getState().startPreview({
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    });
    const s = useThemeStore.getState();
    expect(s.preview.isPreviewing).toBe(true);
    expect(s.preview.originalThemeId).toBe('dark');
    expect(s.preview.previewConfig).toBeDefined();
  });

  it('updatePreview updates preview config during preview', () => {
    useThemeStore.getState().startPreview({
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    });
    useThemeStore.getState().updatePreview({
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    });
    const s = useThemeStore.getState();
    expect(s.preview.previewConfig?.colors?.primary).toBe('#ff0000');
    expect(s.preview.previewConfig?.colors?.secondary).toBe('#00ff00');
  });

  it('applyPreview creates a custom theme from preview config', () => {
    useThemeStore.getState().startPreview({
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    });
    useThemeStore.getState().applyPreview();
    const s = useThemeStore.getState();
    expect(s.preview.isPreviewing).toBe(false);
    expect(s.customThemes.length).toBeGreaterThanOrEqual(1);
  });

  it('discardPreview restores original theme', () => {
    useThemeStore.getState().setTheme('light');
    useThemeStore.getState().startPreview({
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    });
    useThemeStore.getState().discardPreview();
    const s = useThemeStore.getState();
    expect(s.preview.isPreviewing).toBe(false);
    expect(s.activeThemeId).toBe('light');
  });

  it('exportTheme produces valid export data', () => {
    const theme = useThemeStore.getState().theme;
    const exported = useThemeStore.getState().exportTheme(theme);
    expect(exported.version).toBe('1.0.0');
    expect(exported.exportedAt).toBeDefined();
    expect(exported.theme.shared).toBeDefined();
  });

  it('importTheme loads a theme from export data', () => {
    const exportData: ThemeExportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      theme: {
        light: {
          colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
        },
        shared: { id: 'imported-test', name: 'Imported Test' },
      },
    };
    useThemeStore.getState().importTheme(exportData);
    const s = useThemeStore.getState();
    expect(s.activeThemeId).toContain('imported-test');
    expect(s.theme.colors.primary).toBe('#ff0000');
    expect(s.customThemes.length).toBeGreaterThanOrEqual(1);
  });

  it('addThemeVariantPair stores light/dark pair', () => {
    const pair: ThemeVariantPair = {
      light: { ...darkTheme, id: 'test-brand-light', mode: 'light', name: 'Test Light' },
      dark: { ...darkTheme, id: 'test-brand-dark', mode: 'dark', name: 'Test Dark' },
      sharedConfig: { id: 'test-brand', name: 'Test Brand' },
    };
    useThemeStore.getState().addThemeVariantPair(pair);
    expect(useThemeStore.getState().themeVariantPairs).toHaveLength(1);
  });

  it('removeThemeVariantPair removes pair and falls back if active', () => {
    const pair: ThemeVariantPair = {
      light: { ...darkTheme, id: 'test-brand-light', mode: 'light', name: 'Test Light' },
      dark: { ...darkTheme, id: 'test-brand-dark', mode: 'dark', name: 'Test Dark' },
      sharedConfig: { id: 'test-brand', name: 'Test Brand' },
    };
    useThemeStore.getState().addThemeVariantPair(pair);
    useThemeStore.getState().setTheme('test-brand-light');
    useThemeStore.getState().removeThemeVariantPair('test-brand');
    const s = useThemeStore.getState();
    expect(s.themeVariantPairs).toHaveLength(0);
    expect(s.activeThemeId).toBe('dark');
  });

  it('getVariantPair returns the correct pair', () => {
    const pair: ThemeVariantPair = {
      light: { ...darkTheme, id: 'test-brand-light', mode: 'light', name: 'Test Light' },
      dark: { ...darkTheme, id: 'test-brand-dark', mode: 'dark', name: 'Test Dark' },
      sharedConfig: { id: 'test-brand', name: 'Test Brand' },
    };
    useThemeStore.getState().addThemeVariantPair(pair);
    const found = useThemeStore.getState().getVariantPair('test-brand');
    expect(found).toBeDefined();
    expect(found?.sharedConfig.name).toBe('Test Brand');
  });
});
