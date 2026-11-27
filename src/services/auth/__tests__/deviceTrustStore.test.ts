import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PersistedDeviceTrustStore,
  trustCurrentDevice,
  revokeTrustedDevice,
} from '../deviceTrustStore';
import { sensitiveActionGuard } from '../sensitiveActionGuard';

const storage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => storage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    storage[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete storage[key];
  }),
}));

jest.mock('../sensitiveActionGuard', () => ({
  sensitiveActionGuard: {
    authorize: jest.fn(),
  },
}));

const mockedGuard = sensitiveActionGuard as jest.Mocked<typeof sensitiveActionGuard>;

describe('PersistedDeviceTrustStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(storage).forEach((key) => delete storage[key]);
  });

  it('trusts, touches, lists, and revokes devices', async () => {
    const store = new PersistedDeviceTrustStore('@test/trusted-devices');

    const trusted = await store.trust({
      id: 'device-1',
      deviceName: 'Primary phone',
      platform: 'iOS',
    });

    expect(trusted.trustedAt).toBeGreaterThan(0);
    expect(await store.isTrusted('device-1')).toBe(true);
    expect(await store.touch('device-1')).not.toBeNull();
    expect(await store.list()).toHaveLength(1);
    await expect(store.revoke('device-1')).resolves.toBe(true);
    await expect(store.isTrusted('device-1')).resolves.toBe(false);
  });

  it('does not change trust for an unknown device', async () => {
    const store = new PersistedDeviceTrustStore('@test/trusted-devices');

    await expect(store.touch('missing')).resolves.toBeNull();
    await expect(store.revoke('missing')).resolves.toBe(false);
  });

  it('revokes every device except the current one and reports the count', async () => {
    const store = new PersistedDeviceTrustStore('@test/trusted-devices');
    await store.trust({ id: 'device-1', deviceName: 'Phone', platform: 'iOS' });
    await store.trust({ id: 'device-2', deviceName: 'Tablet', platform: 'iPadOS' });

    await expect(store.revokeAllExcept('device-1')).resolves.toBe(1);
    await expect(store.isTrusted('device-1')).resolves.toBe(true);
    await expect(store.isTrusted('device-2')).resolves.toBe(false);
  });

  it('requires successful re-auth before trusting a device', async () => {
    mockedGuard.authorize.mockResolvedValue({
      allowed: true,
      code: 'allowed',
      required: true,
      fellBack: false,
    });
    const store = new PersistedDeviceTrustStore('@test/trusted-devices');

    await expect(
      trustCurrentDevice(store, {
        id: 'device-1',
        deviceName: 'Phone',
        platform: 'iOS',
      })
    ).resolves.toMatchObject({ id: 'device-1' });
    expect(mockedGuard.authorize).toHaveBeenCalledWith('trust_device');
  });

  it('does not trust or revoke when re-authentication fails', async () => {
    mockedGuard.authorize.mockResolvedValue({
      allowed: false,
      code: 'cancelled',
      required: true,
      fellBack: false,
      message: 'Authentication cancelled.',
    });
    const store = new PersistedDeviceTrustStore('@test/trusted-devices');

    await expect(
      trustCurrentDevice(store, {
        id: 'device-1',
        deviceName: 'Phone',
        platform: 'iOS',
      })
    ).rejects.toThrow('Authentication cancelled');
    await expect(revokeTrustedDevice(store, 'device-1')).rejects.toThrow(
      'Authentication cancelled'
    );
    await expect(store.list()).resolves.toEqual([]);
  });

  it('recovers from corrupt storage', async () => {
    storage['@test/trusted-devices'] = '{bad json';
    const store = new PersistedDeviceTrustStore('@test/trusted-devices');

    await expect(store.list()).resolves.toEqual([]);
  });
});
