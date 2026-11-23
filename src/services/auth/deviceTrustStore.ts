import AsyncStorage from '@react-native-async-storage/async-storage';
import { sensitiveActionGuard } from './sensitiveActionGuard';

export interface TrustedDevice {
  id: string;
  deviceName: string;
  platform: string;
  trustedAt: number;
  lastSeenAt: number;
}

export interface DeviceTrustStore {
  list(): Promise<TrustedDevice[]>;
  isTrusted(deviceId: string): Promise<boolean>;
  trust(device: Omit<TrustedDevice, 'trustedAt' | 'lastSeenAt'>): Promise<TrustedDevice>;
  touch(deviceId: string): Promise<TrustedDevice | null>;
  revoke(deviceId: string): Promise<boolean>;
  revokeAllExcept(deviceId: string): Promise<number>;
}

export class PersistedDeviceTrustStore implements DeviceTrustStore {
  constructor(private readonly storageKey = '@subtrackr_trusted_devices') {}

  private async read(): Promise<TrustedDevice[]> {
    try {
      const raw = await AsyncStorage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TrustedDevice[]) : [];
    } catch {
      return [];
    }
  }

  private async write(devices: TrustedDevice[]): Promise<void> {
    await AsyncStorage.setItem(this.storageKey, JSON.stringify(devices));
  }

  async list(): Promise<TrustedDevice[]> {
    return (await this.read()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async isTrusted(deviceId: string): Promise<boolean> {
    return (await this.read()).some((device) => device.id === deviceId);
  }

  async trust(device: Omit<TrustedDevice, 'trustedAt' | 'lastSeenAt'>): Promise<TrustedDevice> {
    const now = Date.now();
    const devices = await this.read();
    const existing = devices.find((item) => item.id === device.id);
    const trusted: TrustedDevice = existing
      ? { ...existing, ...device, lastSeenAt: now }
      : { ...device, trustedAt: now, lastSeenAt: now };

    await this.write([trusted, ...devices.filter((item) => item.id !== device.id)]);
    return trusted;
  }

  async touch(deviceId: string): Promise<TrustedDevice | null> {
    const devices = await this.read();
    const existing = devices.find((device) => device.id === deviceId);
    if (!existing) return null;

    const touched = { ...existing, lastSeenAt: Date.now() };
    await this.write([touched, ...devices.filter((device) => device.id !== deviceId)]);
    return touched;
  }

  async revoke(deviceId: string): Promise<boolean> {
    const devices = await this.read();
    const next = devices.filter((device) => device.id !== deviceId);
    if (next.length === devices.length) return false;
    await this.write(next);
    return true;
  }

  async revokeAllExcept(deviceId: string): Promise<number> {
    const devices = await this.read();
    const retained = devices.filter((device) => device.id === deviceId);
    await this.write(retained);
    return devices.length - retained.length;
  }
}

export async function trustCurrentDevice(
  store: DeviceTrustStore,
  device: Omit<TrustedDevice, 'trustedAt' | 'lastSeenAt'>
): Promise<TrustedDevice> {
  const result = await sensitiveActionGuard.authorize('trust_device');
  if (!result.allowed) {
    throw new Error(result.message ?? 'Biometric re-authentication is required to trust a device');
  }
  return store.trust(device);
}

export async function revokeTrustedDevice(
  store: DeviceTrustStore,
  deviceId: string
): Promise<boolean> {
  const result = await sensitiveActionGuard.authorize('revoke_trusted_device');
  if (!result.allowed) {
    throw new Error(
      result.message ?? 'Biometric re-authentication is required to revoke a trusted device'
    );
  }
  return store.revoke(deviceId);
}

export const deviceTrustStore = new PersistedDeviceTrustStore();
