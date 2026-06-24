import { isReadQuery, normalizeSql } from '../queryClassifier';

describe('queryClassifier', () => {
  describe('normalizeSql', () => {
    it('strips leading line comments', () => {
      expect(normalizeSql('-- comment\nSELECT 1')).toBe('SELECT 1');
    });

    it('strips leading block comments', () => {
      expect(normalizeSql('/* block */ SELECT 1')).toBe('SELECT 1');
    });

    it('returns empty string for comment-only input', () => {
      expect(normalizeSql('-- only comment')).toBe('');
    });
  });

  describe('isReadQuery', () => {
    it('classifies SELECT as read', () => {
      expect(isReadQuery('SELECT * FROM subscriptions')).toBe(true);
      expect(isReadQuery('  select id from plans')).toBe(true);
    });

    it('classifies WITH (CTE) as read', () => {
      expect(isReadQuery('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true);
    });

    it('classifies data-modifying WITH (CTE) as write', () => {
      expect(
        isReadQuery(
          'WITH inserted AS (INSERT INTO plans (id, name) VALUES ($1, $2) RETURNING *) SELECT * FROM inserted',
        ),
      ).toBe(false);
      expect(isReadQuery('WITH updated AS (UPDATE plans SET name = $1 RETURNING *) SELECT * FROM updated')).toBe(
        false,
      );
      expect(isReadQuery('WITH deleted AS (DELETE FROM plans WHERE id = $1 RETURNING *) SELECT * FROM deleted')).toBe(
        false,
      );
    });

    it('classifies INSERT/UPDATE/DELETE as write', () => {
      expect(isReadQuery('INSERT INTO plans VALUES (1)')).toBe(false);
      expect(isReadQuery('UPDATE plans SET name = $1')).toBe(false);
      expect(isReadQuery('DELETE FROM plans WHERE id = $1')).toBe(false);
    });

    it('classifies DDL and REFRESH as write', () => {
      expect(isReadQuery('CREATE TABLE foo (id int)')).toBe(false);
      expect(isReadQuery('REFRESH MATERIALIZED VIEW CONCURRENTLY churn_summary_mv')).toBe(false);
    });

    it('treats SELECT FOR UPDATE as write', () => {
      expect(isReadQuery('SELECT * FROM plans WHERE id = $1 FOR UPDATE')).toBe(false);
    });

    it('treats empty SQL as write (safe default)', () => {
      expect(isReadQuery('')).toBe(false);
      expect(isReadQuery('   ')).toBe(false);
    });

    it('handles commented SELECT as read', () => {
      expect(isReadQuery('-- analytics\nSELECT COUNT(*) FROM transactions')).toBe(true);
    });
  });
});
