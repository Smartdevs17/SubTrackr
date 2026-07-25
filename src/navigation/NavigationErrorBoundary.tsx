import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useNavigation, NavigationState } from '@react-navigation/native';

interface NavigationErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: { componentStack: string }) => void;
}

interface NavigationErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class NavigationErrorBoundary extends React.Component<
  NavigationErrorBoundaryProps,
  NavigationErrorBoundaryState
> {
  constructor(props: NavigationErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): NavigationErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[NavigationErrorBoundary]', error, errorInfo);
    this.props.onError?.(error, { componentStack: errorInfo.componentStack || '' });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <Text style={styles.title}>Navigation Error</Text>
          <Text style={styles.message}>
            {this.state.error?.message || 'An unexpected navigation error occurred.'}
          </Text>
          <Text
            style={styles.retry}
            onPress={() => this.setState({ hasError: false, error: null })}>
            Tap to retry
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ef4444',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#cbd5e1',
    textAlign: 'center',
    marginBottom: 16,
  },
  retry: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
  },
});
