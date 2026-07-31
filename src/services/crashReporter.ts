/**
 * CrashReporter — lightweight crash detection and recovery service.
 *
 * No third-party SDK required. Uses AsyncStorage to persist crash records
 * across app launches so the next session can detect, report, and recover
 * from the previous crash.
 *
 * Integration points:
 *  - Call `crashReporter.initialize()` early in App.tsx (before rendering UI).
 *  - Call `crashReporter.recordCrash(error, context)` from ErrorBoundary and
 *    global JS error handlers.
 *  - Call `crashReporter.attemptDataRecovery()` when the user chooses to recover.
 *  - Subscribe to `crashReporter.onCrashDetected` to show recovery UI.
 *
 * Privacy: crash records are stored locally only. No data is sent to any
 * external server unless you add a `reportingEndpoint` in the config.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ErrorSeverity, ErrorType } from './errorHandler';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrashRecord {
  /** Unique crash identifier */
  id: string;
  /** ISO timestamp of the crash */
  timestamp: string;
  /** JS error message */
  message: string;
  /** JS stack trace (may be minified in production) */
  stackTrace?: string;
  /** Error type classification */
  errorType: ErrorType;
  /** Severity at time of crash */
  severity: ErrorSeverity;
  /** Component or screen where the crash originated */
  component?: string;
  /** Additional key/value metadata */
  metadata?: Record<string, unknown>;
  /** Platform info captured at crash time */
  platform: {
    os: string;
    version: string | number;
  };
  /** Whether the user has already been notified about this crash */
  notified: boolean;
  /** Whether a recovery attempt has been made */
  recoveryAttempted: boolean;
}

export interface CrashReporterConfig {
  /**
   * Maximum number of crash records to keep in storage.
   * Oldest records are pruned when the limit is exceeded.
   * @default 20
   */
  maxRecords?: number;
  /**
   * Optional HTTPS endpoint to POST crash records to.
   * When omitted, crashes are stored locally only.
   */
  reportingEndpoint?: string;
  /**
   * Keys in AsyncStorage that should be preserved during data recovery.
   * Any key NOT in this list will be cleared on a recovery wipe.
   */
  preservedStorageKeys?: string[];
  /**
   * Whether to install a global `ErrorUtils` handler for uncaught JS errors.
   * Disable this in test environments to avoid interfering with Jest.
   * @default true
   */
  installGlobalHandler?: boolean;
}

type CrashDetectedListener = (crash: CrashRecord) => void;

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@subtrackr/crash_records';
const SESSION_FLAG_KEY = '@subtrackr/session_clean';

// ─── Service ──────────────────────────────────────────────────────────────────

class CrashReporterService {
  private config: Required<CrashReporterConfig> = {
    maxRecords: 20,
    reportingEndpoint: '',
    preservedStorageKeys: [],
    installGlobalHandler: true,
  };

  private listeners: CrashDetectedListener[] = [];
  private initialized = false;

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Initialize the crash reporter. Call this once, early in App startup.
   * Returns the most recent unnotified crash record if one exists, so the
   * caller can decide whether to show a recovery UI.
   */
  async initialize(config?: CrashReporterConfig): Promise<CrashRecord | null> {
    if (this.initialized) return null;
    this.initialized = true;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Install global uncaught-error handler
    if (this.config.installGlobalHandler) {
      this._installGlobalHandler();
    }

    // Check whether the previous session ended cleanly
    const previousCrash = await this._detectPreviousCrash();

    // Mark this session as clean (will be cleared if a crash occurs)
    await AsyncStorage.setItem(SESSION_FLAG_KEY, 'clean');

    return previousCrash;
  }

