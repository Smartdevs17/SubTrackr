/**
 * FraudRuleConfigScreen
 *
 * Lists all fraud detection rules fetched from the backend and allows
 * analysts to enable/disable each rule individually.
 * Shows per-rule statistics: hit rate, false positive rate, average score.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RuleInfo {
  name: string;
  category: string;
  weight: number;
  enabled: boolean;
}

interface RuleStat {
  name: string;
  hitCount: number;
  avgScore: number;
  falsePositiveRate: number;
  evaluationCount: number;
}

const API_BASE = '/api'; // adjust to real base URL

// ── Component ─────────────────────────────────────────────────────────────────

const FraudRuleConfigScreen: React.FC = () => {
  const [rules, setRules] = useState<RuleInfo[]>([]);
  const [stats, setStats] = useState<Record<string, RuleStat>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [rulesRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/fraud/rules`),
        fetch(`${API_BASE}/fraud/rules/stats`),
      ]);

      if (!rulesRes.ok || !statsRes.ok) throw new Error('Failed to fetch rule data');

      const rulesJson = (await rulesRes.json()) as { data: RuleInfo[] };
      const statsJson = (await statsRes.json()) as { data: RuleStat[] };

      setRules(rulesJson.data);

      const statsMap: Record<string, RuleStat> = {};
      for (const s of statsJson.data) {
        statsMap[s.name] = s;
      }
      setStats(statsMap);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleToggle = async (name: string, enabled: boolean) => {
    // Optimistic update
    setRules((prev) => prev.map((r) => (r.name === name ? { ...r, enabled } : r)));

    try {
      const res = await fetch(`${API_BASE}/fraud/rules/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Toggle failed');
    } catch {
      // Revert on failure
      setRules((prev) => prev.map((r) => (r.name === name ? { ...r, enabled: !enabled } : r)));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchData();
            }}
          />
        }>
        <Text style={styles.title}>Fraud Rule Configuration</Text>
        <Text style={styles.subtitle}>
          Enable or disable individual detection rules. Changes take effect immediately.
        </Text>

        {rules.map((rule) => {
          const stat = stats[rule.name];
          return (
            <View key={rule.name} style={styles.ruleCard}>
              <View style={styles.ruleHeader}>
                <View style={styles.ruleMeta}>
                  <Text style={styles.ruleName}>{rule.name.replace(/_/g, ' ')}</Text>
                  <View style={styles.badges}>
                    <Text style={styles.badge}>{rule.category}</Text>
                    <Text style={styles.badge}>weight {rule.weight}</Text>
                  </View>
                </View>
                <Switch
                  value={rule.enabled}
                  onValueChange={(val) => void handleToggle(rule.name, val)}
                  accessibilityLabel={`Toggle ${rule.name}`}
                  accessibilityHint={rule.enabled ? 'Tap to disable rule' : 'Tap to enable rule'}
                />
              </View>

              {stat ? (
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{stat.hitCount}</Text>
                    <Text style={styles.statLabel}>Hits</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{stat.avgScore.toFixed(1)}</Text>
                    <Text style={styles.statLabel}>Avg score</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>
                      {(stat.falsePositiveRate * 100).toFixed(1)}%
                    </Text>
                    <Text style={styles.statLabel}>FP rate</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{stat.evaluationCount}</Text>
                    <Text style={styles.statLabel}>Evaluations</Text>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#8E8E93',
    marginBottom: 8,
  },
  ruleCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  ruleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  ruleMeta: {
    flex: 1,
    gap: 6,
    marginRight: 12,
  },
  ruleName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'capitalize',
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  badge: {
    fontSize: 11,
    color: '#8E8E93',
    backgroundColor: '#2C2C2E',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#2C2C2E',
    paddingTop: 10,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 11,
    color: '#8E8E93',
    marginTop: 2,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
});

export default FraudRuleConfigScreen;
