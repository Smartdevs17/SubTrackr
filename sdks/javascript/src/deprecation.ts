/**
 * deprecation.ts
 *
 * Issue #1178 — Implement SDK versioning with deprecation policy
 *
 * Runtime deprecation and removal enforcement for SDK methods.
 *
 * Three lifecycle states for an API surface:
 *   1. current     — normal; no warning.
 *   2. deprecated  — emits a one-time console.warn with migration guidance.
 *   3. removed     — throws RemovedError immediately; the call is blocked.
 *
 * Usage (wrap deprecated method bodies):
 *
 *   async getSubscriptions(): Promise<Subscription[]> {
 *     warnDeprecated({
 *       method: 'getSubscriptions',
 *       deprecatedIn: '2.0.0',
 *       removedIn:    '3.0.0',
 *       replacement:  'listSubscriptions()',
 *     });
 *     return this.listSubscriptions();
 *   }
 *
 * Usage (block removed methods):
 *
 *   async oldMethod(): Promise<void> {
 *     throwIfRemoved({
 *       method: 'oldMethod',
 *       removedIn: '2.0.0',
 *       replacement: 'newMethod()',
 *     });
 *   }
 *
 * Testing:
 *   DeprecationRegistry.reset()   // clears warned-set between tests
 *   DeprecationRegistry.silence() // suppresses console.warn in tests
 */

import { SDK_VERSION } from './version';

// ── RemovedError ──────────────────────────────────────────────────────────────

/**
 * Thrown when a caller invokes an API method that has been removed from the SDK.
 * Extends Error so it can be caught by existing error handlers.
 */
export class RemovedError extends Error {
  readonly method: string;
  readonly removedIn: string;
  readonly replacement?: string;

  constructor(opts: { method: string; removedIn: string; replacement?: string }) {
    const hint = opts.replacement
      ? ` Use ${opts.replacement} instead.`
      : ' See the migration guide.';
    super(
      `${opts.method}() was removed in SDK v${opts.removedIn}.${hint}`
    );
    this.name = 'RemovedError';
    this.method = opts.method;
    this.removedIn = opts.removedIn;
    this.replacement = opts.replacement;
  }
}

// ── DeprecationNotice ─────────────────────────────────────────────────────────

export interface DeprecationNotice {
  /** The name of the deprecated method or option. */
  method: string;
  /** SDK version in which this was deprecated. */
  deprecatedIn: string;
  /** SDK version in which this will be / was removed. */
  removedIn: string;
  /** What the caller should use instead. */
  replacement?: string;
  /** Optional additional guidance surfaced in the warning message. */
  note?: string;
}

// ── DeprecationRegistry ───────────────────────────────────────────────────────

/**
 * Global registry that tracks which deprecation warnings have already fired,
 * so each one is only printed once per process lifetime (not once per call).
 */
export const DeprecationRegistry = {
  _warned: new Set<string>(),
  _silenced: false,

  /** Returns true if this method has already been warned. */
  hasWarned(method: string): boolean {
    return this._warned.has(method);
  },

  /** Record that a warning has been issued. */
  markWarned(method: string): void {
    this._warned.add(method);
  },

  /** Reset warned state — intended for use in unit tests only. */
  reset(): void {
    this._warned.clear();
  },

  /** Suppress console output — useful in test environments. */
  silence(): void {
    this._silenced = true;
  },

  /** Re-enable console output. */
  unsilence(): void {
    this._silenced = false;
  },

  get silenced(): boolean {
    return this._silenced;
  },
};

// ── warnDeprecated ────────────────────────────────────────────────────────────

/**
 * Emit a deprecation warning the first time a deprecated method is called.
 *
 * The warning is intentionally minimal to avoid noise:
 *   [SubTrackr SDK v2.0.0] DEPRECATED: getSubscriptions() was deprecated in
 *   v2.0.0 and will be removed in v3.0.0. Use listSubscriptions() instead.
 */
export function warnDeprecated(notice: DeprecationNotice): void {
  if (DeprecationRegistry.hasWarned(notice.method)) return;

  DeprecationRegistry.markWarned(notice.method);

  if (DeprecationRegistry.silenced) return;

  const parts = [
    `[SubTrackr SDK v${SDK_VERSION}] DEPRECATED: ${notice.method}() was deprecated in v${notice.deprecatedIn}`,
    `and will be removed in v${notice.removedIn}.`,
  ];

  if (notice.replacement) {
    parts.push(`Use ${notice.replacement} instead.`);
  }
  if (notice.note) {
    parts.push(notice.note);
  }

  // Use console.warn so it shows up in most log aggregators and doesn't throw.
  // eslint-disable-next-line no-console
  console.warn(parts.join(' '));
}

// ── throwIfRemoved ────────────────────────────────────────────────────────────

/**
 * Throw a RemovedError immediately if a caller invokes a removed method.
 * Place at the top of removed method bodies.
 */
export function throwIfRemoved(opts: {
  method: string;
  removedIn: string;
  replacement?: string;
}): never {
  throw new RemovedError(opts);
}

// ── deprecated() decorator ────────────────────────────────────────────────────

/**
 * Method decorator factory that wraps a method with a deprecation warning.
 *
 * @example
 * class Client {
 *   \@deprecated({ deprecatedIn: '2.0.0', removedIn: '3.0.0', replacement: 'listSubscriptions()' })
 *   async getSubscriptions() { ... }
 * }
 *
 * Note: decorators require "experimentalDecorators": true in tsconfig.
 * This factory is also exported as a plain higher-order function for
 * environments where decorators are unavailable.
 */
export function deprecated(notice: Omit<DeprecationNotice, 'method'>) {
  return function (
    _target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    descriptor.value = function (...args: unknown[]) {
      warnDeprecated({ ...notice, method: propertyKey });
      return original.apply(this, args);
    };
    return descriptor;
  };
}

/**
 * Higher-order function equivalent of the @deprecated decorator.
 * Use this when decorators are not available.
 *
 * @example
 * const myMethod = withDeprecationWarning(
 *   async function getSubscriptions() { ... },
 *   { deprecatedIn: '2.0.0', removedIn: '3.0.0', replacement: 'listSubscriptions()' }
 * );
 */
export function withDeprecationWarning<T extends (...args: unknown[]) => unknown>(
  fn: T,
  notice: Omit<DeprecationNotice, 'method'>
): T {
  const wrapped = function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
    warnDeprecated({ ...notice, method: fn.name || 'anonymous' });
    return fn.apply(this, args) as ReturnType<T>;
  };
  Object.defineProperty(wrapped, 'name', { value: fn.name });
  return wrapped as T;
}
