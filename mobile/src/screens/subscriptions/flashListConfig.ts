/**
 * Virtualisation tuning for the subscriptions FlashList (Issue #2075).
 *
 * Kept pure so the sizing policy can be tested without rendering native views.
 */

export interface FlashListTuning {
  /** Approximate row height in device-independent pixels. */
  estimatedItemSize: number;
  /** Extra pixels rendered outside the viewport to hide scroll stalls. */
  drawDistance: number;
  /** Number of viewports kept mounted; larger lists use a tighter window. */
  windowSize: number;
  removeClippedSubviews: boolean;
}

export interface FlashListTuningOverrides {
  estimatedItemSize?: number;
  drawDistance?: number;
  windowSize?: number;
}

const DEFAULT_ITEM_SIZE = 76;

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Choose a bounded virtualisation window for a given item count.
 * Long lists trade a slightly larger draw distance for a smaller mount window.
 */
export function resolveFlashListTuning(
  itemCount: number,
  overrides: FlashListTuningOverrides = {},
): FlashListTuning {
  const count = Number.isFinite(itemCount) ? Math.max(0, itemCount) : 0;
  const defaults: FlashListTuning =
    count < 50
      ? { estimatedItemSize: DEFAULT_ITEM_SIZE, drawDistance: 250, windowSize: 5, removeClippedSubviews: false }
      : count < 200
        ? { estimatedItemSize: DEFAULT_ITEM_SIZE, drawDistance: 500, windowSize: 7, removeClippedSubviews: true }
        : { estimatedItemSize: DEFAULT_ITEM_SIZE, drawDistance: 800, windowSize: 9, removeClippedSubviews: true };

  return {
    estimatedItemSize: clamp(overrides.estimatedItemSize, defaults.estimatedItemSize, 40, 300),
    drawDistance: clamp(overrides.drawDistance, defaults.drawDistance, 100, 2_000),
    windowSize: clamp(overrides.windowSize, defaults.windowSize, 3, 21),
    removeClippedSubviews: defaults.removeClippedSubviews,
  };
}
