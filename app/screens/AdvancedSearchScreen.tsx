import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Switch,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../src/types/subscription';
import { useSubscriptionStore } from '../../src/store/subscriptionStore';
import { useSearchStore } from '../stores/searchStore';
import {
  formatHighlight,
  getBillingCycleLabel,
  getCategoryLabel,
  hasHighlightMatch,
} from '../services/searchService';
import { colors, spacing, typography, borderRadius } from '../../src/utils/constants';
import { SearchHit } from '../../backend/services/search/ElasticsearchService';

const STATUS_OPTIONS: Array<'active' | 'inactive'> = ['active', 'inactive'];

export const AdvancedSearchScreen: React.FC = () => {
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const {
    queryText,
    filters,
    sort,
    result,
    savedSearches,
    loading,
    setQueryText,
    setFilters,
    setSort,
    runSearch,
    saveCurrentSearch,
    loadSavedSearch,
    removeSavedSearch,
    checkNotifications,
    hydrateSavedSearches,
    clear,
  } = useSearchStore();

  const [showFilters, setShowFilters] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [notifyOnMatch, setNotifyOnMatch] = useState(true);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  useEffect(() => {
    hydrateSavedSearches().then(() => runSearch());
  }, [hydrateSavedSearches, runSearch]);

  useEffect(() => {
    runSearch();
  }, [subscriptions, runSearch]);

  useEffect(() => {
    const notifications = checkNotifications();
    for (const note of notifications) {
      Alert.alert(
        'Saved search match',
        `"${note.savedSearchName}" has ${note.newMatchCount} new match(es).`
      );
    }
  }, [subscriptions, checkNotifications]);

  const toggleCategory = useCallback(
    (category: SubscriptionCategory) => {
      const current = filters.categories ?? [];
      const next = current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category];
      setFilters({ categories: next });
    },
    [filters.categories, setFilters]
  );

  const toggleBillingCycle = useCallback(
    (cycle: BillingCycle) => {
      const current = filters.billingCycles ?? [];
      const next = current.includes(cycle)
        ? current.filter((c) => c !== cycle)
        : [...current, cycle];
      setFilters({ billingCycles: next });
    },
    [filters.billingCycles, setFilters]
  );

  const toggleStatus = useCallback(
    (status: 'active' | 'inactive') => {
      const current = filters.statuses ?? [];
      const next = current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status];
      setFilters({ statuses: next });
    },
    [filters.statuses, setFilters]
  );

  const applyPriceRange = useCallback(() => {
    const min = minPrice.trim() ? Number(minPrice) : 0;
    const max = maxPrice.trim() ? Number(maxPrice) : Number.MAX_SAFE_INTEGER;
    setFilters({ priceRange: { min, max } });
  }, [maxPrice, minPrice, setFilters]);

  const handleSaveSearch = useCallback(async () => {
    if (!saveName.trim()) {
      Alert.alert('Name required', 'Enter a name for this saved search.');
      return;
    }
    await saveCurrentSearch(saveName.trim(), notifyOnMatch);
    setSaveName('');
    Alert.alert('Saved', 'Search saved. You will be notified when new matches appear.');
  }, [notifyOnMatch, saveCurrentSearch, saveName]);

  const hits = result?.hits ?? [];
  const facets = result?.facets;

  const renderHit = useCallback(({ item }: { item: SearchHit }) => {
    const sub = item.subscription;
    const titleHighlight = item.highlights.planName ?? item.highlights.name;
    const subtitleHighlight =
      item.highlights.customerName ??
      item.highlights.customerEmail ??
      item.highlights.notes ??
      item.highlights.description;

    return (
      <View style={styles.item} accessibilityRole="button">
        <Text style={styles.title}>
          {hasHighlightMatch(titleHighlight)
            ? formatHighlight(titleHighlight, sub.name)
            : sub.planName ?? sub.name}
        </Text>
        {(sub.customerName || sub.customerEmail) && (
          <Text style={styles.subtitle}>
            {[sub.customerName, sub.customerEmail].filter(Boolean).join(' · ')}
          </Text>
        )}
        {subtitleHighlight ? (
          <Text style={styles.highlight}>
            {formatHighlight(subtitleHighlight, sub.notes ?? sub.description ?? '')}
          </Text>
        ) : null}
        <Text style={styles.meta}>
          {getCategoryLabel(sub.category)} · {sub.currency} {sub.price.toFixed(2)} /{' '}
          {getBillingCycleLabel(sub.billingCycle)} · {sub.isActive ? 'Active' : 'Inactive'}
        </Text>
        {queryText.trim() ? <Text style={styles.score}>Score: {item.score.toFixed(1)}</Text> : null}
      </View>
    );
  }, [queryText]);

  const facetSummary = useMemo(() => {
    if (!facets) return '';
    return `${facets.activeCount} active · ${facets.cryptoCount} crypto · ${result?.total ?? 0} results`;
  }, [facets, result?.total]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView horizontal={false} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.header}>Advanced Subscription Search</Text>
        <Text style={styles.summary}>{facetSummary}</Text>

        <TextInput
          style={styles.input}
          placeholder="Search customer, email, plan, notes..."
          value={queryText}
          onChangeText={setQueryText}
          returnKeyType="search"
          onSubmitEditing={runSearch}
          accessibilityLabel="Search query"
        />

        <View style={styles.row}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowFilters((v) => !v)}>
            <Text style={styles.secondaryButtonText}>{showFilters ? 'Hide Filters' : 'Filters'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={clear}>
            <Text style={styles.secondaryButtonText}>Clear</Text>
          </TouchableOpacity>
        </View>

        {showFilters && (
          <View style={styles.filterPanel}>
            <Text style={styles.filterTitle}>Status</Text>
            <View style={styles.chipRow}>
              {STATUS_OPTIONS.map((status) => {
                const selected = (filters.statuses ?? []).includes(status);
                return (
                  <TouchableOpacity
                    key={status}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleStatus(status)}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.filterTitle}>Categories</Text>
            <View style={styles.chipRow}>
              {Object.values(SubscriptionCategory).map((category) => {
                const selected = (filters.categories ?? []).includes(category);
                return (
                  <TouchableOpacity
                    key={category}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleCategory(category)}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {getCategoryLabel(category)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.filterTitle}>Billing Cycle</Text>
            <View style={styles.chipRow}>
              {Object.values(BillingCycle).map((cycle) => {
                const selected = (filters.billingCycles ?? []).includes(cycle);
                return (
                  <TouchableOpacity
                    key={cycle}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleBillingCycle(cycle)}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {getBillingCycleLabel(cycle)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.filterTitle}>Price Range</Text>
            <View style={styles.priceRow}>
              <TextInput
                style={styles.priceInput}
                placeholder="Min"
                keyboardType="numeric"
                value={minPrice}
                onChangeText={setMinPrice}
              />
              <TextInput
                style={styles.priceInput}
                placeholder="Max"
                keyboardType="numeric"
                value={maxPrice}
                onChangeText={setMaxPrice}
              />
              <TouchableOpacity style={styles.applyButton} onPress={applyPriceRange}>
                <Text style={styles.applyButtonText}>Apply</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.filterTitle}>Sort</Text>
            <View style={styles.chipRow}>
              {(['_score', 'name', 'price', 'nextBillingDate'] as const).map((field) => {
                const active = sort?.field === field;
                return (
                  <TouchableOpacity
                    key={field}
                    style={[styles.chip, active && styles.chipSelected]}
                    onPress={() =>
                      setSort({
                        field,
                        order: sort?.order ?? 'desc',
                      })
                    }>
                    <Text style={[styles.chipText, active && styles.chipTextSelected]}>{field}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.savedPanel}>
          <Text style={styles.filterTitle}>Saved Searches</Text>
          <View style={styles.saveRow}>
            <TextInput
              style={[styles.input, styles.saveInput]}
              placeholder="Saved search name"
              value={saveName}
              onChangeText={setSaveName}
            />
            <View style={styles.notifyRow}>
              <Text style={styles.notifyLabel}>Notify on new matches</Text>
              <Switch value={notifyOnMatch} onValueChange={setNotifyOnMatch} />
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={handleSaveSearch}>
              <Text style={styles.primaryButtonText}>Save Search</Text>
            </TouchableOpacity>
          </View>
          {savedSearches.map((saved) => (
            <View key={saved.id} style={styles.savedItem}>
              <TouchableOpacity style={styles.savedLoad} onPress={() => loadSavedSearch(saved.id)}>
                <Text style={styles.savedName}>{saved.name}</Text>
                <Text style={styles.savedQuery}>{saved.query.query || '(filters only)'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeSavedSearch(saved.id)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color={colors.primary} />
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(item) => item.subscription.id}
          renderItem={renderHit}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>No matching subscriptions</Text>}
          ListHeaderComponent={
            result ? (
              <Text style={styles.resultMeta}>
                {result.total} result(s) in {result.took}ms
                {typeof result.indexLagMs === 'number' ? ` · index lag ${result.indexLagMs}ms` : ''}
              </Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md },
  header: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
  summary: { color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    height: 44,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.text, fontWeight: '600' },
  filterPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  filterTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 12 },
  chipTextSelected: { color: colors.onPrimary },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  priceInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.xs,
    color: colors.text,
  },
  applyButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
  },
  applyButtonText: { color: colors.onPrimary, fontWeight: '600' },
  savedPanel: { marginBottom: spacing.md },
  saveRow: { gap: spacing.sm },
  saveInput: { marginBottom: 0 },
  notifyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notifyLabel: { color: colors.text },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.onPrimary, fontWeight: '700' },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  savedLoad: { flex: 1 },
  savedName: { color: colors.text, fontWeight: '600' },
  savedQuery: { color: colors.textSecondary, fontSize: 12 },
  removeText: { color: colors.error, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  item: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.body, color: colors.text, fontWeight: '600' },
  subtitle: { color: colors.textSecondary, marginTop: 2 },
  highlight: { color: colors.accent, marginTop: 4, fontStyle: 'italic' },
  meta: { color: colors.textSecondary, marginTop: 4, fontSize: 12 },
  score: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  empty: { padding: spacing.md, color: colors.textSecondary, textAlign: 'center' },
  resultMeta: { color: colors.textSecondary, marginBottom: spacing.sm },
  loader: { marginTop: spacing.lg },
});

export default AdvancedSearchScreen;
