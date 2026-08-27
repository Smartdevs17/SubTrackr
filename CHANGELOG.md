# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- Automated changelog generation from conventional commits via semantic-release.
- GitHub Actions workflow for changelog preview and validation.
- Conventional commit validation in CI with strict commitlint rules.

### Changed
- Enforced conventional commit format for all PRs and pushes.
- Updated `.releaserc` to generate `CHANGELOG.md` on release.

### Documentation
- Added changelog generation examples and usage instructions.

---

## Automated Changelog Process

This repository uses [semantic-release](https://github.com/semantic-release/semantic-release)
with the [conventional commits](https://www.conventionalcommits.org/) specification.

### How It Works

1. Contributors write commits following the conventional commit format:
   - `feat: add new feature`
   - `fix: resolve bug in billing cycle`
   - `docs: update README`
   - `chore: update dependencies`

2. On every push to `main`, the Release workflow triggers semantic-release.

3. semantic-release:
   - Analyzes commit messages since the last release.
   - Determines the next version (`patch`, `minor`, or `major`).
   - Generates release notes from conventional commits.
   - Updates `CHANGELOG.md` automatically.
   - Creates a GitHub Release.
   - Publishes to npm (if configured).

### Commit Format Examples

```bash
# Feature
feat(subscription): add grace period support

# Bug fix
fix(billing): resolve double-charge edge case

# Documentation
docs(api): add payment webhook examples

# Breaking change
feat(api)!: change subscription status enum

# Chore
chore(deps): upgrade react-native to 0.73
```

### Release Workflow

| Trigger | Action |
|---------|--------|
| Push to `main` | semantic-release analyzes commits and may publish |
| PR to `main` | commitlint validates commit messages |
| Manual dispatch | semantic-release dry-run preview |

### Local Development

Preview the changelog locally:

```bash
npx conventional-changelog-cli -p angular -i CHANGELOG.md -s -r 0
```

Validate commit messages locally:

```bash
npx commitlint --from HEAD~1 --to HEAD --verbose
```
