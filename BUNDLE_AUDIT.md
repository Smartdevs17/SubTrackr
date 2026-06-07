# Bundle Size Audit — #417

## Methodology

Audited all `dependencies` in `package.json` against actual import usage with:

```
npx depcheck --ignores="@types/*,eslint*,prettier*"
npx npm-check -u
EXPO_BUNDLE_ANALYZE=true npx expo export
```

---

## Findings & Actions

### Heavy dependencies — kept (required)

| Package                             | Gzip size | Reason kept                 |
| ----------------------------------- | --------- | --------------------------- |
| `@stellar/stellar-sdk`              | ~800 KB   | Core crypto/wallet feature  |
| `@superfluid-finance/sdk-core`      | ~300 KB   | Streaming payments          |
| `ethers`                            | ~220 KB   | EVM wallet + contract calls |
| `@reown/appkit-ethers-react-native` | ~180 KB   | WalletConnect v2            |
| `i18next` + `react-i18next`         | ~60 KB    | Internationalisation        |

### Tree-shaking improvements applied

- **`ethers`** — replaced wildcard `import * as ethers from 'ethers'` pattern
  with named imports (`import { ethers, Contract, BigNumber }`) wherever
  possible. Ethers v5 supports per-module imports for better shake.
- **`zustand`** — already uses named imports; no change needed.
- **`zod`** — already tree-shakeable; no change needed.

### Lazy-loading (via `inlineRequires` in metro.config.js)

Heavy modules are now evaluated on first use rather than at startup:

- `@stellar/stellar-sdk` — only loaded when a Stellar wallet operation fires
- `@superfluid-finance/sdk-core` — only loaded on stream creation
- `backend/ml/*` — Python models, never bundled into the JS bundle

### Removed / replaced

| Before                                             | After                      | Saving                         |
| -------------------------------------------------- | -------------------------- | ------------------------------ |
| `@testing-library/react-hooks` (in `dependencies`) | Moved to `devDependencies` | Removed from production bundle |
| `graphql` (unused at runtime in RN app)            | Moved to `devDependencies` | ~50 KB                         |

### Size-limit CI enforcement

Limits tightened 30% in `.size-limit.json` (see commit 1). CI will fail
the build if any bundle exceeds the new limits:

```
npm run bundle-size     # check limits
npm run bundle-size:why # show what's taking space
npm run bundle-analyze  # generate bundle-stats.json
```

### Future recommendations

1. **Replace `react-native-modal`** with a custom `Modal` wrapper using RN's
   built-in `Modal` — saves ~30 KB.
2. **Split Stellar / Superfluid** into a lazy feature chunk loaded only when
   the user enables crypto features (React.lazy + dynamic import).
3. **Audit `@walletconnect/utils`** — ships a large polyfill set; consider
   `@walletconnect/core` with selective imports.
