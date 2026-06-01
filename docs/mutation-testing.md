# 🧬 Mutation Testing with Stryker

This project uses [Stryker](https://stryker-mutator.io/) for mutation testing to evaluate and improve test quality beyond standard code coverage metrics.

## Overview

Mutation testing works by introducing small changes (mutations) to your code and checking if your tests catch these changes. If a test fails when the code is mutated, the mutant is "killed." If tests still pass, the mutant "survived," indicating a gap in test coverage or weak assertions.

### Why Mutation Testing?

- **Code coverage alone is misleading** - 100% coverage doesn't mean 100% test quality
- **Finds weak or missing assertions** - Tests that don't actually verify behavior
- **Improves test effectiveness** - Ensures tests catch real bugs
- **Quality gate enforcement** - >75% mutation score required for PRs

## Configuration

We maintain separate configurations for frontend and backend:

### Frontend (React Native)
- **Config**: `stryker.conf.json`
- **Scope**: `src/**/*.{ts,tsx}`, `app/**/*.{ts,tsx}`
- **Test Runner**: Jest (with jest-expo preset)
- **Reports**: `mutation-reports/frontend/`

### Backend (Node.js)
- **Config**: `stryker.backend.conf.json`
- **Scope**: `backend/**/*.ts`
- **Test Runner**: Jest (with ts-jest)
- **Reports**: `mutation-reports/backend/`

## Running Mutation Tests

### Locally

```bash
# Run all mutation tests
npm run mutation:test

# Frontend only
npm run mutation:test:frontend

# Backend only
npm run mutation:test:backend

# Incremental (only changed files)
npm run mutation:test:incremental

# Generate combined report
npm run mutation:test:report
```

### In CI/CD

Mutation testing runs automatically:

1. **Pull Requests**: Incremental testing on changed files only
2. **Main Branch**: Full mutation testing on all code
3. **Manual Trigger**: Via GitHub Actions workflow dispatch

## Understanding Results

### Mutation Score

The mutation score is calculated as:

```
Mutation Score = (Killed Mutants / Total Mutants) × 100%
```

**Threshold**: Minimum 75% required for PR approval

### Mutant Statuses

- ✅ **Killed** - Test failed when code was mutated (good!)
- ❌ **Survived** - Test still passed with mutated code (bad!)
- ⏱️ **Timeout** - Test took too long (counted as killed)
- 📝 **No Coverage** - No tests executed the mutated code
- 🔧 **Compile Error** - Mutation caused compilation failure
- ⚠️ **Runtime Error** - Mutation caused runtime error
- 🚫 **Ignored** - Mutant was explicitly ignored

### Reading the Report

After running mutation tests, view the HTML reports:

```bash
# Frontend report
open mutation-reports/frontend/index.html

# Backend report
open mutation-reports/backend/index.html
```

The report shows:
- Overall mutation score
- File-by-file breakdown
- Specific mutants and their status
- Source code with mutations highlighted

## Incremental Mutation Testing

To optimize CI performance, we use incremental mutation testing:

### How It Works

1. **Detects changed files** using git diff
2. **Runs mutations** only on modified code
3. **Caches results** for unchanged files
4. **Reduces execution time** by 60-80% on PRs

### Automatic Triggers

- Pull requests automatically use incremental mode
- Main branch runs full mutation testing
- Results are cached between runs

## Improving Mutation Score

When mutation tests fail (mutants survive), follow these steps:

### 1. Analyze Survived Mutants

Check the report for survived mutants:

```bash
npm run mutation:test:report
```

Look for patterns in `mutation-reports/mutation-summary.md`

### 2. Common Survival Reasons

| Mutant Type | Reason | Solution |
|-------------|--------|----------|
| Boolean flip | Missing edge case test | Add test for opposite condition |
| Arithmetic operator | Weak assertion | Assert exact values, not just ranges |
| String literal | No validation test | Test error messages/specific text |
| Logical operator | Missing combination test | Test all logical branches |
| Conditional boundary | Off-by-one not tested | Test boundary conditions |

### 3. Example: Fixing a Survived Mutant

**Original Code**:
```typescript
function validateAge(age: number): boolean {
  return age >= 18; // Mutant: >= becomes >
}
```

**Weak Test** (mutant survives):
```typescript
test('validates age', () => {
  expect(validateAge(20)).toBe(true); // Passes for both >= and >
});
```

**Strong Test** (kills mutant):
```typescript
test('validates age at boundary', () => {
  expect(validateAge(18)).toBe(true);  // Fails if >= becomes >
  expect(validateAge(17)).toBe(false); // Tests boundary
});
```

### 4. Prioritize High-Value Mutants

Focus on:
1. **Critical business logic** - Payment processing, subscriptions
2. **Security-sensitive code** - Authentication, authorization
3. **Frequently changed areas** - High churn indicates risk
4. **Complex conditionals** - More likely to have bugs

## Historical Tracking

Mutation scores are tracked over time:

### View History

```bash
# View mutation history JSON
cat mutation-reports/mutation-history.json
```

### Tracked Metrics

- Overall mutation score
- Frontend vs backend scores
- Mutant statistics (killed, survived, etc.)
- Commit SHA and timestamp
- Score trends over time

### Badge

Add the mutation testing badge to your PR:

```markdown
![Mutation Score](https://github.com/Smartdevs17/SubTrackr/actions/workflows/mutation-testing.yml/badge.svg)
```

## CI Integration

### GitHub Actions Workflow

Location: `.github/workflows/mutation-testing.yml`

**Features**:
- 🔹 Automatic on PR changes to source files
- 🔹 Full testing on main branch pushes
- 🔹 Manual workflow dispatch with scope selection
- 🔹 Caching for faster execution
- 🔹 PR comments with results
- 🔹 Artifact uploads (reports, history)
- 🔹 Quality gate enforcement (75% threshold)

### PR Comments

The workflow automatically posts a comment on PRs with:
- Overall mutation score
- Frontend and backend breakdown
- Survived mutants summary
- Quality gate status (Pass/Fail)
- Recommendations for improvement

## Performance Optimization

### Execution Time

- **Full frontend**: ~15-30 minutes
- **Full backend**: ~10-20 minutes
- **Incremental PR**: ~5-10 minutes (60-80% faster)

### Optimization Strategies

1. **Incremental testing** - Only test changed files on PRs
2. **Parallel execution** - Multiple test runners (`maxConcurrentTestRunners: 2`)
3. **Coverage analysis** - `perTest` mode for faster execution
4. **File caching** - Reuse results for unchanged files
5. **Timeout limits** - Prevent hanging mutants (60s timeout)

### CI Resource Management

```yaml
timeout-minutes: 60           # Total workflow timeout
maxConcurrentTestRunners: 2   # Balance speed vs resources
```

## Edge Cases & Limitations

### Equivalent Mutants

Some mutants are semantically equivalent to the original code:

```typescript
// Original
const result = value || defaultValue;

// Mutant (equivalent)
const result = value ? value : defaultValue;
```

**Solution**: Mark as ignored or accept lower score for that file

### Very Slow Mutants

Some mutations cause infinite loops or extreme slowdowns:

```typescript
// Original
while (i < 100) { i++; }

// Mutant (slow)
while (i < 100) { i--; } // Infinite loop
```

**Solution**: Configure appropriate timeouts (60s default)

### Test Framework Limitations

- **Snapshot tests** - Often don't kill mutants (update snapshots)
- **Mock-heavy tests** - May not verify actual behavior
- **Integration tests** - Can be too slow for mutation testing

**Recommendation**: Focus on unit tests with strong assertions

## Best Practices

### 1. Write Mutation-Resistant Tests

```typescript
// ❌ Weak test
test('calculates total', () => {
  expect(calculateTotal([1, 2, 3])).toBeTruthy(); // Survives many mutants
});

// ✅ Strong test
test('calculates total', () => {
  expect(calculateTotal([1, 2, 3])).toBe(6); // Kills arithmetic mutants
  expect(calculateTotal([])).toBe(0);        // Kills boundary mutants
  expect(calculateTotal([5])).toBe(5);       // Kills logical mutants
});
```

### 2. Test Edge Cases

- Boundary values (0, -1, max)
- Empty collections
- Null/undefined inputs
- Error conditions

### 3. Use Precise Assertions

```typescript
// ❌ Weak
expect(result).toBeDefined();

// ✅ Strong
expect(result).toEqual({ id: 1, name: 'Test' });
```

### 4. Test Boolean Logic

```typescript
// ❌ Incomplete
test('validates input', () => {
  expect(validate('valid')).toBe(true);
});

// ✅ Complete
test('validates input', () => {
  expect(validate('valid')).toBe(true);
  expect(validate('invalid')).toBe(false);
  expect(validate('')).toBe(false);
});
```

### 5. Ignore When Appropriate

Some code is not worth mutation testing:

```typescript
// Config files, type definitions, simple getters
export const CONFIG = {
  timeout: 5000,  // Don't mutate constants
};

// Use ignore comments sparingly
/* istanbul ignore next */
export function debugLog(msg: string) {
  if (process.env.DEBUG) console.log(msg);
}
```

## Troubleshooting

### Tests Fail During Mutation Testing

**Cause**: Stryker runs tests multiple times with mutated code

**Solution**: Ensure tests are:
- Deterministic (no random values)
- Isolated (no shared state)
- Fast (< 1s per test)

### Out of Memory Errors

**Cause**: Too many concurrent test runners

**Solution**: Reduce `maxConcurrentTestRunners` in config:

```json
{
  "maxConcurrentTestRunners": 1
}
```

### Timeout Errors

**Cause**: Slow tests or infinite loops from mutations

**Solution**: Increase timeout or optimize tests:

```json
{
  "timeoutMS": 120000,
  "timeoutFactor": 2.0
}
```

### Incremental Mode Not Working

**Cause**: Missing git history

**Solution**: Ensure full checkout in CI:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0  # Full history required
```

## Resources

- [Stryker Documentation](https://stryker-mutator.io/)
- [Mutation Testing Guide](https://stryker-mutator.io/docs/General/guides/mutations/)
- [Jest Runner Configuration](https://stryker-mutator.io/docs/stryker-js/jest-runner/)
- [TypeScript Checker](https://stryker-mutator.io/docs/stryker-js/typescript-checker/)

## Support

For issues or questions:

1. Check survived mutants report
2. Review this documentation
3. Open a GitHub issue with mutation report attached
4. Tag with `mutation-testing` label

---

**Last Updated**: June 2026  
**Maintained By**: SubTrackr Development Team

