# Releasing the SDKs

The JavaScript, Python and Go SDKs are released together under one version.
The pipeline is `.github/workflows/sdk-publish.yml`, driven by
`sdks/scripts/release.mjs`.

| SDK        | Registry        | Package                                                              |
| ---------- | --------------- | -------------------------------------------------------------------- |
| JavaScript | npm             | `@subtrackr/sdk`                                                     |
| Python     | PyPI            | `subtrackr-sdk`                                                      |
| Go         | Go module proxy | `github.com/Smartdevs17/SubTrackr/sdks/go/v2` (tag `sdks/go/vX.Y.Z`) |

## Versions

[`sdks/VERSION`](../VERSION) is the single source of truth. These files must
agree with it, and CI fails if they don't:

| File                          | Field                                        |
| ----------------------------- | -------------------------------------------- |
| `javascript/package.json`     | `version`                                    |
| `javascript/src/version.ts`   | `SDK_VERSION`, `SDK_VERSION_INFO`            |
| `python/setup.py`             | `version` (PEP 440)                          |
| `python/subtrackr/version.py` | `SDK_VERSION` (PEP 440), `SDK_VERSION_TUPLE` |
| `go/version.go`               | `SDKVersion`                                 |
| `go/go.mod`                   | module path: `/vN` suffix from v2 onwards    |

Allowed versions are `X.Y.Z` and the pre-releases `X.Y.Z-alpha.N`,
`X.Y.Z-beta.N` and `X.Y.Z-rc.N`. A pre-release becomes `X.Y.ZaN` / `bN` /
`rcN` on PyPI and is published to npm under the `next` dist-tag, so
`npm install @subtrackr/sdk` keeps getting the latest stable release.

## Cutting a release

```bash
node sdks/scripts/release.mjs set 2.1.0   # rewrites every file above
# add a "## [2.1.0]" section to sdks/CHANGELOG.md
node sdks/scripts/release.mjs check       # must pass
git commit -am "chore(sdks): release 2.1.0"
# open a PR; after it merges:
git tag sdk-v2.1.0 <merge commit>
git push origin sdk-v2.1.0
```

A major version bump changes the Go module path (for example `/v2` → `/v3`).
Go users then have to update their imports, so call that out in the
changelog.

## What the pipeline does

| Trigger                                                            | Result                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Pull request or push to `main` touching `sdks/**`, or a manual run | **Dry run:** test and package all three SDKs, publish nothing |
| Push of tag `sdk-vX.Y.Z` matching `sdks/VERSION`                   | **Release**                                                   |
| Push of a tag that doesn't match `sdks/VERSION`                    | Fails in _Plan release_                                       |

The jobs run in this order:

1. **Plan release.** Runs the release-tool tests and `check`, decides dry run
   or release, and on a release asks each registry whether the version is
   already there.
2. **Verify** (one job per SDK, in parallel):
   - JavaScript: `npm ci`, typecheck, build, `npm pack`.
   - Python: unit tests, `python -m build`, `twine check --strict`.
   - Go: `go vet`, `go test -race`.

   The JavaScript tarball and the Python wheel and sdist are kept as
   artifacts. The publish jobs upload exactly those files.

3. **Publish** runs only when all three verify jobs pass, so one broken SDK
   blocks the whole release instead of shipping a partial one.
   - npm: `npm publish <tarball> --tag <latest|next> --provenance`.
   - PyPI: trusted publishing via `pypa/gh-action-pypi-publish`.
   - Go: pushes `sdks/go/vX.Y.Z` at the release commit, then waits until
     `proxy.golang.org` serves it.
4. **Release summary** writes a table to the run page, showing each SDK's
   result and whether it was published, skipped or a dry run.

## Failure handling

| Situation                                           | Behaviour                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Version files or changelog out of sync              | _Plan release_ fails and names every mismatched file. Run `set`, then add the changelog entry.                                                 |
| Tests or build fail for any SDK                     | Nothing is published. Fix, merge, move the tag (`git tag -f sdk-vX.Y.Z <commit> && git push -f origin sdk-vX.Y.Z`), or release the next patch. |
| One registry fails mid-release                      | Re-run the workflow. Registries that already have the version are skipped, and only the missing ones publish.                                  |
| The Go tag exists but the proxy doesn't have it yet | The re-run leaves the tag alone and retries the proxy.                                                                                         |
| A registry is unreachable during the pre-check      | Retried 3 times, then the run fails. It never publishes without knowing the registry's state.                                                  |
| The Go proxy is slow to pick up the tag             | Retried 5 times with back-off, then the run fails. A re-run continues from there.                                                              |

## One-time setup (repository admins)

- **npm:** create the `@subtrackr` org on npm. Add an automation token as the
  `NPM_TOKEN` secret on a GitHub environment named `npm`.
- **PyPI:** register `subtrackr-sdk`, and add a trusted publisher for
  repository `Smartdevs17/SubTrackr`, workflow `sdk-publish.yml`,
  environment `pypi`. No token is needed.
- **Go:** nothing to set up. The workflow's `GITHUB_TOKEN` pushes the
  `sdks/go/v*` tag.
- **License:** the repository has no license file yet. Add one before the
  first publish, since registries display it and consumers need it.
- Optionally, protect the `npm` and `pypi` environments with required
  reviewers, so each release waits for an approval.

## Local commands

```bash
node --test sdks/scripts/__tests__/release.test.mjs   # release tooling tests
node sdks/scripts/release.mjs check                   # versions + changelog
npm --prefix sdks/javascript ci && npm --prefix sdks/javascript test
PYTHONPATH=sdks/python python3 -m unittest discover sdks/python/tests
(cd sdks/go && go test ./...)
```
