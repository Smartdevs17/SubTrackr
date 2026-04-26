import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { SegmentRule, CriteriaOperator, SegmentField } from '../../types/segment';
import { useTheme } from '../../theme/useTheme';
import { Button } from '../common/Button';
import { Card } from '../common/Card';

interface SegmentRuleBuilderProps {
  rules: SegmentRule[];
  onChange: (rules: SegmentRule[]) => void;
  logic: 'AND' | 'OR';
  onLogicChange: (logic: 'AND' | 'OR') => void;
}

const FIELDS: { label: string; value: SegmentField }[] = [
  { label: 'Monthly Spend', value: 'totalMonthlySpend' },
  { label: 'Yearly Spend', value: 'totalYearlySpend' },
  { label: 'Active Subscriptions', value: 'activeSubscriptionCount' },
  { label: 'Categories', value: 'categories' },
  { label: 'Currencies', value: 'currencies' },
  { label: 'Billing Cycles', value: 'billingCycles' },
  { label: 'Days Since Last Active', value: 'daysSinceLastActive' },
  { label: 'Name', value: 'name' },
  { label: 'Email', value: 'email' },
];

const OPERATORS: { label: string; value: CriteriaOperator }[] = [
  { label: 'Equals', value: CriteriaOperator.EQUALS },
  { label: 'Not Equals', value: CriteriaOperator.NOT_EQUALS },
  { label: 'Greater Than', value: CriteriaOperator.GREATER_THAN },
  { label: 'Less Than', value: CriteriaOperator.LESS_THAN },
  { label: 'Contains', value: CriteriaOperator.CONTAINS },
  { label: 'In', value: CriteriaOperator.IN },
];

export const SegmentRuleBuilder: React.FC<SegmentRuleBuilderProps> = ({
  rules,
  onChange,
  logic,
  onLogicChange,
}) => {
  const theme = useTheme();

  const addRule = () => {
    const newRule: SegmentRule = {
      id: `rule-${Date.now()}`,
      field: 'totalMonthlySpend',
      operator: CriteriaOperator.GREATER_THAN,
      value: 0,
    };
    onChange([...rules, newRule]);
  };

  const removeRule = (id: string) => {
    onChange(rules.filter((r) => r.id !== id));
  };

  const updateRule = (id: string, updates: Partial<SegmentRule>) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Criteria Rules</Text>
        <View style={styles.logicContainer}>
          <TouchableOpacity
            onPress={() => onLogicChange('AND')}
            style={[
              styles.logicButton,
              logic === 'AND' && { backgroundColor: theme.colors.primary },
              { borderColor: theme.colors.border },
            ]}>
            <Text style={[styles.logicText, logic === 'AND' && { color: '#fff' }]}>AND</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onLogicChange('OR')}
            style={[
              styles.logicButton,
              logic === 'OR' && { backgroundColor: theme.colors.primary },
              { borderColor: theme.colors.border },
            ]}>
            <Text style={[styles.logicText, logic === 'OR' && { color: '#fff' }]}>OR</Text>
          </TouchableOpacity>
        </View>
      </View>

      {rules.map((rule, index) => (
        <Card key={rule.id} style={styles.ruleCard}>
          <View style={styles.ruleHeader}>
            <Text style={{ color: theme.colors.textSecondary }}>Rule #{index + 1}</Text>
            <TouchableOpacity onPress={() => removeRule(rule.id)}>
              <Text style={{ color: theme.colors.error }}>Remove</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.ruleRow}>
            <View style={styles.selectContainer}>
              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Field</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {FIELDS.map((f) => (
                  <TouchableOpacity
                    key={f.value}
                    onPress={() => updateRule(rule.id, { field: f.value })}
                    style={[
                      styles.chip,
                      rule.field === f.value && { backgroundColor: theme.colors.primary },
                      { borderColor: theme.colors.border },
                    ]}>
                    <Text style={[styles.chipText, rule.field === f.value && { color: '#fff' }]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <View style={styles.ruleRow}>
            <View style={styles.selectContainer}>
              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Operator</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {OPERATORS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    onPress={() => updateRule(rule.id, { operator: o.value })}
                    style={[
                      styles.chip,
                      rule.operator === o.value && { backgroundColor: theme.colors.accent },
                      { borderColor: theme.colors.border },
                    ]}>
                    <Text style={[styles.chipText, rule.operator === o.value && { color: '#fff' }]}>
                      {o.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <View style={styles.ruleRow}>
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Value</Text>
              <TextInput
                style={[
                  styles.input,
                  { color: theme.colors.text, borderColor: theme.colors.border },
                ]}
                value={String(rule.value)}
                onChangeText={(text) => {
                  const val = isNaN(Number(text)) ? text : Number(text);
                  updateRule(rule.id, { value: val });
                }}
                placeholder="Enter value..."
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>
          </View>
        </Card>
      ))}

      <Button title="+ Add Rule" onPress={addRule} variant="outline" style={styles.addButton} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  logicContainer: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
  },
  logicButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  logicText: {
    fontWeight: '600',
  },
  ruleCard: {
    marginBottom: 12,
    padding: 12,
  },
  ruleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  ruleRow: {
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  selectContainer: {
    flex: 1,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  chipText: {
    fontSize: 12,
  },
  inputContainer: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
  },
  addButton: {
    marginTop: 8,
  },
});
