/**
 * Event schema versioning (issue #1805).
 *
 * Event consumers break when producers change payload shapes. This module
 * provides a versioned schema registry with explicit compatibility rules so
 * that schema changes can be reviewed, classified, and — where compatible —
 * accompanied by automatic payload migrations.
 *
 * Capabilities:
 *   - Register multiple versions of an event schema
 *   - Compute a structured diff between two versions
 *   - Classify a change as backward / forward / full / none compatible
 *   - Register migrators that transform payloads across versions
 *   - Validate a payload against a specific schema version
 *
 * Compatibility definitions (modeled on the Confluent schema registry):
 *
 *   backward  — consumers using the NEW schema can read data produced with
 *               the OLD schema (safe to upgrade consumers first).
 *   forward   — consumers using the OLD schema can read data produced with
 *               the NEW schema (safe to upgrade producers first).
 *   full      — both backward and forward compatible.
 *   none      — a breaking change that requires coordinated rollout.
 */

/** Primitive field types supported by the schema system. */
export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/** Description of a single field within a versioned schema. */
export interface SchemaField {
  type: FieldType;
  required: boolean;
  description: string;
  /** Default applied when migrating an older payload that lacks this field. */
  default?: unknown;
  /** Marks the field as deprecated (still emitted, slated for removal). */
  deprecated?: boolean;
}

/** A fully versioned schema for one event type. */
export interface VersionedSchema {
  type: string;
  version: number;
  fields: Record<string, SchemaField>;
}

/** The kind of compatibility a given change offers. */
export type CompatibilityLevel = 'backward' | 'forward' | 'full' | 'none';

/** A single field-level change between two schema versions. */
export interface FieldChange {
  field: string;
  change:
    | 'added'
    | 'removed'
    | 'type-changed'
    | 'required-added'
    | 'required-removed'
    | 'default-added'
    | 'default-changed'
    | 'description-changed';
  from?: SchemaField;
  to?: SchemaField;
}

/** Structured diff between two versions of a schema. */
export interface SchemaDiff {
  type: string;
  fromVersion: number;
  toVersion: number;
  changes: FieldChange[];
  backwardCompatible: boolean;
  forwardCompatible: boolean;
  compatibility: CompatibilityLevel;
  breaking: boolean;
  /** Human-readable explanation of each incompatibility. */
  incompatibilities: string[];
}

/** Function that transforms a payload from `fromVersion` to `toVersion`. */
export type Migrator = (payload: Record<string, unknown>) => Record<string, unknown>;

/**
 * Computes the structured diff and compatibility classification between two
 * schema versions.
 */
