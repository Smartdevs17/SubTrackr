// Error classification types
export enum ErrorType {
  VALIDATION = 'validation',
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  PAYMENT = 'payment',
  SUBSCRIPTION = 'subscription',
  STORAGE = 'storage',
  CRYPTO = 'crypto',
  WALLET = 'wallet',
  NOTIFICATION = 'notification',
  UNKNOWN = 'unknown',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface ErrorContext {
  userId?: string;
  subscriptionId?: string;
  action?: string;
  component?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface AppError {
  id: string;
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  userMessage: string;
  recoverySuggestions: string[];
  originalError?: Error;
  context: ErrorContext;
  stackTrace?: string;
  isHandled: boolean;
}

// User-friendly error messages
const ERROR_MESSAGES = {
  [ErrorType.VALIDATION]: {
    default: 'Please check your input and try again.',
    nameRequired: 'Subscription name is required.',
    invalidPrice: 'Please enter a valid price greater than 0.',
    invalidDate: 'Please select a valid billing date.',
  },
  [ErrorType.NETWORK]: {
    default: 'Network connection issue. Please check your internet and try again.',
    timeout: 'Request timed out. Please try again.',
    offline: 'You appear to be offline. Please check your connection.',
  },
  [ErrorType.AUTHENTICATION]: {
    default: 'Authentication failed. Please sign in again.',
    expired: 'Your session has expired. Please sign in again.',
  },
  [ErrorType.AUTHORIZATION]: {
    default: 'You do not have permission to perform this action.',
  },
  [ErrorType.PAYMENT]: {
    default: 'Payment processing failed. Please try again or contact support.',
    insufficientFunds: 'Insufficient funds for this transaction.',
    cardDeclined: 'Your payment method was declined.',
  },
  [ErrorType.SUBSCRIPTION]: {
    default: 'Subscription operation failed. Please try again.',
    notFound: 'Subscription not found.',
    duplicate: 'A subscription with this name already exists.',
    limitExceeded: 'You have reached the maximum number of subscriptions.',
  },
  [ErrorType.STORAGE]: {
    default: 'Data storage issue. Please try again.',
    quotaExceeded: 'Storage limit exceeded.',
    corrupted: 'Data appears to be corrupted. Please contact support.',
  },
  [ErrorType.CRYPTO]: {
    default: 'Cryptocurrency operation failed. Please try again.',
    walletNotConnected: 'Please connect your wallet first.',
    insufficientBalance: 'Insufficient cryptocurrency balance.',
    networkError: 'Blockchain network error. Please try again later.',
  },
  [ErrorType.WALLET]: {
    default: 'Wallet operation failed. Please try again.',
    connectionFailed: 'Failed to connect to wallet.',
    signatureRejected: 'Transaction signature was rejected.',
  },
  [ErrorType.NOTIFICATION]: {
    default: 'Notification error. Please check your notification settings.',
    permissionDenied: 'Notification permission denied.',
  },
  [ErrorType.UNKNOWN]: {
    default: 'An unexpected error occurred. Please try again or contact support.',
  },
};

type RecoverySuggestionsMap = typeof RECOVERY_SUGGESTIONS;

// Recovery suggestions
const RECOVERY_SUGGESTIONS = {
  [ErrorType.VALIDATION]: [
    'Check all required fields are filled',
    'Ensure prices are positive numbers',
    'Verify dates are in the future',
  ],
  [ErrorType.NETWORK]: [
    'Check your internet connection',
    'Try again in a few moments',
    'Switch between WiFi and mobile data',
  ],
  [ErrorType.AUTHENTICATION]: [
    'Sign out and sign back in',
    'Clear app cache',
    'Update the app to the latest version',
  ],
  [ErrorType.PAYMENT]: [
    'Verify payment method details',
    'Check account balance',
    'Contact your bank or payment provider',
  ],
  [ErrorType.CRYPTO]: [
    'Ensure wallet is connected',
    'Check cryptocurrency balance',
    'Verify network connection',
    'Try switching networks',
  ],
  [ErrorType.WALLET]: [
    'Reconnect your wallet',
    'Check wallet app is up to date',
    'Restart the wallet app',
  ],
  [ErrorType.STORAGE]: [
    'Free up storage space',
    'Restart the app',
    'Reinstall the app if issues persist',
  ],
  default: ['Try again', 'Restart the app', 'Contact support if the problem persists'],
};

class ErrorHandler {
  private errors: AppError[] = [];
  private readonly maxErrors = 100; // Keep last 100 errors

  // Classify error based on error message and context
  private classifyError(error: Error, _context?: Partial<ErrorContext>): ErrorType {
    const message = error.message.toLowerCase();

    if (
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('required')
    ) {
      return ErrorType.VALIDATION;
    }
    if (
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('timeout') ||
      message.includes('fetch')
    ) {
      return ErrorType.NETWORK;
    }
    if (message.includes('auth') || message.includes('login') || message.includes('session')) {
      return ErrorType.AUTHENTICATION;
    }
    if (
      message.includes('permission') ||
      message.includes('forbidden') ||
      message.includes('unauthorized')
    ) {
      return ErrorType.AUTHORIZATION;
    }
    if (message.includes('payment') || message.includes('charge') || message.includes('billing')) {
      return ErrorType.PAYMENT;
    }
    if (message.includes('subscription') || message.includes('renewal')) {
      return ErrorType.SUBSCRIPTION;
    }
    if (
      message.includes('storage') ||
      message.includes('asyncstorage') ||
      message.includes('persist')
    ) {
      return ErrorType.STORAGE;
    }
    if (
      message.includes('crypto') ||
      message.includes('blockchain') ||
      message.includes('superfluid')
    ) {
      return ErrorType.CRYPTO;
    }
    if (message.includes('wallet') || message.includes('connect')) {
      return ErrorType.WALLET;
    }
    if (message.includes('notification') || message.includes('reminder')) {
      return ErrorType.NOTIFICATION;
    }

    return ErrorType.UNKNOWN;
  }

  // Determine severity based on error type and context
  private determineSeverity(type: ErrorType, _error: Error): ErrorSeverity {
    switch (type) {
      case ErrorType.AUTHENTICATION:
      case ErrorType.AUTHORIZATION:
      case ErrorType.PAYMENT:
        return ErrorSeverity.HIGH;
      case ErrorType.CRYPTO:
      case ErrorType.WALLET:
        return ErrorSeverity.MEDIUM;
      case ErrorType.NETWORK:
      case ErrorType.STORAGE:
        return ErrorSeverity.MEDIUM;
      case ErrorType.VALIDATION:
      case ErrorType.NOTIFICATION:
        return ErrorSeverity.LOW;
      case ErrorType.SUBSCRIPTION:
        return ErrorSeverity.MEDIUM;
      default:
        return ErrorSeverity.MEDIUM;
    }
  }

  // Get user-friendly message
  private getUserMessage(type: ErrorType, error: Error): string {
    const messages = ERROR_MESSAGES[type] as Record<string, string>;
    const message = error.message.toLowerCase();

    // Check for specific error patterns
    if (type === ErrorType.VALIDATION) {
      if (message.includes('name') && message.includes('required')) {
        return messages.nameRequired;
      }
      if (
        message.includes('price') &&
        (message.includes('invalid') || message.includes('greater'))
      ) {
        return messages.invalidPrice;
      }
      if (message.includes('date') && message.includes('invalid')) {
        return messages.invalidDate;
      }
    }

    if (type === ErrorType.NETWORK) {
      if (message.includes('timeout')) {
        return messages.timeout;
      }
      if (message.includes('offline') || message.includes('network')) {
        return messages.offline;
      }
    }

    if (type === ErrorType.CRYPTO) {
      if (message.includes('wallet') && message.includes('connect')) {
        return messages.walletNotConnected;
      }
      if (message.includes('balance') || message.includes('insufficient')) {
        return messages.insufficientBalance;
      }
      if (message.includes('network')) {
        return messages.networkError;
      }
    }

    return messages.default;
  }

  // Get recovery suggestions
  private getRecoverySuggestions(type: ErrorType): string[] {
    return (
      (RECOVERY_SUGGESTIONS as RecoverySuggestionsMap & Partial<Record<ErrorType, string[]>>)[
        type
      ] || RECOVERY_SUGGESTIONS.default
    );
  }

  // Create AppError instance
  createError(error: Error, context: Partial<ErrorContext> = {}, isHandled = false): AppError {
    const type = this.classifyError(error, context);
    const severity = this.determineSeverity(type, error);

    const appError: AppError = {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      message: error.message,
      userMessage: this.getUserMessage(type, error),
      recoverySuggestions: this.getRecoverySuggestions(type),
      originalError: error,
      context: {
        timestamp: new Date(),
        ...context,
      },
      stackTrace: error.stack,
      isHandled,
    };

    // Store error for tracking
    this.storeError(appError);

    return appError;
  }

  // Store error for tracking
  private storeError(error: AppError): void {
    this.errors.push(error);

    // Keep only the last maxErrors
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }

    // Log to console in development
    if (__DEV__) {
      console.error(`[${error.type.toUpperCase()}] ${error.message}`, {
        severity: error.severity,
        context: error.context,
        suggestions: error.recoverySuggestions,
      });
    }
  }

  // Get all errors
  getErrors(): AppError[] {
    return [...this.errors];
  }

  // Get errors by type
  getErrorsByType(type: ErrorType): AppError[] {
    return this.errors.filter((error) => error.type === type);
  }

  // Get errors by severity
  getErrorsBySeverity(severity: ErrorSeverity): AppError[] {
    return this.errors.filter((error) => error.severity === severity);
  }

  // Clear errors
  clearErrors(): void {
    this.errors = [];
  }

  // Get error statistics
  getErrorStats() {
    const stats = {
      total: this.errors.length,
      byType: {} as Record<ErrorType, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
      recent: this.errors.slice(-10), // Last 10 errors
    };

    this.errors.forEach((error) => {
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
    });

    return stats;
  }

  // Handle error (mark as handled and log)
  handleError(error: Error, context?: Partial<ErrorContext>): AppError {
    const appError = this.createError(error, context, true);
    return appError;
  }

  // Wrap async function with error handling
  async wrapAsync<T>(
    fn: () => Promise<T>,
    context?: Partial<ErrorContext>
  ): Promise<{ success: true; data: T } | { success: false; error: AppError }> {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (error) {
      const appError = this.handleError(error as Error, context);
      return { success: false, error: appError };
    }
  }
}

// Singleton instance
export const errorHandler = new ErrorHandler();

// Export types and utilities
export { ValidationError } from '../utils/validation';
