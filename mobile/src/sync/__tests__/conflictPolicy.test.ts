import { isVersionConflict } from '../conflictPolicy';

describe('isVersionConflict', () => {
  it('does not conflict when the server is still at the base version', () => {
    expect(isVersionConflict(3, 3)).toBe(false);
  });

  it('conflicts when the server moved ahead of the base version', () => {
    expect(isVersionConflict(3, 4)).toBe(true);
  });

  it('conflicts when the server reports an older version than the base', () => {
    expect(isVersionConflict(3, 2)).toBe(true);
  });

  it('rejects versions that are not non-negative integers', () => {
    expect(() => isVersionConflict(-1, 0)).toThrow(TypeError);
    expect(() => isVersionConflict(1.5, 1)).toThrow(TypeError);
    expect(() => isVersionConflict(1, Number.NaN)).toThrow(TypeError);
  });
});
