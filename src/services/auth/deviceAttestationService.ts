import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const DEVICE_INTEGRITY_KEY = '@subtrackr/device_integrity';

export interface DeviceIntegrityResult {
  isIntact: boolean;
  isRooted: boolean;
  isEmulator: boolean;
  attestedAt: number;
}

class DeviceAttestationService {
  async checkIntegrity(): Promise<DeviceIntegrityResult> {
    const isRooted = await this.detectRootOrJailbreak();
    const isEmulator = this.detectEmulator();

    const result: DeviceIntegrityResult = {
      isIntact: !isRooted && !isEmulator,
      isRooted,
      isEmulator,
      attestedAt: Date.now(),
    };

    await AsyncStorage.setItem(DEVICE_INTEGRITY_KEY, JSON.stringify(result));
    return result;
  }

  async getCachedIntegrity(): Promise<DeviceIntegrityResult | null> {
    try {
      const raw = await AsyncStorage.getItem(DEVICE_INTEGRITY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async detectRootOrJailbreak(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      return this.detectJailbreak();
    }
    if (Platform.OS === 'android') {
      return this.detectRoot();
    }
    return false;
  }

  private detectJailbreak(): boolean {
    // Check for common jailbreak indicators
    // In production, use a native module for file system checks
    try {
      // const indicators = [
      //   '/Applications/Cydia.app',
      //   '/Library/MobileSubstrate/MobileSubstrate.dylib',
      //   '/bin/bash',
      //   '/usr/sbin/sshd',
      //   '/etc/apt',
      //   '/private/var/lib/apt/',
      // ];
      // React Native can't directly check file existence without native module
      // This is a placeholder — in production use react-native-device-info or jail-monkey
      return false;
    } catch {
      return false;
    }
  }

  private detectRoot(): boolean {
    // Check for common root indicators on Android
    // In production, use SafetyNet/Play Integrity API
    try {
      // const indicators = [
      //   '/system/app/Superuser.apk',
      //   '/sbin/su',
      //   '/system/bin/su',
      //   '/system/xbin/su',
      //   '/data/local/xbin/su',
      //   '/data/local/bin/su',
      //   '/system/sd/xbin/su',
      // ];
      return false;
    } catch {
      return false;
    }
  }

  private detectEmulator(): boolean {
    if (Platform.OS === 'android') {
      const brand = (Platform as any).constants?.Brand?.toLowerCase() || '';
      const model = (Platform as any).constants?.Model?.toLowerCase() || '';
      return brand === 'google' && model.includes('sdk');
    }
    return false;
  }
}

export const deviceAttestationService = new DeviceAttestationService();
