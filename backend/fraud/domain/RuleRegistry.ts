/**
 * RuleRegistry
 *
 * Manages the loaded set of FraudRules.  Rules are registered by name and can
 * be enabled/disabled individually without restarting the service.
 *
 * In a Node.js server environment SIGHUP triggers a hot-reload of rules from
 * the filesystem directory so new rules can be deployed without downtime.
 */

import fs from 'fs';
import path from 'path';
import { FraudRule } from './rules/FraudRule';

// ── Rule statistics ───────────────────────────────────────────────────────────

export interface RuleStats {
  name: string;
  hitCount: number;
  totalScore: number;
  avgScore: number;
  falsePositiveCount: number;
  falsePositiveRate: number;
  evaluationCount: number;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class RuleRegistry {
  private rules: Map<string, FraudRule> = new Map();
  private stats: Map<string, RuleStats> = new Map();

  /** Register a rule instance. Overwrites any existing rule with the same name. */
  register(rule: FraudRule): void {
    this.rules.set(rule.name, rule);
    if (!this.stats.has(rule.name)) {
      this.stats.set(rule.name, {
        name: rule.name,
        hitCount: 0,
        totalScore: 0,
        avgScore: 0,
        falsePositiveCount: 0,
        falsePositiveRate: 0,
        evaluationCount: 0,
      });
    }
  }

  /** Remove a rule by name. */
  unregister(name: string): void {
    this.rules.delete(name);
  }

  /** Return all registered rules (enabled and disabled). */
  getAll(): FraudRule[] {
    return Array.from(this.rules.values());
  }

  /** Return only enabled rules. */
  getEnabled(): FraudRule[] {
    return this.getAll().filter((r) => r.enabled);
  }

  find(name: string): FraudRule | undefined {
    return this.rules.get(name);
  }

  enable(name: string): boolean {
    const rule = this.rules.get(name);
    if (!rule) return false;
    rule.enabled = true;
    return true;
  }

  disable(name: string): boolean {
    const rule = this.rules.get(name);
    if (!rule) return false;
    rule.enabled = false;
    return true;
  }

  // ── Statistics ─────────────────────────────────────────────────────────────

  recordHit(name: string, score: number): void {
    const stat = this.stats.get(name);
    if (!stat) return;
    stat.hitCount += 1;
    stat.totalScore += score;
    stat.avgScore = stat.totalScore / stat.hitCount;
  }

  recordEvaluation(name: string): void {
    const stat = this.stats.get(name);
    if (!stat) return;
    stat.evaluationCount += 1;
  }

  recordFalsePositive(name: string): void {
    const stat = this.stats.get(name);
    if (!stat) return;
    stat.falsePositiveCount += 1;
    stat.falsePositiveRate =
      stat.hitCount > 0 ? stat.falsePositiveCount / stat.hitCount : 0;
  }

  getStats(): RuleStats[] {
    return Array.from(this.stats.values());
  }

  getStatsByName(name: string): RuleStats | undefined {
    return this.stats.get(name);
  }

  /**
   * Dynamically load rule modules from a directory.
   * Each .js / .ts file in the directory must export a default class
   * implementing FraudRule.
   *
   * Designed for Node.js environments; called on SIGHUP for hot-reload.
   */
  async loadFromDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) return;

    const files = fs.readdirSync(dirPath).filter(
      (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.startsWith('FraudRule'),
    );

    for (const file of files) {
      try {
        const mod = await import(path.resolve(dirPath, file)) as { default?: new () => FraudRule };
        const RuleClass = mod.default;
        if (typeof RuleClass === 'function') {
          const instance = new RuleClass();
          this.register(instance);
        }
      } catch (err) {
        console.warn(`[RuleRegistry] Failed to load rule from ${file}:`, err);
      }
    }
  }
}

// ── Default registry singleton ────────────────────────────────────────────────

export const defaultRegistry = new RuleRegistry();
