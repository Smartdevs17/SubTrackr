import {
  type GestureDirection,
  type GesturePriority,
  type GestureSample,
  type GestureValidationResult,
  resolveGesturePriority,
  triggerGestureFeedback,
  validateHorizontalSwipe,
} from './gestureService';

export type GestureHandlerFn = (result: ComposedGestureResult) => void;

export interface ComposedGestureResult {
  priority: GesturePriority;
  direction: GestureDirection;
  swipe: GestureValidationResult;
  longPressTriggered: boolean;
  sample: GestureSample;
  debugLabel: string;
}

export interface GestureComposerOptions {
  enableHaptics?: boolean;
  onGesture?: GestureHandlerFn;
}

export class GestureComposer {
  private handlers: GestureHandlerFn[] = [];
  private enableHaptics: boolean;

  constructor(options: GestureComposerOptions = {}) {
    this.enableHaptics = options.enableHaptics ?? true;
    if (options.onGesture) this.handlers.push(options.onGesture);
  }

  addHandler(handler: GestureHandlerFn): this {
    this.handlers.push(handler);
    return this;
  }

  removeHandler(handler: GestureHandlerFn): this {
    this.handlers = this.handlers.filter((h) => h !== handler);
    return this;
  }

  process(sample: GestureSample, longPressTriggered = false): ComposedGestureResult {
    const swipe = validateHorizontalSwipe(sample);
    const priority = resolveGesturePriority(swipe, longPressTriggered);

    const result: ComposedGestureResult = {
      priority,
      direction: swipe.direction,
      swipe,
      longPressTriggered,
      sample,
      debugLabel: buildComposedDebugLabel(priority, swipe, sample),
    };

    if (this.enableHaptics) {
      triggerGestureFeedback(priority);
    }

    this.handlers.forEach((h) => h(result));
    return result;
  }
}

function buildComposedDebugLabel(
  priority: GesturePriority,
  swipe: GestureValidationResult,
  sample: GestureSample
): string {
  return [
    `priority=${priority}`,
    `direction=${swipe.direction}`,
    `dx=${sample.dx.toFixed(1)}`,
    `dy=${sample.dy.toFixed(1)}`,
    `vx=${sample.vx.toFixed(2)}`,
    `reason=${swipe.reason}`,
  ].join(' ');
}

export function composeGestureHandlers(...handlers: GestureHandlerFn[]): GestureHandlerFn {
  return (result) => handlers.forEach((h) => h(result));
}
