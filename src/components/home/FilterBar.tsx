import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography } from '../../utils/constants';

interface FilterBarProps {
  searchQuery: string;
  setSearchQuery: (text: string) => void;
  onFilterPress: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  setSearchQuery,
  onFilterPress,
  hasActiveFilters,
  activeFilterCount,
}) => {
  return (
    <View style={styles.container} accessibilityRole="search">
      {/* Search Input Field */}
      <View style={styles.searchWrapper}>
        <Text
          style={styles.iconSm}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants">
          🔍
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Search subscriptions..."
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search subscriptions"
          returnKeyType="search"
          clearButtonMode="never" // We use a custom clear button for better cross-platform control
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchQuery('')}
            accessibilityLabel="Clear search"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Action Button */}
      <TouchableOpacity
        style={[styles.filterButton, hasActiveFilters && styles.filterButtonActive]}
        onPress={onFilterPress}
        accessibilityRole="button"
        accessibilityLabel={`Filters${hasActiveFilters ? `, ${activeFilterCount} active` : ''}`}>
        <Text style={[styles.filterIcon, hasActiveFilters && styles.filterIconActive]}>🔧</Text>

        {hasActiveFilters && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{activeFilterCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  searchWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 48, // Fixed height for better touch targets
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    color: colors.text,
    ...typography.body,
    paddingVertical: 0, // Fixes vertical alignment on some Android versions
    marginLeft: spacing.xs,
  },
  iconSm: {
    fontSize: 14,
  },
  clearIcon: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: 'bold',
  },
  filterButton: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    backgroundColor: colors.primary + '15', // Soft tint of primary
    borderColor: colors.primary,
  },
  filterIcon: {
    fontSize: 18,
    color: colors.textSecondary,
  },
  filterIconActive: {
    color: colors.primary,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.accent, // Using accent instead of error red
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background, // Creates a "cutout" effect
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
