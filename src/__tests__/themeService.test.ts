import { themeService } from '../services/themeService';
import { darkTheme } from '../theme/themes';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    setItem: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    getItem: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    removeItem: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
});

describe('themeService', () => {
  it('fetchThemes returns empty array when no themes saved', async () => {
    const result = await themeService.fetchThemes();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('saveTheme stores a theme record', async () => {
    const result = await themeService.saveTheme(darkTheme);
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(darkTheme.id);
    expect(result.data?.config.colors.primary).toBe(darkTheme.colors.primary);
  });

  it('fetchThemes returns saved themes', async () => {
    await themeService.saveTheme(darkTheme);
    const result = await themeService.fetchThemes();
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it('deleteTheme removes a theme', async () => {
    await themeService.saveTheme(darkTheme);
    await themeService.deleteTheme(darkTheme.id);
    const result = await themeService.fetchThemes();
    expect(result.data?.length).toBe(0);
  });

  it('exportTheme produces valid export data', async () => {
    const exported = await themeService.exportTheme(darkTheme);
    expect(exported.version).toBe('1.0.0');
    expect(exported.theme.dark).toBeDefined();
    expect(exported.theme.shared.id).toBe(darkTheme.id);
  });

  it('importTheme loads a theme from export data', async () => {
    const exported = await themeService.exportTheme(darkTheme);
    const result = await themeService.importTheme(exported);
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(`${darkTheme.id}-dark`);
  });

  it('syncThemesToRemote saves multiple themes', async () => {
    const result = await themeService.syncThemesToRemote([darkTheme]);
    expect(result.success).toBe(true);
    expect(result.data?.synced).toBe(1);
  });
});
