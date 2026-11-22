import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { DeviceIntegrityBanner } from '../DeviceIntegrityBanner';
import { useDeviceIntegrity } from '../../../hooks/useDeviceIntegrity';

jest.mock('../../../hooks/useDeviceIntegrity');

describe('DeviceIntegrityBanner component', () => {
  const mockDismissBanner = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when device is intact with low risk', () => {
    (useDeviceIntegrity as jest.Mock).mockReturnValue({
      result: {
        isIntact: true,
        isRooted: false,
        isJailbroken: false,
        isTampered: false,
        riskLevel: 'low',
        compromiseIndicators: [],
      },
      isCompromised: false,
      riskLevel: 'low',
      bannerDismissed: false,
      dismissBanner: mockDismissBanner,
    });

    render(<DeviceIntegrityBanner />);
    expect(screen.queryByTestID('device-integrity-banner')).toBeNull();
  });

  it('renders alert when rooted Android device is detected', () => {
    (useDeviceIntegrity as jest.Mock).mockReturnValue({
      result: {
        isIntact: false,
        isRooted: true,
        isJailbroken: false,
        isTampered: false,
        riskLevel: 'critical',
        compromiseIndicators: ['android_root_path:/sbin/su'],
        degradationPolicy: {
          warningMessage: 'Critical security risk: Root detected.',
        },
      },
      isCompromised: true,
      riskLevel: 'critical',
      bannerDismissed: false,
      dismissBanner: mockDismissBanner,
    });

    render(<DeviceIntegrityBanner />);
    expect(screen.getByTestID('device-integrity-banner')).toBeTruthy();
    expect(screen.getByText('Rooted Android Device Detected')).toBeTruthy();
    expect(screen.getByText('SECURITY ALERT')).toBeTruthy();
  });

  it('renders alert when jailbroken iOS device is detected', () => {
    (useDeviceIntegrity as jest.Mock).mockReturnValue({
      result: {
        isIntact: false,
        isRooted: false,
        isJailbroken: true,
        isTampered: false,
        riskLevel: 'critical',
        compromiseIndicators: ['ios_jailbreak_path:/Applications/Cydia.app'],
        degradationPolicy: {
          warningMessage: 'Critical security risk: Jailbreak detected.',
        },
      },
      isCompromised: true,
      riskLevel: 'critical',
      bannerDismissed: false,
      dismissBanner: mockDismissBanner,
    });

    render(<DeviceIntegrityBanner />);
    expect(screen.getByTestID('device-integrity-banner')).toBeTruthy();
    expect(screen.getByText('Jailbroken iOS Device Detected')).toBeTruthy();
  });

  it('toggles details when show details is pressed', () => {
    (useDeviceIntegrity as jest.Mock).mockReturnValue({
      result: {
        isIntact: false,
        isRooted: true,
        isJailbroken: false,
        isTampered: false,
        riskLevel: 'critical',
        compromiseIndicators: ['android_root_path:/sbin/su'],
      },
      isCompromised: true,
      riskLevel: 'critical',
      bannerDismissed: false,
      dismissBanner: mockDismissBanner,
    });

    render(<DeviceIntegrityBanner />);
    expect(screen.queryByTestID('device-integrity-details')).toBeNull();

    fireEvent.press(screen.getByText('Show details'));
    expect(screen.getByTestID('device-integrity-details')).toBeTruthy();
    expect(screen.getByText('• android_root_path:/sbin/su')).toBeTruthy();

    fireEvent.press(screen.getByText('Hide details'));
    expect(screen.queryByTestID('device-integrity-details')).toBeNull();
  });

  it('calls dismissBanner when close button is clicked', () => {
    (useDeviceIntegrity as jest.Mock).mockReturnValue({
      result: {
        isIntact: false,
        isRooted: true,
        isJailbroken: false,
        isTampered: false,
        riskLevel: 'critical',
        compromiseIndicators: ['android_root_path:/sbin/su'],
      },
      isCompromised: true,
      riskLevel: 'critical',
      bannerDismissed: false,
      dismissBanner: mockDismissBanner,
    });

    render(<DeviceIntegrityBanner />);
    fireEvent.press(screen.getByTestID('device-integrity-dismiss'));
    expect(mockDismissBanner).toHaveBeenCalledTimes(1);
  });
});
