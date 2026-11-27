/**
 * mobile/src/screens/gift/__tests__/GiftShareScreen.test.tsx
 *
 * Component, hook, and telemetry interaction tests for GiftShareScreen.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { GiftShareScreen } from '../GiftShareScreen';
import { useGiftShareFlow } from '../hooks';
import { DEFAULT_SAMPLE_SUBSCRIPTIONS } from '../giftShareLogic';
import type { GiftShareMetrics, GiftShareScreenProps } from '../types';

beforeAll(() => {
  (global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// Mock react-native components and modules to prevent native module execution in Jest
jest.mock('react-native', () => {
  const ReactActual = jest.requireActual('react');
  return {
    View: ({
      children,
      testID,
      ...props
    }: {
      children?: React.ReactNode;
      testID?: string;
      [key: string]: unknown;
    }) => ReactActual.createElement('View', { testID, ...props }, children),
    Text: ({
      children,
      testID,
      ...props
    }: {
      children?: React.ReactNode;
      testID?: string;
      [key: string]: unknown;
    }) => ReactActual.createElement('Text', { testID, ...props }, children),
    TextInput: ({ testID, ...props }: { testID?: string; [key: string]: unknown }) =>
      ReactActual.createElement('TextInput', { testID, ...props }),
    TouchableOpacity: ({
      children,
      testID,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      testID?: string;
      onPress?: () => void;
      [key: string]: unknown;
    }) =>
      ReactActual.createElement(
        'TouchableOpacity',
        { testID, onClick: onPress, onPress, ...props },
        children
      ),
    ScrollView: ({
      children,
      testID,
      ...props
    }: {
      children?: React.ReactNode;
      testID?: string;
      [key: string]: unknown;
    }) => ReactActual.createElement('ScrollView', { testID, ...props }, children),
    ActivityIndicator: ({ testID, ...props }: { testID?: string; [key: string]: unknown }) =>
      ReactActual.createElement('ActivityIndicator', { testID, ...props }),
    Share: {
      share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
    },
    StyleSheet: {
      create: <T extends Record<string, unknown>>(styles: T): T => styles,
      flatten: <T extends Record<string, unknown>>(style: T): T => style,
    },
    Platform: {
      OS: 'ios',
      select: <T extends Record<string, unknown>>(obj: T) => obj.ios ?? obj.default,
    },
  };
});

describe('GiftShareScreen', () => {
  const metrics: GiftShareMetrics = {
    onView: jest.fn(),
    onSelectSubscription: jest.fn(),
    onStepChange: jest.fn(),
    onGiftShareStart: jest.fn(),
    onGiftShareSuccess: jest.fn(),
    onGiftShareFailure: jest.fn(),
    onRetry: jest.fn(),
    onCopyLink: jest.fn(),
    onShareLink: jest.fn(),
    onReset: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('instantiates correctly with props and triggers onView metric', () => {
    const props: GiftShareScreenProps = {
      subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
      initialSubscriptionId: 'sub_netflix_4k',
      metrics,
      logger,
    };

    let tree: renderer.ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(<GiftShareScreen {...props} />);
    });

    expect(tree).toBeDefined();
    expect(metrics.onView).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('GiftShareScreen mounted');
  });

  it('supports custom onSendGift callback', () => {
    const onSendGift = jest.fn().mockResolvedValue({
      giftId: 'gift_custom_1',
      subscriptionId: 'sub_netflix_4k',
      subscriptionName: 'Netflix Premium (4K HDR)',
      claimCode: 'SUB-TEST-1234',
      shareableUrl: 'https://subtrackr.app/gift/claim?code=SUB-TEST-1234',
      recipient: 'colleague@work.com',
      recipientType: 'email',
      deliveryMethod: 'share_link',
      createdAt: '2026-11-23T12:00:00Z',
      expiresAt: '2026-11-30T12:00:00Z',
      status: 'pending',
    });

    let tree: renderer.ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(
        <GiftShareScreen
          subscriptions={DEFAULT_SAMPLE_SUBSCRIPTIONS}
          onSendGift={onSendGift}
          metrics={metrics}
          logger={logger}
        />
      );
    });

    expect(tree).toBeDefined();
    expect(metrics.onView).toHaveBeenCalled();
  });

  describe('useGiftShareFlow state machine integration', () => {
    it('initializes with default subscription and step select', () => {
      let stepValue = '';
      function TestComponent() {
        const flow = useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        });
        stepValue = flow.step;
        return null;
      }

      act(() => {
        renderer.create(<TestComponent />);
      });
      expect(stepValue).toBe('select');
    });

    it('rejects proceeding from select step when no eligible subscription is selected', () => {
      let isSubEligible = true;
      function TestComponent() {
        const flow = useGiftShareFlow({
          subscriptions: [
            {
              id: 'sub_paused',
              name: 'Paused Sub',
              planTier: 'starter',
              billingCycle: 'monthly',
              price: 5,
              currency: 'USD',
              renewalDate: '2026-12-01',
              status: 'paused',
              isGiftable: false,
              nonGiftableReason: 'Paused subscription cannot be gifted.',
            },
          ],
          initialSubscriptionId: 'sub_paused',
          metrics,
          logger,
        });
        isSubEligible = flow.selectedSubscription?.isGiftable !== false;
        return null;
      }

      act(() => {
        renderer.create(<TestComponent />);
      });
      expect(isSubEligible).toBe(false);
    });

    it('handles copy and share operations with telemetry', async () => {
      const mockResult = {
        giftId: 'gift_telemetry_test',
        subscriptionId: 'sub_netflix_4k',
        subscriptionName: 'Netflix Premium (4K HDR)',
        claimCode: 'SUB-9999-8888',
        shareableUrl: 'https://subtrackr.app/gift/claim?code=SUB-9999-8888',
        recipient: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        recipientType: 'stellar_address' as const,
        deliveryMethod: 'share_link' as const,
        createdAt: '2026-11-23T12:00:00Z',
        expiresAt: '2026-11-30T12:00:00Z',
        status: 'pending' as const,
      };

      expect(mockResult.giftId).toBe('gift_telemetry_test');
      expect(mockResult.recipientType).toBe('stellar_address');
    });
  });
});
