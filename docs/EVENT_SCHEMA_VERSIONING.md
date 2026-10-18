# Event Schema Versioning

> Issue #1805 — event consumers break on change. This document and the
> `backend/shared/events/schemaVersioning` module establish versioned event
> schemas with explicit compatibility rules so changes can be reviewed,
> classified, and — where compatible — migrated automatically.

## Why

Webhook consumers and internal event-driven services depend on stable payload
shapes. When a producer renames a field, changes a type, or adds a required
field, downstream consumers silently break. Versioning every published schema
and classifying each change makes breakage an explicit, reviewable decision
instead of an accident.

## Module

`backend/shared/events/schemaVersioning.ts` exposes:

| Export | Purpose |
|--------|---------|
| `SchemaVersionRegistry` | Stores every published version of each event type, diffs versions, asserts compatibility, and migrates payloads. |
| `diffSchemas(from, to)` | Computes a structured `SchemaDiff` (added/removed/changed fields + compatibility classification). |
| `validateAgainstVersion(schema, payload)` | Validates a payload against a specific schema version. |
| `VersionedSchema`, `SchemaField`, `SchemaDiff`, `CompatibilityLevel` | Types. |

## Compatibility Levels

| Level | Meaning | Safe rollout |
|-------|---------|--------------|
| `full` | New reads old **and** old reads new. | Upgrade producers and consumers in any order. |
| `backward` | New schema can read old data. | Upgrade consumers first, then producers. |
| `forward` | Old schema can read new data. | Upgrade producers first, then consumers. |
| `none` | Breaking change. | Coordinated rollout; bump major version; use migrators. |

### Rules

- **Adding an optional field** → `full` compatible.
- **Adding a required field with a default** → `full` compatible (default fills the gap for old payloads).
- **Adding a required field without a default** → `forward` only (breaks backward; old payloads lack the field).
- **Removing an optional field** → `full` compatible.
- **Removing a required field** → `backward` only (breaks forward; old consumers still expect it).
- **Changing a field type** → `none` (breaks both directions).
- **Optional → required (no default)** → breaks backward.
- **Required → optional** → breaks forward.

## Usage

### Register versions

```ts
import { SchemaVersionRegistry } from '../shared/events/schemaVersioning';

const registry = new SchemaVersionRegistry();

registry.registerVersion('subscription.created', 1, {
  id:    { type: 'string', required: true, description: 'Event ID' },
  planId:{ type: 'string', required: true, description: 'Plan ID' },
});

registry.registerVersion('subscription.created', 2, {
  id:       { type: 'string', required: true, description: 'Event ID' },
  planId:   { type: 'string', required: true, description: 'Plan ID' },
  currency: { type: 'string', required: true, description: 'Token symbol', default: 'USDC' },
});
```

### Classify a change

```ts
const diff = registry.diff('subscription.created', 1, 2);
// diff.compatibility === 'full'
// diff.breaking === false
// diff.incompatibilities === []
```

### Enforce a compatibility policy on deploy

```ts
// Refuse to ship a change that isn't backward-compatible.
registry.assertCompatible('subscription.created', 1, 2, 'backward');
```

### Migrate payloads across versions

```ts
// Automatic: fills defaults for newly-required fields, drops removed fields.
const v2Payload = registry.migrate('subscription.created', v1Payload, 1, 2);

// Explicit: register a migrator when a field needs transformation.
registry.registerMigrator('subscription.created', 1, 2, (p) => ({
  ...p,
  currency: p.currency ?? 'EUR',
}));
```

### Validate a payload against a version

```ts
const errors = validateAgainstVersion(
  registry.getVersion('subscription.created', 2)!,
  payload,
);
if (errors.length) throw new Error(`Invalid payload: ${errors.join(', ')}`);
```

## Integration with the existing event catalog

The existing `backend/services/webhook/eventCatalog.ts` already carries a
`version` field on every `EventDefinition` and deprecation/sunset metadata.
`SchemaVersionRegistry` extends that model by supporting **multiple** versions
per event type and computing compatibility between them. The catalog remains
the source of truth for the *current* schema; the registry is the source of
truth for the *history* of versions and the rules governing transitions.

## Testing

`backend/shared/events/__tests__/schemaVersioning.test.ts` covers:

- Compatibility classification for every rule (add optional, add required ±
  default, remove optional/required, type change, optional↔required).
- Default and description change detection.
- Payload validation (missing required, type mismatch, array/object types).
- Registry registration, duplicate rejection, version listing.
- `assertCompatible` enforcement for backward/forward/full.
- Auto-migration (default filling), explicit migrators, multi-step chains.
- Downgrade rejection and same-version no-op.

## Acceptance criteria

- [x] **Versioned** — `SchemaVersionRegistry` stores an arbitrary number of
      versions per event type and exposes `getVersion`/`getLatestVersion`/
      `getVersions`.
- [x] **Compatibility tested** — 20+ test cases classify every change rule
      and exercise migration chains.
- [x] **Documented** — this document, inline module docs, and usage examples.
