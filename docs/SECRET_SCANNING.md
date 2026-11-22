# Secret Scanning

Issue #1767 — prevent credentials from landing in the repository.

## What runs

The `Secret Scanning - gitleaks` job in
[`.github/workflows/security-scan.yml`](../.github/workflows/security-scan.yml)
runs [gitleaks](https://github.com/gitleaks/gitleaks) over **every commit** in
the repository (`git log --all`) on every pull request and on pushes to
`main` / `dev` / `develop`, plus a weekly scheduled run:

```bash
gitleaks detect \
  --source=/repo \
  --log-opts=--all \
  --redact \
  --report-format=json \
  --report-path=security-reports/gitleaks.json \
  --exit-code=1
```

- **Runs on PRs** — the workflow trigger is `pull_request` (and `push` to the
  long-lived branches), so every PR gets a dedicated check.
- **Fails on detection** — `--exit-code=1` makes the job go red the moment any
  secret is found; the follow-up `security-dashboard.py --fail-on-critical`
  step (runs with `if: always()`) re-reports the findings and annotates the run.
  Findings are also uploaded as the `security-secret-scan` artifact.
- Secrets in the report are **redacted** (`--redact`), so the raw value never
  appears in logs.

## Configuration

Rules come from the built-in gitleaks ruleset extended by
[`.gitleaks.toml`](../.gitleaks.toml):

- **Allowlist** — test/spec files, `__tests__`/`__mocks__` directories,
  Markdown, lockfiles, `.env.example`, the developer-portal demo screen
  (`developer-portal/pages/ApiKeysPage.tsx`) whose `sk_test_…` values are
  render-only fixtures, and the literal placeholder tokens `YOUR_API_KEY` /
  `sk_test_your_key` used in documentation snippets.
- Everything else is reported as **Critical** and blocks the check.

Allowlist entries are for **known-fake values only**. Never allowlist a file
because it contains a real credential — rotate the credential instead.

## Running locally

```bash
# Full-history scan (same as CI), needs Docker:
docker run --rm -v "$PWD":/repo -w /repo ghcr.io/gitleaks/gitleaks:latest \
  detect --source=/repo --log-opts=--all --redact --exit-code=1

# Or with a local gitleaks install:
gitleaks detect --source=. --redact --verbose
```

The scan uses `.gitleaks.toml` automatically from the repository root.

## If a secret is found

1. **Rotate it immediately** (API keys, Stripe keys, tokens are all
   revocable). Treat the leak as real until proven otherwise — history scans
   catch secrets that were committed and later "removed" from the working tree.
2. Purge from history only after rotation (`git filter-repo` / BFG) and force
   coordinate with collaborators.
3. Add an allowlist entry **only** if the value is a documented placeholder,
   and say so in the entry's description.

## Related

- `docs/security-dashboard.md` — how findings from all security tools are
  aggregated.
- `.github/workflows/security-scan.yml` — SAST (Semgrep), dependency audit,
  Trivy, this secret scan, and DAST (ZAP).
