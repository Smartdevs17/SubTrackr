/**
 * version.ts
 *
 * Issue #1178 — Implement SDK versioning with deprecation policy
 *
 * Single source of truth for the SDK version and the API version it targets.
 * Both values are stamped into every request via the X-SDK-Version and
 * X-API-Version headers so the backend can route or warn accordingly.
 *
 * Versioning scheme: MAJOR.MINOR.PATCH (semantic versioning)
 *   MAJOR — breaking change; callers must update.
 *   MINOR — new features, backwards-compatible.
 *   PATCH — bug fixes; no API surface changes.
 *
 * API version policy:
 *   - The SDK always targets one primary API version (CURRENT_API_VERSION).
 *   - It can accept responses from the previous version for a transition window.
 *   - API versions are deprecated 6 months before removal.
 *
 * Deprecation policy:
 *   - Deprecated SDK methods emit a console.warn once per process lifetime.
 *   - The warning includes the method name, the version it was deprecated in,
 *     the version it will be removed, and the recommended replacement.
 *   - Calling a removed method throws a RemovedError.
 *   - A DeprecationRegistry keeps track of what has already been warned so
 *     warnings are not repeated on every call.
 */

// ── SDK version ───────────────────────────────────────────────────────────────

/** Current SDK release version (semver). */
export const SDK_VERSION = '2.0.0';

/** Parsed semver components for programmatic comparison. */
export const SDK_VERSION_INFO = {
  major: 2,
  minor: 0,
  patch: 0,
} as const;

// ── API version ───────────────────────────────────────────────────────────────

/** The latest API version this SDK is built against. */
export const CURRENT_API_VERSION = 2;

/** The oldest API version this SDK still supports (transition window). */
export const MIN_SUPPORTED_API_VERSION = 1;

/** API versions that have been fully removed and must not be used. */
export const REMOVED_API_VERSIONS: readonly number[] = [];

// ── Version compatibility ─────────────────────────────────────────────────────

export interface VersionCompatibility {
  /** Whether the given API version is fully supported. */
  supported: boolean;
  /** Whether the given API version is deprecated but still functional. */
  deprecated: boolean;
  /** Whether the given API version has been removed. */
  removed: boolean;
  /** Human-readable message, or undefined when fully supported. */
  message?: string;
}

/**
 * Assess compatibility between the SDK and an API version received from the
 * server (e.g. via the X-API-Version response header).
 */
export function assessApiVersionCompatibility(apiVersion: number): VersionCompatibility {
  if (REMOVED_API_VERSIONS.includes(apiVersion)) {
    return {
      supported: false,
      deprecated: false,
      removed: true,
      message:
        `API version ${apiVersion} has been removed. ` +
        `Upgrade to API v${CURRENT_API_VERSION} and SDK v${SDK_VERSION}.`,
    };
  }

  if (apiVersion < MIN_SUPPORTED_API_VERSION) {
    return {
      supported: false,
      deprecated: true,
      removed: false,
      message:
        `API version ${apiVersion} is deprecated and will be removed in a future release. ` +
        `Please migrate to API v${CURRENT_API_VERSION}.`,
    };
  }

  if (apiVersion > CURRENT_API_VERSION) {
    return {
      supported: false,
      deprecated: false,
      removed: false,
      message:
        `API version ${apiVersion} is newer than this SDK (v${SDK_VERSION}). ` +
        `Upgrade to the latest SDK to access new features.`,
    };
  }

  return { supported: true, deprecated: false, removed: false };
}

// ── Semver comparison utility ─────────────────────────────────────────────────

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a semver string such as "2.1.3" into its components. */
export function parseSemVer(version: string): SemVer {
  const parts = version.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid semver string: "${version}". Expected MAJOR.MINOR.PATCH`);
  }
  const [major, minor, patch] = parts.map(Number);
  if ([major, minor, patch].some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Invalid semver components in: "${version}"`);
  }
  return { major, minor, patch };
}

/**
 * Compare two semver values.
 * @returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** Returns true if `required` satisfies a minimum version constraint. */
export function satisfiesMinVersion(current: string, minimum: string): boolean {
  return compareSemVer(parseSemVer(current), parseSemVer(minimum)) >= 0;
}
