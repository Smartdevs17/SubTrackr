/**
 * Classifies SQL statements for read/write routing.
 *
 * SELECT and WITH (CTE) queries route to read replicas.
 * INSERT, UPDATE, DELETE, and DDL route to the primary.
 */

const WRITE_PREFIXES = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'REFRESH',
  'GRANT',
  'REVOKE',
  'COPY',
  'VACUUM',
  'ANALYZE',
  'REINDEX',
  'CLUSTER',
  'COMMENT',
  'LOCK',
  'CALL',
  'DO',
  'SET',
];

/** Strip leading SQL comments and whitespace. */
export function normalizeSql(sql: string): string {
  let text = sql.trim();
  while (text.startsWith('/*') || text.startsWith('--')) {
    if (text.startsWith('--')) {
      const newline = text.indexOf('\n');
      text = newline === -1 ? '' : text.slice(newline + 1).trim();
      continue;
    }
    const end = text.indexOf('*/');
    text = end === -1 ? '' : text.slice(end + 2).trim();
  }
  return text;
}

const DATA_MODIFYING_KEYWORDS = /\b(INSERT|UPDATE|DELETE)\b/i;

/** True when the statement should be routed to a read replica. */
export function isReadQuery(sql: string): boolean {
  const normalized = normalizeSql(sql).toUpperCase();

  if (!normalized) return false;

  if (normalized.startsWith('WITH')) {
    // Data-modifying CTEs (WITH … INSERT/UPDATE/DELETE) must hit primary
    if (DATA_MODIFYING_KEYWORDS.test(normalized)) {
      return false;
    }
  }

  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) {
    // SELECT … FOR UPDATE / FOR SHARE must hit primary
    if (/\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i.test(sql)) {
      return false;
    }
    return true;
  }

  for (const prefix of WRITE_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return false;
    }
  }

  // Unknown statements default to primary (safe)
  return false;
}