export function diffSchemas(
  type: string,
  from: VersionedSchema,
  to: VersionedSchema,
): SchemaDiff {
  const changes: FieldChange[] = [];
  const incompatibilities: string[] = [];

  const fromFields = from.fields;
  const toFields = to.fields;

  // Fields present in `to` only → added.
  for (const [name, toField] of Object.entries(toFields)) {
    if (!(name in fromFields)) {
      changes.push({ field: name, change: 'added', to: toField });
      // Backward: new consumer expects this field from old data. Breaking if
      // required AND no default is available to fill the gap.
      if (toField.required && toField.default === undefined) {
        incompatibilities.push(
          `Field "${name}" added as required without a default — old payloads (v${from.version}) will not contain it`,
        );
      }
    }
  }

  // Fields present in `from` only → removed.
  for (const [name, fromField] of Object.entries(fromFields)) {
    if (!(name in toFields)) {
      changes.push({ field: name, change: 'removed', from: fromField });
      // Forward: old consumer expects this field from new data. Breaking if
      // the old consumer required it.
      if (fromField.required) {
        incompatibilities.push(
          `Required field "${name}" removed — old consumers (v${from.version}) still expect it in new payloads`,
        );
      }
    }
  }

  // Fields present in both → check for type/required/default/description changes.
  for (const [name, fromField] of Object.entries(fromFields)) {
    const toField = toFields[name];
    if (!toField) continue;

    if (fromField.type !== toField.type) {
      changes.push({ field: name, change: 'type-changed', from: fromField, to: toField });
      incompatibilities.push(
        `Field "${name}" type changed from "${fromField.type}" to "${toField.type}"`,
      );
      continue;
    }

    if (!fromField.required && toField.required) {
      changes.push({ field: name, change: 'required-added', from: fromField, to: toField });
      // Backward: new consumer requires a field old data may omit.
      if (toField.default === undefined) {
        incompatibilities.push(
          `Field "${name}" became required without a default — old payloads may omit it`,
        );
      }
    } else if (fromField.required && !toField.required) {
      changes.push({ field: name, change: 'required-removed', from: fromField, to: toField });
      // Forward: old consumer still requires it; new producer may omit.
      incompatibilities.push(
        `Field "${name}" became optional — old consumers (v${from.version}) still require it`,
      );
    }

    if (fromField.default === undefined && toField.default !== undefined) {
      changes.push({ field: name, change: 'default-added', from: fromField, to: toField });
    } else if (
      fromField.default !== undefined &&
      toField.default !== undefined &&
      fromField.default !== toField.default
    ) {
      changes.push({ field: name, change: 'default-changed', from: fromField, to: toField });
    }

    if (fromField.description !== toField.description) {
      changes.push({ field: name, change: 'description-changed', from: fromField, to: toField });
    }
  }

  // Classify. A change is backward-compatible if the new schema can read old
  // data, and forward-compatible if the old schema can read new data.
  // Type changes break both directions; required-added (no default) breaks
  // backward; removed-required and required-removed break forward.
  const hasTypeChange = changes.some(c => c.change === 'type-changed');
  const breaksBackward = hasTypeChange ||
    changes.some(c => c.change === 'added' && c.to?.required && c.to?.default === undefined) ||
    changes.some(c => c.change === 'required-added' && c.to?.default === undefined);
  const breaksForward = hasTypeChange ||
    changes.some(c => c.change === 'removed' && c.from?.required) ||
    changes.some(c => c.change === 'required-removed');

  const backward = !breaksBackward;
  const forward = !breaksForward;
  const compatibility: CompatibilityLevel = backward && forward
    ? 'full'
    : backward
      ? 'backward'
      : forward
        ? 'forward'
        : 'none';

  return {
    type,
    fromVersion: from.version,
    toVersion: to.version,
    changes,
    backwardCompatible: backward,
    forwardCompatible: forward,
    compatibility,
    breaking: compatibility === 'none',
    incompatibilities,
  };
}

/**
 * Validates a payload against a specific schema version.
 * Returns the list of validation errors (empty when valid).
 */
export function validateAgainstVersion(
  schema: VersionedSchema,
  payload: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [name, spec] of Object.entries(schema.fields)) {
    const value = payload[name];
    if (spec.required && (value === undefined || value === null)) {
      errors.push(`Missing required field: ${name}`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (!checkFieldType(value, spec.type)) {
      errors.push(`Field "${name}" expected type "${spec.type}", got "${typeof value}"`);
    }
  }
  return errors;
}

function checkFieldType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean': return typeof value === 'boolean';
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    default: return false;
  }
}

/**
 * Versioned schema registry. Stores every published version of each event
 * type, computes compatibility between versions, and applies registered
 * migrators to translate payloads across versions.
 */
export class SchemaVersionRegistry {
  /** eventType → version → schema */
  private schemas = new Map<string, Map<number, VersionedSchema>>();
  /** `${eventType}:${fromVersion}->${toVersion}` → migrator */
  private migrators = new Map<string, Migrator>();

  /** Register a schema version. Re-registering an existing version throws. */
  registerVersion(type: string, version: number, fields: Record<string, SchemaField>): VersionedSchema {
    const versions = this.schemas.get(type) ?? new Map<number, VersionedSchema>();
    if (versions.has(version)) {
      throw new Error(`Schema ${type} v${version} is already registered`);
    }
    const schema: VersionedSchema = { type, version, fields };
    versions.set(version, schema);
    this.schemas.set(type, versions);
    return schema;
  }

