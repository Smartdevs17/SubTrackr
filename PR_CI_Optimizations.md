# Pull Request: CI/CD Pipeline Optimizations

## Summary

This PR introduces several enhancements to the CI/CD pipeline for the SubTrackr project:

- **Parallel test execution** using a matrix strategy with sharded Jest runs.
- **Build caching** for Node modules and Rust dependencies.
- **Incremental Rust builds** that only trigger when contract sources change.
- **Deployment optimizations**: added canary deployment, promotion to production, and rollback jobs in `release.yml`.
- Fixed **package.json** syntax errors and added a `test:shard` script.
- Added `cross-env` as a devDependency to simplify environment variable handling.

## Changes Made

- Updated `.github/workflows/ci.yml` to run TypeScript tests in parallel shards and upload per‑shard coverage.
- Refactored `.github/workflows/release.yml` to include canary, promote, and rollback jobs, and removed duplicate definitions.
- Fixed JSON formatting in `package.json`, added missing commas, simplified the `test:shard` script, and added `cross-env`.
- Ran `npm install --legacy-peer-deps` to resolve dependency conflicts.
- Created a new branch `ci-optimizations` and pushed the changes.

## Verification

- `npm ci` runs successfully after the fixes.
- Sharded tests execute correctly with `npm run test:shard` (environment variables are now handled via `cross-env`).
- GitHub Actions workflow runs pass, confirming caching and incremental builds work as intended.

## Related Issue

#241
