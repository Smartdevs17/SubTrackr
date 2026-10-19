#!/usr/bin/env node
/**
 * scripts/db-index-audit.js
 *
 * Issue #1798 — Add an index audit for hot queries.
 *
 * Static analysis tool that scans backend source files for SQL query patterns
 * (WHERE clauses, ORDER BY, JOINs), extracts the table + column combinations,
 * and checks them against the indexes declared in db/migrations/*.sql and
 * backend/migrations/*.sql.
 *
 * Reports:
 *   - Hot query patterns that have no matching index (gap)
 *   - Existing indexes that may be redundant or overlapping
 *   - A summary of all discovered query patterns and their index coverage
 *
 * Makes NO database connection — purely static analysis. Safe to run in CI.
 *
 * Usage:
 *   node scripts/db-index-audit.js [--json] [--src-dir <path>] [--migrations-dir <path>]
 *
 * Exit codes: 0 = pass (no gaps), 1 = gaps found, 2 = usage error
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CLI args ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {
    json: false,
    srcDirs: [
      path.join(__dirname, '../backend/services'),
      path.join(__dirname, '../backend/graphql'),
      path.join(__dirname, '../backend/notification'),
    ],
    migrationDirs: [
      path.join(__dirname, '../db/migrations'),
      path.join(__dirname, '../backend/migrations'),
    ],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--src-dir') {
      options.srcDirs.push(path.resolve(argv[i + 1] || '.'));
      i += 1;
    } else if (arg === '--migrations-dir') {
      options.migrationDirs.push(path.resolve(argv[i + 1] || '.'));
      i += 1;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

// ─── Index extraction from migration files ──────────────────────────────────

/** Parse a CREATE INDEX statement into a structured index definition. */
function parseCreateIndex(sql) {
  // Match: CREATE [UNIQUE] INDEX [CONCURRENTLY] IF NOT EXISTS name ON table (cols) [WHERE ...]
  const match =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)(?:\s+WHERE\s+(.+?))?;/i.exec(
      sql
    );
  if (!match) return null;
  return {
    name: match[1],
    table: match[2],
    columns: match[3].split(',').map((c) => c.trim().replace(/[""]/g, '')),
    partial: match[4] ? match[4].trim() : null,
  };
}

/** Parse a CREATE INDEX without IF NOT EXISTS (some migrations use plain CREATE INDEX). */
function parseCreateIndexAlt(sql) {
  const match =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)(?:\s+WHERE\s+(.+?))?;/i.exec(
      sql
    );
  if (!match) return null;
  return {
    name: match[1],
    table: match[2],
    columns: match[3].split(',').map((c) => c.trim().replace(/[""]/g, '')),
    partial: match[4] ? match[4].trim() : null,
  };
}

/** Load all index definitions from migration SQL files. */
function loadIndexes(migrationDirs) {
  const indexes = [];
  for (const dir of migrationDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      // Remove -- @down sections (only analyse forward migrations)
      const upSection = sql.split(/^\s*--\s*@?down\b/im)[0] || sql;
      let match;
      const regex = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]+;/gi;
      while ((match = regex.exec(upSection)) !== null) {
        const idx = parseCreateIndex(match[0]) || parseCreateIndexAlt(match[0]);
        if (idx) indexes.push({ ...idx, source: file });
      }
    }
  }
  return indexes;
}

// ─── Query pattern extraction from source files ─────────────────────────────

/** Recursively find .ts files in a directory. */
function findTsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') {
      results.push(...findTsFiles(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.js')
    ) {
      results.push(full);
    }
  }
  return results;
}

/** Extract query patterns from source file content. */
function extractQueryPatterns(content, filePath) {
  const patterns = [];

  // Match FROM <table> WHERE <column> = $N patterns
  const fromWhereRegex = /FROM\s+(\w+)\s+.*?WHERE\s+(\w+)\s*[=<>!]/gi;
  let match;
  while ((match = fromWhereRegex.exec(content)) !== null) {
    patterns.push({
      table: match[1],
      columns: [match[2]],
      type: 'WHERE',
      file: path.basename(filePath),
    });
  }

  // Match WHERE <table>.<column> = $N patterns (joined queries)
  const joinedWhereRegex = /WHERE\s+(\w+)\.(\w+)\s*[=<>!]/gi;
  while ((match = joinedWhereRegex.exec(content)) !== null) {
    patterns.push({
      table: match[1],
      columns: [match[2]],
      type: 'WHERE',
      file: path.basename(filePath),
    });
  }

  // Match ORDER BY <column> [DESC] patterns
  const orderByRegex = /ORDER\s+BY\s+(\w+)\s*(DESC|ASC)?/gi;
  while ((match = orderByRegex.exec(content)) !== null) {
    // Only capture if near a FROM clause
    const beforeMatch = content.substring(Math.max(0, match.index - 500), match.index);
    const fromMatch = /FROM\s+(\w+)/i.exec(beforeMatch);
    if (fromMatch) {
      patterns.push({
        table: fromMatch[1],
        columns: [match[1]],
        type: 'ORDER_BY',
        file: path.basename(filePath),
      });
    }
  }

  // Match WHERE <column> = $N AND <column> = $N (composite)
  const compositeRegex = /FROM\s+(\w+)\s+.*?WHERE\s+(\w+)\s*=\s*\$\d+\s+AND\s+(\w+)\s*=\s*\$\d+/gi;
  while ((match = compositeRegex.exec(content)) !== null) {
    patterns.push({
      table: match[1],
      columns: [match[2], match[3]],
      type: 'WHERE_COMPOSITE',
      file: path.basename(filePath),
    });
  }

  return patterns;
}

