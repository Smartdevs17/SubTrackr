/**
 * mobile/src/screens/upgrade/components/FeatureDiffList.tsx
 *
 * Highlights newly unlocked perks and features for the selected tier.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { UpgradeFeature } from '../types';

export interface FeatureDiffListProps {
  unlockedFeatures: UpgradeFeature[];
  targetTierName: string;
  testID?: string;
}

export const FeatureDiffList: React.FC<FeatureDiffListProps> = ({
  unlockedFeatures,
  targetTierName,
  testID = 'feature-diff-list',
}) => {
  if (unlockedFeatures.length === 0) return null;

  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.title}>Everything you get in {targetTierName}:</Text>
      {unlockedFeatures.map((feature) => (
        <View key={feature.id} style={styles.featureRow} testID={`feature-${feature.id}`}>
          <View style={styles.checkIcon}>
            <Text style={styles.checkText}>✓</Text>
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.featureName}>{feature.name}</Text>
            <Text style={styles.featureDescription}>{feature.description}</Text>
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginVertical: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 10,
  },
  checkIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#065F46',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '800',
  },
  textContainer: {
    flex: 1,
  },
  featureName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  featureDescription: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
    lineHeight: 15,
  },
});
