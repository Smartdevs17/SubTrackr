#!/usr/bin/env node
/**
 * scripts/db-partition-manage.js (issue #1802)
 *
 * Manages monthly partitions for the audit_events table. Can:
 *   - List existing partitions
 *   - Create partitions for upcoming months
 *   - Detach old partitions (for archiving)
 *
 * Usage:
 *   node scripts/db-partition-manage.js list
 *   node scripts/db-partition-manage.js create --months 6
 *   node scripts/db-partition-manage.js detach --before 2026-06
 *
 * Environment:
 *   DATABASE_URL — required.
 */

'use strict';

const { spawnSync } = require('child_process');

function psql(databaseUrl, sql) {
  const result = spawnSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-tAq', databaseUrl, '-c', sql],
    {
      encoding: 'utf8',
    }
  );
  if (result.error) return { ok: false, output: result.error.message };
  return { ok: result.status === 0, output: result.stdout || result.stderr };
}

function psqlAvailable() {
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

function listPartitions(databaseUrl) {
  const sql = `SELECT
    c.relname AS partition_name,
    pg_get_expr(c.relpartbound, c.oid) AS bound
  FROM pg_class c
  JOIN pg_inherits i ON i.inhrelid = c.oid
  JOIN pg_class p ON p.oid = i.inhparent
  WHERE p.relname = 'audit_events'
  ORDER BY c.relname;`;

  const result = psql(databaseUrl, sql);
  if (!result.ok) {
    console.error('[partition] Failed to list partitions:', result.output);
    return 1;
  }

  const lines = result.output.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    console.log('[partition] No partitions found for audit_events.');
    return 0;
  }

  console.log('[partition] Partitions for audit_events:');
  for (const line of lines) {
    const [name, bound] = line.split('|');
    console.log(`  ${name.padEnd(30)} ${bound}`);
  }
  return 0;
}

function createPartitions(databaseUrl, monthsAhead) {
  const now = new Date();
  let created = 0;

  for (let i = 0; i < monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;

    const result = psql(databaseUrl, `SELECT create_audit_events_partition(${year}, ${month});`);
    if (!result.ok) {
      console.error(
        `[partition] Failed to create partition for ${year}-${month}: ${result.output}`
      );
      continue;
    }
    console.log(`[partition] ${result.output.trim()}`);
    created++;
  }

  console.log(`[partition] ${created} partition(s) processed.`);
  return 0;
}

function detachPartitions(databaseUrl, beforeDate) {
  const sql = `SELECT c.relname
  FROM pg_class c
  JOIN pg_inherits i ON i.inhrelid = c.oid
  JOIN pg_class p ON p.oid = i.inhparent
  WHERE p.relname = 'audit_events'
    AND c.relname ~ '^audit_events_[0-9]{4}_[0-9]{2}$'
    AND c.relname < 'audit_events_${beforeDate.replace('-', '_')}'
  ORDER BY c.relname;`;

  const result = psql(databaseUrl, sql);
  if (!result.ok) {
    console.error('[partition] Failed to find partitions to detach:', result.output);
    return 1;
  }

  const names = result.output.trim().split('\n').filter(Boolean);
  if (names.length === 0) {
    console.log('[partition] No partitions to detach before', beforeDate);
    return 0;
  }

  for (const name of names) {
    const detachResult = psql(databaseUrl, `ALTER TABLE audit_events DETACH PARTITION ${name};`);
    if (!detachResult.ok) {
      console.error(`[partition] Failed to detach ${name}: ${detachResult.output}`);
      continue;
    }
    console.log(`[partition] Detached ${name}`);
  }

  console.log(`[partition] Detached ${names.length} partition(s) before ${beforeDate}.`);
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log('Usage: node scripts/db-partition-manage.js list');
    console.log('       node scripts/db-partition-manage.js create --months <n>');
    console.log('       node scripts/db-partition-manage.js detach --before <YYYY-MM>');
    process.exit(command ? 0 : 2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[partition] DATABASE_URL is not set.');
    process.exit(2);
  }

  if (!psqlAvailable()) {
    console.error('[partition] psql was not found on PATH.');
    process.exit(2);
  }

  if (command === 'list') return listPartitions(databaseUrl);
  if (command === 'create') {
    const monthsIdx = args.indexOf('--months');
    const months = monthsIdx !== -1 ? parseInt(args[monthsIdx + 1], 10) || 6 : 6;
    return createPartitions(databaseUrl, months);
  }
  if (command === 'detach') {
    const beforeIdx = args.indexOf('--before');
    const before = beforeIdx !== -1 ? args[beforeIdx + 1] : '';
    if (!before) {
      console.error('[partition] --before YYYY-MM is required for detach');
      return 2;
    }
    return detachPartitions(databaseUrl, before);
  }

  console.error(`[partition] Unknown command "${command}". Use list, create, or detach.`);
  return 2;
}

process.exit(main());
