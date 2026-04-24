# Subscription Contract Fuzzing Test Suite

## Overview

This document describes the comprehensive fuzzing test suite for the SubTrackr subscription contract.

## Test Files

### 1. `tests/fuzz.rs` - Core Fuzzing Tests
Tests basic input validation and state transitions.

**Tests:**
- `test_negative_prices()` - Reject negative prices
- `test_huge_prices()` - Handle very large numbers
- `test_pause_duration_limits()` - Enforce pause duration limits
- `test_invalid_state_transitions()` - Prevent double cancellations
- `test_refund_limits()` - Prevent refunds exceeding total paid

### 2. `tests/pricing_fuzz.rs` - Pricing Differential Fuzzing
Tests pricing calculations across different price points and intervals.

**Tests:**
- `test_pricing_calculations()` - Test all price × interval combinations
- `test_subscriptions_with_different_prices()` - Multiple subscriptions with different prices
- `test_price_boundaries()` - Test minimum and maximum prices

### 3. `tests/rate_limit_fuzz.rs` - Rate Limit Fuzzing
Tests rate limiting functionality.

**Tests:**
- `test_rate_limit_intervals()` - Test various rate limit intervals
- `test_rate_limit_removal()` - Test rate limit removal
- `test_multiple_rate_limits()` - Test multiple function rate limits

## Running Tests

### Run All Tests
```bash
cd contracts/subscription
cargo test
```

### Run Specific Test File
```bash
cargo test --test fuzz_tests
cargo test --test pricing_fuzz_tests
cargo test --test rate_limit_fuzz_tests
```

### Run Specific Test
```bash
cargo test test_negative_prices
```

### Run With Output
```bash
cargo test -- --nocapture
```

### Run Using Script
```bash
bash scripts/run_fuzz_tests.sh
```

## Test Coverage

| Category | Tests | Status |
|----------|-------|--------|
| Input Validation | 5 | ✅ |
| Pricing | 3 | ✅ |
| Rate Limiting | 3 | ✅ |
| **Total** | **11** | **✅** |

## Key Findings

### ✅ Vulnerabilities Tested
- Zero price validation
- Negative price handling
- Integer overflow scenarios
- Pause duration limits
- Double cancellation prevention
- Refund amount validation
- Rate limit enforcement

### ✅ Edge Cases Covered
- Minimum price ($1)
- Maximum price (i128::MAX / 2)
- Pause duration boundaries (30 days)
- All subscription intervals (Day, Week, Month, Year)
- Multiple concurrent rate limits

## CI/CD Integration

Tests automatically run on:
- Push to `main` or `develop`
- Pull requests to `main` or `develop`
- Changes to `contracts/subscription/**`

**Workflow:** `.github/workflows/fuzz-tests.yml`

## Expected Results

All tests should pass:
```
running 11 tests
test pricing_fuzz_tests::test_pricing_calculations ... ok
test pricing_fuzz_tests::test_price_boundaries ... ok
test pricing_fuzz_tests::test_subscriptions_with_different_prices ... ok
test rate_limit_fuzz_tests::test_multiple_rate_limits ... ok
test rate_limit_fuzz_tests::test_rate_limit_intervals ... ok
test rate_limit_fuzz_tests::test_rate_limit_removal ... ok
test fuzz_tests::test_huge_prices ... ok
test fuzz_tests::test_invalid_state_transitions ... ok
test fuzz_tests::test_negative_prices ... ok
test fuzz_tests::test_pause_duration_limits ... ok
test fuzz_tests::test_refund_limits ... ok

test result: ok. 11 passed; 0 failed
```

## Future Improvements

- [ ] Property-based fuzzing with `proptest`
- [ ] Symbolic execution for pricing logic
- [ ] Formal verification of contract transitions
- [ ] Continuous fuzzing infrastructure
- [ ] Coverage metrics reporting

## Issues Found & Fixed

None at this time. ✅

All tests pass successfully!