import { element, expect, waitFor } from 'detox';

/**
 * Explicit, expectation-based wait helpers.
 *
 * RULE: E2E tests must never call `device.sleep(...)` or any fixed timer to
 * "give the UI a moment". Fixed sleeps are simultaneously too long (slow CI) and
 * too short (flaky on cold machines). Instead we poll an explicit condition until
 * it holds or a generous timeout elapses. Detox's synchronization already idles
 * on the bridge/animations, so these waits resolve as soon as the app is settled.
 */

/** Generous default ceiling — reached only on genuine hangs, not normal latency. */
export const DEFAULT_TIMEOUT = 15000;

type Matcher = Detox.NativeMatcher;

const el = (matcher: Matcher) => element(matcher);

/** Wait until an element is visible (rendered and on-screen). */
export const waitForVisible = async (
  matcher: Matcher,
  timeout = DEFAULT_TIMEOUT
): Promise<void> => {
  await waitFor(el(matcher)).toBeVisible().withTimeout(timeout);
};

/** Wait until an element exists in the hierarchy (may be off-screen). */
export const waitForExists = async (matcher: Matcher, timeout = DEFAULT_TIMEOUT): Promise<void> => {
  await waitFor(el(matcher)).toExist().withTimeout(timeout);
};

/** Wait until an element is gone from the hierarchy (e.g. after navigation). */
export const waitForGone = async (matcher: Matcher, timeout = DEFAULT_TIMEOUT): Promise<void> => {
  await waitFor(el(matcher)).not.toExist().withTimeout(timeout);
};

/** Wait until an element carries the expected text — avoids reading stale labels. */
export const waitForText = async (
  matcher: Matcher,
  text: string,
  timeout = DEFAULT_TIMEOUT
): Promise<void> => {
  await waitFor(el(matcher)).toHaveText(text).withTimeout(timeout);
};

/**
 * Wait for an element then tap it. Tapping without first waiting is a classic
 * race: the node may not yet be hittable. This pairs the wait + action atomically.
 */
export const tapWhenReady = async (matcher: Matcher, timeout = DEFAULT_TIMEOUT): Promise<void> => {
  await waitForVisible(matcher, timeout);
  await el(matcher).tap();
};

/** Assert visible immediately (no polling) — for post-condition checks. */
export const expectVisible = async (matcher: Matcher): Promise<void> => {
  await expect(el(matcher)).toBeVisible();
};
