# SubTrackr Configuration Management

## Overview
SubTrackr uses a structured environment configuration system powered by **Zod** validation.

## Supported Environments
- `development` (Default for local work)
- `staging` (Staging integration tests)
- `production` (Live environment with strict schema validation)
- `test` (Automated unit/integration tests)

## Features
- **Validation**: Strict schema checks via `zod`.
- **Secret Management**: Automatic resolution via AWS Secrets Manager when enabled.
- **Config Drift Detection**: Utilities to compare actual runtime config vs expected definitions.
- **Runtime Refresh**: In-memory config refresh capability without service restart.
