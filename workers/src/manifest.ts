/**
 * workers/src/manifest.ts
 *
 * Issue #2261 — typed job manifests with runtime schemas. One declarative
 * manifest is the single source of truth for a worker job: its name, schedule,
 * input/output contracts, handler reference and retry/timeout policy.
 *
 * Design rules:
 *  - Zero dependencies and zero I/O: no imports, no clock reads, no ambient
 *    state. A registry instance is isolated per call to createJobRegistry().
 *  - Schemas are composable, immutable value objects. Validation reports every
 *    issue with a stable JSON-style path (`$.items[0].id`).
 *  - Every rejection is a typed `ManifestError` with a stable `code`.
 *  - Configuration and registrations are frozen; observability hooks are
 *    injected (metrics + logger) and default to no-ops.
 *  - Built-in manifests are declarative only. Job modules are never imported,
 *    so this file stays dependency-free and safe to load from any runtime.
 *
 * Usage:
 *   const registry = createDefaultJobRegistry();
 *   const manifest = registry.get('billing-shift');
 *   const input = validateInput(manifest!, { items: [] });
 */

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Stable, machine-readable failure codes emitted by this module. */
export const ManifestErrorCode = {
  INVALID_CONFIG: 'MANIFEST_INVALID_CONFIG',
  INVALID_MANIFEST: 'MANIFEST_INVALID_MANIFEST',
  DUPLICATE_JOB: 'MANIFEST_DUPLICATE_JOB',
  INVALID_SCHEMA: 'MANIFEST_INVALID_SCHEMA',
  VALIDATION_FAILED: 'MANIFEST_VALIDATION_FAILED',
  UNKNOWN_TYPE: 'MANIFEST_UNKNOWN_TYPE',
  UNKNOWN_JOB: 'MANIFEST_UNKNOWN_JOB',
  INVALID_INPUT: 'MANIFEST_INVALID_INPUT',
} as const;

export type ManifestErrorCode = (typeof ManifestErrorCode)[keyof typeof ManifestErrorCode];

/** Error surface for manifest, schema and registry failures. */
export class ManifestError extends Error {
  readonly code: ManifestErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ManifestErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'ManifestError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ManifestError.prototype);
  }

  /** Invalid registry configuration. */
  static invalidConfig(message: string, details: Readonly<Record<string, unknown>> = {}): ManifestError {
    return new ManifestError(ManifestErrorCode.INVALID_CONFIG, message, details);
  }

  /** Structurally invalid job manifest. */
  static invalidManifest(message: string, details: Readonly<Record<string, unknown>> = {}): ManifestError {
    return new ManifestError(ManifestErrorCode.INVALID_MANIFEST, message, details);
  }

  /** Duplicate job name in a registry. */
  static duplicateJob(name: string): ManifestError {
    return new ManifestError(ManifestErrorCode.DUPLICATE_JOB, `Job already registered: ${name}`, {
      name,
    });
  }

  /** Invalid runtime argument passed to a public helper. */
  static invalidInput(message: string, details: Readonly<Record<string, unknown>> = {}): ManifestError {
    return new ManifestError(ManifestErrorCode.INVALID_INPUT, message, details);
  }

  /** Malformed schema definition supplied by a caller. */
  static invalidSchema(message: string, details: Readonly<Record<string, unknown>> = {}): ManifestError {
    return new ManifestError(ManifestErrorCode.INVALID_SCHEMA, message, details);
  }

  /** Value did not satisfy a schema at runtime. */
  static validationFailed(
    issues: readonly ValidationIssue[],
    label = 'value'
  ): ManifestError {
    const first = issues[0];
    return new ManifestError(
      ManifestErrorCode.VALIDATION_FAILED,
      `Invalid ${label} at ${first.path}: ${first.message}`,
      { label, path: first.path, issues }
    );
  }
}

// ---------------------------------------------------------------------------
// Schema primitives
// ---------------------------------------------------------------------------

/** The closed set of schema node kinds supported by the validator. */
export const SchemaType = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  OBJECT: 'object',
  ARRAY: 'array',
  DATE: 'date',
} as const;

