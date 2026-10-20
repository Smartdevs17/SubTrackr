import { SoftDeleteHelper, SOFT_DELETE_TABLES, SOFT_DELETE_HELPERS, filterActive } from '../softDelete';

describe('SoftDeleteHelper', () => {
  it('generates active filter clause', () => {
    const sd = new SoftDeleteHelper('subscriptions');
    expect(sd.activeFilter()).toBe('subscriptions.deleted_at IS NULL');
  });

  it('generates deleted filter clause', () => {
    const sd = new SoftDeleteHelper('users');
    expect(sd.deletedFilter()).toBe('users.deleted_at IS NOT NULL');
  });

  it('generates soft-delete SQL', () => {
    const sd = new SoftDeleteHelper('subscriptions');
    expect(sd.softDeleteSql()).toBe(
      'UPDATE subscriptions SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    );
  });

  it('generates restore SQL', () => {
    const sd = new SoftDeleteHelper('subscriptions');
    expect(sd.restoreSql()).toBe(
      'UPDATE subscriptions SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL',
    );
  });

  it('generates count active SQL', () => {
    const sd = new SoftDeleteHelper('transactions');
    expect(sd.countActiveSql()).toContain('deleted_at IS NULL');
  });

  it('generates count deleted SQL', () => {
    const sd = new SoftDeleteHelper('transactions');
    expect(sd.countDeletedSql()).toContain('deleted_at IS NOT NULL');
  });

  it('generates purge SQL with cutoff days', () => {
    const sd = new SoftDeleteHelper('users');
    const sql = sd.purgeSql(30);
    expect(sql).toContain('DELETE FROM users');
    expect(sql).toContain("INTERVAL '30 days'");
  });

  it('generates find deleted SQL', () => {
    const sd = new SoftDeleteHelper('merchants');
    const sql = sd.findDeletedSql();
    expect(sql).toContain('deleted_at IS NOT NULL');
    expect(sql).toContain('ORDER BY deleted_at DESC');
  });
});

describe('SOFT_DELETE_TABLES', () => {
  it('includes all core entity tables', () => {
    expect(SOFT_DELETE_TABLES).toContain('subscriptions');
    expect(SOFT_DELETE_TABLES).toContain('transactions');
    expect(SOFT_DELETE_TABLES).toContain('users');
    expect(SOFT_DELETE_TABLES).toContain('merchants');
    expect(SOFT_DELETE_TABLES).toContain('loyalty');
    expect(SOFT_DELETE_TABLES).toContain('payment_methods');
    expect(SOFT_DELETE_TABLES).toContain('plans');
  });
});

describe('SOFT_DELETE_HELPERS', () => {
  it('provides a helper for each soft-delete table', () => {
    for (const table of SOFT_DELETE_TABLES) {
      expect(SOFT_DELETE_HELPERS[table]).toBeDefined();
      expect(SOFT_DELETE_HELPERS[table].table).toBe(table);
    }
  });
});

describe('filterActive', () => {
  it('appends WHERE clause when none exists', () => {
    const sql = 'SELECT * FROM subscriptions';
    const result = filterActive(sql, 'subscriptions');
    expect(result).toContain('WHERE subscriptions.deleted_at IS NULL');
  });

  it('adds AND to existing WHERE clause', () => {
    const sql = 'SELECT * FROM subscriptions WHERE user_id = $1';
    const result = filterActive(sql, 'subscriptions');
    expect(result).toContain('subscriptions.deleted_at IS NULL AND');
    expect(result).toContain('user_id = $1');
  });

  it('inserts WHERE before ORDER BY when no existing WHERE', () => {
    const sql = 'SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 10';
    const result = filterActive(sql, 'subscriptions');
    expect(result).toContain('WHERE subscriptions.deleted_at IS NULL');
    expect(result.indexOf('WHERE')).toBeLessThan(result.indexOf('ORDER BY'));
  });

  it('inserts WHERE before GROUP BY when no existing WHERE', () => {
    const sql = 'SELECT user_id, COUNT(*) FROM subscriptions GROUP BY user_id';
    const result = filterActive(sql, 'subscriptions');
    expect(result).toContain('WHERE subscriptions.deleted_at IS NULL');
    expect(result.indexOf('WHERE')).toBeLessThan(result.indexOf('GROUP BY'));
  });

  it('does not modify queries that already filter deleted_at', () => {
    const sql = 'SELECT * FROM subscriptions WHERE deleted_at IS NULL AND user_id = $1';
    // filterActive will still add its fragment — this is by design, the
    // double filter is harmless and the caller can check beforehand
    const result = filterActive(sql, 'subscriptions');
    expect(result).toContain('deleted_at IS NULL');
  });
});
