# Tenant portal branding / custom themes (Issue #1110)

Merchants can customize the look and feel of their hosted subscription portal with
a logo, brand colors and fonts. The stored branding is rendered as the `--st-portal-*`
CSS custom properties the portal stylesheet consumes.

## Branding payload

```ts
interface PortalBranding {
  merchantId: string;
  brandName: string;
  logo?: { uri: string; darkUri?: string; width?: number; height?: number; altText?: string };
  colors: { primary: string; secondary?: string; accent?: string; background?: string; surface?: string; text?: string };
  fonts?: { heading?: string; body?: string; url?: string };
  customVariables?: Record<string, string>;
  updatedAt: string;
}
```

Validation rules:

- `brandName` must be non-empty
- colors must be `#RGB` or `#RRGGBB`
- `logo.uri` must be a non-empty URL/data URI when a logo is supplied
- `customVariables` keys must be valid CSS property names and values single-line
  (no `;`), which prevents CSS injection

## API

Mounted under `/api/v1/merchant`:

| Method | Path                   | Purpose                                     |
| ------ | ---------------------- | ------------------------------------------- |
| `GET`  | `/branding`            | Branding for the merchant (`x-merchant-id`)  |
| `PUT`  | `/branding`            | Create or merge branding                    |
| `GET`  | `/branding/portal`     | Theme JSON + ready-to-inject stylesheet     |

### Example

```bash
curl -X PUT http://localhost:3000/api/v1/merchant/branding \
  -H 'content-type: application/json' \
  -H 'x-merchant-id: merchant_7' \
  -d '{
    "brandName": "Seven",
    "logo": { "uri": "https://cdn.seven.test/logo.svg", "altText": "Seven" },
    "colors": { "primary": "#123456" }
  }'

curl http://localhost:3000/api/v1/merchant/branding/portal \
  -H 'x-merchant-id: merchant_7'
```

The portal endpoint returns `cssVariables`, a pre-rendered `stylesheet`,
plus `logo`, `colors` and `fonts`:

```css
:root {
  --st-portal-brand-name: Seven;
  --st-portal-primary: #123456;
  --st-portal-logo: url(https://cdn.seven.test/logo.svg);
  --st-portal-logo-alt: Seven;
}
```

Errors: `422 VALIDATION_ERROR` for an invalid payload.

## Code map

- `backend/subscription/domain/portalBranding.ts` – validation, CSS rendering, store
- `backend/subscription/controller/brandingController.ts` – HTTP handlers
- `backend/subscription/router/themeRouter.ts` – branding route table
- `src/theme/` – existing theme engine (`customThemeBuilder`, `cssVariables`, `themeStore`)
- `backend/migrations/004_theme_storage.sql` – Postgres schema for durable storage

## Tests

```bash
npx jest -c jest.backend.config.js backend/subscription/domain/__tests__/portalBranding.test.ts
npx jest -c jest.backend.config.js backend/subscription/router/__tests__/subscriptionOpsRouter.test.ts
```
