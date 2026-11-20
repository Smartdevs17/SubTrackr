import { bucketFor, isEnabled, FlagSet } from '../index';

const flags: FlagSet = {
  on: { enabled: true },
  off: { enabled: false, rolloutPercent: 100 },
  half: { enabled: true, rolloutPercent: 50 },
  none: { enabled: true, rolloutPercent: 0, allowUsers: ['vip'] },
};

describe('@subtrackr/flags', () => {
  it('returns false for unknown or disabled flags', () => {
    expect(isEnabled(flags, 'missing')).toBe(false);
    expect(isEnabled(flags, 'off', { userId: 'u1' })).toBe(false);
  });

  it('treats a missing rollout as 100%, even without a user', () => {
    expect(isEnabled(flags, 'on')).toBe(true);
  });

  it('buckets deterministically within [0, 100)', () => {
    const b = bucketFor('half', 'user-1');
    expect(b).toBe(bucketFor('half', 'user-1'));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });

  it('splits a 50% rollout roughly in half', () => {
    let on = 0;
    for (let i = 0; i < 1000; i++) if (isEnabled(flags, 'half', { userId: `u${i}` })) on++;
    expect(on).toBeGreaterThan(400);
    expect(on).toBeLessThan(600);
  });

  it('denies anonymous users on partial rollouts', () => {
    expect(isEnabled(flags, 'half')).toBe(false);
  });

  it('lets the allow-list bypass a 0% rollout', () => {
    expect(isEnabled(flags, 'none', { userId: 'vip' })).toBe(true);
    expect(isEnabled(flags, 'none', { userId: 'other' })).toBe(false);
  });

  it('applies overrides but never beats the kill switch', () => {
    expect(isEnabled(flags, 'none', { userId: 'x', overrides: { none: true } })).toBe(true);
    expect(isEnabled(flags, 'on', { overrides: { on: false } })).toBe(false);
    expect(isEnabled(flags, 'off', { overrides: { off: true } })).toBe(false);
  });
});
