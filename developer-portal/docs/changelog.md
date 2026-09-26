# Changelog

All notable changes to the SubTrackr API and SDKs will be documented in this file.

## [1.2.0] - 2026-07-24

### Added
- **API Playground**: Interactive API playground added to the developer portal for easy testing and code generation.
- **Python SDK**: Added support for pagination in the `list` method for subscriptions and payments.
- **Go SDK**: Added webhook verification helpers.

### Changed
- Improved error messages for `INVALID_REQUEST` by providing more granular `details`.

## [1.1.0] - 2026-06-15

### Added
- **Webhooks**: Added `invoice.generated` event.
- **API**: New `GET /v1/analytics/subscriptions` endpoint for aggregated subscription metrics.

### Fixed
- Fixed an issue where the `category` filter on `GET /v1/subscriptions` was case-sensitive.

## [1.0.0] - 2026-05-01

### Added
- Initial stable release of the SubTrackr API (`v1`).
- SDKs released for JavaScript/Node.js, Python, and Go.
- comprehensive Developer Portal with API Reference and Quick Start Guides.
