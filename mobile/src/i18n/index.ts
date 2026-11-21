/**
 * mobile/src/i18n/index.ts
 *
 * Issue #2037 — mobile wiring for the shared locale pipeline. The pure rules
 * live in `src/i18n/pipeline.ts`; this file only adds React Native's layout
 * direction so screens can mirror rows as well as text.
 */

import { I18nManager } from 'react-native';
import {
  createLocalePipeline,
  normalizeLocale,
  type LocalePipeline,
  type LocalePipelineConfig,
} from '../../../src/i18n/pipeline';

export * from '../../../src/i18n/pipeline';

export interface MobileLocalePipeline extends LocalePipeline {
  /** Direction reported by React Native, which may lag a locale change. */
  readonly layoutDirection: 'ltr' | 'rtl';
  /** Ready-to-use flexDirection value for mirrored rows. */
  rowDirection(): 'row' | 'row-reverse';
}

export function createMobileLocalePipeline(
  localeInput: string,
  config: Omit<LocalePipelineConfig, 'locale'> = {},
): MobileLocalePipeline {
  const locale = normalizeLocale(localeInput);
  const base = createLocalePipeline({ ...config, locale });
  const layoutDirection = I18nManager.isRTL ? 'rtl' : 'ltr';

  return {
    ...base,
    layoutDirection,
    rowDirection: () => (layoutDirection === 'rtl' ? 'row-reverse' : 'row'),
    withLocale: (nextLocale: string) => createMobileLocalePipeline(nextLocale, config),
  };
}
