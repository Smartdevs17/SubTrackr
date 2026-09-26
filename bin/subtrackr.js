#!/usr/bin/env node
/**
 * bin/subtrackr.js
 *
 * Issue #1174 — Build CLI tool for subscription management
 *
 * SubTrackr CLI — manage Stellar-based subscriptions from the command line.
 *
 * Built with zero extra dependencies: uses only Node.js built-ins (http/https,
 * readline, fs, path, process) and mirrors the SubTrackrClient API surface
 * already defined in sdks/javascript/src/client.ts.
 *
 * Usage:
 *   subtrackr <command> [options]
 *
 * Run `subtrackr --help` or `subtrackr <command> --help` for full usage.
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

// ── Version ──────────────────────────────────────────────────────────────────

const CLI_VERSION = '1.0.0';

// ── Config file location ──────────────────────────────────────────────────────
// Credentials are stored in ~/.subtrackr/config.json (never committed to git).

const CONFIG_DIR  = path.join(os.homedir(), '.subtrackr');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ── ANSI colour helpers ───────────────────────────────────────────────────────

const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;

const c = {
  reset:  (s) => NO_COLOR ? s : `\x1b[0m${s}\x1b[0m`,
  bold:   (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
  green:  (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  red:    (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  blue:   (s) => NO_COLOR ? s : `\x1b[34m${s}\x1b[0m`,
};

function ok(msg)   { console.log(`${c.green('✔')} ${msg}`); }
function info(msg) { console.log(`${c.blue('ℹ')} ${msg}`); }
function warn(msg) { console.warn(`${c.yellow('⚠')} ${msg}`); }
function fail(msg) { console.error(`${c.red('✖')} ${msg}`); }

// ── Argument parser ───────────────────────────────────────────────────────────
// Minimal hand-rolled parser; avoids external deps.

function parseArgs(argv) {
  const args   = { _: [], flags: {}, options: {} };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args.options[key] = next;
        i += 2;
      } else {
        args.flags[key] = true;
        i++;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args.options[key] = next;
        i += 2;
      } else {
        args.flags[key] = true;
        i++;
      }
    } else {
      args._.push(a);
      i++;
    }
  }
  return args;
}

// ── Config management ─────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // Restrict permissions to owner-only on Unix
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

// ── HTTP client ───────────────────────────────────────────────────────────────

/**
 * Makes an HTTP/HTTPS request and returns the parsed JSON response.
 *
 * @param {string} baseUrl   - e.g. http://localhost:3000
 * @param {string} endpoint  - e.g. /v1/subscriptions
 * @param {string} method    - GET | POST | PUT | DELETE | PATCH
 * @param {object|null} body - Request body (serialised as JSON)
 * @param {string} apiKey    - Bearer token / API key
 * @returns {Promise<{status: number, body: any}>}
 */
