import {
  SchemaVersionRegistry,
  diffSchemas,
  validateAgainstVersion,
  type SchemaField,
  type VersionedSchema,
} from '../schemaVersioning';

function field(type: SchemaField['type'], required: boolean, opts: Partial<SchemaField> = {}): SchemaField {
  return { type, required, description: opts.description ?? 'test', ...opts };
}

function schema(type: string, version: number, fields: Record<string, SchemaField>): VersionedSchema {
  return { type, version, fields };
}

describe('schemaVersioning', () => {
  describe('diffSchemas', () => {
    it('reports full compatibility when only optional fields are added', () => {
      const v1 = schema('subscription.created', 1, { id: field('string', true) });
      const v2 = schema('subscription.created', 2, {
        id: field('string', true),
        note: field('string', false),
      });
      const diff = diffSchemas('subscription.created', v1, v2);
      expect(diff.compatibility).toBe('full');
      expect(diff.breaking).toBe(false);
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].change).toBe('added');
    });

    it('flags added-required-without-default as backward-incompatible', () => {
      const v1 = schema('evt', 1, { id: field('string', true) });
      const v2 = schema('evt', 2, { id: field('string', true), owner: field('string', true) });
      const diff = diffSchemas('evt', v1, v2);
      expect(diff.backwardCompatible).toBe(false);
      expect(diff.forwardCompatible).toBe(true);
      expect(diff.compatibility).toBe('forward');
      expect(diff.incompatibilities.length).toBeGreaterThan(0);
    });

    it('treats added-required-with-default as backward compatible', () => {
      const v1 = schema('evt', 1, { id: field('string', true) });
      const v2 = schema('evt', 2, {
        id: field('string', true),
        owner: field('string', true, { default: 'unknown' }),
      });
      const diff = diffSchemas('evt', v1, v2);
      expect(diff.backwardCompatible).toBe(true);
      expect(diff.compatibility).toBe('full');
    });

    it('flags removed-required as forward-incompatible', () => {
      const v1 = schema('evt', 1, { id: field('string', true), reason: field('string', true) });
      const v2 = schema('evt', 2, { id: field('string', true) });
      const diff = diffSchemas('evt', v1, v2);
      expect(diff.forwardCompatible).toBe(false);
      expect(diff.backwardCompatible).toBe(true);
      expect(diff.compatibility).toBe('backward');
    });

    it('flags type change as breaking in both directions', () => {
      const v1 = schema('evt', 1, { amount: field('number', true) });
      const v2 = schema('evt', 2, { amount: field('string', true) });
      const diff = diffSchemas('evt', v1, v2);
      expect(diff.compatibility).toBe('none');
      expect(diff.breaking).toBe(true);
    });

    it('flags optional→required without default as backward-incompatible', () => {
      const v1 = schema('evt', 1, { id: field('string', true), note: field('string', false) });
      const v2 = schema('evt', 2, { id: field('string', true), note: field('string', true) });
      const diff = diffSchemas('evt', v1, v2);
      expect(diff.backwardCompatible).toBe(false);
    });

    it('treats required→optional as forward-incompatible', () => {
      const v1 = schema('evt', 1, { id: field('string', true), reason: field('string', true) });
      const v2 = schema('evt', 2, { id: field('string', true), reason: field('string', false) });
      const diff = diffSchemas('evt', v1, v2);
      expect(diff.forwardCompatible).toBe(false);
    });

    it('detects default and description changes', () => {
      const v1 = schema('evt', 1, { id: field('string', true, { default: 'a', description: 'one' }) });
      const v2 = schema('evt', 2, { id: field('string', true, { default: 'b', description: 'two' }) });
      const diff = diffSchemas('evt', v1, v2);
      const changeTypes = diff.changes.map(c => c.change);
      expect(changeTypes).toContain('default-changed');
      expect(changeTypes).toContain('description-changed');
      expect(diff.compatibility).toBe('full');
    });

    it('reports no changes for identical schemas', () => {
      const v1 = schema('evt', 1, { id: field('string', true) });
      const v2 = schema('evt', 2, { id: field('string', true) });
      const diff = diffSchemas('evt', v1, v2);
      expect(diff.changes).toHaveLength(0);
      expect(diff.compatibility).toBe('full');
    });
  });

  describe('validateAgainstVersion', () => {
    it('reports missing required fields', () => {
      const s = schema('evt', 1, { id: field('string', true), amount: field('number', true) });
      const errors = validateAgainstVersion(s, { id: 'x' });
      expect(errors).toContain('Missing required field: amount');
    });

    it('reports type mismatches', () => {
      const s = schema('evt', 1, { amount: field('number', true) });
      const errors = validateAgainstVersion(s, { amount: 'not-a-number' });
      expect(errors.some(e => e.includes('expected type "number"'))).toBe(true);
    });

    it('passes for a valid payload', () => {
      const s = schema('evt', 1, { id: field('string', true), amount: field('number', true), note: field('string', false) });
      expect(validateAgainstVersion(s, { id: 'x', amount: 5 })).toEqual([]);
    });

    it('validates array and object types', () => {
      const s = schema('evt', 1, { tags: field('array', true), meta: field('object', true) });
      expect(validateAgainstVersion(s, { tags: [1], meta: { a: 1 } })).toEqual([]);
      expect(validateAgainstVersion(s, { tags: 'x', meta: [1] }).length).toBeGreaterThan(0);
    });
  });

  describe('SchemaVersionRegistry', () => {
    function registry(): SchemaVersionRegistry {
      const r = new SchemaVersionRegistry();
      r.registerVersion('sub.created', 1, { id: field('string', true), planId: field('string', true) });
      r.registerVersion('sub.created', 2, {
        id: field('string', true),
        planId: field('string', true),
        currency: field('string', true, { default: 'USDC' }),
      });
      r.registerVersion('sub.created', 3, {
        id: field('string', true),
        planId: field('string', true),
        currency: field('string', true, { default: 'USDC' }),
        metadata: field('object', false),
      });
      return r;
    }

    it('stores and retrieves versions', () => {
      const r = registry();
      expect(r.getVersion('sub.created', 1)?.version).toBe(1);
      expect(r.getLatestVersion('sub.created')?.version).toBe(3);
      expect(r.getVersions('sub.created')).toEqual([1, 2, 3]);
    });

    it('rejects re-registering an existing version', () => {
      const r = new SchemaVersionRegistry();
      r.registerVersion('evt', 1, { id: field('string', true) });
      expect(() => r.registerVersion('evt', 1, { id: field('string', true) })).toThrow();
    });

    it('diffs registered versions', () => {
      const r = registry();
      const d = r.diff('sub.created', 1, 3);
      expect(d.fromVersion).toBe(1);
      expect(d.toVersion).toBe(3);
      expect(d.changes.some(c => c.field === 'metadata')).toBe(true);
    });

    it('assertCompatible throws on a breaking requirement', () => {
      const r = new SchemaVersionRegistry();
      r.registerVersion('evt', 1, { id: field('string', true) });
      r.registerVersion('evt', 2, { id: field('string', true), owner: field('string', true) });
      expect(() => r.assertCompatible('evt', 1, 2, 'backward')).toThrow();
      expect(() => r.assertCompatible('evt', 1, 2, 'forward')).not.toThrow();
    });

    it('auto-migrates by filling defaults for newly-required fields', () => {
      const r = registry();
      const migrated = r.migrate('sub.created', { id: 'e1', planId: 'p1' }, 1, 3);
      expect(migrated.id).toBe('e1');
      expect(migrated.planId).toBe('p1');
      expect(migrated.currency).toBe('USDC'); // default filled
      expect(migrated.metadata).toBeUndefined(); // optional, absent
    });

    it('applies an explicit migrator when registered', () => {
      const r = registry();
      r.registerMigrator('sub.created', 1, 2, (p) => ({
        ...p,
        currency: (p.currency as string) ?? 'EUR',
      }));
      const migrated = r.migrate('sub.created', { id: 'e1', planId: 'p1' }, 1, 2);
      expect(migrated.currency).toBe('EUR');
    });

    it('chains migrators across multiple versions', () => {
      const r = registry();
      r.registerMigrator('sub.created', 1, 2, (p) => ({ ...p, currency: 'EUR' }));
      r.registerMigrator('sub.created', 2, 3, (p) => ({ ...p, metadata: { migrated: true } }));
      const migrated = r.migrate('sub.created', { id: 'e1', planId: 'p1' }, 1, 3);
      expect(migrated.currency).toBe('EUR');
      expect(migrated.metadata).toEqual({ migrated: true });
    });

    it('rejects downgrade migration', () => {
      const r = registry();
      expect(() => r.migrate('sub.created', { id: 'x', planId: 'p' }, 3, 1)).toThrow();
    });

    it('rejects invalid migrator direction', () => {
      const r = registry();
      expect(() => r.registerMigrator('sub.created', 2, 1, (p) => p)).toThrow();
    });

    it('returns the payload unchanged for same-version migrate', () => {
      const r = registry();
      const out = r.migrate('sub.created', { id: 'x', planId: 'p' }, 2, 2);
      expect(out).toEqual({ id: 'x', planId: 'p' });
    });

    it('validateAgainstVersion catches migrated-payload issues', () => {
      const r = registry();
      // v2 requires currency; an explicit migrator that forgets to set it
      // leaves the field absent and validation should flag it.
      r.registerMigrator('sub.created', 1, 2, (p) => ({ ...p })); // forgets currency
      const migrated = r.migrate('sub.created', { id: 'x', planId: 'p' }, 1, 2);
      const v2 = r.getVersion('sub.created', 2)!;
      const errors = validateAgainstVersion(v2, migrated);
      expect(errors.some(e => e.includes('currency'))).toBe(true);
    });
  });
});
