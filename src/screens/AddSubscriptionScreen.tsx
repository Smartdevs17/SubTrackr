import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { SubscriptionCategory, BillingCycle } from '../types/subscription';

export const AddSubscriptionScreen: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<SubscriptionCategory>(SubscriptionCategory.OTHER);
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<BillingCycle>(BillingCycle.MONTHLY);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Add Subscription</Text>
          <Text style={styles.subtitle}>Track your new subscription</Text>
        </View>
        
        <View style={styles.form}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Information</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name</Text>
              <View style={styles.inputPlaceholder}>
                <Text style={styles.placeholderText}>Enter subscription name</Text>
              </View>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description (Optional)</Text>
              <View style={styles.inputPlaceholder}>
                <Text style={styles.placeholderText}>Enter description</Text>
              </View>
            </View>
          </View>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Category</Text>
            <View style={styles.categoryGrid}>
              {Object.values(SubscriptionCategory).map((category) => (
                <View
                  key={category}
                  style={[
                    styles.categoryItem,
                    selectedCategory === category && styles.categoryItemSelected
                  ]}
                >
                  <Text style={[
                    styles.categoryText,
                    selectedCategory === category && styles.categoryTextSelected
                  ]}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Billing Details</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Price</Text>
              <View style={styles.inputPlaceholder}>
                <Text style={styles.placeholderText}>$0.00</Text>
              </View>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Billing Cycle</Text>
              <View style={styles.billingCycleContainer}>
                {Object.values(BillingCycle).map((cycle) => (
                  <View
                    key={cycle}
                    style={[
                      styles.billingCycleItem,
                      selectedBillingCycle === cycle && styles.billingCycleItemSelected
                    ]}
                  >
                    <Text style={[
                      styles.billingCycleText,
                      selectedBillingCycle === cycle && styles.billingCycleTextSelected
                    ]}>
                      {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  form: {
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.xs,
    fontWeight: '500',
  },
  inputPlaceholder: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  placeholderText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryItemSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryText: {
    ...typography.caption,
    color: colors.text,
  },
  categoryTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  billingCycleContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  billingCycleItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  billingCycleItemSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  billingCycleText: {
    ...typography.caption,
    color: colors.text,
  },
  billingCycleTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
});
