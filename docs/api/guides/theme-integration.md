# Theme Integration Guide

Use SubTrackr's white-label theme system to apply your brand's colours, logo,
and fonts to the subscription management UI.

---

## Concepts

| Term | Description |
|------|-------------|
| **Built-in theme** | `dark`, `light`, `high-contrast` — shipped with SubTrackr |
| **Brand theme** | A custom theme you create by overriding colours/logo/font |
| **CSS variables** | Auto-generated `--st-*` properties derived from theme colours |
| **Theme export** | A portable JSON snapshot of a theme (version-enveloped) |

---

## Create a brand theme via API

```typescript
const theme = await client.themes.create({
  id: 'brand-acme',
  name: 'Acme Corp',
  mode: 'dark',
  colors: {
    primary:       '#ff6b35',
    secondary:     '#004e89',
    accent:        '#1a936f',
    success:       '#10b981',
    warning:       '#f59e0b',
    error:         '#ef4444',
    background:    '#0f172a',
    surface:       '#1e293b',
    text:          '#f8fafc',
    textSecondary: '#cbd5e1',
    border:        '#334155',
    overlay:       'rgba(15, 23, 42, 0.8)',
  },
  logoUri: 'https://cdn.acme.com/logo-white.png',
  font: { family: 'Inter', scale: 1.0 },
});

console.log(theme.cssVariables?.['--st-primary']); // '#ff6b35'
```

---

## Use generated CSS variables in a web view

The API returns a `cssVariables` map on every theme. Inject it into a `<style>`
tag to theme a web view hosted inside the mobile app:

```typescript
import { toCssBlock } from '@subtrackr/sdk/theme';

const cssBlock = toCssBlock(theme.cssVariables ?? {});
// :root {
//   --st-primary: #ff6b35;
//   --st-background: #0f172a;
//   ...
// }

// Inject into an Expo WebView
<WebView
  source={{ html: `<style>${cssBlock}</style><body>...</body>` }}
/>
```

---

## Accessibility contrast check

Before shipping a brand theme, run the built-in contrast audit:

```typescript
import { auditThemeContrast } from '@subtrackr/sdk/theme';

const audit = auditThemeContrast(theme);

for (const [pair, result] of Object.entries(audit)) {
  if (!result.passesAA) {
    console.warn(`⚠️  ${pair}: ratio ${result.ratio} — fails WCAG AA`);
  }
}
// Example output:
// ⚠️  primary/background: ratio 3.1 — fails WCAG AA
```

Fix failing pairs by adjusting the colour until the ratio is ≥ 4.5 (AA) or
≥ 7.0 (AAA).

---

## Export and import themes

Export for sharing or version control:

```typescript
// In-app (React Native)
import { useThemeStore } from '@/theme';

const json = useThemeStore.getState().exportTheme('brand-acme');
// Share json string via email, clipboard, or API
```

Import on another device or tenant:

```typescript
const id = useThemeStore.getState().importTheme(json);
if (id) {
  useThemeStore.getState().setTheme(id);
}
```

---

## Theme inheritance (light / dark variants)

Create paired themes that inherit from their respective base:

```typescript
import { createBrandTheme } from '@/theme';
import { darkTheme, lightTheme } from '@/theme';

const brand = { primary: '#ff6b35', secondary: '#004e89', accent: '#1a936f' };

const acmeDark  = createBrandTheme(darkTheme,  brand, 'acme-dark',  'Acme Dark');
const acmeLight = createBrandTheme(lightTheme, brand, 'acme-light', 'Acme Light');

useThemeStore.getState().addBrandTheme(brand, acmeDark.id, acmeDark.name);
```

The `toggleMode` action automatically switches between the base dark and light
themes. For brand variants, implement your own toggle:

```typescript
function toggleAcmeMode() {
  const current = useThemeStore.getState().theme;
  const next = current.id === 'acme-dark' ? 'acme-light' : 'acme-dark';
  useThemeStore.getState().setTheme(next);
}
```
