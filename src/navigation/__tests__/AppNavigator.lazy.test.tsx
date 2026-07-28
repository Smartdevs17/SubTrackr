import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { lazyWithRetry, LazyErrorBoundary, SuspenseLoadingFallback } from '../../utils/lazyLoading';

// Mock react-native completely with pass-through elements so testID is fully discoverable by testing-library
jest.mock('react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mockReact = require('react') as typeof import('react');
  return {
    View: ({
      children,
      testID,
      style,
    }: {
      children?: React.ReactNode;
      testID?: string;
      style?: object;
    }) => mockReact.createElement('View', { testID, style }, children),
    Text: ({
      children,
      testID,
      style,
    }: {
      children?: React.ReactNode;
      testID?: string;
      style?: object;
    }) => mockReact.createElement('Text', { testID, style }, children),
    ActivityIndicator: ({ color }: { color?: string }) =>
      mockReact.createElement('ActivityIndicator', { color }),
    TouchableOpacity: ({
      children,
      onPress,
      style,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      style?: object;
      testID?: string;
    }) => mockReact.createElement('TouchableOpacity', { onPress, style, testID }, children),
    InteractionManager: {
      runAfterInteractions: (cb: () => void) => cb(),
    },
    StyleSheet: {
      create: (styles: object) => styles,
      flatten: (styles: object) => styles,
    },
    Platform: {
      OS: 'ios',
    },
  };
});

// Mocking design system constants
jest.mock('../../utils/constants', () => ({
  colors: {
    primary: '#6366f1',
    secondary: '#8b5cf6',
    accent: '#06b6d4',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    textSecondary: '#cbd5e1',
    onPrimary: '#ffffff',
    border: '#334155',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
  },
  typography: {
    h3: { fontSize: 20 },
    body: { fontSize: 16 },
    body2: { fontSize: 14 },
    button: { fontSize: 16 },
  },
  shadows: {
    sm: {},
    md: {},
    lg: {},
  },
}));

const DummyComponent = () => <Text testID="dummy-component">Loaded Content Successfully</Text>;

describe('Lazy Loading Utilities & Error Boundaries', () => {
  it('renders SuspenseLoadingFallback correctly', () => {
    const { getByTestId, getByText } = render(<SuspenseLoadingFallback />);
    expect(getByTestId('lazy-loading-fallback')).toBeTruthy();
    expect(getByText('Preparing premium modules...')).toBeTruthy();
  });

  it('lazyWithRetry resolves successfully on initial attempt', async () => {
    const importFn = jest.fn().mockResolvedValue({ default: DummyComponent });
    const lazyComponent = lazyWithRetry(importFn) as unknown as {
      _payload: { _result: () => Promise<{ default: typeof DummyComponent }> };
    };

    const loadFn = lazyComponent._payload._result;
    const result = await loadFn();

    expect(result.default).toBe(DummyComponent);
    expect(importFn).toHaveBeenCalledTimes(1);
  });

  it('lazyWithRetry retries on failure and resolves on second attempt', async () => {
    let called = 0;
    const importFn = jest.fn().mockImplementation(() => {
      called++;
      if (called === 1) {
        return Promise.reject(new Error('Transient connection drop'));
      }
      return Promise.resolve({ default: DummyComponent });
    });

    const lazyComponent = lazyWithRetry(importFn, 2, 5) as unknown as {
      _payload: { _result: () => Promise<{ default: typeof DummyComponent }> };
    };
    const loadFn = lazyComponent._payload._result;
    const result = await loadFn();

    expect(result.default).toBe(DummyComponent);
    expect(importFn).toHaveBeenCalledTimes(2);
  });

  it('LazyErrorBoundary catches loading failures and renders interactive retry screen', async () => {
    let shouldThrow = true;
    const FailingComponent = () => {
      if (shouldThrow) {
        throw new Error('All retries failed');
      }
      return <Text testID="recovered-component">Recovered!</Text>;
    };

    // Suppress console.error to keep the logs clean during expected test failure
    const originalConsoleError = console.error;
    console.error = jest.fn();

    try {
      const { getByTestId, getByText } = render(
        <LazyErrorBoundary>
          <FailingComponent />
        </LazyErrorBoundary>
      );

      expect(getByTestId('lazy-error-fallback')).toBeTruthy();
      expect(getByText('Connection Interrupted')).toBeTruthy();

      // Disable throwing state before retry click
      shouldThrow = false;

      const retryButton = getByText('Try Again');
      fireEvent.press(retryButton);

      expect(getByTestId('recovered-component')).toBeTruthy();
    } finally {
      console.error = originalConsoleError;
    }
  });
});
