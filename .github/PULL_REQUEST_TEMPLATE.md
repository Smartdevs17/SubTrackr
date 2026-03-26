## Pull Request Checklist

### Quality Gates (All must pass before merge)

- [ ] **Lint**: Code passes ESLint and Prettier checks
- [ ] **Type Check**: TypeScript compilation succeeds
- [ ] **Tests**: All tests pass
- [ ] **Build**: Project builds successfully
- [ ] **Rust Format**: Smart contract formatting is correct
- [ ] **Rust Clippy**: Smart contract linting passes
- [ ] **Rust Tests**: All smart contract tests pass
- [ ] **Rust Build**: Smart contracts compile successfully

### Additional Requirements

- [ ] New code has appropriate TypeScript types
- [ ] No hardcoded secrets or credentials
- [ ] New features have corresponding tests
- [ ] Documentation updated if needed

### Reviewers

- At least 1 approval required for merge
- All CI checks must be green

---

_This PR will not be mergeable until all quality gates pass._
