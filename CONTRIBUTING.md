# Contributing to SubTrackr

Thank you for taking the time to contribute SubTracker. This document covers everything you need to know to contribute to this project

---

## Table of Contents

- [Development Setup](#development-setup)
- [Code Style Guidelines](#code-style-guidelines)
- [Commit Message Conventions](#commit-message-conventions)
- [Branch Naming Conventions](#branch-naming-conventions)
- [Pull Request Process](#pull-request-process)
- [Testing Requirements](#testing-requirements)

---

## Development Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Mobile app development |
| npm | bundled with Node | Package management |
| Rust | 1.77+ | Smart contract development |
| Expo CLI | latest | Running and building the app |
| Soroban CLI | latest | Deploying/interacting with contracts |

### Mobile App Setup

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start the Expo development server
npx expo start

# Run on Android
npm run android

# Run on iOS
npm run ios
```

### Smart Contracts Setup

```bash
# Install the Rust toolchain with required components
rustup component add rustfmt clippy

# Build contracts
npm run contracts:build

# Run contract tests
npm run contracts:test
```

### Environment Variables

Create a `.env` file at the project root if needed:

| Variable | Description |
|----------|-------------|
| `STELLAR_NETWORK` | `testnet` or `public` |
| `CONTRACT_ID` | Deployed Soroban subscription contract ID |
| `WEB3AUTH_CLIENT_ID` | Web3Auth client ID for social login |

### Generating Contract TypeScript Types

After modifying any ABI files in `src/contracts/abis/`, regenerate the TypeScript bindings and commit the result:

```bash
npm run contracts:codegen
```

The CI pipeline checks that committed types match the ABI — always run this before pushing if you changed any ABI.

### Running All CI Checks Locally

```bash
npm run ci
```

This runs lint, type check, tests, contract tests, Rust formatting, and Clippy in sequence.

---

## Code Style Guidelines

### TypeScript / React Native

Formatting is enforced by **Prettier** and linting by **ESLint**. The configuration is in `.prettierrc` and `.eslintrc.json`.

Key rules:

- **Indentation**: 2 spaces (no tabs)
- **Quotes**: single quotes (`'`)
- **Semicolons**: required
- **Trailing commas**: ES5 style (objects and arrays only)
- **Print width**: 100 characters
- **Line endings**: LF

ESLint rules to be aware of:

- `@typescript-eslint/no-unused-vars` — unused variables are errors; prefix intentionally unused params with `_`
- `@typescript-eslint/no-explicit-any` — `any` types produce a warning; use proper types
- `no-console` — `console.log` is a warning; only `console.warn` and `console.error` are allowed

**Auto-fix before committing:**

```bash
npm run lint:fix    # fix ESLint issues
npm run format      # apply Prettier formatting
```

**Check without modifying:**

```bash
npm run lint
npm run format:check
npm run typecheck
```

### Rust (Smart Contracts)

- Follow standard Rust idioms and the output of `cargo fmt`
- All Clippy warnings (`-D warnings`) must be resolved
- Keep contract logic in `contracts/src/lib.rs` well-documented

```bash
npm run contracts:fmt     # check formatting
npm run contracts:clippy  # run linter
```

---

## Commit Message Conventions

This project uses **Conventional Commits**. Every commit message must follow this format:

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, dependency updates, tooling |
| `docs` | Documentation only |
| `refactor` | Code change that is neither a fix nor a feature |
| `test` | Adding or updating tests |
| `style` | Formatting, whitespace — no logic change |
| `ci` | CI/CD configuration changes |
| `perf` | Performance improvement |

### Scope (optional but encouraged)

Use the area of the codebase affected: `contracts`, `store`, `screens`, `navigation`, `services`, `hooks`, `ui`, `wallet`, `notifications`.

### Examples

```
feat(contracts): add grace period logic to billing cycle
fix(store): prevent duplicate subscription entries on rehydration
chore(deps): bump ethers to 5.8.0
docs: add environment variable table to README
test(store): add unit tests for subscriptionStore selectors
refactor(screens): extract shared form logic into useSubscriptionForm hook
ci: cache Rust build artifacts in contracts jobs
```

### Rules

- Use the imperative mood in the description ("add" not "added" or "adds")
- Do not capitalize the first letter of the description
- No period at the end of the description
- Keep the subject line under 72 characters
- Reference GitHub issues in the footer: `Closes #123` or `Refs #456`

---

## Branch Naming Conventions

Branches must follow this pattern:

```
<type>/<short-description>
```

Use the same types as commit messages. The description should be kebab-case.

### Examples

```
feat/grace-period-billing
fix/duplicate-subscription-rehydration
chore/bump-expo-53
docs/soroban-deployment-guide
test/subscription-store-unit-tests
refactor/wallet-service-error-handling
```

### Protected Branches

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code — all CI must pass, PR required |
| `dev` / `develop` | Integration branch — CI required |

Never commit directly to `main`. All changes must go through a pull request.

---

## Pull Request Process

### Before Opening a PR

1. Run `npm run ci` locally and fix any failures
2. Ensure your branch is up to date with `main`
3. Write or update tests for any changed behaviour
4. Regenerate contract types if ABIs changed (`npm run contracts:codegen`)

### PR Requirements

All of the following CI jobs must pass before a PR can be merged:

| Check | Command |
|-------|---------|
| Prettier format | `npm run format:check` |
| ESLint | `npm run lint` |
| TypeScript type check | `npm run typecheck` |
| Jest tests | `npm test` |
| Expo build | `npm run build` |
| Rust formatting | `npm run contracts:fmt` |
| Rust Clippy | `npm run contracts:clippy` |
| Rust tests | `npm run contracts:test` |

### PR Checklist

The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) will be pre-filled when you open a PR. Make sure all boxes are checked before requesting review:

- All CI checks pass
- New code has appropriate TypeScript types
- No hardcoded secrets or credentials
- New features have corresponding tests
- Documentation updated if needed

### Review

- At least **1 approval** is required before merging
- Address all review comments before re-requesting review
- Stale reviews are dismissed automatically when new commits are pushed

---

## Testing Requirements

### TypeScript / React Native Tests

- Tests live alongside source files or in `__tests__` directories
- Test files must match: `**/*.test.{ts,tsx}` or `**/*.spec.{ts,tsx}`
- Use the `@/` path alias for imports from `src/` (e.g. `import { foo } from '@/utils/formatting'`)

```bash
npm test                 # run all tests
npm run test:coverage    # run with coverage report
```

Coverage is collected from all files under `src/**/*.{ts,tsx}`, excluding `.d.ts` and barrel `index.ts` files.

**What to test:**

- State store logic (Zustand actions and selectors)
- Utility functions (`src/utils/`)
- Service layer functions where possible
- New screens should have at least a smoke-render test

### Rust Contract Tests

- Tests live in `contracts/src/lib.rs` using the standard `#[cfg(test)]` module
- All contract logic must have corresponding tests

```bash
npm run contracts:test
# or directly:
cd contracts && cargo test --verbose
```

**What to test:**

- Happy-path contract invocations
- Edge cases (zero amounts, expired subscriptions, unauthorized callers)
- Error conditions and expected panics

### General Guidelines

- Do not commit tests that are skipped (`test.skip`, `xit`) without a comment explaining why
- Mock only what is strictly necessary; prefer testing real behaviour
- Keep test descriptions specific enough to diagnose failures without reading the test body