export type SchemaType = (typeof SchemaType)[keyof typeof SchemaType];

/** Options accepted by the {@link SchemaNode} constructor. */
export interface SchemaNodeOptions {
  readonly type: SchemaType;
  readonly isOptional?: boolean;
  readonly description?: string;
  readonly shape?: Readonly<Record<string, SchemaNode>>;
  readonly item?: SchemaNode;
}

/**
 * Immutable, composable schema node. Use the factory functions ({@link str},
 * {@link num}, {@link bool}, {@link obj}, {@link arr}, {@link date}) instead of
 * constructing this class directly.
 */
export class SchemaNode<T = unknown> {
  readonly type: SchemaType;
  readonly isOptional: boolean;
  readonly description: string | undefined;
  readonly shape: Readonly<Record<string, SchemaNode>> | undefined;
  readonly item: SchemaNode | undefined;

  constructor(options: SchemaNodeOptions) {
    this.type = options.type;
    this.isOptional = options.isOptional ?? false;
    this.description = options.description;
    this.shape = options.shape;
    this.item = options.item;
    Object.freeze(this);
  }

  /** Allow the value to be absent (`undefined`) without failing validation. */
  optional(): SchemaNode<T | undefined> {
    return new SchemaNode<T | undefined>({
      type: this.type,
      isOptional: true,
      description: this.description,
      shape: this.shape,
      item: this.item,
    });
  }

  /** Attach documentation to the schema; used in issue messages and JSDoc. */
  describe(description: string): SchemaNode<T> {
    return new SchemaNode<T>({
      type: this.type,
      isOptional: this.isOptional,
      description,
      shape: this.shape,
      item: this.item,
    });
  }
}

/** Alias used in public signatures: any schema node, typed by its value type. */
export type Schema<T = unknown> = SchemaNode<T>;

/** Extract the value type carried by a schema node. */
export type Infer<S> = S extends SchemaNode<infer V> ? V : never;

/** Map an object schema's shape to its inferred value type. */
export type InferShape<S extends Readonly<Record<string, SchemaNode>>> = {
  readonly [K in keyof S]: Infer<S[K]>;
};

/** Create a string schema. */
export function str(): SchemaNode<string> {
  return new SchemaNode<string>({ type: SchemaType.STRING });
}

/** Create a finite-number schema (`NaN` and infinities are rejected). */
export function num(): SchemaNode<number> {
  return new SchemaNode<number>({ type: SchemaType.NUMBER });
}

/** Create a boolean schema. */
export function bool(): SchemaNode<boolean> {
  return new SchemaNode<boolean>({ type: SchemaType.BOOLEAN });
}

/**
 * Create a date schema. Accepts ISO-8601 strings and `Date` instances and
 * normalizes both to a `Date`. Invalid dates are rejected.
 */
export function date(): SchemaNode<Date> {
  return new SchemaNode<Date>({ type: SchemaType.DATE });
}

/**
 * Create an object schema from a named shape. Unknown keys are ignored
 * (open-object semantics); optional child keys may be omitted entirely.
 */
export function obj<S extends Readonly<Record<string, SchemaNode>>>(
  shape: S
): SchemaNode<InferShape<S>> {
  if (shape === null || typeof shape !== 'object' || Array.isArray(shape)) {
    throw ManifestError.invalidSchema('obj() requires a shape object');
  }
  for (const key of Object.keys(shape)) {
    if (key.trim() === '') {
      throw ManifestError.invalidSchema('obj() shape keys must be non-empty', { key });
    }
    if (!isSchema(shape[key])) {
      throw ManifestError.invalidSchema('obj() shape values must be schema nodes', { key });
    }
  }
  return new SchemaNode<InferShape<S>>({
    type: SchemaType.OBJECT,
    shape: Object.freeze({ ...shape }),
  });
}

