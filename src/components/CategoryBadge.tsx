import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useCategoryStore } from '../store/categoryStore';

interface CategoryBadgeProps {
  categoryId: string;
  size?: 'sm' | 'md' | 'lg';
}

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({
  categoryId,
  size = 'md',
}) => {
  const { getCategoryById } = useCategoryStore();
  const category = getCategoryById(categoryId);

  if (!category) {
    return (
      <View style={[styles.badge, styles.unknownBadge, sizes[size]]}>
        <Text style={[styles.text, textSizes[size]]}>Unknown</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.badge,
        sizes[size],
        { backgroundColor: `${category.color}20`, borderColor: `${category.color}40` },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: category.color }]} />
      <Text style={[styles.text, textSizes[size], { color: category.color }]}>
        {category.name}
      </Text>
    </View>
  );
};

const sizes = StyleSheet.create({
  sm: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4 },
  md: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6 },
  lg: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8 },
});

const textSizes = StyleSheet.create({
  sm: { fontSize: 10 },
  md: { fontSize: 12 },
  lg: { fontSize: 14 },
});

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  unknownBadge: {
    backgroundColor: '#f5f5f5',
    borderColor: '#ddd',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  text: {
    fontWeight: '600',
  },
});