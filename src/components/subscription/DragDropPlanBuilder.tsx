import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { spacing, borderRadius } from '../../utils/constants';

export interface PlanTier {
  id: string;
  name: string;
  price: number;
  billingCycle: 'monthly' | 'yearly';
  features: string[];
  isPopular?: boolean;
}

interface DragDropPlanBuilderProps {
  initialTiers?: PlanTier[];
  onChange?: (tiers: PlanTier[]) => void;
  onSave?: (tiers: PlanTier[]) => void;
}

const DEFAULT_TIERS: PlanTier[] = [
  {
    id: 'tier-basic',
    name: 'Basic',
    price: 9,
    billingCycle: 'monthly',
    features: ['Up to 5 subscriptions', 'Basic analytics', 'Email notifications'],
  },
  {
    id: 'tier-pro',
    name: 'Pro',
    price: 29,
    billingCycle: 'monthly',
    features: ['Unlimited subscriptions', 'Advanced cohort analytics', 'Priority support', 'Export CSV & PDF'],
    isPopular: true,
  },
];

export const DragDropPlanBuilder: React.FC<DragDropPlanBuilderProps> = ({
  initialTiers = DEFAULT_TIERS,
  onChange,
  onSave,
}) => {
  const colors = useThemeColors();
  const [tiers, setTiers] = useState<PlanTier[]>(initialTiers);
  const [newTierName, setNewTierName] = useState('');
  const [newTierPrice, setNewTierPrice] = useState('19');
  const [editingFeatureInput, setEditingFeatureInput] = useState<{ [tierId: string]: string }>({});

  const updateTiers = (nextTiers: PlanTier[]) => {
    setTiers(nextTiers);
    onChange?.(nextTiers);
  };

  const moveTier = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tiers.length) return;
    const next = [...tiers];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    updateTiers(next);
  };

  const moveFeature = (tierId: string, featureIndex: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? featureIndex - 1 : featureIndex + 1;
    const tier = tiers.find((t) => t.id === tierId);
    if (!tier || targetIndex < 0 || targetIndex >= tier.features.length) return;

    const nextFeatures = [...tier.features];
    const [movedFeature] = nextFeatures.splice(featureIndex, 1);
    nextFeatures.splice(targetIndex, 0, movedFeature);

    const nextTiers = tiers.map((t) => (t.id === tierId ? { ...t, features: nextFeatures } : t));
    updateTiers(nextTiers);
  };

  const handleAddTier = () => {
    if (!newTierName.trim()) return;
    const newTier: PlanTier = {
      id: `tier-${Date.now()}`,
      name: newTierName.trim(),
      price: parseFloat(newTierPrice) || 0,
      billingCycle: 'monthly',
      features: ['Standard feature'],
    };
    const next = [...tiers, newTier];
    setNewTierName('');
    setNewTierPrice('19');
    updateTiers(next);
  };

  const handleRemoveTier = (tierId: string) => {
    const next = tiers.filter((t) => t.id !== tierId);
    updateTiers(next);
  };

  const handleAddFeature = (tierId: string) => {
    const text = editingFeatureInput[tierId]?.trim();
    if (!text) return;
    const nextTiers = tiers.map((t) =>
      t.id === tierId ? { ...t, features: [...t.features, text] } : t
    );
    setEditingFeatureInput((prev) => ({ ...prev, [tierId]: '' }));
    updateTiers(nextTiers);
  };

  const handleRemoveFeature = (tierId: string, featureIndex: number) => {
    const nextTiers = tiers.map((t) => {
      if (t.id !== tierId) return t;
      const features = t.features.filter((_, idx) => idx !== featureIndex);
      return { ...t, features };
    });
    updateTiers(nextTiers);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text.primary }]}>Plan Builder & Reorder Tiers</Text>

      {tiers.map((tier, tierIdx) => (
        <View
          key={tier.id}
          style={[styles.tierCard, { backgroundColor: colors.card, borderColor: colors.border.default }]}
          testID={`tier-card-${tier.id}`}
        >
          <View style={styles.tierHeader}>
            <View style={styles.tierTitleContainer}>
              <Text style={[styles.tierName, { color: colors.text.primary }]}>{tier.name}</Text>
              <Text style={[styles.tierPrice, { color: colors.brand.primary }]}>${tier.price}/mo</Text>
            </View>
            <View style={styles.reorderControls}>
              <Pressable
                disabled={tierIdx === 0}
                onPress={() => moveTier(tierIdx, 'up')}
                style={[styles.iconButton, tierIdx === 0 && styles.disabledBtn]}
                testID={`move-up-tier-${tier.id}`}
              >
                <Text style={[styles.btnSymbol, { color: colors.text.primary }]}>▲</Text>
              </Pressable>
              <Pressable
                disabled={tierIdx === tiers.length - 1}
                onPress={() => moveTier(tierIdx, 'down')}
                style={[styles.iconButton, tierIdx === tiers.length - 1 && styles.disabledBtn]}
                testID={`move-down-tier-${tier.id}`}
              >
                <Text style={[styles.btnSymbol, { color: colors.text.primary }]}>▼</Text>
              </Pressable>
              <Pressable
                onPress={() => handleRemoveTier(tier.id)}
                style={styles.deleteBtn}
                testID={`delete-tier-${tier.id}`}
              >
                <Text style={styles.deleteTxt}>✕</Text>
              </Pressable>
            </View>
          </View>

          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>Features (Drag/Reorder):</Text>
          {tier.features.map((feature, fIdx) => (
            <View
              key={fIdx}
              style={[styles.featureRow, { backgroundColor: colors.surfaceVariant }]}
              testID={`feature-row-${tier.id}-${fIdx}`}
            >
              <Text style={[styles.featureText, { color: colors.text.primary }]}>• {feature}</Text>
              <View style={styles.featureReorder}>
                <Pressable
                  disabled={fIdx === 0}
                  onPress={() => moveFeature(tier.id, fIdx, 'up')}
                  style={styles.smallIconButton}
                  testID={`move-up-feature-${tier.id}-${fIdx}`}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 10 }}>▲</Text>
                </Pressable>
                <Pressable
                  disabled={fIdx === tier.features.length - 1}
                  onPress={() => moveFeature(tier.id, fIdx, 'down')}
                  style={styles.smallIconButton}
                  testID={`move-down-feature-${tier.id}-${fIdx}`}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 10 }}>▼</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleRemoveFeature(tier.id, fIdx)}
                  style={styles.smallDeleteButton}
                  testID={`delete-feature-${tier.id}-${fIdx}`}
                >
                  <Text style={{ color: colors.status.error, fontSize: 11 }}>✕</Text>
                </Pressable>
              </View>
            </View>
          ))}

          <View style={styles.addFeatureContainer}>
            <TextInput
              style={[styles.input, { color: colors.text.primary, borderColor: colors.border.default }]}
              placeholder="Add feature..."
              placeholderTextColor={colors.textSecondary}
              value={editingFeatureInput[tier.id] || ''}
              onChangeText={(val) => setEditingFeatureInput((prev) => ({ ...prev, [tier.id]: val }))}
              testID={`add-feature-input-${tier.id}`}
            />
            <Pressable
              style={[styles.addFeatureBtn, { backgroundColor: colors.brand.primary }]}
              onPress={() => handleAddFeature(tier.id)}
              testID={`add-feature-btn-${tier.id}`}
            >
              <Text style={styles.btnText}>+ Add</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <View style={[styles.addTierBox, { backgroundColor: colors.card, borderColor: colors.border.default }]}>
        <Text style={[styles.addTierTitle, { color: colors.text.primary }]}>Add New Tier</Text>
        <View style={styles.addTierInputs}>
          <TextInput
            style={[styles.input, { flex: 2, color: colors.text.primary, borderColor: colors.border.default }]}
            placeholder="Tier Name (e.g., Enterprise)"
            placeholderTextColor={colors.textSecondary}
            value={newTierName}
            onChangeText={setNewTierName}
            testID="new-tier-name-input"
          />
          <TextInput
            style={[styles.input, { flex: 1, color: colors.text.primary, borderColor: colors.border.default }]}
            placeholder="Price ($)"
            keyboardType="numeric"
            placeholderTextColor={colors.textSecondary}
            value={newTierPrice}
            onChangeText={setNewTierPrice}
            testID="new-tier-price-input"
          />
        </View>
        <Pressable
          style={[styles.saveTierBtn, { backgroundColor: colors.brand.primary }]}
          onPress={handleAddTier}
          testID="add-tier-button"
        >
          <Text style={styles.btnText}>+ Create Tier</Text>
        </Pressable>
      </View>

      {onSave && (
        <Pressable
          style={[styles.saveAllBtn, { backgroundColor: colors.status.success }]}
          onPress={() => onSave(tiers)}
          testID="save-plan-builder-btn"
        >
          <Text style={styles.btnText}>Save Plan Changes</Text>
        </Pressable>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md },
  title: { fontSize: 20, fontWeight: '700', marginBottom: spacing.md },
  tierCard: { padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, marginBottom: spacing.md },
  tierHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  tierTitleContainer: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  tierName: { fontSize: 17, fontWeight: '700' },
  tierPrice: { fontSize: 15, fontWeight: '600' },
  reorderControls: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  iconButton: { padding: spacing.xs, borderRadius: borderRadius.xs, borderWidth: 1, borderColor: '#ccc' },
  btnSymbol: { fontSize: 12, fontWeight: '700' },
  disabledBtn: { opacity: 0.3 },
  deleteBtn: { padding: spacing.xs, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: borderRadius.xs },
  deleteTxt: { color: '#ef4444', fontWeight: '700' },
  sectionSubtitle: { fontSize: 12, fontWeight: '600', marginBottom: spacing.xs },
  featureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.xs,
    borderRadius: borderRadius.xs,
    marginBottom: 4,
  },
  featureText: { fontSize: 13 },
  featureReorder: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  smallIconButton: { paddingHorizontal: 4, paddingVertical: 2 },
  smallDeleteButton: { paddingHorizontal: 4, paddingVertical: 2 },
  addFeatureContainer: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  addTierBox: { padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, marginBottom: spacing.md },
  addTierTitle: { fontSize: 15, fontWeight: '600', marginBottom: spacing.xs },
  addTierInputs: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderRadius: borderRadius.xs, paddingHorizontal: spacing.sm, height: 38, fontSize: 13 },
  addFeatureBtn: { paddingHorizontal: spacing.sm, borderRadius: borderRadius.xs, justifyContent: 'center' },
  saveTierBtn: { paddingVertical: spacing.xs, borderRadius: borderRadius.xs, alignItems: 'center' },
  saveAllBtn: { paddingVertical: spacing.sm, borderRadius: borderRadius.md, alignItems: 'center', marginBottom: spacing.xl },
  btnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
});

export default DragDropPlanBuilder;
