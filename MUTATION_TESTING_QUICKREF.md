# 🧬 Mutation Testing Quick Reference

## Commands

| Command | Description |
|---------|-------------|
| `npm run mutation:test` | Run all mutation tests (frontend + backend) |
| `npm run mutation:test:frontend` | Run frontend mutation tests only |
| `npm run mutation:test:backend` | Run backend mutation tests only |
| `npm run mutation:test:incremental` | Run only on changed files (faster) |
| `npm run mutation:test:report` | Generate combined report & summary |
| `npm run mutation:analyze` | Analyze survived mutants for equivalents |

## Configuration Files

| File | Purpose |
|------|---------|
| `stryker.conf.json` | Frontend (React Native) configuration |
| `stryker.backend.conf.json` | Backend (Node.js) configuration |
| `.github/workflows/mutation-testing.yml` | CI/CD workflow |
| `scripts/run-incremental-mutation.js` | Incremental testing script |
| `scripts/generate-mutation-report.js` | Report generation script |
| `scripts/analyze-equivalent-mutants.js` | Equivalent mutant detection |

## Reports Location

```
mutation-reports/
├── frontend/
│   ├── index.html              # Interactive HTML report
│   └── mutation-report.json    # Machine-readable JSON
├── backend/
│   ├── index.html
│   └── mutation-report.json
├── mutation-summary.md         # Combined markdown summary
└── mutation-history.json       # Historical tracking
```

## Quality Thresholds

| Threshold | Score | Status |
|-----------|-------|--------|
| **Break** | <75% | ❌ PR fails |
| **Low** | 60-75% | ⚠️ Warning |
| **High** | ≥80% | ✅ Excellent |

## Mutant Statuses

| Status | Meaning | Count As |
|--------|---------|----------|
| ✅ **Killed** | Test caught mutation | Good |
| ❌ **Survived** | Test missed mutation | Bad |
| ⏱️ **Timeout** | Test took too long | Killed |
| 📝 **No Coverage** | Code not tested | Bad |
| 🔧 **Compile Error** | Mutation broke build | Ignored |
| ⚠️ **Runtime Error** | Mutation crashed | Ignored |

## Common Mutators

| Mutator | Example | Test Strategy |
|---------|---------|---------------|
| **ConditionalExpression** | `if (x > 5)` → `if (false)` | Test both branches |
| **ArithmeticOperator** | `a + b` → `a - b` | Assert exact values |
| **EqualityOperator** | `a === b` → `a !== b` | Test equality & inequality |
| **LogicalOperator** | `a && b` → `a \|\| b` | Test all combinations |
| **StringLiteral** | `"error"` → `""` | Assert specific strings |
| **BooleanLiteral** | `true` → `false` | Test both states |
| **UnaryOperator** | `!valid` → `valid` | Test negation |
| **UpdateExpression** | `i++` → `i--` | Test boundaries |

## Workflow

### Local Development

```bash
# 1. Make changes to code
git checkout -b feature/my-feature

# 2. Write/update tests
npm test

# 3. Run mutation tests
npm run mutation:test:incremental

# 4. View report
open mutation-reports/mutation-summary.md

# 5. Fix survived mutants
# ... improve tests ...

# 6. Commit with conventional commit
git commit -m "feat: add new feature with mutation tests"

# 7. Push and create PR
git push origin feature/my-feature
```

### CI/CD Flow

1. **PR Created** → Incremental mutation testing on changed files
2. **Tests Run** → Mutation score calculated
3. **Report Posted** → PR comment with results
4. **Quality Gate** → ≥75% required to merge
5. **Main Branch** → Full mutation testing, history updated

## Improving Mutation Score

### Step 1: Find Survived Mutants

```bash
npm run mutation:test:report
cat mutation-reports/mutation-summary.md
```

### Step 2: Analyze Report

Look for:
- Which files have most survived mutants
- Which mutator types survive most often
- Patterns in survival (e.g., all in error handling)

### Step 3: Check for Equivalents

```bash
npm run mutation:analyze
```

Ignore true equivalents in Stryker config.

### Step 4: Improve Tests

**Before** (weak test):
```typescript
test('validates age', () => {
  expect(validateAge(20)).toBe(true);
});
```

**After** (strong test):
```typescript
test('validates age at boundaries', () => {
  expect(validateAge(18)).toBe(true);   // boundary
  expect(validateAge(17)).toBe(false);  // below boundary
  expect(validateAge(19)).toBe(true);   // above boundary
  expect(validateAge(0)).toBe(false);   // edge case
});
```

### Step 5: Verify Improvement

```bash
npm run mutation:test:incremental
```

## Best Practices

### ✅ DO

- Write tests that assert **exact values**, not just truthiness
- Test **boundary conditions** (0, -1, max, min)
- Test **both branches** of conditionals
- Test **error cases** and exceptions
- Use **specific assertions** (`toBe(6)` not `toBeDefined()`)
- Test **all logical combinations** (true/true, true/false, etc.)

### ❌ DON'T

- Rely solely on snapshot tests
- Use weak assertions (`toBeTruthy()`, `toBeDefined()`)
- Test only the "happy path"
- Mock everything (test real behavior)
- Ignore all survived mutants (investigate first)
- Skip testing edge cases

## Troubleshooting

### "Mutation tests failing in CI but pass locally"

```bash
# Ensure full git history
git fetch --unshallow

# Check that base branch exists
git fetch origin main:main

# Run in same mode as CI
GITHUB_BASE_REF=main npm run mutation:test:incremental
```

### "Tests too slow"

```json
// In stryker*.conf.json
{
  "maxConcurrentTestRunners": 1,
  "timeoutMS": 30000
}
```

### "Out of memory"

```json
{
  "maxConcurrentTestRunners": 1
}
```

Or set Node.js memory:
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run mutation:test
```

### "Too many equivalent mutants"

```bash
# Analyze potential equivalents
npm run mutation:analyze

# Add ignore patterns to stryker*.conf.json
{
  "mutate": [
    "src/**/*.ts",
    "!src/config/**"  // Ignore config files
  ]
}
```

## Resources

- 📖 [Full Documentation](docs/mutation-testing.md)
- 🌐 [Stryker Website](https://stryker-mutator.io/)
- 📊 [Dashboard](https://dashboard.stryker-mutator.io/)
- 🐛 [GitHub Issues](https://github.com/Smartdevs17/SubTrackr/issues)

## Support

1. Check this guide
2. Check [docs/mutation-testing.md](docs/mutation-testing.md)
3. Search [Stryker docs](https://stryker-mutator.io/docs/)
4. Open issue with `mutation-testing` label

---

**Last Updated**: June 2026
