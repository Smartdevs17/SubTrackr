# API Versioning

SubTrackr uses a URL-based versioning strategy to ensure backwards compatibility. The current active version is `v1`.

## How it works

When making API requests, you must include the version in the URL:

```http
https://api.subtrackr.io/v1/subscriptions
```

## Backwards Compatibility

We consider the following changes to be backwards-compatible:
- Adding new API endpoints
- Adding new properties to responses
- Adding optional request parameters
- Changing the order of properties in a response

## Breaking Changes

If we need to make backwards-incompatible changes, we will release a new API version (e.g., `v2`). Examples of breaking changes include:
- Removing an endpoint
- Removing or renaming a property in a response
- Changing a property's type
- Adding a new required parameter

When a new version is released, we will provide an upgrade guide and deprecation timeline for the previous version.
