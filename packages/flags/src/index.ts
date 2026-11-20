/**
 * Dependency-free feature-flag evaluation, usable from React Native and Node.
 * Precedence: kill switch > per-user override > allow-list > percentage rollout.
 */
export interface FlagDefinition {
  /** Master switch. When false the flag is off for everyone. */
  enabled: boolean;
  /** 0-100. Share of users that receive the flag. Defaults to 100. */
  rolloutPercent?: number;
  /** User ids that always receive the flag while `enabled` is true. */
  allowUsers?: string[];
}

export type FlagSet = Record<string, FlagDefinition>;

export interface FlagContext {
  userId?: string;
  /** Explicit per-user overrides, e.g. from a debug menu. Keyed by flag name. */
  overrides?: Record<string, boolean>;
}

/** FNV-1a hash mapped to a stable bucket in [0, 100). */
export function bucketFor(flag: string, userId: string): number {
  let hash = 0x811c9dc5;
  for (const ch of `${flag}:${userId}`) {
    hash ^= ch.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function isEnabled(flags: FlagSet, name: string, ctx: FlagContext = {}): boolean {
  const def = flags[name];
  if (!def || !def.enabled) return false;
  if (ctx.overrides && name in ctx.overrides) return ctx.overrides[name];
  if (ctx.userId && def.allowUsers?.includes(ctx.userId)) return true;

  const percent = Math.min(100, Math.max(0, def.rolloutPercent ?? 100));
  if (percent >= 100) return true;
  if (percent <= 0 || !ctx.userId) return false;
  return bucketFor(name, ctx.userId) < percent;
}
