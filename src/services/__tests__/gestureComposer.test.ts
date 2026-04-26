import { composeGestureHandlers, GestureComposer } from '../gestureComposer';
import type { ComposedGestureResult } from '../gestureComposer';

const SWIPE_SAMPLE = { dx: 90, dy: 5, vx: 0.4, vy: 0 };
const TAP_SAMPLE = { dx: 5, dy: 2, vx: 0.02, vy: 0 };

describe('GestureComposer', () => {
  describe('process', () => {
    it('returns swipe result for a valid horizontal swipe', () => {
      const composer = new GestureComposer({ enableHaptics: false });
      const result = composer.process(SWIPE_SAMPLE);
      expect(result.priority).toBe('swipe');
      expect(result.direction).toBe('right');
      expect(result.swipe.isValid).toBe(true);
    });

    it('returns tap result for minimal motion without long press', () => {
      const composer = new GestureComposer({ enableHaptics: false });
      const result = composer.process(TAP_SAMPLE, false);
      expect(result.priority).toBe('tap');
    });

    it('returns long-press when triggered with no swipe', () => {
      const composer = new GestureComposer({ enableHaptics: false });
      const result = composer.process(TAP_SAMPLE, true);
      expect(result.priority).toBe('long-press');
    });

    it('includes the original sample in the result', () => {
      const composer = new GestureComposer({ enableHaptics: false });
      const result = composer.process(SWIPE_SAMPLE);
      expect(result.sample).toEqual(SWIPE_SAMPLE);
    });

    it('includes a non-empty debugLabel', () => {
      const composer = new GestureComposer({ enableHaptics: false });
      const result = composer.process(SWIPE_SAMPLE);
      expect(result.debugLabel.length).toBeGreaterThan(0);
      expect(result.debugLabel).toContain('priority=swipe');
    });
  });

  describe('handler management', () => {
    it('calls registered onGesture handler', () => {
      const calls: ComposedGestureResult[] = [];
      const composer = new GestureComposer({
        enableHaptics: false,
        onGesture: (r) => calls.push(r),
      });
      composer.process(SWIPE_SAMPLE);
      expect(calls.length).toBe(1);
      expect(calls[0].priority).toBe('swipe');
    });

    it('addHandler: chains additional handlers', () => {
      const results: string[] = [];
      const composer = new GestureComposer({ enableHaptics: false });
      composer.addHandler((r) => results.push(`first:${r.priority}`));
      composer.addHandler((r) => results.push(`second:${r.priority}`));
      composer.process(SWIPE_SAMPLE);
      expect(results).toEqual(['first:swipe', 'second:swipe']);
    });

    it('removeHandler: stops calling removed handler', () => {
      const calls: number[] = [];
      const handler = () => calls.push(1);
      const composer = new GestureComposer({ enableHaptics: false });
      composer.addHandler(handler);
      composer.process(SWIPE_SAMPLE);
      composer.removeHandler(handler);
      composer.process(SWIPE_SAMPLE);
      expect(calls.length).toBe(1);
    });

    it('returns this for fluent chaining', () => {
      const composer = new GestureComposer({ enableHaptics: false });
      const result = composer.addHandler(() => {});
      expect(result).toBe(composer);
    });
  });
});

describe('composeGestureHandlers', () => {
  it('calls all composed handlers in order', () => {
    const log: string[] = [];
    const composed = composeGestureHandlers(
      () => log.push('a'),
      () => log.push('b'),
      () => log.push('c'),
    );

    const mockResult = {} as ComposedGestureResult;
    composed(mockResult);
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('passes the same result to all handlers', () => {
    const received: ComposedGestureResult[] = [];
    const composer = new GestureComposer({ enableHaptics: false });
    composer.addHandler(
      composeGestureHandlers(
        (r) => received.push(r),
        (r) => received.push(r),
      )
    );
    composer.process(SWIPE_SAMPLE);
    expect(received[0]).toBe(received[1]);
  });
});
