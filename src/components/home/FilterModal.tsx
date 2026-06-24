import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../utils/constants';
import { SubscriptionCategory, BillingCycle } from '../../types/subscription';

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  selectedCategories: SubscriptionCategory[];
  toggleCategory: (category: SubscriptionCategory) => void;
  selectedBillingCycles: BillingCycle[];
  toggleBillingCycle: (cycle: BillingCycle) => void;
  priceRange: { min: number; max: number };
  setPriceRange: React.Dispatch<React.SetStateAction<{ min: number; max: number }>>;
  showActiveOnly: boolean;
  setShowActiveOnly: (val: boolean) => void;
  showCryptoOnly: boolean;
  setShowCryptoOnly: (val: boolean) => void;
  sortBy: 'name' | 'price' | 'nextBilling' | 'category';
  setSortBy: (val: 'name' | 'price' | 'nextBilling' | 'category') => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (val: 'asc' | 'desc') => void;
  clearAllFilters: () => void;
}

export const FilterModal: React.FC<FilterModalProps> = ({
  visible,
  onClose,
  selectedCategories,
  toggleCategory,
  selectedBillingCycles,
  toggleBillingCycle,
  priceRange,
  setPriceRange,
  showActiveOnly,
  setShowActiveOnly,
  showCryptoOnly,
  setShowCryptoOnly,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  clearAllFilters,
}) => {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      accessibilityViewIsModal={true}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} accessibilityRole="header">
            Filter &amp; Sort
          </Text>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close filter modal"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.closeButton}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          {/* Categories */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle} accessibilityRole="header">
              Categories
            </Text>
            <View style={styles.categoryGrid}>
              {Object.values(SubscriptionCategory).map((category) => {
                const isSelected = selectedCategories.includes(category);
                const label = category.charAt(0).toUpperCase() + category.slice(1);
                return (
                  <TouchableOpacity
                    key={category}
                    style={[styles.categoryChip, isSelected && styles.categoryChipSelected]}
                    onPress={() => toggleCategory(category)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: isSelected }}>
                    <Text
                      style={[
                        styles.categoryChipText,
                        isSelected && styles.categoryChipTextSelected,
                      ]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Billing Cycles */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle} accessibilityRole="header">
              Billing Cycles
            </Text>
            <View style={styles.billingCycleGrid}>
              {Object.values(BillingCycle).map((cycle) => {
                const isSelected = selectedBillingCycles.includes(cycle);
                const label = cycle.charAt(0).toUpperCase() + cycle.slice(1);
                return (
                  <TouchableOpacity
                    key={cycle}
                    style={[styles.billingCycleChip, isSelected && styles.billingCycleChipSelected]}
                    onPress={() => toggleBillingCycle(cycle)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: isSelected }}>
                    <Text
                      style={[
                        styles.billingCycleChipText,
                        isSelected && styles.billingCycleChipTextSelected,
                      ]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Price Range */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle} accessibilityRole="header">
              Price Range
            </Text>
            <View style={styles.priceRangeContainer}>
              <TextInput
                style={styles.priceInput}
                placeholder="Min"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={priceRange.min.toString()}
                onChangeText={(text) =>
                  setPriceRange((prev) => ({ ...prev, min: parseFloat(text) || 0 }))
                }
                accessibilityLabel="Minimum price"
                accessibilityHint="Enter the minimum price to filter subscriptions"
              />
              <Text style={styles.priceRangeSeparator} accessibilityElementsHidden={true}>
                to
              </Text>
              <TextInput
                style={styles.priceInput}
                placeholder="Max"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={priceRange.max.toString()}
                onChangeText={(text) =>
                  setPriceRange((prev) => ({ ...prev, max: parseFloat(text) || 1000 }))
                }
                accessibilityLabel="Maximum price"
                accessibilityHint="Enter the maximum price to filter subscriptions"
              />
            </View>
          </View>

          {/* Toggle Options */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle} accessibilityRole="header">
              Options
            </Text>
            <View style={styles.toggleContainer}>
              <Text style={styles.toggleLabel} nativeID="activeOnlyLabel">
                Active Only
              </Text>
              <Switch
                value={showActiveOnly}
                onValueChange={setShowActiveOnly}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
                accessibilityLabel="Show active subscriptions only"
                accessibilityRole="switch"
                accessibilityState={{ checked: showActiveOnly }}
              />
            </View>
            <View style={styles.toggleContainer}>
              <Text style={styles.toggleLabel} nativeID="cryptoOnlyLabel">
                Crypto Only
              </Text>
              <Switch
                value={showCryptoOnly}
                onValueChange={setShowCryptoOnly}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
                accessibilityLabel="Show crypto subscriptions only"
                accessibilityRole="switch"
                accessibilityState={{ checked: showCryptoOnly }}
              />
            </View>
          </View>

          {/* Sort Options */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle} accessibilityRole="header">
              Sort By
            </Text>
            <View style={styles.sortContainer}>
              <View style={styles.sortRow}>
                <Text style={styles.sortLabel} accessibilityElementsHidden={true}>
                  Field:
                </Text>
                <View style={styles.sortButtons} accessibilityRole="tablist">
                  {(['name', 'price', 'nextBilling', 'category'] as const).map((field) => {
                    const isSelected = sortBy === field;
                    const label =
                      field === 'nextBilling'
                        ? 'Next Billing'
                        : field.charAt(0).toUpperCase() + field.slice(1);
                    return (
                      <TouchableOpacity
                        key={field}
                        style={[styles.sortButton, isSelected && styles.sortButtonSelected]}
                        onPress={() => setSortBy(field)}
                        accessibilityRole="tab"
                        accessibilityLabel={`Sort by ${label}`}
                        accessibilityState={{ selected: isSelected }}>
                        <Text
                          style={[
                            styles.sortButtonText,
                            isSelected && styles.sortButtonTextSelected,
                          ]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={styles.sortRow}>
                <Text style={styles.sortLabel} accessibilityElementsHidden={true}>
                  Order:
                </Text>
                <View style={styles.sortButtons} accessibilityRole="tablist">
                  <TouchableOpacity
                    style={[styles.sortButton, sortOrder === 'asc' && styles.sortButtonSelected]}
                    onPress={() => setSortOrder('asc')}
                    accessibilityRole="tab"
                    accessibilityLabel="Sort ascending"
                    accessibilityState={{ selected: sortOrder === 'asc' }}>
                    <Text
                      style={[
                        styles.sortButtonText,
                        sortOrder === 'asc' && styles.sortButtonTextSelected,
                      ]}>
                      ↑ Ascending
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.sortButton, sortOrder === 'desc' && styles.sortButtonSelected]}
                    onPress={() => setSortOrder('desc')}
                    accessibilityRole="tab"
                    accessibilityLabel="Sort descending"
                    accessibilityState={{ selected: sortOrder === 'desc' }}>
                    <Text
                      style={[
                        styles.sortButtonText,
                        sortOrder === 'desc' && styles.sortButtonTextSelected,
                      ]}>
                      ↓ Descending
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={styles.clearFiltersButton}
            onPress={clearAllFilters}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters">
            <Text style={styles.clearFiltersButtonText}>Clear All Filters</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.applyFiltersButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Apply filters and close">
            <Text style={styles.applyFiltersButtonText}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.h2, color: colors.text },
  closeButton: { fontSize: 24, color: colors.textSecondary, padding: spacing.sm },
  modalContent: { flex: 1, padding: spacing.lg },
  filterSection: { marginBottom: spacing.xl },
  filterSectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  categoryChip: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryChipText: { ...typography.body, color: colors.text },
  categoryChipTextSelected: { color: colors.text, fontWeight: '600' },
  billingCycleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  billingCycleChip: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  billingCycleChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  billingCycleChipText: { ...typography.body, color: colors.text },
  billingCycleChipTextSelected: { color: colors.text, fontWeight: '600' },
  priceRangeContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  priceInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
  },
  priceRangeSeparator: { ...typography.body, color: colors.textSecondary },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  toggleLabel: { ...typography.body, color: colors.text },
  sortContainer: { gap: spacing.md },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sortLabel: { ...typography.body, color: colors.text, minWidth: 80 },
  sortButtons: { flexDirection: 'row', gap: spacing.sm },
  sortButton: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortButtonSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  sortButtonText: { ...typography.body, color: colors.text },
  sortButtonTextSelected: { color: colors.text, fontWeight: '600' },
  modalFooter: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clearFiltersButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearFiltersButtonText: { ...typography.body, color: colors.text, fontWeight: '600' },
  applyFiltersButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  applyFiltersButtonText: { ...typography.body, color: colors.text, fontWeight: '600' },
});