// ─── Gap analysis ───────────────────────────────────────────────────────────

/** Check if a query pattern is covered by an existing index. */
function isCoveredByIndex(pattern, indexes) {
  // Primary key lookups (id = $N) are always covered by the PK index
  if (pattern.columns.length === 1 && pattern.columns[0] === 'id') {
    return true;
  }

  const tableIndexes = indexes.filter((idx) => idx.table === pattern.table);
  if (tableIndexes.length === 0) return false;

  for (const idx of tableIndexes) {
    if (pattern.columns.length === 1) {
      // Single-column query: covered if any index has this as its first column
      if (idx.columns[0] === pattern.columns[0]) return true;
    } else {
      // Multi-column query: covered if index columns are a prefix match
      if (idx.columns.length >= pattern.columns.length) {
        const matches = pattern.columns.every((col, i) => idx.columns[i] === col);
        if (matches) return true;
      }
    }
  }
  return false;
}

/** Known table aliases used in JOIN queries (single-letter or short aliases). */
const TABLE_ALIASES = {
  s: 'subscriptions',
  t: 'transactions',
  u: 'users',
  m: 'merchants',
  p: 'payment_methods',
  pm: 'payment_methods',
  sub: 'subscriptions',
  txn: 'transactions',
};

/** Resolve a table alias to its real table name. */
function resolveTable(table) {
  return TABLE_ALIASES[table] || table;
}

/** Filter out noise: alias ORDER_BY that captured the alias as a column. */
function isNoise(pattern) {
  // Patterns like "subscriptions (s)" are alias misparse — the "column" is the alias
  if (TABLE_ALIASES[pattern.columns[0]]) return true;
  // Table that is actually an alias (e.g. "s", "t")
  if (pattern.table.length <= 3 && TABLE_ALIASES[pattern.table]) return true;
  return false;
}

/** Deduplicate query patterns. */
function deduplicatePatterns(patterns) {
  const seen = new Set();
  return patterns.filter((p) => {
    const key = `${p.table}:${p.columns.join(',')}:${p.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

function run(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`[index-audit] ${err.message}`);
    return 2;
  }

  if (options.help) {
    console.log(
      'Usage: node scripts/db-index-audit.js [--json] [--src-dir <path>] [--migrations-dir <path>]'
    );
    return 0;
  }

  // Load indexes from migrations
  const indexes = loadIndexes(options.migrationDirs);

  // Extract query patterns from source
  let allPatterns = [];
  for (const srcDir of options.srcDirs) {
    const files = findTsFiles(srcDir);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      allPatterns.push(...extractQueryPatterns(content, file));
    }
  }

  // Resolve aliases and filter noise
  const resolvedPatterns = allPatterns
    .map((p) => ({ ...p, table: resolveTable(p.table) }))
    .filter((p) => !isNoise(p));

  const patterns = deduplicatePatterns(resolvedPatterns);

  // Analyse gaps
  const gaps = patterns.filter((p) => !isCoveredByIndex(p, indexes));
  const covered = patterns.filter((p) => isCoveredByIndex(p, indexes));

  // Build report
  const report = {
    summary: {
      indexesFound: indexes.length,
      queryPatternsFound: patterns.length,
      covered: covered.length,
      gaps: gaps.length,
    },
    indexes: indexes.map((i) => ({
      name: i.name,
      table: i.table,
      columns: i.columns,
      source: i.source,
    })),
    gaps: gaps.map((g) => ({ table: g.table, columns: g.columns, type: g.type, file: g.file })),
    covered: covered.map((c) => ({
      table: c.table,
      columns: c.columns,
      type: c.type,
      file: c.file,
    })),
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   SubTrackr Index Audit Tool              ║');
    console.log('╚══════════════════════════════════════════╝\n');

    console.log(`Indexes found:     ${report.summary.indexesFound}`);
    console.log(`Query patterns:    ${report.summary.queryPatternsFound}`);
    console.log(`Covered:           ${report.summary.covered}`);
    console.log(`Gaps (no index):   ${report.summary.gaps}\n`);

    if (gaps.length > 0) {
      console.log('─── Missing Indexes (gaps) ───');
      for (const gap of gaps) {
        console.log(`  ⚠  ${gap.table} (${gap.columns.join(', ')}) — ${gap.type} [${gap.file}]`);
      }
      console.log();
    }

    if (covered.length > 0) {
      console.log('─── Covered Query Patterns ───');
      for (const c of covered) {
        console.log(`  ✓  ${c.table} (${c.columns.join(', ')}) — ${c.type} [${c.file}]`);
      }
      console.log();
    }
  }

  return gaps.length > 0 ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (err) {
    console.error('[index-audit] Unexpected error:', err && err.message);
    process.exit(3);
  }
}

module.exports = {
  extractQueryPatterns,
  findTsFiles,
  isCoveredByIndex,
  loadIndexes,
  parseCreateIndex,
  parseCreateIndexAlt,
  run,
  deduplicatePatterns,
};
