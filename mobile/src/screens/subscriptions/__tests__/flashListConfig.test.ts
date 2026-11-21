import { resolveFlashListTuning } from '../flashListConfig';

describe('resolveFlashListTuning', () => {
  it('uses a small window for short lists', () => {
    expect(resolveFlashListTuning(10)).toEqual({
      estimatedItemSize: 76,
      drawDistance: 250,
      windowSize: 5,
      removeClippedSubviews: false,
    });
  });

  it('trades a tighter mount window for a larger draw distance on long lists', () => {
    const medium = resolveFlashListTuning(100);
    const long = resolveFlashListTuning(1_000);

    expect(long.drawDistance).toBeGreaterThan(medium.drawDistance);
    expect(long.windowSize).toBeGreaterThan(2);
    expect(long.removeClippedSubviews).toBe(true);
    expect(medium.removeClippedSubviews).toBe(true);
  });

  it('clamps invalid and out-of-range overrides', () => {
    const tuning = resolveFlashListTuning(1_000, {
      estimatedItemSize: 1,
      drawDistance: 10_000,
      windowSize: 100,
    });

    expect(tuning.estimatedItemSize).toBe(40);
    expect(tuning.drawDistance).toBe(2_000);
    expect(tuning.windowSize).toBe(21);
  });

  it('ignores NaN item counts instead of poisoning the config', () => {
    expect(resolveFlashListTuning(Number.NaN)).toEqual(resolveFlashListTuning(0));
  });
});
