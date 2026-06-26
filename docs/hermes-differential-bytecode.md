# Differential Hermes Bytecode & Screen-Level Compilation Tiers

SubTrackr uses Hermes, which compiles JS to bytecode (`.hbc`). Compiling every
screen into one monolithic chunk means startup pays the parse/compile cost of
screens the user may never open, and peak memory holds bytecode for all of them.
This feature splits screens into **compilation tiers** so the critical path loads
eagerly and the rest loads on demand.

## Tiers

Declared in `app.config.js` → `extra.screenTiers`:

- **eager** — critical-path screens (`Home`, `SubscriptionDetail`, `Analytics`,
  `CryptoPayment`/Payment). Bundled into the initial Hermes bytecode chunk and
  loaded at startup. Lowest latency, larger initial bundle.
- **lazy** — everything else. Emitted as separate chunks and loaded on demand via
  `React.lazy` + `Suspense` in `src/navigation/AppNavigator.tsx`. Their
  parse/compile cost and memory are only paid when the screen is visited.

## How it works

1. **AppNavigator** imports eager screens statically and wraps lazy ones with
   `lazyScreen(() => import('../screens/X'))` (or `namedLazyScreen` for named
   exports). The dynamic `import()` is the chunk boundary.
2. **Metro** (`metro.config.js`) enables `inlineRequires`, deferring each
   module's evaluation until first use, and splits dynamically-imported modules
   into separately-loadable segments.
3. **Hermes** compiles those segments to bytecode; the eager tier lands in the
   startup `.hbc`, lazy tiers compile/load when requested.
4. **Fallback** — if a chunk can't be loaded (e.g. an OTA bytecode/runtime
   mismatch), `lazyScreen`'s error boundary shows a retry that re-fetches the
   module from the full bundle, so a missing chunk degrades gracefully instead of
   crashing.

## Assigning a screen to a tier

1. Decide the tier. Default to **lazy** unless the screen is on the first-paint
   critical path.
2. In `src/navigation/AppNavigator.tsx`:
   - eager: add a static `import Foo from '../screens/Foo'`.
   - lazy: `const Foo = lazyScreen(() => import('../screens/Foo'));`
3. Add the route name to the matching list in `app.config.js`
   (`extra.screenTiers.eager` / `.lazy`).
4. Run `npm run perf:budget` — it fails if a critical screen drifts out of the
   eager tier or a screen appears in both tiers.

## Performance budget

`scripts/check-performance-budget.js` (`npm run perf:budget`) enforces, against
`app.config.js` → `extra.performanceBudget`:

| Check                       | Target (default)            |
| --------------------------- | --------------------------- |
| Cold-start ceiling          | `startupBudgetMs` = 2000ms  |
| Startup improvement vs base | `startupImprovementTarget` ≥ 30% |
| Peak-memory reduction       | `peakMemoryReductionTarget` ≥ 20% |
| Lazy chunk frame budget     | `maxFrameMs` ≤ 16.7ms       |

Provide measurements in `perf/metrics.json` (see `perf/metrics.sample.json`) and
a `perf/baseline.json`. Without metrics the script validates tier integrity only
and passes (use `--strict` in CI to require metrics). Wire it into CI alongside
the existing `bundle-size` check.

## Edge cases

- **Screen transition during chunk load** — `Suspense` shows a lightweight
  spinner; the transition completes when the chunk resolves.
- **Hermes/OTA mismatch** — error boundary → retry from full bundle.
- **Debug builds** — Metro serves modules over the dev server (no bytecode); the
  same lazy boundaries apply, behavior is identical minus bytecode.
- **Cache invalidation** — chunk identity follows Metro's content hashing; an OTA
  update ships fresh chunks.
