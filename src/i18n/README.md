# Locale pipeline

Issue #2037 — one RTL-safe locale pipeline shared by the app screens and the
mobile shell.

## What lives here

| File | Responsibility |
| --- | --- |
| `config.ts` | i18next bootstrap and persisted language selection |
| `pipeline.ts` | Pure locale rules: registry, normalisation, bidi isolation, formatting, plurals |
| `locales/*.json` | Translations (en, hi, ar, he, fa) |

## Direction-safe formatting

```ts
import { createLocalePipeline } from './src/i18n/pipeline';
import en from './src/i18n/locales/en.json';

const l10n = createLocalePipeline({ locale: 'ar-SA', resources: { ar: en } });

l10n.locale; // 'ar'
l10n.direction; // 'rtl'
l10n.translate('status.affected', { provider: 'Stripe' });
l10n.formatMoney(1999, 'USD');
l10n.plural('renewal.count', 3);
```

- `normalizeLocale` collapses `ar-SA` / `he_IL` / legacy `iw` / `in` tags.
- Interpolated values are wrapped in Unicode directional isolates by default,
  so a Latin provider name or a number never flips in an RTL sentence.
- `formatMoney` emits integer minor units as local currency and isolates the
  result when the active locale is RTL.
- `resolvePluralKey` returns `_one` / `_other`; Arabic treats 0, 1 and 2 as
  `_one` to match the shipped resources.
- Missing keys fall back to the fallback locale and then to the raw key, so a
  new screen can never render an empty label.

## Adding strings for a new screen

1. Add the key to **all five** locale files with identical `{{placeholders}}`.
2. Use `l10n.translate(key, vars)` rather than building strings by hand.
3. If the key is plural, ship both `_one` and `_other` forms; the `i18n-lint`
   CI job rejects incomplete plural pairs.