/** Create an array schema whose elements must satisfy `item`. */
export function arr<T>(item: SchemaNode<T>): SchemaNode<readonly T[]> {
  if (!isSchema(item)) {
    throw ManifestError.invalidSchema('arr() requires a schema node for its items');
  }
  return new SchemaNode<readonly T[]>({ type: SchemaType.ARRAY, item });
}

/** Type guard for schema nodes. */
export function isSchema(value: unknown): value is SchemaNode {
  return value instanceof SchemaNode;
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/** Machine-readable kind of a single validation issue. */
export type ValidationIssueCode = 'REQUIRED' | 'TYPE_MISMATCH' | 'INVALID_DATE' | 'INVALID_SCHEMA';

/** One validation failure, located by a stable path. */
export interface ValidationIssue {
  readonly path: string;
  readonly code: ValidationIssueCode;
  readonly expected: string;
  readonly actual: string;
  readonly message: string;
}

/** Result of {@link validateSchema}: either a typed value or all issues found. */
export type ValidationResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** Human-readable type name used in issue details. */
function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  return typeof value;
}

/** Append a property key or array index to a validation path. */
function joinPath(path: string, segment: string | number): string {
  return typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${segment}`;
}

/** Issue factory that keeps messages consistent across schema kinds. */
function issue(
  path: string,
  code: ValidationIssueCode,
  expected: string,
  value: unknown,
  message: string
): ValidationIssue {
  return Object.freeze({ path, code, expected, actual: describeValue(value), message });
}

/**
 * Validate `value` against `schema` without throwing for value mismatches.
 *
 * All issues are collected (nested object fields and array indices included)
 * so callers can report a complete error surface. Programmer errors — a
 * malformed schema or an unsupported schema type — throw `ManifestError` with
 * `INVALID_SCHEMA` / `UNKNOWN_TYPE`.
 */
export function validateSchema<T>(schema: SchemaNode<T>, value: unknown, path = '$'): ValidationResult<T> {
  if (!isSchema(schema)) {
    throw ManifestError.invalidSchema('schema must be a SchemaNode', { path });
  }
  if (schema.isOptional && value === undefined) {
    return { ok: true, value: undefined as T };
  }

  switch (schema.type) {
    case SchemaType.STRING:
      if (typeof value === 'string') return { ok: true, value: value as T };
      return {
        ok: false,
        issues: [issue(path, 'TYPE_MISMATCH', 'string', value, 'Expected a string')],
      };

    case SchemaType.NUMBER:
      if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value: value as T };
      return {
        ok: false,
        issues: [issue(path, 'TYPE_MISMATCH', 'finite number', value, 'Expected a finite number')],
      };

    case SchemaType.BOOLEAN:
      if (typeof value === 'boolean') return { ok: true, value: value as T };
      return {
        ok: false,
        issues: [issue(path, 'TYPE_MISMATCH', 'boolean', value, 'Expected a boolean')],
      };

    case SchemaType.DATE: {
      if (value instanceof Date) {
        if (Number.isFinite(value.getTime())) return { ok: true, value: value as T };
        return {
          ok: false,
          issues: [issue(path, 'INVALID_DATE', 'valid Date', value, 'Invalid Date instance')],
        };
      }
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return { ok: true, value: new Date(parsed) as T };
      }
      return {
        ok: false,
        issues: [
          issue(path, 'INVALID_DATE', 'ISO-8601 string or Date', value, 'Expected a valid date'),
        ],
      };
    }

    case SchemaType.OBJECT: {
      if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Date) {
        return {
          ok: false,
          issues: [issue(path, 'TYPE_MISMATCH', 'object', value, 'Expected an object')],
        };
      }
      const record = value as Record<string, unknown>;
      const shape = schema.shape ?? {};
      const issues: ValidationIssue[] = [];
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        const child = shape[key];
        const childPath = joinPath(path, key);
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
          if (child.isOptional) continue;
          issues.push(
            issue(childPath, 'REQUIRED', child.type, undefined, `Missing required field '${key}'`)
          );
          continue;
        }
        const result = validateSchema(child, record[key], childPath);
        if (result.ok) output[key] = result.value;
        else issues.push(...result.issues);
      }
      return issues.length === 0 ? { ok: true, value: output as T } : { ok: false, issues };
    }

    case SchemaType.ARRAY: {
      if (!Array.isArray(value)) {
        return {
          ok: false,
          issues: [issue(path, 'TYPE_MISMATCH', 'array', value, 'Expected an array')],
        };
      }
      const item = schema.item;
      if (!isSchema(item)) {
        throw ManifestError.invalidSchema('array schema is missing its item schema', { path });
      }
      const issues: ValidationIssue[] = [];
      const output: unknown[] = [];
      value.forEach((element, index) => {
        const result = validateSchema(item, element, joinPath(path, index));
        if (result.ok) output.push(result.value);
        else issues.push(...result.issues);
      });
      return issues.length === 0 ? { ok: true, value: output as T } : { ok: false, issues };
    }

    default:
      throw new ManifestError(ManifestErrorCode.UNKNOWN_TYPE, `Unsupported schema type: ${String(schema.type)}`, {
        path,
        type: schema.type,
      });
  }
}

/**
 * Validate a value and throw a typed `VALIDATION_FAILED` error on the first
 * issue. `details.path` and `details.issues` carry the complete diagnostics.
 */
export function assertSchema<T>(schema: SchemaNode<T>, value: unknown, label = 'value'): T {
  const result = validateSchema(schema, value);
  if (result.ok) return result.value;
  throw ManifestError.validationFailed(result.issues, label);
}

// ---------------------------------------------------------------------------
// Job manifests
// ---------------------------------------------------------------------------

/** Declarative description of one worker job. */
export interface JobManifest<I = unknown, O = unknown> {
  /** Unique registry key, e.g. `billing-shift`. */
  readonly name: string;
  /** Human-readable purpose, used by logs and generated documentation. */
  readonly description?: string;
  /** Cron expression or event name; omitted for manually triggered jobs. */
  readonly schedule?: string;
  /** Runtime schema for the handler input. */
  readonly input: SchemaNode<I>;
  /** Optional runtime schema for the handler result. */
  readonly output?: SchemaNode<O>;
  /** Module/function reference as a string; no module is imported here. */
  readonly handler: string;
  /** Number of retries after a failed attempt (0-10). */
  readonly retries?: number;
  /** Per-attempt timeout in milliseconds (1-86_400_000). */
  readonly timeoutMs?: number;
  /** Free-form labels for filtering and dashboards. */
  readonly tags?: readonly string[];
}

/** Identity helper that preserves `I`/`O` inference for declarative manifests. */
export function defineJob<I, O>(manifest: JobManifest<I, O>): JobManifest<I, O> {
  return manifest;
}

/**
 * Narrow a runtime value to a job-manifest-shaped object. Identity fields are
 * checked here; schema fields are validated by {@link validateManifest} so bad
 * schemas surface as `INVALID_SCHEMA` rather than being collapsed into a
 * generic manifest error.
 */
export function isJobManifest(value: unknown): value is JobManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<JobManifest>;
  return typeof candidate.name === 'string' && typeof candidate.handler === 'string';
}

/**
 * Validate a manifest's structure and policy fields, throwing a typed
 * `ManifestError` on the first problem. Returns the same manifest on success.
 */
export function validateManifest<I, O>(manifest: JobManifest<I, O>): JobManifest<I, O> {
  if (!isJobManifest(manifest)) {
    throw ManifestError.invalidManifest('manifest must have a name and handler string', {
      manifest: describeValue(manifest),
    });
  }
  const name = manifest.name;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw ManifestError.invalidManifest('manifest.name must be a non-empty slug', { name });
  }
  if (manifest.handler.trim() === '') {
    throw ManifestError.invalidManifest('manifest.handler must be a non-empty string', { name });
  }
  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    throw ManifestError.invalidManifest('manifest.description must be a string', { name });
  }
  if (manifest.schedule !== undefined &&
      (typeof manifest.schedule !== 'string' || manifest.schedule.trim() === '')) {
    throw ManifestError.invalidManifest('manifest.schedule must be a non-empty string', { name });
  }
  if (!isSchema(manifest.input)) {
    throw ManifestError.invalidSchema('manifest.input must be a schema node', { name });
  }
  if (manifest.output !== undefined && !isSchema(manifest.output)) {
    throw ManifestError.invalidSchema('manifest.output must be a schema node', { name });
  }
  if (manifest.retries !== undefined &&
      (!Number.isInteger(manifest.retries) || manifest.retries < 0 || manifest.retries > 10)) {
    throw ManifestError.invalidManifest('manifest.retries must be an integer 0-10', {
      name,
      retries: manifest.retries,
    });
  }
  if (manifest.timeoutMs !== undefined &&
      (!Number.isInteger(manifest.timeoutMs) || manifest.timeoutMs < 1 || manifest.timeoutMs > 86400000)) {
    throw ManifestError.invalidManifest('manifest.timeoutMs must be an integer 1-86400000', {
      name,
      timeoutMs: manifest.timeoutMs,
    });
  }
  if (manifest.tags !== undefined) {
    if (!Array.isArray(manifest.tags) || manifest.tags.some((t) => typeof t !== 'string' || t.trim() === '')) {
      throw ManifestError.invalidManifest('manifest.tags must be an array of non-empty strings', { name });
    }
  }
  return manifest;
}

/** Validate and type-narrow a manifest's input using its declared schema. */
export function validateInput<I, O>(manifest: JobManifest<I, O>, value: unknown): I {
  validateManifest(manifest);
  return assertSchema(manifest.input, value, `${manifest.name} input`);
}

/** Validate and type-narrow a manifest's output, if it declares one. */
export function validateOutput<I, O>(manifest: JobManifest<I, O>, value: unknown): O | undefined {
  validateManifest(manifest);
  if (!manifest.output) return undefined;
  return assertSchema(manifest.output, value, `${manifest.name} output`);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Immutable registry configuration. */
export interface ManifestRegistryConfig {
  /** When true, a repeated name replaces the prior registration. */
  readonly allowDuplicates: boolean;
  /** Maximum number of distinct jobs in a registry. */
  readonly maxJobs: number;
}

/** Frozen defaults: reject duplicates, cap at 500 jobs. */
export const DEFAULT_MANIFEST_REGISTRY_CONFIG: Readonly<ManifestRegistryConfig> = Object.freeze({
  allowDuplicates: false,
  maxJobs: 500,
});

/** Validate and freeze registry configuration. */
export function validateManifestRegistryConfig(
  config: Partial<ManifestRegistryConfig> = {}
): ManifestRegistryConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw ManifestError.invalidConfig('config must be an object');
  }
  const merged: ManifestRegistryConfig = { ...DEFAULT_MANIFEST_REGISTRY_CONFIG, ...config };
  if (typeof merged.allowDuplicates !== 'boolean') {
    throw ManifestError.invalidConfig('allowDuplicates must be a boolean', {
      allowDuplicates: config.allowDuplicates,
    });
  }
  if (!Number.isInteger(merged.maxJobs) || merged.maxJobs < 1 || merged.maxJobs > 10000) {
    throw ManifestError.invalidConfig('maxJobs must be an integer 1-10000', {
      maxJobs: config.maxJobs,
    });
  }
  return Object.freeze(merged);
}

/** Metrics hooks for registry activity. */
export interface ManifestMetrics {
  recordRegister(name: string): void;
  recordValidation(name: string, ok: boolean): void;
  recordRejected(code: ManifestErrorCode, name?: string): void;
}

/** Logging hooks for registry activity. */
export interface ManifestLogger {
  info(message: string, details?: Readonly<Record<string, unknown>>): void;
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
}

/** No-op metrics implementation. */
export const noopManifestMetrics: Readonly<ManifestMetrics> = Object.freeze({
  recordRegister(): void {},
  recordValidation(): void {},
  recordRejected(): void {},
});

/** No-op logger implementation. */
export const noopManifestLogger: Readonly<ManifestLogger> = Object.freeze({
  info(): void {},
  warn(): void {},
});

/** Result of {@link JobRegistry.validateAll}. */
export interface ValidationReport {
  readonly ok: boolean;
  readonly total: number;
  readonly valid: readonly string[];
  readonly invalid: readonly {
    readonly name: string;
    readonly code: ManifestErrorCode;
    readonly message: string;
  }[];
}

/** Immutable, isolated registry of job manifests. */
export interface JobRegistry {
  readonly config: Readonly<ManifestRegistryConfig>;
  readonly size: number;
  register<I, O>(manifest: JobManifest<I, O>): JobManifest<I, O>;
  registerAll(manifests: readonly JobManifest[]): readonly JobManifest[];
  get(name: string): JobManifest | undefined;
  getOrThrow(name: string): JobManifest;
  has(name: string): boolean;
  list(): readonly JobManifest[];
  validateAll(manifests?: readonly JobManifest[]): ValidationReport;
}

/** Copy a manifest into a deeply-frozen registration (tags array included). */
function freezeManifest<I, O>(manifest: JobManifest<I, O>): JobManifest<I, O> {
  return Object.freeze({
    name: manifest.name,
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    ...(manifest.schedule !== undefined ? { schedule: manifest.schedule } : {}),
    input: manifest.input,
    ...(manifest.output !== undefined ? { output: manifest.output } : {}),
    handler: manifest.handler,
    ...(manifest.retries !== undefined ? { retries: manifest.retries } : {}),
    ...(manifest.timeoutMs !== undefined ? { timeoutMs: manifest.timeoutMs } : {}),
    ...(manifest.tags !== undefined ? { tags: Object.freeze([...manifest.tags]) } : {}),
  }) as JobManifest<I, O>;
}

/**
 * Create an isolated job registry with duplicate-name rejection, frozen
 * registrations and injected observability hooks.
 */
export function createJobRegistry(
  config: Partial<ManifestRegistryConfig> = {},
  metrics: Partial<ManifestMetrics> = {},
  logger: Partial<ManifestLogger> = {}
): JobRegistry {
  const resolvedConfig = validateManifestRegistryConfig(config);
  const resolvedMetrics: ManifestMetrics = { ...noopManifestMetrics, ...metrics };
  const resolvedLogger: ManifestLogger = { ...noopManifestLogger, ...logger };
  const jobs = new Map<string, JobManifest>();

  function reject(code: ManifestErrorCode, message: string, name?: string): never {
    resolvedMetrics.recordRejected(code, name);
    resolvedLogger.warn(message, { code, name });
    throw new ManifestError(code, message, { name });
  }

  function register<I, O>(manifest: JobManifest<I, O>): JobManifest<I, O> {
    const validated = validateManifest(manifest);
    const name = validated.name;
    if (jobs.has(name) && !resolvedConfig.allowDuplicates) {
      return reject(ManifestErrorCode.DUPLICATE_JOB, `Job already registered: ${name}`, name);
    }
    if (!jobs.has(name) && jobs.size >= resolvedConfig.maxJobs) {
      return reject(ManifestErrorCode.INVALID_CONFIG, `Registry is full (maxJobs=${resolvedConfig.maxJobs})`, name);
    }
    const frozen = freezeManifest(validated);
    jobs.set(name, frozen);
    resolvedMetrics.recordRegister(name);
    resolvedLogger.info('Registered worker job manifest', { name, handler: frozen.handler });
    return frozen;
  }

  function registerAll(manifests: readonly JobManifest[]): readonly JobManifest[] {
    if (!Array.isArray(manifests)) {
      throw ManifestError.invalidInput('registerAll expects an array of manifests');
    }
    return Object.freeze(manifests.map((manifest) => register(manifest)));
  }

  function get(name: string): JobManifest | undefined {
    return jobs.get(name);
  }

  function getOrThrow(name: string): JobManifest {
    const found = jobs.get(name);
    if (!found) {
      return reject(ManifestErrorCode.UNKNOWN_JOB, `Unknown job: ${name}`, name);
    }
    return found;
  }

  function has(name: string): boolean {
    return jobs.has(name);
  }

  function list(): readonly JobManifest[] {
    return Object.freeze(Array.from(jobs.values()));
  }

  function validateAll(manifests: readonly JobManifest[] = list()): ValidationReport {
    if (!Array.isArray(manifests)) {
      throw ManifestError.invalidInput('validateAll expects an array of manifests');
    }
    const valid: string[] = [];
    const invalid: { name: string; code: ManifestErrorCode; message: string }[] = [];
    for (const manifest of manifests) {
      const name = isJobManifest(manifest) ? manifest.name : '<unknown>';
      try {
        validateManifest(manifest);
        valid.push(name);
        resolvedMetrics.recordValidation(name, true);
      } catch (error) {
        const failure = error instanceof ManifestError
          ? error
          : new ManifestError(ManifestErrorCode.INVALID_MANIFEST, String(error), { name });
        invalid.push(Object.freeze({ name, code: failure.code, message: failure.message }));
        resolvedMetrics.recordValidation(name, false);
        resolvedMetrics.recordRejected(failure.code, name);
        resolvedLogger.warn('Manifest validation failed', { name, code: failure.code });
      }
    }
    return Object.freeze({
      ok: invalid.length === 0,
      total: manifests.length,
      valid: Object.freeze(valid),
      invalid: Object.freeze(invalid),
    });
  }

  return Object.freeze({
    config: resolvedConfig,
    get size(): number {
      return jobs.size;
    },
    register,
    registerAll,
    get,
    getOrThrow,
    has,
    list,
    validateAll,
  });
}

// ---------------------------------------------------------------------------
// Declarative built-in manifests (no job module imports)
// ---------------------------------------------------------------------------

/** Manifest for `workers/src/jobs/billingShift.ts` (issue #2252). */
export const BILLING_SHIFT_MANIFEST = defineJob({
  name: 'billing-shift',
  description: 'Consolidate due charges onto the configured billing weekday and emit sorted batches.',
  schedule: '0 3 * * 1',
  input: obj({
    items: arr(obj({
      id: str().describe('Subscription identifier'),
      dueDate: str().describe('ISO-8601 due date'),
      amountMinor: num().optional(),
      currency: str().optional(),
    })),
  }),
  output: obj({
    batches: arr(obj({
      key: str(),
      scheduledFor: str(),
      status: str(),
    })),
    rejected: num(),
  }),
  handler: 'workers/src/jobs/billingShift.ts#createBillingShiftJob',
  retries: 3,
  timeoutMs: 60000,
  tags: Object.freeze(['billing', 'cron']),
});

/** Manifest for the audit sink in `workers/src/handlers/index.ts`. */
export const AUDIT_FLUSH_MANIFEST = defineJob({
  name: 'audit-flush',
  description: 'Drain buffered lifecycle audit lines recorded by the default worker handlers.',
  schedule: '*/15 * * * *',
  input: obj({
    since: date().optional(),
    limit: num().optional(),
  }),
  output: obj({ flushed: num() }),
  handler: 'workers/src/handlers/index.ts#audit',
  retries: 2,
  timeoutMs: 30000,
  tags: Object.freeze(['audit', 'cron']),
});

/** All built-in manifests, frozen for safe reuse across registries. */
export const BUILTIN_JOB_MANIFESTS: readonly JobManifest[] = Object.freeze([
  BILLING_SHIFT_MANIFEST,
  AUDIT_FLUSH_MANIFEST,
]);

/** Create a registry preloaded with every built-in manifest. */
export function createDefaultJobRegistry(
  config: Partial<ManifestRegistryConfig> = {},
  metrics: Partial<ManifestMetrics> = {},
  logger: Partial<ManifestLogger> = {}
): JobRegistry {
  const registry = createJobRegistry(config, metrics, logger);
  registry.registerAll(BUILTIN_JOB_MANIFESTS);
  return registry;
}
