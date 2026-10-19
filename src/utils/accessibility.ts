/**
 * Accessibility utilities for SubTrackr
 * Provides helpers for screen reader support, minimum touch targets, and semantic labels.
 */

import { AccessibilityRole } from 'react-native';

/** Minimum touch target size recommended by WCAG 2.5.5 (44x44 pts) */
export const MIN_TOUCH_TARGET = 44;

/** Build a combined accessibility label from multiple parts, filtering empty strings */
export function buildA11yLabel(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join(', ');
}

/** Returns a human-readable state suffix for toggle/switch elements */
export function toggleStateLabel(enabled: boolean): string {
  return enabled ? 'enabled' : 'disabled';
}

/** Returns a human-readable selected state for chip/button groups */
export function selectedStateLabel(selected: boolean): string {
  return selected ? 'selected' : 'not selected';
}

/**
 * Common accessibility roles re-exported for convenience.
 *
 * Declared `as const satisfies` so each entry keeps its literal type — a plain
 * `Record<string, AccessibilityRole>` annotation would widen every entry to
 * `AccessibilityRole`, which is then too broad to pass to components that
 * declare a narrower literal union for `accessibilityRole`.
 */
export const A11yRole = {
  button: 'button',
  link: 'link',
  header: 'header',
  image: 'image',
  text: 'text',
  search: 'search',
  tab: 'tab',
  tablist: 'tablist',
  menuitem: 'menuitem',
  checkbox: 'checkbox',
  switch: 'switch',
  adjustable: 'adjustable',
  summary: 'summary',
  none: 'none',
} as const satisfies Record<string, AccessibilityRole>;
