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
});
