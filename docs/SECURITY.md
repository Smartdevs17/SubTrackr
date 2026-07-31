# Security Policy

SubTrackr runs automated security checks on every pull request and every merge to
`main`, `dev`, and `develop`. Manual penetration testing still happens, but CI now
provides continuous coverage for code, dependencies, containers, and sandbox API
behavior between quarterly reviews.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub Security
Advisories from the repository Security tab, or email `security@subtrackr.example.com`.

## Automated Security Pipeline

The security workflow is defined in `.github/workflows/security-scan.yml`.

| Area | Tooling | Scope | Merge behavior |
| --- | --- | --- | --- |
| SAST | Semgrep OWASP Top 10 plus `.semgrep/subtrackr.yml` | SQL injection, XSS, CSRF, IDOR, SSRF, and subscription-domain patterns | Critical/Error findings block merge |
| DAST | OWASP ZAP baseline | `vars.DAST_TARGET_URL` sandbox deployment, or a local API fallback when no sandbox URL is configured | Critical findings block merge; high findings require security review |
| Dependency scanning | npm audit, cargo-audit, pip-audit, Dependabot, optional Snyk | `package.json`, `Cargo.toml`, `requirements.txt`, and lockfiles | Critical findings block merge |
| Container scanning | Trivy image and config scans | Root API Dockerfile, OS packages, vulnerable base layers, Dockerfile/IaC misconfigurations | Critical findings block merge |
| Dashboard | `scripts/security-dashboard.py` | Aggregates JSON reports into the job summary and uploaded artifact | High findings route through the `security-review` environment |

## Severity SLA

| Severity | Response SLA | Policy |
| --- | --- | --- |
| Critical | Fix or mitigate within 24 hours | Blocks merge until resolved or an approved emergency exception is documented |
| High | Security-team review within 72 hours | Requires manual review and a tracked remediation plan |
| Medium | Next scheduled release | Triage and batch with normal hardening work |
| Low | Best effort | Fix opportunistically or document why risk is accepted |

## False Positive Management

False positives must be documented close to the scanner that raised them.

- Semgrep suppressions must use `# nosemgrep: <rule-id> -- reason: <why safe> -- expires: YYYY-MM-DD`.
- Approved Semgrep exceptions are tracked in `.semgrep/semgrep-suppressions.yml`.
- Snyk exceptions belong in `.snyk` with a justification and expiry date when the token-backed Snyk job is enabled.
- ZAP and Trivy exceptions should be linked from the security dashboard artifact or the follow-up issue used for security review.

Suppression without a reason fails CI for Semgrep. Long-lived exceptions should be
reviewed during quarterly penetration testing.

## DAST Rate Limiting

`scripts/zap-baseline-scan.sh` retries ZAP scans when the target appears rate
limited. The default policy is three attempts with a five-minute backoff between
attempts. Configure these environment variables if the sandbox changes:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DAST_TARGET_URL` | unset | GitHub Actions variable for the deployed sandbox target |
| `ZAP_MAX_ATTEMPTS` | `3` | Maximum ZAP attempts before failing |
| `ZAP_BACKOFF_SECONDS` | `300` | Backoff between retry attempts |
| `ZAP_FAIL_LEVEL` | `Critical` | Minimum DAST severity that blocks merge |

## Triage Workflow

1. Review the Security Dashboard job summary and downloaded scanner artifacts.
2. Confirm exploitability and assign a severity.
3. For Critical issues, patch immediately or revert the risky change.
4. For High issues, request security-team review through the protected `security-review` environment and create a tracked remediation issue.
5. Add any approved false positive to `.snyk` or `.semgrep/semgrep-suppressions.yml` with a clear reason and expiry.
6. Re-run the workflow and verify the dashboard is clear or the accepted risk is documented.
