import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing, borderRadius, typography } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';

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
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

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

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
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
      backgroundColor: colors.background.card,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      height: 48,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    input: {
      flex: 1,
      color: colors.text.primary,
      ...typography.body,
      paddingVertical: 0,
      marginLeft: spacing.xs,
    },
    iconSm: {
      fontSize: 14,
    },
    clearIcon: {
      fontSize: 14,
      color: colors.text.secondary,
      fontWeight: 'bold',
    },
    filterButton: {
      backgroundColor: colors.background.card,
      borderRadius: borderRadius.md,
      width: 48,
      height: 48,
      borderWidth: 1,
      borderColor: colors.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterButtonActive: {
      backgroundColor: colors.brand.primary + '15',
      borderColor: colors.brand.primary,
    },
    filterIcon: {
      fontSize: 18,
      color: colors.text.secondary,
    },
    filterIconActive: {
      color: colors.brand.primary,
    },
    badge: {
      position: 'absolute',
      top: -4,
      right: -4,
      backgroundColor: colors.accent,
      borderRadius: 10,
      minWidth: 18,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.background.primary,
    },
    badgeText: {
      color: colors.onPrimary,
      fontSize: 10,
      fontWeight: 'bold',
    },
  });
}