function apiRequest(baseUrl, endpoint, method, body, apiKey) {
  return new Promise((resolve, reject) => {
    const url    = new URL(endpoint, baseUrl);
    const isHttps = url.protocol === 'https:';
    const lib   = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   method.toUpperCase(),
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
        'X-SDK-Version': `subtrackr-cli/${CLI_VERSION}`,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : null; }
        catch (_) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Table printer ─────────────────────────────────────────────────────────────

function printTable(rows, columns) {
  if (!rows || rows.length === 0) {
    info('No records found.');
    return;
  }
  // Compute column widths
  const widths = columns.map((col) =>
    Math.max(col.label.length, ...rows.map((r) => String(r[col.key] ?? '').length))
  );
  const header = columns.map((col, i) => c.bold(col.label.padEnd(widths[i]))).join('  ');
  const divider = widths.map((w) => '─'.repeat(w)).join('──');
  console.log(header);
  console.log(c.dim(divider));
  for (const row of rows) {
    const line = columns.map((col, i) => String(row[col.key] ?? '').padEnd(widths[i])).join('  ');
    console.log(line);
  }
}

// ── Output formatting ─────────────────────────────────────────────────────────

function printOutput(data, format) {
  if (format === 'json') {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    // Human-readable default handled by each command
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────

function statusBadge(status) {
  const s = String(status).toLowerCase();
  if (s === 'active')    return c.green(status);
  if (s === 'paused')    return c.yellow(status);
  if (s === 'cancelled') return c.red(status);
  if (s === 'past_due')  return c.red(status);
  return status;
}

// ── Help text ─────────────────────────────────────────────────────────────────

const GLOBAL_HELP = `
${c.bold('subtrackr')} — Stellar subscription management CLI  ${c.dim(`v${CLI_VERSION}`)}

${c.bold('Usage:')}
  subtrackr <command> [subcommand] [options]

${c.bold('Commands:')}
  ${c.cyan('auth')}          Configure API credentials
    login              Save API key and base URL
    logout             Remove stored credentials
    status             Show current auth configuration

  ${c.cyan('subscriptions')} Manage subscriptions  ${c.dim('(alias: sub)')}
    list               List all subscriptions
    get <id>           Get a subscription by ID
    create             Create a new subscription
    cancel <id>        Cancel a subscription
    pause <id>         Pause a subscription
    resume <id>        Resume a paused subscription
    charge <id>        Manually trigger a charge cycle

  ${c.cyan('plans')}         Manage subscription plans
    list               List available plans
    get <id>           Get a plan by ID
    create             Create a new plan
    deactivate <id>    Deactivate a plan

  ${c.cyan('webhooks')}      Manage webhook endpoints
    list               List registered webhooks
    create             Register a new webhook
    delete <id>        Remove a webhook

${c.bold('Global options:')}
  --api-key <key>      Override stored API key for this invocation
  --base-url <url>     Override stored base URL for this invocation
  --format json        Output raw JSON instead of formatted tables
  --no-color           Disable ANSI colour output
  --version            Print CLI version
  --help, -h           Show this help

${c.bold('Quick start:')}
  subtrackr auth login --api-key sk_test_... --base-url http://localhost:3000
  subtrackr subscriptions list
  subtrackr subscriptions create --plan-id 1 --subscriber GABCD...
  subtrackr subscriptions cancel 42
`;

// ── Resolve runtime config ────────────────────────────────────────────────────

function resolveConfig(args) {
  const stored = loadConfig();
  const apiKey  = args.options['api-key']  || process.env.SUBTRACKR_API_KEY  || stored.apiKey;
  const baseUrl = args.options['base-url'] || process.env.SUBTRACKR_BASE_URL || stored.baseUrl
                  || 'http://localhost:3000';
  return { apiKey, baseUrl };
}

function requireAuth(cfg) {
  if (!cfg.apiKey) {
    fail('No API key configured. Run:  subtrackr auth login --api-key <key>');
    process.exit(1);
  }
}

// ── Commands: auth ────────────────────────────────────────────────────────────

async function cmdAuthLogin(args) {
  const apiKey  = args.options['api-key']  || args.options['k'];
  const baseUrl = args.options['base-url'] || args.options['u'] || 'http://localhost:3000';

  if (!apiKey) {
    fail('--api-key <key> is required.');
    process.exit(1);
  }

  // Verify key by hitting /v1/subscriptions
  info(`Verifying credentials against ${baseUrl}…`);
  try {
    const res = await apiRequest(baseUrl, '/v1/subscriptions', 'GET', null, apiKey);
    if (res.status === 401 || res.status === 403) {
      fail(`Authentication failed (HTTP ${res.status}). Check your API key.`);
      process.exit(1);
    }
  } catch (err) {
    warn(`Could not reach ${baseUrl} — saving credentials anyway. (${err.message})`);
  }

  saveConfig({ apiKey, baseUrl });
  ok(`Credentials saved to ${CONFIG_FILE}`);
  info(`  API key : ${apiKey.slice(0, 8)}${'*'.repeat(Math.max(0, apiKey.length - 8))}`);
  info(`  Base URL: ${baseUrl}`);
}

function cmdAuthLogout() {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
    ok('Credentials removed.');
  } else {
    info('No credentials file found — nothing to remove.');
  }
}

function cmdAuthStatus() {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    warn('Not logged in. Run:  subtrackr auth login --api-key <key>');
  } else {
    ok('Logged in');
    info(`  API key : ${cfg.apiKey.slice(0, 8)}${'*'.repeat(Math.max(0, cfg.apiKey.length - 8))}`);
    info(`  Base URL: ${cfg.baseUrl || 'http://localhost:3000'}`);
    info(`  Config  : ${CONFIG_FILE}`);
  }
}

// ── Commands: subscriptions ───────────────────────────────────────────────────

async function cmdSubList(args, cfg) {
  requireAuth(cfg);
  const format = args.options['format'] || args.options['f'];

  const params = new URLSearchParams();
  if (args.options['status'])   params.set('status',   args.options['status']);
  if (args.options['category']) params.set('category', args.options['category']);
  if (args.options['page'])     params.set('page',     args.options['page']);
  if (args.options['limit'])    params.set('limit',    args.options['limit']);

  const endpoint = `/v1/subscriptions${params.toString() ? '?' + params.toString() : ''}`;
  const res = await apiRequest(cfg.baseUrl, endpoint, 'GET', null, cfg.apiKey);

  if (res.status !== 200) {
    fail(`API error ${res.status}: ${JSON.stringify(res.body)}`);
    process.exit(1);
  }

  const subs = Array.isArray(res.body) ? res.body : (res.body && res.body.data ? res.body.data : []);

  if (format === 'json') {
    printOutput(res.body, 'json');
    return;
  }

  console.log(`\n${c.bold('Subscriptions')}  ${c.dim(`(${subs.length} total)`)}\n`);
  printTable(subs, [
    { key: 'id',     label: 'ID'       },
    { key: 'name',   label: 'Name'     },
    { key: 'status', label: 'Status'   },
    { key: 'price',  label: 'Price'    },
    { key: 'currency', label: 'Token'  },
    { key: 'next_charge_at', label: 'Next Charge' },
  ]);
  console.log('');
}

async function cmdSubGet(args, cfg) {
  requireAuth(cfg);
  const id = args._[0];
  if (!id) { fail('Usage: subtrackr subscriptions get <id>'); process.exit(1); }

  const format = args.options['format'] || args.options['f'];
  const res = await apiRequest(cfg.baseUrl, `/v1/subscriptions/${id}`, 'GET', null, cfg.apiKey);

  if (res.status === 404) { fail(`Subscription ${id} not found.`); process.exit(1); }
  if (res.status !== 200) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  if (format === 'json') { printOutput(res.body, 'json'); return; }

  const s = res.body;
  console.log(`\n${c.bold('Subscription')} ${c.cyan('#' + s.id)}\n`);
  console.log(`  Name          : ${s.name || c.dim('—')}`);
  console.log(`  Status        : ${statusBadge(s.status)}`);
  console.log(`  Plan ID       : ${s.plan_id ?? c.dim('—')}`);
  console.log(`  Subscriber    : ${s.subscriber || c.dim('—')}`);
  console.log(`  Price         : ${s.price != null ? s.price + ' ' + (s.currency || 'XLM') : c.dim('—')}`);
  console.log(`  Started       : ${s.started_at || c.dim('—')}`);
  console.log(`  Last charged  : ${s.last_charged_at || c.dim('—')}`);
  console.log(`  Next charge   : ${s.next_charge_at || c.dim('—')}`);
  console.log(`  Total paid    : ${s.total_paid != null ? s.total_paid : c.dim('—')}`);
  console.log('');
}

async function cmdSubCreate(args, cfg) {
  requireAuth(cfg);

  const planId     = args.options['plan-id'];
  const subscriber = args.options['subscriber'] || args.options['s'];
  const name       = args.options['name'] || args.options['n'];
  const price      = args.options['price'];
  const currency   = args.options['currency'] || args.options['token'] || 'XLM';

  if (!planId) { fail('--plan-id <id> is required.'); process.exit(1); }
  if (!subscriber) { fail('--subscriber <address> is required.'); process.exit(1); }

  const body = {
    plan_id:    parseInt(planId, 10),
    subscriber,
    ...(name     ? { name }            : {}),
    ...(price    ? { price: parseFloat(price) } : {}),
    ...(currency ? { currency }        : {}),
  };

  const res = await apiRequest(cfg.baseUrl, '/v1/subscriptions', 'POST', body, cfg.apiKey);

  if (res.status !== 201 && res.status !== 200) {
    fail(`API error ${res.status}: ${JSON.stringify(res.body)}`);
    process.exit(1);
  }

  const format = args.options['format'] || args.options['f'];
  if (format === 'json') { printOutput(res.body, 'json'); return; }

  const s = res.body;
  ok(`Subscription created — ID: ${c.cyan(String(s.id))}`);
  info(`  Plan     : ${s.plan_id}`);
  info(`  Status   : ${statusBadge(s.status)}`);
  info(`  Subscriber: ${s.subscriber || subscriber}`);
}

async function cmdSubCancel(args, cfg) {
  requireAuth(cfg);
  const id = args._[0];
  if (!id) { fail('Usage: subtrackr subscriptions cancel <id>'); process.exit(1); }

  const atPeriodEnd = !args.flags['now'];
  const reason      = args.options['reason'] || '';

  const res = await apiRequest(
    cfg.baseUrl,
    `/v1/subscriptions/${id}/cancel`,
    'POST',
    { atPeriodEnd, ...(reason ? { reason } : {}) },
    cfg.apiKey
  );

  if (res.status === 404) { fail(`Subscription ${id} not found.`); process.exit(1); }
  if (res.status >= 400) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  ok(`Subscription ${c.cyan(id)} cancelled${atPeriodEnd ? ' at period end' : ' immediately'}.`);
}

async function cmdSubPause(args, cfg) {
  requireAuth(cfg);
  const id = args._[0];
  if (!id) { fail('Usage: subtrackr subscriptions pause <id>'); process.exit(1); }

  const res = await apiRequest(cfg.baseUrl, `/v1/subscriptions/${id}`, 'PUT',
    { status: 'paused' }, cfg.apiKey);

  if (res.status === 404) { fail(`Subscription ${id} not found.`); process.exit(1); }
  if (res.status >= 400) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  ok(`Subscription ${c.cyan(id)} paused.`);
}

async function cmdSubResume(args, cfg) {
  requireAuth(cfg);
  const id = args._[0];
  if (!id) { fail('Usage: subtrackr subscriptions resume <id>'); process.exit(1); }

  const res = await apiRequest(cfg.baseUrl, `/v1/subscriptions/${id}`, 'PUT',
    { status: 'active' }, cfg.apiKey);

  if (res.status === 404) { fail(`Subscription ${id} not found.`); process.exit(1); }
  if (res.status >= 400) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  ok(`Subscription ${c.cyan(id)} resumed.`);
}

async function cmdSubCharge(args, cfg) {
  requireAuth(cfg);
  const id = args._[0];
  if (!id) { fail('Usage: subtrackr subscriptions charge <id>'); process.exit(1); }

  const res = await apiRequest(cfg.baseUrl, `/charge_subscription`, 'POST',
    { subscription_id: parseInt(id, 10) }, cfg.apiKey);

  if (res.status === 404) { fail(`Subscription ${id} not found.`); process.exit(1); }
  if (res.status >= 400) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  ok(`Charge triggered for subscription ${c.cyan(id)}.`);
}

// ── Commands: plans ───────────────────────────────────────────────────────────

async function cmdPlanList(args, cfg) {
  requireAuth(cfg);
  const format = args.options['format'] || args.options['f'];

  const res = await apiRequest(cfg.baseUrl, '/v1/plans', 'GET', null, cfg.apiKey);

  if (res.status !== 200) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  const plans = Array.isArray(res.body) ? res.body : (res.body && res.body.data ? res.body.data : []);

  if (format === 'json') { printOutput(res.body, 'json'); return; }

  console.log(`\n${c.bold('Plans')}  ${c.dim(`(${plans.length} total)`)}\n`);
  printTable(plans, [
    { key: 'id',       label: 'ID'       },
    { key: 'name',     label: 'Name'     },
    { key: 'price',    label: 'Price'    },
    { key: 'token',    label: 'Token'    },
    { key: 'interval', label: 'Interval' },
    { key: 'active',   label: 'Active'   },
  ]);
  console.log('');
}

async function cmdPlanGet(args, cfg) {
  requireAuth(cfg);
  const id = args._[0];
  if (!id) { fail('Usage: subtrackr plans get <id>'); process.exit(1); }

  const format = args.options['format'] || args.options['f'];
  const res = await apiRequest(cfg.baseUrl, `/v1/plans/${id}`, 'GET', null, cfg.apiKey);

  if (res.status === 404) { fail(`Plan ${id} not found.`); process.exit(1); }
  if (res.status !== 200) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  if (format === 'json') { printOutput(res.body, 'json'); return; }

  const p = res.body;
  console.log(`\n${c.bold('Plan')} ${c.cyan('#' + p.id)}\n`);
  console.log(`  Name           : ${p.name}`);
  console.log(`  Price          : ${p.price} ${p.token || 'XLM'}`);
  console.log(`  Interval       : ${p.interval}`);
  console.log(`  Active         : ${p.active ? c.green('Yes') : c.red('No')}`);
  console.log(`  Merchant       : ${p.merchant || c.dim('—')}`);
  console.log(`  Subscribers    : ${p.subscriber_count ?? c.dim('—')}`);
  console.log('');
}

async function cmdPlanCreate(args, cfg) {
  requireAuth(cfg);

  const name     = args.options['name']     || args.options['n'];
  const price    = args.options['price'];
  const token    = args.options['token']    || 'XLM';
  const interval = args.options['interval'] || 'Monthly';
  const merchant = args.options['merchant'] || args.options['m'];

  if (!name)     { fail('--name <name> is required.');             process.exit(1); }
  if (!price)    { fail('--price <amount> is required.');          process.exit(1); }
  if (!merchant) { fail('--merchant <address> is required.');      process.exit(1); }

  const VALID_INTERVALS = ['Weekly', 'Monthly', 'Quarterly', 'Yearly'];
  if (!VALID_INTERVALS.includes(interval)) {
    fail(`--interval must be one of: ${VALID_INTERVALS.join(', ')}`);
    process.exit(1);
  }

  const body = { name, price: parseFloat(price), token, interval, merchant };
  const res = await apiRequest(cfg.baseUrl, '/create_plan', 'POST', body, cfg.apiKey);

  if (res.status >= 400) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  const format = args.options['format'] || args.options['f'];
  if (format === 'json') { printOutput(res.body, 'json'); return; }

  ok(`Plan created — ID: ${c.cyan(String(res.body))}`);
  info(`  Name    : ${name}`);
  info(`  Price   : ${price} ${token}`);
  info(`  Interval: ${interval}`);
}

async function cmdPlanDeactivate(args, cfg) {
  requireAuth(cfg);
  const id = args._[0];
  if (!id) { fail('Usage: subtrackr plans deactivate <id>'); process.exit(1); }

  const merchant = args.options['merchant'] || args.options['m'];
  if (!merchant) { fail('--merchant <address> is required.'); process.exit(1); }

  const res = await apiRequest(cfg.baseUrl, '/deactivate_plan', 'POST',
    { plan_id: parseInt(id, 10), merchant }, cfg.apiKey);

  if (res.status === 404) { fail(`Plan ${id} not found.`); process.exit(1); }
  if (res.status >= 400) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  ok(`Plan ${c.cyan(id)} deactivated.`);
}

// ── Commands: webhooks ────────────────────────────────────────────────────────

async function cmdWebhookList(args, cfg) {
  requireAuth(cfg);
  const format = args.options['format'] || args.options['f'];

  const res = await apiRequest(cfg.baseUrl, '/v1/webhooks', 'GET', null, cfg.apiKey);
  if (res.status !== 200) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  const hooks = Array.isArray(res.body) ? res.body : (res.body && res.body.data ? res.body.data : []);

  if (format === 'json') { printOutput(res.body, 'json'); return; }

  console.log(`\n${c.bold('Webhooks')}  ${c.dim(`(${hooks.length} total)`)}\n`);
  printTable(hooks, [
    { key: 'id',     label: 'ID'     },
    { key: 'url',    label: 'URL'    },
    { key: 'events', label: 'Events' },
  ]);
  console.log('');
}

async function cmdWebhookCreate(args, cfg) {
  requireAuth(cfg);

  const url    = args.options['url']    || args.options['u'];
  const events = args.options['events'] || args.options['e'];

  if (!url)    { fail('--url <url> is required.');       process.exit(1); }
  if (!events) { fail('--events <event,...> is required.'); process.exit(1); }

  const eventList = events.split(',').map((e) => e.trim()).filter(Boolean);

  const res = await apiRequest(cfg.baseUrl, '/v1/webhooks', 'POST',
    { url, events: eventList }, cfg.apiKey);

  if (res.status >= 400) { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  const format = args.options['format'] || args.options['f'];
  if (format === 'json') { printOutput(res.body, 'json'); return; }

  ok(`Webhook registered — ID: ${c.cyan(String(res.body && res.body.id ? res.body.id : '?'))}`);
  info(`  URL   : ${url}`);
  info(`  Events: ${eventList.join(', ')}`);
}

async function cmdWebhookDelete(args, cfg) {
  requireAuth(cfg);
  const id = args._[0];
  if (!id) { fail('Usage: subtrackr webhooks delete <id>'); process.exit(1); }

  const res = await apiRequest(cfg.baseUrl, `/v1/webhooks/${id}`, 'DELETE', null, cfg.apiKey);

  if (res.status === 404) { fail(`Webhook ${id} not found.`); process.exit(1); }
  if (res.status >= 400)  { fail(`API error ${res.status}: ${JSON.stringify(res.body)}`); process.exit(1); }

  ok(`Webhook ${c.cyan(id)} deleted.`);
}

// ── Sub-command dispatcher ────────────────────────────────────────────────────

async function dispatchSubscriptions(subArgs, cfg) {
  const [subCmd, ...rest] = subArgs._;
  const args = { ...subArgs, _: rest };

  switch (subCmd) {
    case 'list':       return cmdSubList(args, cfg);
    case 'get':        return cmdSubGet(args, cfg);
    case 'create':     return cmdSubCreate(args, cfg);
    case 'cancel':     return cmdSubCancel(args, cfg);
    case 'pause':      return cmdSubPause(args, cfg);
    case 'resume':     return cmdSubResume(args, cfg);
    case 'charge':     return cmdSubCharge(args, cfg);
    default:
      console.log(`${c.bold('subtrackr subscriptions')} — manage subscriptions\n`);
      console.log('  list                        List all subscriptions');
      console.log('    --status <status>           Filter by status (active|paused|cancelled)');
      console.log('    --category <cat>            Filter by category');
      console.log('    --page <n>                  Page number (default: 1)');
      console.log('    --limit <n>                 Results per page (default: 20)');
      console.log('');
      console.log('  get <id>                    Get subscription details');
      console.log('');
      console.log('  create                      Create a subscription');
      console.log('    --plan-id <id>  (required)  Plan to subscribe to');
      console.log('    --subscriber <address>      Stellar address of subscriber');
      console.log('    --name <name>               Display name');
      console.log('    --price <amount>            Override price');
      console.log('    --currency <token>          Token symbol (default: XLM)');
      console.log('');
      console.log('  cancel <id>                 Cancel a subscription');
      console.log('    --now                       Cancel immediately (default: at period end)');
      console.log('    --reason <text>             Cancellation reason');
      console.log('');
      console.log('  pause <id>                  Pause a subscription');
      console.log('  resume <id>                 Resume a paused subscription');
      console.log('  charge <id>                 Manually trigger a charge cycle');
      console.log('');
      console.log(`${c.dim('Global: --format json | --api-key <k> | --base-url <u>')}`);
      console.log('');
  }
}

async function dispatchPlans(subArgs, cfg) {
  const [subCmd, ...rest] = subArgs._;
  const args = { ...subArgs, _: rest };

  switch (subCmd) {
    case 'list':       return cmdPlanList(args, cfg);
    case 'get':        return cmdPlanGet(args, cfg);
    case 'create':     return cmdPlanCreate(args, cfg);
    case 'deactivate': return cmdPlanDeactivate(args, cfg);
    default:
      console.log(`${c.bold('subtrackr plans')} — manage subscription plans\n`);
      console.log('  list                        List all plans');
      console.log('  get <id>                    Get plan details');
      console.log('  create                      Create a plan');
      console.log('    --name <name>  (required)');
      console.log('    --price <amount>  (required)');
      console.log('    --merchant <address>  (required)');
      console.log('    --token <symbol>          Token (default: XLM)');
      console.log('    --interval <interval>     Weekly|Monthly|Quarterly|Yearly (default: Monthly)');
      console.log('  deactivate <id>             Deactivate a plan');
      console.log('    --merchant <address>  (required)');
      console.log('');
  }
}

async function dispatchWebhooks(subArgs, cfg) {
  const [subCmd, ...rest] = subArgs._;
  const args = { ...subArgs, _: rest };

  switch (subCmd) {
    case 'list':   return cmdWebhookList(args, cfg);
    case 'create': return cmdWebhookCreate(args, cfg);
    case 'delete': return cmdWebhookDelete(args, cfg);
    default:
      console.log(`${c.bold('subtrackr webhooks')} — manage webhook endpoints\n`);
      console.log('  list                        List registered webhooks');
      console.log('  create                      Register a new webhook');
      console.log('    --url <url>  (required)');
      console.log('    --events <event,...>  (required)  e.g. subscription.created,payment.succeeded');
      console.log('  delete <id>                 Remove a webhook');
      console.log('');
  }
}

async function dispatchAuth(subArgs) {
  const [subCmd, ...rest] = subArgs._;
  const args = { ...subArgs, _: rest };

  switch (subCmd) {
    case 'login':   return cmdAuthLogin(args);
    case 'logout':  return cmdAuthLogout();
    case 'status':  return cmdAuthStatus();
    default:
      console.log(`${c.bold('subtrackr auth')} — configure API credentials\n`);
      console.log('  login   --api-key <key> [--base-url <url>]   Save credentials');
      console.log('  logout                                        Remove saved credentials');
      console.log('  status                                        Show current config');
      console.log('');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  // Global flags
  if (args.flags['version'] || args.flags['v']) {
    console.log(`subtrackr/${CLI_VERSION} node/${process.version}`);
    process.exit(0);
  }

  const [command, ...rest] = args._;
  const subArgs = parseArgs(rest);
  // Forward global options to subcommand args
  Object.assign(subArgs.options, args.options);
  Object.assign(subArgs.flags, args.flags);

  // Resolve config (stored + env overrides)
  const cfg = resolveConfig(args);

  if (!command || args.flags['help'] || args.flags['h']) {
    console.log(GLOBAL_HELP);
    process.exit(0);
  }

  switch (command) {
    case 'auth':
      return dispatchAuth(subArgs);

    case 'subscriptions':
    case 'sub':
    case 'subs':
      return dispatchSubscriptions(subArgs, cfg);

    case 'plans':
    case 'plan':
      return dispatchPlans(subArgs, cfg);

    case 'webhooks':
    case 'webhook':
      return dispatchWebhooks(subArgs, cfg);

    default:
      fail(`Unknown command: ${command}`);
      console.log('');
      console.log(`Run ${c.cyan('subtrackr --help')} to see available commands.`);
      process.exit(1);
  }
}

main().catch((err) => {
  fail(err.message || String(err));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
