/**
 * mobile/src/i18n/resources.ts
 *
 * Single place where the shipped locale JSON is attached to the mobile
 * pipeline. Screens should import `createAppLocalePipeline` instead of wiring
 * resources themselves so RTL isolation stays consistent everywhere.
 */

import ar from '../../../src/i18n/locales/ar.json';
import en from '../../../src/i18n/locales/en.json';
import fa from '../../../src/i18n/locales/fa.json';
import he from '../../../src/i18n/locales/he.json';
import hi from '../../../src/i18n/locales/hi.json';
import type { LocaleResources } from '../../../src/i18n/pipeline';
import { createMobileLocalePipeline, type MobileLocalePipeline } from './index';

export const MOBILE_RESOURCES: LocaleResources = {
  en,
  hi,
  ar,
  he,
  fa,
};

export function createAppLocalePipeline(localeInput: string): MobileLocalePipeline {
  return createMobileLocalePipeline(localeInput, { resources: MOBILE_RESOURCES });
}
