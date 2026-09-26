# SubTrackr CLI

> Issue #1174 — Build CLI tool for subscription management

The `subtrackr` CLI lets you manage Stellar-based subscriptions, plans, and webhooks directly from your terminal. It talks to the SubTrackr REST API and mirrors the full [`SubTrackrClient`](../sdks/javascript/src/client.ts) SDK surface.

## Installation

The CLI ships as part of the `subtrackr` npm package. After running `npm install` in the repo root:

```bash
# Run directly via npm script
npm run cli -- --help

# Or invoke the binary directly (after npm link or global install)
subtrackr --help
```

To install globally from the local repo:

```bash
npm link          # registers `subtrackr` in your PATH
subtrackr --help
```

## Authentication

Credentials are stored in `~/.subtrackr/config.json` (file permissions: `600` — owner-readable only). You can override them per-invocation with `--api-key` and `--base-url`.

### Login

```bash
# Save credentials for local development
subtrackr auth login \
  --api-key sk_test_YOUR_KEY \
  --base-url http://localhost:3000

# Save credentials for production
subtrackr auth login \
  --api-key sk_live_YOUR_KEY \
  --base-url https://api.subtrackr.io
```

### Check status

```bash
subtrackr auth status
```

### Logout

```bash
subtrackr auth logout
```

### Environment variable overrides

| Variable               | Purpose                         |
|------------------------|---------------------------------|
| `SUBTRACKR_API_KEY`    | API key (overrides stored key)  |
| `SUBTRACKR_BASE_URL`   | Base URL (overrides stored URL) |
| `NO_COLOR`             | Disable ANSI colour output      |
| `DEBUG`                | Print full stack traces on error |

---

## Subscriptions

### List subscriptions

```bash
subtrackr subscriptions list

# Filter by status
subtrackr subscriptions list --status active
subtrackr subscriptions list --status paused
subtrackr subscriptions list --status cancelled

# Filter by category
subtrackr subscriptions list --category streaming

# Pagination
subtrackr subscriptions list --page 2 --limit 50

# Output raw JSON
subtrackr subscriptions list --format json
```

### Get a subscription

```bash
subtrackr subscriptions get 42
subtrackr subscriptions get 42 --format json
```

### Create a subscription

```bash
subtrackr subscriptions create \
  --plan-id 1 \
  --subscriber GABCDEF...STELLARADDRESS \
  --name "Alice's Pro Plan" \
  --price 29.99 \
  --currency USDC
```

| Option          | Required | Description                            |
|-----------------|----------|----------------------------------------|
| `--plan-id`     | ✅        | ID of the plan to subscribe to         |
| `--subscriber`  | ✅        | Stellar address of the subscriber      |
| `--name`        |           | Display name for the subscription      |
| `--price`       |           | Override the plan price                |
| `--currency`    |           | Token symbol (default: `XLM`)          |

### Cancel a subscription

```bash
# Cancel at the end of the current billing period (default)
subtrackr subscriptions cancel 42

# Cancel immediately
subtrackr subscriptions cancel 42 --now

# Cancel with a reason
subtrackr subscriptions cancel 42 --reason "Customer requested"
```

### Pause a subscription

```bash
subtrackr subscriptions pause 42
```

### Resume a paused subscription

```bash
subtrackr subscriptions resume 42
```

### Manually trigger a charge

```bash
subtrackr subscriptions charge 42
```

---

## Plans

### List plans

```bash
subtrackr plans list
subtrackr plans list --format json
```

### Get a plan

```bash
subtrackr plans get 1
subtrackr plans get 1 --format json
```

### Create a plan

```bash
subtrackr plans create \
  --name "Enterprise" \
  --price 99.99 \
  --merchant GABCDEF...MERCHANTADDRESS \
  --token USDC \
  --interval Yearly
```

| Option        | Required | Description                                          |
|---------------|----------|------------------------------------------------------|
| `--name`      | ✅        | Plan name                                            |
| `--price`     | ✅        | Price amount                                         |
| `--merchant`  | ✅        | Stellar address of the merchant creating the plan    |
| `--token`     |           | Token symbol (default: `XLM`)                       |
| `--interval`  |           | `Weekly` \| `Monthly` \| `Quarterly` \| `Yearly` (default: `Monthly`) |

### Deactivate a plan

