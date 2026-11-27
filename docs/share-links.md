# Subscription share links

`backend/src/services/shareLinks.ts` (#2025) builds read-only share URLs for one subscription.

The URL ends in a token, `<payload>.<signature>`. The payload holds the subscription ID, the granted scopes, issue and expiry times and a token ID. The signature is HMAC-SHA256 over the payload with a server secret of at least 32 characters.

Scopes: `summary`, `billing`, `usage`, `invoices`. Expiry defaults to 7 days and cannot exceed 30.

```ts
const links = createShareLinkService({ secret, baseUrl: 'https://app.example.com/share', store });
const { url, tokenId } = links.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });

const result = await links.verify({
  token: links.extractToken(requestUrl)!,
  requiredScope: 'summary',
  subscriptionId: 'sub-1',
});
if (!result.ok) respond(403, result.reason);
```

Failure reasons: `MALFORMED`, `BAD_SIGNATURE`, `EXPIRED`, `REVOKED`, `WRONG_SUBSCRIPTION`, `SCOPE_NOT_GRANTED`. `revoke(token)` blocks one link. The default revocation store is in memory; production needs a shared store implementing `RevocationStore`.

`onEvent` receives `created`, `verified`, `rejected` and `revoked` events with token IDs only, never the token or the secret.
