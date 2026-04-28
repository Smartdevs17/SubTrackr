import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { errorHandler, AppError, ErrorSeverity } from '../services/errorHandler';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Button } from '../components/common/Button';

interface Props {
  children: ReactNode;
  fallback?: (error: AppError, retry: () => void) => ReactNode;
  onError?: (error: AppError) => void;
}

interface State {
  hasError: boolean;
  error: AppError | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Create AppError from the caught error
    const appError = errorHandler.createError(error, {
      component: 'ErrorBoundary',
      action: 'render',
    });

    return {
      hasError: true,
      error: appError,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log additional error info
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Update error context with component stack
    if (this.state.error) {
      this.state.error.context.metadata = {
        ...this.state.error.context.metadata,
        componentStack: errorInfo.componentStack,
      };
    }

    // Call onError callback if provided
    if (this.props.onError && this.state.error) {
      this.props.onError(this.state.error);
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleRetry);
      }

      // Default error UI
      return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  error: AppError;
  onRetry: () => void;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error, onRetry }) => {
  const getSeverityColor = (severity: ErrorSeverity) => {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return colors.error;
      case ErrorSeverity.HIGH:
        return '#dc2626'; // Red-600
      case ErrorSeverity.MEDIUM:
        return colors.warning;
      case ErrorSeverity.LOW:
        return '#6b7280'; // Gray-500
      default:
        return colors.error;
    }
  };

  const getSeverityText = (severity: ErrorSeverity) => {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return 'Critical';
      case ErrorSeverity.HIGH:
        return 'High';
      case ErrorSeverity.MEDIUM:
        return 'Medium';
      case ErrorSeverity.LOW:
        return 'Low';
      default:
        return 'Unknown';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.errorContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>Oops! Something went wrong</Text>
            <Text style={[styles.severity, { color: getSeverityColor(error.severity) }]}>
              {getSeverityText(error.severity)} Priority Error
            </Text>
          </View>

          <View style={styles.messageContainer}>
            <Text style={styles.userMessage}>{error.userMessage}</Text>
          </View>

          {error.recoverySuggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              <Text style={styles.suggestionsTitle}>What you can try:</Text>
              {error.recoverySuggestions.map((suggestion, index) => (
                <Text key={index} style={styles.suggestion}>
                  • {suggestion}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.actionsContainer}>
            <Button title="Try Again" onPress={onRetry} style={styles.retryButton} />
            <TouchableOpacity style={styles.reportButton}>
              <Text style={styles.reportButtonText}>Report Issue</Text>
            </TouchableOpacity>
          </View>

          {__DEV__ && (
            <View style={styles.devInfo}>
              <Text style={styles.devTitle}>Developer Info:</Text>
              <Text style={styles.devText}>Type: {error.type}</Text>
              <Text style={styles.devText}>Message: {error.message}</Text>
              {error.context.component && (
                <Text style={styles.devText}>Component: {error.context.component}</Text>
              )}
              {error.context.action && (
                <Text style={styles.devText}>Action: {error.context.action}</Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  severity: {
    ...typography.h3,
    fontWeight: '600',
  },
  messageContainer: {
    marginBottom: spacing.lg,
  },
  userMessage: {
    ...typography.body,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 24,
  },
  suggestionsContainer: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  suggestionsTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  suggestion: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    lineHeight: 20,
  },
  actionsContainer: {
    gap: spacing.md,
  },
  retryButton: {
    marginBottom: spacing.sm,
  },
  reportButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  reportButtonText: {
    color: colors.accent,
    ...typography.body,
    fontWeight: '600',
  },
  devInfo: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  devTitle: {
    ...typography.h3,
    color: colors.warning,
    marginBottom: spacing.sm,
  },
  devText: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
});

export default ErrorBoundary;
