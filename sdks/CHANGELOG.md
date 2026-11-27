# SubTrackr SDK changelog

All three SDKs (JavaScript, Python, Go) share one version, set in
[`VERSION`](VERSION). Every release needs a section here before it can be
tagged; `node sdks/scripts/release.mjs check` enforces it. See
[docs/releasing.md](docs/releasing.md).

## [2.0.0]

First release published to the package registries.

- JavaScript: `@subtrackr/sdk` on npm.
- Python: `subtrackr-sdk` on PyPI.
- Go: `github.com/Smartdevs17/SubTrackr/sdks/go/v2`. The module path takes the
  `/v2` suffix that Go requires for major version 2.
- Python: restored `create_plan()` (same payload as the JavaScript SDK's
  `createPlan`), which had been lost in a client refactor. Every call now goes
  through one pooled `requests.Session`.
- JavaScript: includes the circuit breaker and resilience layer; fixed a
  missing `CircuitState` import that stopped the package from compiling.
- Requests carry `X-SDK-Version` / `X-API-Version`. Deprecation policy:
  [docs/deprecation-policy.md](docs/deprecation-policy.md).
