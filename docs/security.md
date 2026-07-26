# Security Policy

SubTrackr is committed to maintaining a secure environment for tracking subscriptions. This document outlines our security practices, vulnerability reporting process, and patching workflow.

## Reporting a Vulnerability

If you've found a security vulnerability, please do NOT create a public issue. Instead, report it via one of the following methods:

1. **GitHub Security Advisory**: Use the "Report a security vulnerability" button in the Security tab of the repository.
2. **Email**: security@subtrackr.example.com (Placeholder)

## Vulnerability Severity Levels

We follow the CVSS standard to categorize vulnerabilities:

| Severity     | Description                                             | Target Response        |
| :----------- | :------------------------------------------------------ | :--------------------- |
| **Critical** | Remote code execution, full database access, etc.       | Within 24 hours        |
| **High**     | Significant data exposure, bypass of security controls. | Within 72 hours        |
| **Moderate** | Potential for misuse, limited data exposure.            | Next scheduled release |
| **Low**      | Minimal impact, hard to exploit.                        | Best effort            |

## Security Monitoring

The repository is monitored using several automated tools:

1. **GitHub Dependabot**: Scans dependencies daily for known vulnerabilities (CVEs).
2. **NPM Audit**: Integrated into CI/CD to prevent merging code with high-risk dependencies.
3. **Audit-CI**: Enforces strict policy-based audits during the build process.

## Patching Workflow

1. **Notification**: Dependabot or CI alert triggers a notification.
2. **Triage**: Maintainers assess the impact and severity.
3. **Draft**: A fix is drafted in a private security fork or branch.
4. **Validation**: CI runs security scans against the proposed fix.
5. **Release**: The fix is merged and a new version is released immediately for Critical/High issues.
6. **Disclosure**: A security advisory is published if necessary.

## Best Practices for Contributors

- Never commit secrets, API keys, or private tokens.
- Use environment variables for sensitive configuration.
- Keep dependencies updated and minimize the use of unverified third-party libraries.
