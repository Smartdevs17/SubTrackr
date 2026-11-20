# Mobile locale wiring

Issue #2037. All translation and formatting logic is in
`../../src/i18n/pipeline.ts`; this folder adds only the React Native layout
concern.

```ts
import { createMobileLocalePipeline } from './index';

const l10n = createMobileLocalePipeline('ar-SA', { resources });
const rowDirection = l10n.rowDirection(); // 'row-reverse'
```

`layoutDirection` reflects `I18nManager.isRTL`, so a screen can mirror its rows
even when the OS has not restarted after an RTL language switch. Text-level
bidi isolation is always derived from the locale, not the layout flag, which
keeps Latin provider names and numbers readable in RTL sentences.
