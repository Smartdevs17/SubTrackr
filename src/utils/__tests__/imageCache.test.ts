import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { ImageCacheManager } from '../imageCache';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-image', () => ({
  Image: {
    prefetch: jest.fn(),
    clearDiskCache: jest.fn(),
  },
}));

const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockImage = Image as jest.Mocked<typeof Image>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCache(options = {}) {
  return new ImageCacheManager(options);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.getItem.mockResolvedValue(null);
  mockStorage.setItem.mockResolvedValue(undefined);
  mockStorage.removeItem.mockResolvedValue(undefined);
  mockImage.prefetch.mockResolvedValue(true);
  mockImage.clearDiskCache.mockResolvedValue(true);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ImageCacheManager', () => {
  describe('hydrate', () => {
    it('loads existing entries from AsyncStorage', async () => {
      const now = Date.now();
      const entry = {
        url: 'https://example.com/icon.png',
        cachedAt: now,
        expiresAt: now + 10000,
        lastAccessedAt: now,
      };
      mockStorage.getItem.mockResolvedValueOnce(JSON.stringify([entry]));

      const cache = makeCache();
      await cache.hydrate();

      expect(await cache.isCached('https://example.com/icon.png')).toBe(true);
    });

    it('handles missing AsyncStorage data gracefully', async () => {
      mockStorage.getItem.mockResolvedValueOnce(null);
      const cache = makeCache();
      await expect(cache.hydrate()).resolves.not.toThrow();
      expect(cache.size).toBe(0);
    });

    it('handles AsyncStorage read errors gracefully', async () => {
      mockStorage.getItem.mockRejectedValueOnce(new Error('storage error'));
      const cache = makeCache();
      await expect(cache.hydrate()).resolves.not.toThrow();
      expect(cache.size).toBe(0);
    });

    it('only hydrates once', async () => {
      const cache = makeCache();
      await cache.hydrate();
      await cache.hydrate();
      expect(mockStorage.getItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('register', () => {
    it('adds a new URL to the index', async () => {
      const cache = makeCache();
      await cache.register('https://example.com/icon.png');
      expect(cache.size).toBe(1);
    });

    it('persists the index to AsyncStorage', async () => {
      const cache = makeCache();
      await cache.register('https://example.com/icon.png');
      expect(mockStorage.setItem).toHaveBeenCalled();
    });

    it('updates lastAccessedAt for an existing non-expired entry', async () => {
      const cache = makeCache();
      await cache.register('https://example.com/icon.png');
      const callCount = mockStorage.setItem.mock.calls.length;
      await cache.register('https://example.com/icon.png');
      // Should persist again with updated timestamp
      expect(mockStorage.setItem.mock.calls.length).toBeGreaterThan(callCount);
      expect(cache.size).toBe(1); // no duplicate
    });

    it('evicts the LRU entry when at capacity', async () => {
      const cache = makeCache({ maxEntries: 2 });

      await cache.register('https://example.com/a.png');
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 1));
      await cache.register('https://example.com/b.png');
      await new Promise((r) => setTimeout(r, 1));
      // Access 'a' again to make 'b' the LRU
      await cache.register('https://example.com/a.png');
      await new Promise((r) => setTimeout(r, 1));
      // Adding 'c' should evict 'b' (least recently accessed)
      await cache.register('https://example.com/c.png');

      expect(cache.size).toBe(2);
      expect(await cache.isCached('https://example.com/b.png')).toBe(false);
      expect(await cache.isCached('https://example.com/a.png')).toBe(true);
      expect(await cache.isCached('https://example.com/c.png')).toBe(true);
    });
  });

  describe('isCached', () => {
    it('returns true for a registered, non-expired URL', async () => {
      const cache = makeCache();
      await cache.register('https://example.com/icon.png');
      expect(await cache.isCached('https://example.com/icon.png')).toBe(true);
    });

    it('returns false for an unknown URL', async () => {
      const cache = makeCache();
      expect(await cache.isCached('https://example.com/unknown.png')).toBe(false);
    });

    it('returns false for an expired entry', async () => {
      const now = Date.now();
      const expired = {
        url: 'https://example.com/old.png',
        cachedAt: now - 20000,
        expiresAt: now - 1,
        lastAccessedAt: now - 20000,
      };
      mockStorage.getItem.mockResolvedValueOnce(JSON.stringify([expired]));

      const cache = makeCache();
      await cache.hydrate();
      expect(await cache.isCached('https://example.com/old.png')).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('removes the URL from the index', async () => {
      const cache = makeCache();
      await cache.register('https://example.com/icon.png');
      await cache.invalidate('https://example.com/icon.png');
      expect(await cache.isCached('https://example.com/icon.png')).toBe(false);
    });

    it('calls Image.clearDiskCache', async () => {
      const cache = makeCache();
      await cache.register('https://example.com/icon.png');
      await cache.invalidate('https://example.com/icon.png');
      expect(mockImage.clearDiskCache).toHaveBeenCalled();
    });

    it('handles clearDiskCache errors gracefully', async () => {
      mockImage.clearDiskCache.mockRejectedValueOnce(new Error('disk error'));
      const cache = makeCache();
      await cache.register('https://example.com/icon.png');
      await expect(cache.invalidate('https://example.com/icon.png')).resolves.not.toThrow();
    });
  });

  describe('preload', () => {
    it('calls Image.prefetch with valid URLs', async () => {
      const cache = makeCache();
      await cache.preload(['https://example.com/a.png', 'https://example.com/b.png']);
      expect(mockImage.prefetch).toHaveBeenCalledWith([
        'https://example.com/a.png',
        'https://example.com/b.png',
      ]);
    });

    it('registers all preloaded URLs in the index', async () => {
      const cache = makeCache();
      await cache.preload(['https://example.com/a.png', 'https://example.com/b.png']);
      expect(cache.size).toBe(2);
    });

    it('filters out empty/falsy URLs', async () => {
      const cache = makeCache();
      await cache.preload(['', 'https://example.com/a.png', '']);
      expect(mockImage.prefetch).toHaveBeenCalledWith(['https://example.com/a.png']);
    });

    it('does nothing for an empty array', async () => {
      const cache = makeCache();
      await cache.preload([]);
      expect(mockImage.prefetch).not.toHaveBeenCalled();
    });

    it('handles prefetch errors gracefully', async () => {
      mockImage.prefetch.mockRejectedValueOnce(new Error('network error'));
      const cache = makeCache();
      await expect(cache.preload(['https://example.com/a.png'])).resolves.not.toThrow();
    });
  });

  describe('clearAll', () => {
    it('removes all entries from the index', async () => {
      const cache = makeCache();
      await cache.register('https://example.com/a.png');
      await cache.register('https://example.com/b.png');
      await cache.clearAll();
      expect(cache.size).toBe(0);
    });

    it('removes the AsyncStorage key', async () => {
      const cache = makeCache();
      await cache.clearAll();
      expect(mockStorage.removeItem).toHaveBeenCalled();
    });

    it('calls Image.clearDiskCache', async () => {
      const cache = makeCache();
      await cache.clearAll();
      expect(mockImage.clearDiskCache).toHaveBeenCalled();
    });
  });
});
