# Security and Secret Management

This guide describes how SubTrackr protects sensitive credentials and how contributors should manage secrets.

## Secret Scanning

SubTrackr now enforces GitLeaks-based secret scanning in both local pre-commit hooks and CI.

- `.gitleaks.toml`: GitLeaks configuration for Stellar secrets, API keys, JWTs, private keys, and high-entropy binary data.
- `.pre-commit-config.yaml`: Captures staged file scans before commit.
- `.github/workflows/secret-scan.yml`: Scans full git history on pushes to `main` and release branches.
- `.gitleaks.baseline.toml`: Known false positives are allowed via baseline exceptions.

## Contributor Workflow

1. Install repo hooks:
   ```bash
   npm install
   npx husky install
   npx pre-commit install
   ```
2. Before committing, staged files are scanned automatically.
3. If GitLeaks detects a secret, fix the offending file before committing.

## What is scanned

- Stellar secret keys beginning with `S` and 56-character encoded payload.
- Stripe-style API keys such as `sk_live_...` and `sk_test_...`.
- JWT tokens like `eyJ...`.
- PEM private key blocks (`BEGIN RSA PRIVATE KEY`, `BEGIN EC PRIVATE KEY`, etc.).
- High-entropy base64-like strings or binary content with entropy above 4.5 bits/byte.

## CI Detection and Alerting

The CI workflow uses GitLeaks Docker image to run a full repository scan.

On detection:
- A Slack alert is sent to the configured security webhook.
- If a Stellar secret is found, the workflow attempts key rotation with `scripts/revoke-stellar-key.sh`.
- Pull requests receive an automated comment with remediation instructions.

## Remediation

If a secret is found in history:
1. Remove it from the file.
2. Rewrite git history to eliminate committed exposure.
3. Force-push the cleaned branch.
4. Rotate the exposed credentials in the affected system.

## Best Practices

- Never store secrets in source control.
- Use environment variables or secrets management tools.
- Rotate leaked keys immediately.
- Audit Git history regularly and keep `.gitleaks.baseline.toml` updated with only verified false positives.
