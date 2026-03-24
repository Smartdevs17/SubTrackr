# Branch Protection Rules

To enforce the CI/CD pipeline quality gates, configure branch protection rules in your GitHub repository:

## Settings Location

Go to: Repository Settings → Branches → Add rule

## Required Settings for `main` branch:

### Branch name pattern

```
main
```

### ✅ Required checks (enable ALL):

- [ ] **typescript-lint** - ESLint and Prettier checks
- [ ] **typescript-typecheck** - TypeScript type validation
- [ ] **typescript-tests** - Jest test suite
- [ ] **typescript-build** - Expo build verification
- [ ] **rust-format** - Rust formatting check
- [ ] **rust-clippy** - Rust linting
- [ ] **rust-tests** - Rust test suite
- [ ] **rust-build** - Rust contract compilation

### Additional protections:

- [x] Require pull request before merging
- [x] Require at least 1 approval (recommended)
- [x] Dismiss stale reviews
- [x] Require status checks to pass before merging
- [x] Require branches to be up to date before merging
- [x] Do not allow bypassing the above settings

## Settings Location for `dev` branch (optional):

Similar settings, but you may allow force pushes for rapid development.

---

## Verification

After setting up, verify by:

1. Creating a test PR
2. Intentionally break a lint rule
3. Verify the PR cannot be merged until fixed