```bash
subtrackr plans deactivate 1 --merchant GABCDEF...MERCHANTADDRESS
```

---

## Webhooks

### List webhooks

```bash
subtrackr webhooks list
subtrackr webhooks list --format json
```

### Register a webhook

```bash
subtrackr webhooks create \
  --url https://yourapp.example.com/webhooks/subtrackr \
  --events subscription.created,payment.succeeded,invoice.generated
```

| Option      | Required | Description                                               |
|-------------|----------|-----------------------------------------------------------|
| `--url`     | ✅        | HTTPS endpoint that will receive event payloads           |
| `--events`  | ✅        | Comma-separated list of event types to subscribe to       |

**Available event types:**

| Event                    | Fired when                                    |
|--------------------------|-----------------------------------------------|
| `subscription.created`   | A new subscription is created                 |
| `subscription.cancelled` | A subscription is cancelled                   |
| `subscription.paused`    | A subscription is paused                      |
| `subscription.resumed`   | A paused subscription is resumed              |
| `payment.succeeded`      | A charge cycle completes successfully         |
| `payment.failed`         | A charge cycle fails                          |
| `invoice.generated`      | An invoice is generated                       |
| `refund.requested`       | A refund is requested                         |
| `refund.approved`        | A refund is approved                          |

### Delete a webhook

```bash
subtrackr webhooks delete wh_abc123
```

---

## Global options

These flags work with any command:

| Flag                    | Description                                         |
|-------------------------|-----------------------------------------------------|
| `--api-key <key>`       | Override the stored API key for this invocation     |
| `--base-url <url>`      | Override the stored base URL for this invocation    |
| `--format json`         | Output raw JSON instead of formatted tables         |
| `--no-color`            | Disable ANSI colour output                          |
| `--version`             | Print CLI version                                   |
| `--help`, `-h`          | Show help for any command                           |

---

## CI / scripting usage

The `--format json` flag makes every command machine-readable, suitable for piping into `jq` or shell scripts:

```bash
# Get subscription count
subtrackr subscriptions list --format json | jq '. | length'

# Extract all active subscription IDs
subtrackr subscriptions list --status active --format json | jq '.[].id'

# Cancel all paused subscriptions
subtrackr subscriptions list --status paused --format json \
  | jq -r '.[].id' \
  | xargs -I{} subtrackr subscriptions cancel {}

# Create a plan and capture the new ID
PLAN_ID=$(subtrackr plans create \
  --name "CI Test Plan" \
  --price 1.00 \
  --merchant "$MERCHANT_ADDRESS" \
  --format json | jq -r '.id')
echo "Created plan: $PLAN_ID"
```

---

## Credential security

- Credentials are stored in `~/.subtrackr/config.json` with `chmod 600` (owner-read-only on Unix).
- The stored API key is masked in `auth status` output — only the first 8 characters are shown.
- Never commit your `.subtrackr/config.json` to version control.
- In CI environments, use the `SUBTRACKR_API_KEY` and `SUBTRACKR_BASE_URL` environment variables instead of `auth login`.

---

## Architecture

The CLI is implemented in [`bin/subtrackr.js`](../bin/subtrackr.js) using **zero external dependencies** — only Node.js built-in modules (`http`, `https`, `fs`, `path`, `os`). This keeps the install footprint small and avoids supply-chain risk.

It mirrors the full method surface of [`sdks/javascript/src/client.ts`](../sdks/javascript/src/client.ts):

| SDK method              | CLI command                              |
|-------------------------|------------------------------------------|
| `listSubscriptions()`   | `subtrackr subscriptions list`           |
| `createSubscription()`  | `subtrackr subscriptions create`         |
| `cancelSubscription()`  | `subtrackr subscriptions cancel <id>`    |
| `pauseSubscription()`   | `subtrackr subscriptions pause <id>`     |
| `resumeSubscription()`  | `subtrackr subscriptions resume <id>`    |
| `chargeSubscription()`  | `subtrackr subscriptions charge <id>`    |
| `createPlan()`          | `subtrackr plans create`                 |
| `deactivatePlan()`      | `subtrackr plans deactivate <id>`        |
| `getPlan()`             | `subtrackr plans get <id>`               |
| `listWebhooks()`        | `subtrackr webhooks list`                |
| `createWebhook()`       | `subtrackr webhooks create`              |
