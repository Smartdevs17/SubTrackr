# Enterprise Single Sign-On (SSO) & JIT Provisioning

SubTrackr provides enterprise-grade Single Sign-On (SSO) support across **SAML 2.0** and **OpenID Connect (OIDC)**, alongside **Just-in-Time (JIT) provisioning** and **SCIM 2.0** directory integration.

---

## 1. Architecture Overview

Enterprise organizations can enforce centralized authentication with corporate identity providers (such as Okta, Azure AD / Microsoft Entra ID, Google Workspace, PingFederate, or OneLogin).

```
                      ┌────────────────────────────────────────┐
                      │    Identity Provider (IdP)             │
                      │  (Okta / Azure AD / PingFederate)      │
                      └──────────────────┬─────────────────────┘
                                         │
               1. Initiate SSO Login     │  2. SAML Assertion /
                  Redirect               │     OIDC ID Token + Claims
                                         ▼
                               ┌──────────────────┐
                               │   SubTrackr SSO  │
                               │   Gateway / ACS  │
                               └─────────┬────────┘
                                         │
                     ┌───────────────────┴───────────────────┐
                     ▼                                       ▼
       ┌───────────────────────────┐           ┌───────────────────────────┐
       │   JIT Provisioning        │           │   Session Management      │
       │  - Auto-create/sync user  │           │  - 8-hour secure session  │
       │  - Apply role mappings    │           │  - Audit log recorded     │
       └───────────────────────────┘           └───────────────────────────┘
```

---

## 2. Supported Protocols

### SAML 2.0
- **Binding**: HTTP-POST and HTTP-Redirect.
- **NameID Format**: Email address (`urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress`).
- **Metadata**: Direct XML metadata import or dynamic configuration from remote IdP metadata URLs.
- **Signatures**: Enforces signed assertions and AuthnRequests.
- **Certificates**: Supports dual-certificate rotation with automated expiring certificate detection.

### OpenID Connect (OIDC)
- **Grant**: Authorization Code Flow (`response_type=code`).
- **Discovery**: Integrates with IdP discovery endpoints (`.well-known/openid-configuration`).
- **Claims**: Extracts `email`, `displayName`, and corporate `groups` for automated provisioning and role assignment.

---

## 3. Just-in-Time (JIT) User Provisioning

When JIT provisioning is enabled for an identity provider:
1. **User Authentication**: The user completes authentication at the enterprise IdP.
2. **Attribute Extraction**: SubTrackr parses assertion attributes (email, display name, groups/departments).
3. **Account Provisioning**:
   - If the user does not exist in SubTrackr under the organization, a new user account is automatically provisioned.
   - If the user already exists, their display name, group memberships, and roles are synchronized on-the-fly (`lastSyncedAt` updated).
4. **Role Mapping**: Corporate IdP group memberships (e.g. `billing-admins`, `it-security`) are automatically translated into SubTrackr platform roles (`admin`, `billing`, `viewer`).

```typescript
// Example role mapping configuration:
[
  { idpGroup: "Engineering-Leads", subtrackrRole: "admin" },
  { idpGroup: "Finance-Operations", subtrackrRole: "billing" },
  { idpGroup: "All-Employees", subtrackrRole: "viewer" }
]
```

---

## 4. Emergency Bypass & Resilience

To prevent enterprise lockouts during third-party IdP outages or misconfigured assertion certificates:
- **Bypass Codes**: Every identity provider generates single-use cryptographically random emergency bypass codes upon creation.
- **Certificate Rotation**: SAML configurations maintain primary and secondary certificates with automatic warnings when certificates are within 30 days of expiration.
- **IP Allowlisting**: Organizations can optionally restrict SSO access to enterprise corporate CIDR ranges.

---

## 5. API Reference

### Create Identity Provider
`POST /api/v1/sso/identity-providers`
```json
{
  "organizationId": "org_enterprise_01",
  "name": "Okta Enterprise",
  "protocol": "saml2"
}
```

### Configure SAML via Metadata XML
`POST /api/v1/sso/identity-providers/:id/saml/metadata`
```json
{
  "metadataXml": "<md:EntityDescriptor entityID=\"https://okta.com/idp\">...</md:EntityDescriptor>"
}
```

### Configure OIDC Provider
`POST /api/v1/sso/identity-providers/:id/oidc`
```json
{
  "issuer": "https://login.microsoftonline.com/tenant/v2.0",
  "authorizationEndpoint": "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
  "tokenEndpoint": "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
  "userinfoEndpoint": "https://graph.microsoft.com/oidc/userinfo",
  "jwksUri": "https://login.microsoftonline.com/tenant/discovery/v2.0/keys",
  "clientId": "subtrackr-client-id",
  "clientSecretHash": "sha256_hashed_secret",
  "scopes": ["openid", "email", "profile"]
}
```

### Enable JIT Provisioning
`POST /api/v1/sso/identity-providers/:id/jit`
```json
{
  "enabled": true
}
```

### Configure Role Mappings
`POST /api/v1/sso/identity-providers/:id/roles`
```json
{
  "mappings": [
    { "idpGroup": "SubTrackr-Admins", "subtrackrRole": "admin" },
    { "idpGroup": "SubTrackr-Finance", "subtrackrRole": "billing" }
  ]
]
```

### Initiate SSO Login
`POST /api/v1/sso/login`
```json
{
  "identityProviderId": "idp_12345",
  "relayState": "/dashboard/subscriptions"
}
```
**Response**:
```json
{
  "success": true,
  "data": {
    "redirectUrl": "https://idp.example.com/sso?SAMLRequest=...",
    "state": "8f3b2a1c0d4e..."
  }
}
```
