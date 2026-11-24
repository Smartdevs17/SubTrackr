/**
 * Conflict policy for subscription edits (Issue #1987).
 *
 * Rule: versioned optimistic concurrency with a server-authoritative winner.
 * A local edit made against version N is applied only if the server is still
 * at version N. If the server is at any other version, the edit is a conflict:
 * the server state stays, and the local edit is held for the user to keep the
 * server state, or to re-apply the edit on top of it.
 *
 * Why not last-writer-wins by device clock: mobile clocks skew and drift while
 * offline, so the "later" edit is not reliably the newer one. LWW would also
 * overwrite the other device's change silently. Versions are assigned by the
 * server and compare exactly.
 *
 * Consequence: two edits to different fields of the same record still conflict
 * when the version moved. That is a deliberate false positive. It keeps the
 * rule simple and never silently drops a change.
 */

/** Shared guard for every version number the sync layer accepts. */
export function assertVersion(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer, got ${String(value)}`);
  }
}

/** True when an edit based on `baseVersion` must not be applied to `remoteVersion`. */
export function isVersionConflict(baseVersion: number, remoteVersion: number): boolean {
  assertVersion('baseVersion', baseVersion);
  assertVersion('remoteVersion', remoteVersion);
  return baseVersion !== remoteVersion;
}
