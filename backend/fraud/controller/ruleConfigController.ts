/**
 * Rule Configuration REST API (framework-agnostic handler functions)
 *
 * Endpoints:
 *   GET    /fraud/rules             – list all rules with enabled status
 *   PATCH  /fraud/rules/:name       – enable or disable a rule
 *   GET    /fraud/rules/stats       – per-rule hit rate and average score
 *   POST   /fraud/rules/ab-test     – configure A/B test split
 */

import { defaultEngine } from '../domain/RuleEngine';
import { ABTestConfig } from '../domain/RuleEngine';

// ── Response helpers ──────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true, data };
}

function err(message: string, status = 400) {
  return { success: false, error: { message }, status };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/** GET /fraud/rules */
export function listRules() {
  return ok(defaultEngine.listRules());
}

/** PATCH /fraud/rules/:name  — body: { enabled: boolean } */
export function updateRule(name: string, body: { enabled?: boolean }) {
  if (body.enabled === undefined) {
    return err('Body must include "enabled" boolean');
  }

  const success = body.enabled
    ? defaultEngine.enableRule(name)
    : defaultEngine.disableRule(name);

  if (!success) {
    return err(`Rule "${name}" not found`, 404);
  }

  return ok({ name, enabled: body.enabled });
}

/** GET /fraud/rules/stats */
export function getRuleStats() {
  return ok(defaultEngine.getStats());
}

/** POST /fraud/rules/ab-test  — body: ABTestConfig */
export function configureABTest(body: ABTestConfig) {
  if (!Array.isArray(body.rulesA) || !Array.isArray(body.rulesB)) {
    return err('Body must include "rulesA" and "rulesB" arrays');
  }
  defaultEngine.configureABTest(body);
  return ok({ message: 'A/B test configured', config: body });
}

/** POST /fraud/evaluate  — body: { transaction, context } */
export function evaluateTransaction(body: {
  transaction: Parameters<typeof defaultEngine.evaluate>[0];
  context: Parameters<typeof defaultEngine.evaluate>[1];
}) {
  if (!body.transaction || !body.context) {
    return err('Body must include "transaction" and "context"');
  }
  const result = defaultEngine.evaluate(body.transaction, body.context);
  return ok(result);
}
