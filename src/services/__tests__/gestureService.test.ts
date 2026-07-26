import {
  buildGestureDebugLabel,
  resolveGesturePriority,
  validateHorizontalSwipe,
} from '../gestureService';

describe('gestureService', () => {
  it('accepts a clear horizontal swipe', () => {
    const result = validateHorizontalSwipe({ dx: 88, dy: 12, vx: 0.4, vy: 0.02 });

    expect(result.isValid).toBe(true);
    expect(result.direction).toBe('right');
    expect(result.priority).toBe('swipe');
  });

  it('rejects vertical-dominant movement', () => {
    const result = validateHorizontalSwipe({ dx: 74, dy: 64, vx: 0.27, vy: 0.35 });

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('vertical-dominant');
  });

  it('resolves long press priority when no swipe is accepted', () => {
    const swipeResult = validateHorizontalSwipe({ dx: 10, dy: 2, vx: 0.01, vy: 0 });

    expect(resolveGesturePriority(swipeResult, true)).toBe('long-press');
    expect(resolveGesturePriority(swipeResult, false)).toBe('tap');
  });

  it('builds a readable debug label', () => {
    const result = validateHorizontalSwipe({ dx: -90, dy: 8, vx: -0.31, vy: 0.01 });
    const label = buildGestureDebugLabel(result, { dx: -90, dy: 8, vx: -0.31, vy: 0.01 });

    expect(label).toContain('direction=left');
    expect(label).toContain('reason=accepted');
  });
});

// ── Additional gesture validation coverage ────────────────────────────────

describe('validateHorizontalSwipe — extended', () => {
  it('rejects zero motion', () => {
    const result = validateHorizontalSwipe({ dx: 0, dy: 0, vx: 0, vy: 0 });
    expect(result.isValid).toBe(false);
    expect(result.direction).toBe('none');
    expect(result.reason).toBe('no-horizontal-motion');
  });

  it('rejects below-threshold distance with low velocity', () => {
    const result = validateHorizontalSwipe({ dx: 20, dy: 2, vx: 0.05, vy: 0.01 });
    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('below-threshold');
  });

  it('accepts left swipe', () => {
    const result = validateHorizontalSwipe({ dx: -80, dy: 5, vx: -0.35, vy: 0 });
    expect(result.isValid).toBe(true);
    expect(result.direction).toBe('left');
  });

  it('accepts swipe that meets distance threshold even at low velocity', () => {
    const result = validateHorizontalSwipe({ dx: 70, dy: 10, vx: 0.1, vy: 0 });
    expect(result.isValid).toBe(true);
  });

  it('result contains all required fields', () => {
    const result = validateHorizontalSwipe({ dx: 90, dy: 5, vx: 0.4, vy: 0 });
    expect(typeof result.isValid).toBe('boolean');
    expect(typeof result.direction).toBe('string');
    expect(typeof result.priority).toBe('string');
    expect(typeof result.reason).toBe('string');
  });
});

// ── resolveGesturePriority ─────────────────────────────────────────────────

describe('resolveGesturePriority', () => {
  it('swipe wins over long-press when swipe is valid', () => {
    const valid = validateHorizontalSwipe({ dx: 90, dy: 5, vx: 0.4, vy: 0 });
    expect(resolveGesturePriority(valid, true)).toBe('swipe');
  });

  it('tap when neither swipe nor long-press', () => {
    const invalid = validateHorizontalSwipe({ dx: 5, dy: 1, vx: 0.01, vy: 0 });
    expect(resolveGesturePriority(invalid, false)).toBe('tap');
  });
});

// ── buildGestureDebugLabel ─────────────────────────────────────────────────

describe('buildGestureDebugLabel', () => {
  it('includes gesture type in label', () => {
    const sample = { dx: 90, dy: 3, vx: 0.4, vy: 0 };
    const result = validateHorizontalSwipe(sample);
    const label = buildGestureDebugLabel(result, sample);
    expect(label).toContain('gesture=swipe');
  });

  it('includes dx and dy values', () => {
    const sample = { dx: 90, dy: 3, vx: 0.4, vy: 0 };
    const result = validateHorizontalSwipe(sample);
    const label = buildGestureDebugLabel(result, sample);
    expect(label).toContain('dx=');
    expect(label).toContain('dy=');
  });
});