  /**
   * Record a crash. Persists the record to AsyncStorage and optionally
   * forwards it to a remote endpoint.
   */
  async recordCrash(
    error: Error,
    context?: {
      errorType?: ErrorType;
      severity?: ErrorSeverity;
      component?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<CrashRecord> {
    // Mark the session as dirty so the next launch detects the crash
    await AsyncStorage.setItem(SESSION_FLAG_KEY, 'crashed');

    const record: CrashRecord = {
      id: `crash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      message: error.message || 'Unknown error',
      stackTrace: error.stack,
      errorType: context?.errorType ?? ErrorType.UNKNOWN,
      severity: context?.severity ?? ErrorSeverity.CRITICAL,
      component: context?.component,
      metadata: context?.metadata,
      platform: {
        os: Platform.OS,
        version: Platform.Version,
      },
      notified: false,
      recoveryAttempted: false,
    };

    await this._persistRecord(record);

    if (this.config.reportingEndpoint) {
      // Fire-and-forget — do not let a network failure block the crash path
      this._sendToEndpoint(record).catch(() => {
        // Silently swallow — crash reporting must never throw
      });
    }

    if (__DEV__) {
      console.warn('[CrashReporter] Crash recorded:', record.id, record.message);
    }

    return record;
  }

  /**
   * Attempt to recover user data after a crash.
   *
   * Strategy:
   *  1. Read all AsyncStorage keys.
   *  2. Keep keys listed in `preservedStorageKeys`.
   *  3. Remove all other keys (clears corrupted state).
   *  4. Mark the crash record as recovery-attempted.
   *
   * Returns `true` if recovery completed without errors.
   */
  async attemptDataRecovery(crashId?: string): Promise<boolean> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const keysToRemove = allKeys.filter(
        (key) =>
          key !== STORAGE_KEY &&
          key !== SESSION_FLAG_KEY &&
          !this.config.preservedStorageKeys.includes(key)
      );

      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
      }

      if (crashId) {
        await this._markRecoveryAttempted(crashId);
      }

      if (__DEV__) {
        console.info('[CrashReporter] Data recovery complete. Removed keys:', keysToRemove.length);
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Mark a crash record as notified (user has seen the recovery UI).
   */
  async markNotified(crashId: string): Promise<void> {
    const records = await this._loadRecords();
    const updated = records.map((r) => (r.id === crashId ? { ...r, notified: true } : r));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  /**
   * Return all stored crash records, newest first.
   */
  async getCrashHistory(): Promise<CrashRecord[]> {
    const records = await this._loadRecords();
    return [...records].reverse();
  }

  /**
   * Clear all stored crash records.
   */
  async clearHistory(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Subscribe to crash-detected events. The listener is called during
   * `initialize()` if a previous crash is found.
   */
  onCrashDetected(listener: CrashDetectedListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _detectPreviousCrash(): Promise<CrashRecord | null> {
    try {
      const sessionFlag = await AsyncStorage.getItem(SESSION_FLAG_KEY);

      if (sessionFlag !== 'crashed') return null;

      const records = await this._loadRecords();
      // Find the most recent unnotified crash
      const crash = [...records].reverse().find((r) => !r.notified) ?? null;

      if (crash) {
        // Notify all listeners
        this.listeners.forEach((l) => {
          try {
            l(crash);
          } catch {
            // Listener errors must not propagate
          }
        });
      }

      return crash;
    } catch {
      return null;
    }
  }

  private async _persistRecord(record: CrashRecord): Promise<void> {
    const records = await this._loadRecords();
    records.push(record);

    // Prune oldest records beyond the limit
    const pruned =
      records.length > this.config.maxRecords
        ? records.slice(records.length - this.config.maxRecords)
        : records;

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  }

  private async _loadRecords(): Promise<CrashRecord[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async _markRecoveryAttempted(crashId: string): Promise<void> {
    const records = await this._loadRecords();
    const updated = records.map((r) => (r.id === crashId ? { ...r, recoveryAttempted: true } : r));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  private async _sendToEndpoint(record: CrashRecord): Promise<void> {
    if (!this.config.reportingEndpoint) return;

    await fetch(this.config.reportingEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Strip the full stack trace from the payload to limit PII exposure
      body: JSON.stringify({
        ...record,
        stackTrace: record.stackTrace ? '[redacted in remote report]' : undefined,
      }),
    });
  }

  /**
   * Install a global handler for uncaught JS errors via React Native's
   * ErrorUtils. This catches errors that escape all React error boundaries
   * (e.g. errors in native event callbacks or promise rejections that are
   * not caught anywhere).
   */
  private _installGlobalHandler(): void {
    // ErrorUtils is a React Native global — not available in Node/Jest
    if (typeof ErrorUtils === 'undefined') return;

    const previousHandler = ErrorUtils.getGlobalHandler();

    ErrorUtils.setGlobalHandler(async (error: Error, isFatal?: boolean) => {
      try {
        await this.recordCrash(error, {
          severity: isFatal ? ErrorSeverity.CRITICAL : ErrorSeverity.HIGH,
          metadata: { isFatal: isFatal ?? false, source: 'globalHandler' },
        });
      } catch {
        // Never let the crash reporter itself crash
      } finally {
        // Always delegate to the previous handler so React Native's default
        // red-screen / crash behaviour is preserved in development.
        previousHandler?.(error, isFatal);
      }
    });
  }
}

// Singleton — import and use directly throughout the app
export const crashReporter = new CrashReporterService();
