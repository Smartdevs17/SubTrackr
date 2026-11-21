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
- Requests carry `X-SDK-Version` / `X-API-Version`. Deprecation policy:
  [docs/deprecation-policy.md](docs/deprecation-policy.md).
