# SubTrackr SDK Deprecation Policy

**Issue #1178 — Implement SDK versioning with deprecation policy**

---

## Versioning scheme

The SubTrackr SDK follows [Semantic Versioning 2.0.0](https://semver.org/):

| Component | Meaning |
|-----------|---------|
| **MAJOR** | Breaking change. Callers **must** update. |
| **MINOR** | New features, backwards-compatible. |
| **PATCH** | Bug fixes. No API surface changes. |

Current SDK version: **2.0.0**  
Targets API version: **v2**  
Minimum supported API version: **v1**

---

## API version policy

- Every request carries `X-SDK-Version` and `X-API-Version` headers so the backend can route or log accordingly.
- The SDK supports a **rolling two-version window**: current (`v2`) and the previous version (`v1`).
- API versions more than one major behind the current version are **deprecated**.
- Deprecated API versions are removed no sooner than **6 months** after the deprecation notice is published.

---

## Deprecation lifecycle

```
current  ──▶  deprecated  ──▶  removed
                (≥ 6 mo)
```

### 1. Current
Normal usage. No warnings.

### 2. Deprecated
- A `console.warn` (JavaScript) or `DeprecationWarning` (Python) is emitted **once per process**.
- The warning includes: method/option name, version deprecated, version of removal, recommended replacement.
- Deprecated features continue to work identically.

### 3. Removed
- The method/option is deleted from the SDK.
- Calling it throws a `RemovedError` (JavaScript) or `RemovedError` exception (Python).
- The error message names the replacement and links to the migration guide.

---

## Currently deprecated methods

| SDK | Method | Deprecated In | Removed In | Replacement |
|-----|--------|---------------|------------|-------------|
| JS/TS | `getSubscriptions()` | `2.0.0` | `3.0.0` | `listSubscriptions()` |
| JS/TS | `getWebhooks()` | `2.0.0` | `3.0.0` | `listWebhooks()` |
| Python | `get_subscriptions()` | `2.0.0` | `3.0.0` | `list_subscriptions()` |

---

## Migrating from v1.x to v2.x

```ts
// Before (v1)
const subs = await client.getSubscriptions();

// After (v2)
const subs = await client.listSubscriptions();
```

```python
# Before (v1)
subs = client.get_subscriptions()

# After (v2)
subs = client.list_subscriptions()
```

---

## Silencing deprecation warnings (e.g. in tests)

**JavaScript**
```ts
import { DeprecationRegistry } from '@subtrackr/sdk';

beforeEach(() => DeprecationRegistry.reset());
afterAll(() => DeprecationRegistry.unsilence());

// In a specific test:
DeprecationRegistry.silence();
```

**Python**
```python
import warnings
from subtrackr import reset_warned

def setup_function():
    reset_warned()

with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    client.get_subscriptions()
```

---

## Checking version compatibility at runtime

**JavaScript**
```ts
import { assessApiVersionCompatibility, SDK_VERSION } from '@subtrackr/sdk';

const compat = assessApiVersionCompatibility(serverApiVersion);
if (!compat.supported) {
  console.warn(compat.message);
}

console.log(client.getSdkVersion()); // "2.0.0"
console.log(client.getApiVersion()); // 2
```

**Python**
```python
from subtrackr import assess_api_version_compatibility, SDK_VERSION

compat = assess_api_version_compatibility(server_api_version)
if not compat["supported"]:
    print(compat["message"])

print(client.get_sdk_version())  # "2.0.0"
print(client.get_api_version())  # 2
```
