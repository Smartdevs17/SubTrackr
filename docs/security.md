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

## MEV Threat Model for Subscription Charges

Subscription charge transactions can be visible before inclusion. For large
charges, this creates room for ordering games, gas bidding, and sandwich-style
execution around token liquidity or merchant-side accounting hooks.

The subscription contract exposes an opt-in MEV protection configuration:

- `large_charge_threshold` forces charges at or above the threshold through a
  commit-reveal flow instead of the direct charge path.
- `max_fee_bps` caps how loose a subscriber's reveal-time maximum charge bound
  can be, protecting against stale or manipulated charge parameters.
- `private_mempool_required` lets operators require relayers/private routing for
  protected reveals when public mempool exposure is unacceptable.
- `gas_price_alert_threshold` records an on-chain alert counter/event when a
  reveal reports an unusually high gas price signal.

Recommended operation:

1. Configure conservative thresholds for high-value plans.
2. Have the subscriber derive a 32-byte commitment with
   `hash_charge_commitment(subscription_id, max_charge_amount, salt)` and submit
   it through `commit_charge`.
3. Reveal after the configured delay with `reveal_charge`, the salt, a strict
   `max_charge_amount`, observed gas price, and private-route flag.
4. Monitor `mev_gas_alert` events and `get_mev_alert_count` for gas bidding
   anomalies.

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
