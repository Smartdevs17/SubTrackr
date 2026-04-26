import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Segment, SegmentOverlap } from '../../types/segment';
import { useTheme } from '../../theme/useTheme';
import { Card } from '../common/Card';

interface SegmentOverlapAnalysisProps {
  segments: Segment[];
  overlaps: SegmentOverlap[];
}

export const SegmentOverlapAnalysis: React.FC<SegmentOverlapAnalysisProps> = ({
  segments,
  overlaps,
}) => {
  const theme = useTheme();

  if (segments.length < 2) {
    return (
      <Card style={styles.container}>
        <Text style={[styles.message, { color: theme.colors.textSecondary }]}>
          Add at least two segments to see overlap analysis.
        </Text>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: theme.colors.text }]}>Overlap Analysis</Text>
      {overlaps.map((overlap, index) => {
        const segNames = overlap.segmentIds.map(
          (id) => segments.find((s) => s.id === id)?.name || 'Unknown'
        );

        return (
          <Card key={index} style={styles.overlapCard}>
            <View style={styles.overlapHeader}>
              <Text style={[styles.names, { color: theme.colors.text }]}>
                {segNames.join(' ∩ ')}
              </Text>
              <Text style={[styles.count, { color: theme.colors.primary }]}>
                {overlap.subscriberCount} Users
              </Text>
            </View>
            <View style={[styles.progressBarContainer, { backgroundColor: theme.colors.border }]}>
              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${overlap.percentage}%`,
                    backgroundColor: theme.colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={[styles.percentage, { color: theme.colors.textSecondary }]}>
              {overlap.percentage.toFixed(1)}% of total subscribers
            </Text>
          </Card>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  message: {
    textAlign: 'center',
    padding: 20,
  },
  overlapCard: {
    marginBottom: 10,
    padding: 12,
  },
  overlapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  names: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  count: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  progressBarContainer: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBar: {
    height: '100%',
  },
  percentage: {
    fontSize: 10,
  },
});
