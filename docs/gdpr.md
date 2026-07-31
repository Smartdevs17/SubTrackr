# GDPR Compliance & Data Privacy

SubTrackr is designed with "Privacy by Design" principles to ensure user data is handled securely and transparently in compliance with the General Data Protection Regulation (GDPR).

## 1. Data Collection & Processing

We collect only the minimum data necessary to provide our subscription management services:

- **Identity**: Wallet addresses (public keys), email (if social login is used).
- **Activity**: Subscription names, billing amounts, and recurring intervals.
- **On-chain**: Transactions recorded on the Stellar network (immutable by design).

## 2. User Rights

### Right of Access & Portability

Users can download a structured JSON file of their profile and activity data directly from the **GDPR Settings** screen in the app.

### Right to be Forgotten (Deletion/Anonymization)

Users can request account deletion. Due to the immutable nature of blockchain, on-chain records remain, but we:

- Anonymize personal identifiers (names, emails) in our off-chain databases.
- Remove associations between the wallet address and the person's identity where possible.
- Soft-delete subscriptions to maintain system integrity for merchants while stopping all user tracking.

### Right to Restrict Processing

Consent preferences for analytics and marketing can be toggled at any time in the app settings.

## 3. Data Processing Agreement (DPA)

| Purpose         | Data Category         | Lawful Basis          |
| :-------------- | :-------------------- | :-------------------- |
| Core Service    | Wallet, Subscriptions | Contractual Necessity |
| Billing Alerts  | Emails, Notifications | Legitimate Interest   |
| App Improvement | Usage Analytics       | Consent (Opt-in)      |

## 4. Retention Policy

- **Active Accounts**: Retained for the duration of the account lifespan.
- **Deactivated Accounts**: Anonymized immediately; logs deleted after 90 days.
- **On-chain Data**: Persists on the Stellar network indefinitely.

## 5. Security Measures

- Data encryption at rest and in transit.
- Secure wallet-based authentication.
- Regular security audits (see [Security Policy](SECURITY.md)).

---

For any privacy-related inquiries, contact us at privacy@subtrackr.example.com.
