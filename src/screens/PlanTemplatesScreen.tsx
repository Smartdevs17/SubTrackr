import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import {
  usePlanTemplateStore,
  canInstantiate,
  computeLibraryAnalytics,
} from '../store/planTemplateStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useUserStore } from '../store/userStore';
import { PlanTemplate, TemplatePricingModel } from '../types/planTemplate';
import { borderRadius, colors, spacing, typography } from '../utils/constants';
import { formatCurrency } from '../utils/formatting';

const PRICING_MODEL_FILTERS: { value: TemplatePricingModel | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'flat', label: 'Flat' },
  { value: 'tiered', label: 'Usage' },
];

const QUOTE_UNIT_PRESETS = [500, 5_000, 25_000];

const formatPercent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

const PlanTemplatesScreen: React.FC = () => {
  const navigation = useNavigation();
  const currentUserId = useUserStore((s) => s.user?.id) ?? 'me';

  const { listVersions, getAnalytics, seedStarterTemplates, recordView, setShared, quote } =
    usePlanTemplateStore();
  const templates = usePlanTemplateStore((s) => s.templates);
  const analytics = usePlanTemplateStore((s) => s.analytics);
  const addFromTemplate = useSubscriptionStore((s) => s.addFromTemplate);

  const [search, setSearch] = useState('');
  const [pricingModel, setPricingModel] = useState<TemplatePricingModel | 'all'>('all');
  const [sharedOnly, setSharedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quoteUnits, setQuoteUnits] = useState(QUOTE_UNIT_PRESETS[1]);
  const [priceOverride, setPriceOverride] = useState('');

  useEffect(() => {
    seedStarterTemplates(currentUserId);
  }, [currentUserId, seedStarterTemplates]);

  const available = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return templates
      .filter((template) => canInstantiate(template, currentUserId))
      .filter((template) => {
        if (sharedOnly && !template.shared) return false;
        if (pricingModel !== 'all' && template.pricingModel !== pricingModel) return false;
        if (!needle) return true;
        const haystack = `${template.name} ${template.description} ${template.tags.join(' ')}`;
        return haystack.toLowerCase().includes(needle);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [templates, search, pricingModel, sharedOnly, currentUserId]);

  const library = useMemo(
    () => computeLibraryAnalytics(templates, analytics, { ownerId: currentUserId }),
    [templates, analytics, currentUserId]
  );

  const handleSelect = (template: PlanTemplate) => {
    const next = selectedId === template.id ? null : template.id;
    setSelectedId(next);
    setPriceOverride('');
    if (next) recordView(template.id);
  };

  const handleShareToggle = (template: PlanTemplate) => {
    try {
      setShared(currentUserId, template.id, !template.shared);
    } catch (error) {
      Alert.alert('Cannot share template', (error as Error).message);
    }
  };

  const handleUse = async (template: PlanTemplate) => {
    const parsed = parseFloat(priceOverride);
    try {
      const resolved = await addFromTemplate(currentUserId, template.id, {
        price: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      });
      Alert.alert(
        'Subscription created',
        `${resolved.name} at ${formatCurrency(resolved.price, resolved.currency)} per ${resolved.billingCycle}.`
      );
    } catch (error) {
      Alert.alert('Could not use template', (error as Error).message);
    }
  };

  const renderLibraryAnalytics = () => (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Library performance</Text>
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{library.templates}</Text>
          <Text style={styles.statLabel}>Templates</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{library.totalPlansCreated}</Text>
          <Text style={styles.statLabel}>Plans made</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{formatPercent(library.conversionRate)}</Text>
          <Text style={styles.statLabel}>Conversion</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{formatPercent(library.adoptionRate)}</Text>
          <Text style={styles.statLabel}>Adoption</Text>
        </View>
      </View>
      <Text style={styles.hint}>
        {library.sharedTemplates} shared · {library.totalViews} view(s) ·{' '}
        {library.totalSubscriptionsStarted} subscription(s) started
      </Text>
    </Card>
  );

  const renderFilters = () => (
    <Card style={styles.card}>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Search templates by name, description or tag"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Search plan templates"
      />
      <View style={styles.filterRow}>
        {PRICING_MODEL_FILTERS.map((option) => {
          const active = pricingModel === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setPricingModel(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter by ${option.label} pricing`}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Shared library only</Text>
        <Switch
          value={sharedOnly}
          onValueChange={setSharedOnly}
          accessibilityLabel="Show only shared templates"
        />
      </View>
    </Card>
  );

  const renderDetail = (template: PlanTemplate) => {
    const templateAnalytics = getAnalytics(template.id);
    const versions = listVersions(template.rootId);
    const priceQuote = template.pricingModel === 'tiered' ? quote(template.id, quoteUnits) : null;

    return (
      <View style={styles.detail}>
        <Text style={styles.detailHeading}>Features</Text>
        {template.features.length === 0 ? (
          <Text style={styles.hint}>No features listed.</Text>
        ) : (
          template.features.map((feature) => (
            <Text key={feature.key} style={styles.featureLine}>
              • {feature.label}
              {feature.includedUnits !== null ? ` — ${feature.includedUnits} included` : ''}
              {feature.highlight ? '  ★' : ''}
            </Text>
          ))
        )}

        {template.pricingModel === 'tiered' && (
          <>
            <Text style={styles.detailHeading}>Pricing tiers</Text>
            {template.tiers.map((tier, index) => (
              <Text key={`${tier.upToUnits ?? 'inf'}-${index}`} style={styles.featureLine}>
                • Up to {tier.upToUnits === null ? 'unlimited' : tier.upToUnits.toLocaleString()}{' '}
                units at {formatCurrency(tier.unitPrice, template.currency)} each
              </Text>
            ))}
            <View style={styles.filterRow}>
              {QUOTE_UNIT_PRESETS.map((units) => {
                const active = quoteUnits === units;
                return (
                  <TouchableOpacity
                    key={units}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setQuoteUnits(units)}
                    accessibilityRole="button"
                    accessibilityLabel={`Quote ${units} units`}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {units.toLocaleString()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {priceQuote && (
              <Text style={styles.quote}>
                {quoteUnits.toLocaleString()} units ={' '}
                {formatCurrency(priceQuote.total, template.currency)} (
                {formatCurrency(priceQuote.effectiveUnitPrice, template.currency)} per unit)
              </Text>
            )}
          </>
        )}

        <Text style={styles.detailHeading}>Customize</Text>
        <TextInput
          style={styles.input}
          value={priceOverride}
          onChangeText={setPriceOverride}
          placeholder={`Override price (default ${template.basePrice})`}
          placeholderTextColor={colors.textSecondary}
          keyboardType="decimal-pad"
          accessibilityLabel="Override template price"
        />

        <Text style={styles.detailHeading}>Performance</Text>
        <Text style={styles.hint}>
          {templateAnalytics.views} view(s) · {templateAnalytics.plansCreated} plan(s) ·{' '}
          {formatPercent(templateAnalytics.conversionRate)} conversion ·{' '}
          {formatCurrency(templateAnalytics.revenue, template.currency)} attributed
        </Text>

        <Text style={styles.detailHeading}>Versions</Text>
        <Text style={styles.hint}>
          {versions.map((v) => `v${v.version}${v.active ? ' (current)' : ''}`).join(' · ')}
        </Text>

        <View style={styles.actions}>
          <Button title="Use template" onPress={() => handleUse(template)} />
          {template.ownerId === currentUserId && (
            <Button
              title={template.shared ? 'Unshare' : 'Share'}
              variant="secondary"
              onPress={() => handleShareToggle(template)}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Plan Templates</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {renderLibraryAnalytics()}
        {renderFilters()}

        {available.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.hint}>No templates match these filters.</Text>
          </Card>
        ) : (
          available.map((template) => {
            const expanded = template.id === selectedId;
            return (
              <Card key={template.id} style={styles.card}>
                <TouchableOpacity
                  onPress={() => handleSelect(template)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${template.name} template`}>
                  <View style={styles.templateHeader}>
                    <View style={styles.templateHeading}>
                      <Text style={styles.cardTitle}>{template.name}</Text>
                      <Text style={styles.hint}>{template.description}</Text>
                    </View>
                    <View style={styles.templateMeta}>
                      <Text style={styles.price}>
                        {formatCurrency(template.basePrice, template.currency)}
                      </Text>
                      <Text style={styles.hint}>/{template.billingCycle}</Text>
                    </View>
                  </View>
                  <View style={styles.badgeRow}>
                    <Text style={styles.badge}>v{template.version}</Text>
                    <Text style={styles.badge}>
                      {template.pricingModel === 'tiered' ? 'Usage-based' : 'Flat'}
                    </Text>
                    {template.shared && <Text style={styles.badge}>Shared</Text>}
                    {template.ownerId !== currentUserId && (
                      <Text style={styles.badge}>Library</Text>
                    )}
                  </View>
                </TouchableOpacity>

                {expanded && renderDetail(template)}
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: { marginRight: spacing.md },
  title: { ...typography.h2, color: colors.text },
  scrollContent: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xl },
  card: { marginBottom: spacing.md },
  cardTitle: { ...typography.h3, color: colors.text },
  hint: { ...typography.caption, color: colors.textSecondary },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    marginBottom: spacing.md,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextActive: { color: colors.onPrimary, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { ...typography.body, color: colors.text },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { ...typography.h3, color: colors.text },
  statLabel: { ...typography.caption, color: colors.textSecondary },
  templateHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  templateHeading: { flex: 1, paddingRight: spacing.md },
  templateMeta: { alignItems: 'flex-end' },
  price: { ...typography.h3, color: colors.primary },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  badge: {
    ...typography.caption,
    color: colors.textSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  detail: { marginTop: spacing.md },
  detailHeading: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  featureLine: { ...typography.caption, color: colors.text, marginBottom: 2 },
  quote: { ...typography.body, color: colors.primary, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
});

export default PlanTemplatesScreen;