  getVersion(type: string, version: number): VersionedSchema | undefined {
    return this.schemas.get(type)?.get(version);
  }

  getLatestVersion(type: string): VersionedSchema | undefined {
    const versions = this.schemas.get(type);
    if (!versions || versions.size === 0) return undefined;
    let latest = -1;
    for (const v of versions.keys()) if (v > latest) latest = v;
    return versions.get(latest);
  }

  getVersions(type: string): number[] {
    const versions = this.schemas.get(type);
    if (!versions) return [];
    return Array.from(versions.keys()).sort((a, b) => a - b);
  }

  /** Register a migrator translating payloads from `fromVersion` to `toVersion`. */
  registerMigrator(type: string, fromVersion: number, toVersion: number, migrator: Migrator): void {
    if (fromVersion >= toVersion) {
      throw new Error(`Migrator must upgrade: fromVersion (${fromVersion}) must be < toVersion (${toVersion})`);
    }
    this.migrators.set(`${type}:${fromVersion}->${toVersion}`, migrator);
  }

  /** Compute the diff between two registered versions. */
  diff(type: string, fromVersion: number, toVersion: number): SchemaDiff {
    const from = this.getVersion(type, fromVersion);
    const to = this.getVersion(type, toVersion);
    if (!from) throw new Error(`Schema ${type} v${fromVersion} is not registered`);
    if (!to) throw new Error(`Schema ${type} v${toVersion} is not registered`);
    return diffSchemas(type, from, to);
  }

  /**
   * Verify that upgrading from `fromVersion` to `toVersion` satisfies the
   * required compatibility level. Throws with the incompatibility reasons when
   * the requirement is not met.
   */
  assertCompatible(
    type: string,
    fromVersion: number,
    toVersion: number,
    required: CompatibilityLevel,
  ): void {
    const d = this.diff(type, fromVersion, toVersion);
    const ok =
      required === 'none' ? true :
      required === 'backward' ? d.backwardCompatible :
      required === 'forward' ? d.forwardCompatible :
      d.backwardCompatible && d.forwardCompatible;
    if (!ok) {
      throw new Error(
        `Schema ${type} v${fromVersion}→v${toVersion} is not ${required}-compatible: ` +
        d.incompatibilities.join('; '),
      );
    }
  }

  /**
   * Migrate a payload from `fromVersion` up to `toVersion` by applying the
   * registered migrators for each step. When no explicit migrator exists for a
   * step, an automatic compatibility migration is applied: fields newly added
   * as required (with a default) are filled, and removed/deprecated fields are
   * dropped.
   */
  migrate(
    type: string,
    payload: Record<string, unknown>,
    fromVersion: number,
    toVersion: number,
  ): Record<string, unknown> {
    if (fromVersion === toVersion) return { ...payload };
    if (fromVersion > toVersion) {
      throw new Error(`Downgrade migration is not supported (v${fromVersion}→v${toVersion})`);
    }
    let current = { ...payload };
    let v = fromVersion;
    while (v < toVersion) {
      const next = v + 1;
      const explicit = this.migrators.get(`${type}:${v}->${next}`);
      if (explicit) {
        current = explicit(current);
      } else {
        current = this.autoMigrate(type, current, v, next);
      }
      v = next;
    }
    return current;
  }

  /** Apply defaults for newly-required fields and drop removed fields. */
  private autoMigrate(
    type: string,
    payload: Record<string, unknown>,
    fromVersion: number,
    toVersion: number,
  ): Record<string, unknown> {
    const from = this.getVersion(type, fromVersion);
    const to = this.getVersion(type, toVersion);
    if (!from || !to) {
      throw new Error(`Missing schema ${type} v${fromVersion} or v${toVersion}`);
    }
    const out: Record<string, unknown> = {};
    for (const [name, toField] of Object.entries(to.fields)) {
      if (name in payload) {
        out[name] = payload[name];
      } else if (toField.default !== undefined) {
        out[name] = toField.default;
      } else if (!toField.required) {
        // optional field absent in old payload — leave unset
      }
    }
    return out;
  }
}
