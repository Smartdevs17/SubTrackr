import { Platform, Vibration } from 'react-native';

export type GestureDirection = 'left' | 'right' | 'none';
export type GesturePriority = 'swipe' | 'long-press' | 'tap';

export interface GestureSample {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
}

export interface GestureValidationResult {
  isValid: boolean;
  direction: GestureDirection;
  priority: GesturePriority;
  reason: string;
}

const SWIPE_DISTANCE_THRESHOLD = 56;
const SWIPE_VELOCITY_THRESHOLD = 0.22;
const HORIZONTAL_DOMINANCE_RATIO = 1.35;

export function validateHorizontalSwipe(sample: GestureSample): GestureValidationResult {
  const absDx = Math.abs(sample.dx);
  const absDy = Math.abs(sample.dy);
  const direction: GestureDirection = sample.dx > 0 ? 'right' : sample.dx < 0 ? 'left' : 'none';

  if (!direction || direction === 'none') {
    return { isValid: false, direction: 'none', priority: 'tap', reason: 'no-horizontal-motion' };
  }

  if (absDx < SWIPE_DISTANCE_THRESHOLD && Math.abs(sample.vx) < SWIPE_VELOCITY_THRESHOLD) {
    return { isValid: false, direction, priority: 'tap', reason: 'below-threshold' };
  }

  if (absDy > absDx / HORIZONTAL_DOMINANCE_RATIO) {
    return { isValid: false, direction, priority: 'tap', reason: 'vertical-dominant' };
  }

  return { isValid: true, direction, priority: 'swipe', reason: 'accepted' };
}

export function resolveGesturePriority(
  swipeResult: GestureValidationResult,
  longPressTriggered: boolean
): GesturePriority {
  if (swipeResult.isValid) {
    return 'swipe';
  }

  return longPressTriggered ? 'long-press' : 'tap';
}

export function buildGestureDebugLabel(
  result: GestureValidationResult,
  sample: GestureSample
): string {
  return `gesture=${result.priority} direction=${result.direction} dx=${sample.dx.toFixed(
    1
  )} dy=${sample.dy.toFixed(1)} vx=${sample.vx.toFixed(2)} reason=${result.reason}`;
}

export function triggerGestureFeedback(kind: GesturePriority | 'success'): void {
  const duration = kind === 'success' ? 20 : Platform.OS === 'ios' ? 10 : 15;
  Vibration.vibrate(duration);
}
