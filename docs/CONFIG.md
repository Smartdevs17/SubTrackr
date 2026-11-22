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

## Environment Profiles

App runtime config lives in `src/config/env.ts`; backend service config lives in
`backend/services/shared/configService.ts`. Both expose explicit profiles for
`development`, `test`, `staging`, and `production` and then layer environment
variables on top.

```ts
import { loadEnvironmentConfig } from '../src/config/env';

const config = loadEnvironmentConfig(process.env, 'staging');
```

Production validation is intentionally strict:

- `WALLET_CONNECT_PROJECT_ID` must be a real production value.
- `EXPO_PUBLIC_API_URL` cannot point at sandbox, staging, or localhost.
- Backend `DATABASE_URL` and `REDIS_URL` cannot point at localhost.
- Backend production requires `AWS_SECRET_ID` when managed secrets are enabled.

Backend tests and one-off tools should use an injected env map rather than
mutating global `process.env`:

```ts
import { ConfigService } from '../backend/services/shared/configService';

const service = ConfigService.fromEnv(
  {
    DATABASE_URL: 'postgresql://prod.internal:5432/subtrackr',
    REDIS_URL: 'redis://prod.internal:6379',
    JWT_SECRET: 'production-secret-value',
    AWS_SECRET_ID: 'subtrackr/prod',
  },
  'production'
);
```

Stellar contract IDs should be read from `env` through `src/config/networks.ts`,
not directly from `process.env`.
