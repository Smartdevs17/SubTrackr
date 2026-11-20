import { readFile } from 'node:fs/promises';
import { RuleEngine } from './engine.js';

/**
 * Builds the engine from the JSON file at `NOTIFICATION_RULES_PATH`.
 * Without the variable the engine has no rules and every notification is
 * delivered on its own channel, which matches the pre-rules behaviour.
 * An unreadable or invalid file fails startup rather than silently dropping rules.
 */
export async function loadRuleEngine(env: Record<string, string | undefined>): Promise<RuleEngine> {
  const path = env.NOTIFICATION_RULES_PATH;
  if (!path) return new RuleEngine();

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read notification rules from ${path}: ${(err as Error).message}`);
  }
  try {
    return new RuleEngine(raw as never);
  } catch (err) {
    throw new Error(`Invalid notification rules in ${path}: ${(err as Error).message}`);
  }
}
