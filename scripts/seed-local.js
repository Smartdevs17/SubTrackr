#!/usr/bin/env node
/**
 * seed-local.js
 *
 * Issue #1175 — Implement local development environment with Docker
 *
 * Seeds the local PostgreSQL database with development fixtures:
 *   - A demo merchant account
 *   - Three subscription plans (Basic, Pro, Enterprise)
 *   - Two demo subscriber accounts
 *   - Sample active subscriptions
 *   - Sample webhooks
 *
 * Designed to run inside the `seed` Docker Compose service:
 *   docker compose run --rm seed
 *
 * Can also be run directly against a local Postgres instance:
 *   DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=postgres \
 *     DB_NAME=subtrackr node scripts/seed-local.js
 *
 * The script is idempotent — it uses INSERT … ON CONFLICT DO NOTHING so it
 * is safe to re-run without duplicating data.
 */

'use strict';

const { Client } = require('pg');

// ── Connection config from environment ──────────────────────────────────────

const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'subtrackr',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

// ── Retry helper ─────────────────────────────────────────────────────────────

/**
 * Retries an async function up to `maxAttempts` times with exponential backoff.
 */
async function withRetry(fn, label = 'operation', maxAttempts = 10, baseDelayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const delay = baseDelayMs * Math.pow(1.5, attempt - 1);
      console.log(
        `[seed] ${label} — attempt ${attempt}/${maxAttempts} failed: ${err.message}. ` +
          `Retrying in ${Math.round(delay)}ms…`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ── Schema bootstrap ─────────────────────────────────────────────────────────

/**
 * Creates the minimal tables required for seeding if they do not already exist.
 * In production the real migrations in db/migrations/ manage the schema — this
 * is a lightweight bootstrap for local dev environments that skip Prisma.
 */
async function bootstrapSchema(client) {
  console.log('[seed] Bootstrapping dev schema (CREATE TABLE IF NOT EXISTS)…');

  await client.query(`
    CREATE TABLE IF NOT EXISTS merchants (
      id          SERIAL PRIMARY KEY,
      address     TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      email       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id               SERIAL PRIMARY KEY,
      merchant_address TEXT NOT NULL,
      name             TEXT NOT NULL,
      price            NUMERIC(20, 7) NOT NULL,
      token            TEXT NOT NULL DEFAULT 'XLM',
      interval         TEXT NOT NULL CHECK (interval IN ('Weekly','Monthly','Quarterly','Yearly')),
      active           BOOLEAN NOT NULL DEFAULT TRUE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id         SERIAL PRIMARY KEY,
      address    TEXT NOT NULL UNIQUE,
      email      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id               SERIAL PRIMARY KEY,
      plan_id          INTEGER NOT NULL REFERENCES plans(id),
      subscriber_address TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','paused','cancelled','past_due')),
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_charged_at  TIMESTAMPTZ,
      next_charge_at   TIMESTAMPTZ,
      total_paid       NUMERIC(20, 7) NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id         TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      events     TEXT[] NOT NULL DEFAULT '{}',
      active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log('[seed] Schema bootstrap complete.');
}

// ── Seed data ────────────────────────────────────────────────────────────────

const MERCHANTS = [
  {
    address: 'GDEMO1MERCHANTSTELLARADDRESS0000000000000000000000000000',
    name:    'SubTrackr Demo Merchant',
    email:   'merchant@subtrackr.local',
  },
];

const PLANS = [
  {
    merchant_address: 'GDEMO1MERCHANTSTELLARADDRESS0000000000000000000000000000',
    name:      'Basic',
    price:     9.99,
    token:     'USDC',
    interval:  'Monthly',
    active:    true,
  },
  {
    merchant_address: 'GDEMO1MERCHANTSTELLARADDRESS0000000000000000000000000000',
    name:      'Pro',
    price:     29.99,
    token:     'USDC',
    interval:  'Monthly',
    active:    true,
  },
  {
    merchant_address: 'GDEMO1MERCHANTSTELLARADDRESS0000000000000000000000000000',
    name:      'Enterprise',
    price:     99.99,
    token:     'USDC',
    interval:  'Yearly',
    active:    true,
  },
];

const SUBSCRIBERS = [
  {
    address: 'GSUB1DEMOSTELLARADDRESS00000000000000000000000000000000',
    email:   'alice@subtrackr.local',
  },
  {
    address: 'GSUB2DEMOSTELLARADDRESS00000000000000000000000000000000',
    email:   'bob@subtrackr.local',
  },
];

const WEBHOOKS = [
  {
    id:     'wh_demo_001',
    url:    'http://localhost:4000/webhooks/subtrackr',
    events: ['subscription.created', 'subscription.cancelled', 'payment.succeeded'],
  },
  {
    id:     'wh_demo_002',
    url:    'http://localhost:4000/webhooks/billing',
    events: ['invoice.generated', 'payment.failed'],
  },
];

// ── Seed functions ────────────────────────────────────────────────────────────

async function seedMerchants(client) {
  console.log('[seed] Seeding merchants…');
  for (const m of MERCHANTS) {
    await client.query(
      `INSERT INTO merchants (address, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (address) DO NOTHING`,
      [m.address, m.name, m.email]
    );
  }
  console.log(`[seed] ${MERCHANTS.length} merchant(s) seeded.`);
}

async function seedPlans(client) {
  console.log('[seed] Seeding plans…');
  const planIds = {};
  for (const p of PLANS) {
    const result = await client.query(
      `INSERT INTO plans (merchant_address, name, price, token, interval, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id, name`,
      [p.merchant_address, p.name, p.price, p.token, p.interval, p.active]
    );
    if (result.rows.length > 0) {
      planIds[p.name] = result.rows[0].id;
    }
  }
  console.log(`[seed] ${PLANS.length} plan(s) seeded.`);
  return planIds;
}

async function seedSubscribers(client) {
  console.log('[seed] Seeding subscribers…');
  for (const s of SUBSCRIBERS) {
    await client.query(
      `INSERT INTO subscribers (address, email)
       VALUES ($1, $2)
       ON CONFLICT (address) DO NOTHING`,
      [s.address, s.email]
    );
  }
  console.log(`[seed] ${SUBSCRIBERS.length} subscriber(s) seeded.`);
}

async function seedSubscriptions(client, planIds) {
  console.log('[seed] Seeding subscriptions…');

  const now = new Date();
  const nextMonth = new Date(now);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  const fixtures = [
    {
      plan_name:          'Basic',
      subscriber_address: SUBSCRIBERS[0].address,
      status:             'active',
      last_charged_at:    now,
      next_charge_at:     nextMonth,
      total_paid:         9.99,
    },
    {
      plan_name:          'Pro',
      subscriber_address: SUBSCRIBERS[1].address,
      status:             'active',
      last_charged_at:    now,
      next_charge_at:     nextMonth,
      total_paid:         29.99,
    },
    {
      plan_name:          'Enterprise',
      subscriber_address: SUBSCRIBERS[0].address,
      status:             'paused',
      last_charged_at:    now,
      next_charge_at:     null,
      total_paid:         99.99,
    },
  ];

  let inserted = 0;
  for (const fx of fixtures) {
    const planId = planIds[fx.plan_name];
    if (!planId) {
      console.warn(`[seed] Skipping subscription — plan "${fx.plan_name}" not found in DB.`);
      continue;
    }
    await client.query(
      `INSERT INTO subscriptions
         (plan_id, subscriber_address, status, last_charged_at, next_charge_at, total_paid)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        planId,
        fx.subscriber_address,
        fx.status,
        fx.last_charged_at,
        fx.next_charge_at,
        fx.total_paid,
      ]
    );
    inserted++;
  }
  console.log(`[seed] ${inserted} subscription(s) seeded.`);
}

async function seedWebhooks(client) {
  console.log('[seed] Seeding webhooks…');
  for (const wh of WEBHOOKS) {
    await client.query(
      `INSERT INTO webhooks (id, url, events)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [wh.id, wh.url, wh.events]
    );
  }
  console.log(`[seed] ${WEBHOOKS.length} webhook(s) seeded.`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log('===========================================');
  console.log(' SubTrackr Local Database Seeder');
  console.log('===========================================');
  console.log(`[seed] Connecting to ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}…`);

  const client = new Client(DB_CONFIG);

  // Retry connection — Postgres may still be initialising when this container starts
  await withRetry(
    () => client.connect(),
    'PostgreSQL connect',
    12,
    2000
  );

  console.log('[seed] Connected to PostgreSQL.');

  try {
    await client.query('BEGIN');

    await bootstrapSchema(client);
    await seedMerchants(client);
    const planIds = await seedPlans(client);
    await seedSubscribers(client);
    await seedSubscriptions(client, planIds);
    await seedWebhooks(client);

    await client.query('COMMIT');

    console.log('');
    console.log('✅ Seeding complete!');
    console.log('');
    console.log('Demo credentials:');
    console.log('  Merchant : GDEMO1MERCHANTSTELLARADDRESS0000000000000000000000000000');
    console.log('  Alice    : GSUB1DEMOSTELLARADDRESS00000000000000000000000000000000');
    console.log('  Bob      : GSUB2DEMOSTELLARADDRESS00000000000000000000000000000000');
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[seed] ❌ Seeding failed — transaction rolled back: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[seed] Fatal error: ${err.message}`);
  process.exit(1);
});
