import React from 'react';
import { render, RenderOptions } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider, initialWindowMetrics, Metrics } from 'react-native-safe-area-context';
import { ThemeProvider } from './context/ThemeContext';

// Under Jest there is no native layout pass, so `initialWindowMetrics` is null
// and `SafeAreaProvider` would withhold its children until an onLayout event
// that never fires. Providing concrete metrics makes it render synchronously.
const TEST_METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * Shared render wrapper for component interaction tests.
 *
 * Wraps the component under test in the providers the app relies on at runtime
 * (safe-area + navigation context) so individual suites never have to repeat
 * provider setup. Screens that need a fully mocked `useNavigation` should mock
 * `@react-navigation/native` directly; the real `NavigationContainer` here is a
 * harmless no-op in that case.
 */
interface WrapperProps {
  children: React.ReactNode;
}

const AllProviders = ({ children }: WrapperProps) => (
  <ThemeProvider>
    <SafeAreaProvider initialMetrics={initialWindowMetrics ?? TEST_METRICS}>
      <NavigationContainer>{children}</NavigationContainer>
    </SafeAreaProvider>
  </ThemeProvider>
);

const customRender = (ui: React.ReactElement, options?: RenderOptions) =>
  render(ui, { wrapper: AllProviders, ...options });

// Re-export everything from RNTL so suites import from a single place.
export * from '@testing-library/react-native';

// Override `render` with the provider-wrapped version.
export { customRender as render };
