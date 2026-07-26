import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { colors, spacing } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import { Button } from '../../src/components/common/Button';
import {
  RecommendationService,
  Recommendation,
} from '../../backend/services/recommendationService';

const RecommendationsScreen = () => {
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      // Mocking context
      const context = {
        activeSubscriptions: ['netflix', 'spotify'],
        userProfile: { interests: ['Entertainment', 'Security'] },
      };
      const recs = await RecommendationService.getRecommendations('0xUSER123', context);
      setRecommendations(recs);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleRecommendationClick = async (rec: Recommendation) => {
    const success = await RecommendationService.trackRecommendationClick(rec.id, '0xUSER123');
    if (success) {
      Alert.alert('Offer Claimed', `You have shown interest in ${rec.name}.`);
    } else {
      Alert.alert('Error', 'Unable to process your request at this time.');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recommended For You</Text>
        <Text style={styles.subtitle}>Discover add-ons based on your subscriptions</Text>
      </View>

      <View style={styles.section}>
        {recommendations.length > 0 ? (
          recommendations.map((rec) => (
            <Card key={rec.id} style={styles.recommendationCard}>
              <View style={styles.recHeader}>
                <View>
                  <Text style={styles.recName}>{rec.name}</Text>
                  <Text style={styles.recCategory}>{rec.category}</Text>
                </View>
                <Text style={styles.recPrice}>${rec.price.toFixed(2)}/mo</Text>
              </View>

              <View style={styles.matchScoreContainer}>
                <Text style={styles.matchScoreText}>
                  {Math.round(rec.confidenceScore * 100)}% Match
                </Text>
              </View>

              <Button
                title="Add to Subscriptions"
                onPress={() => handleRecommendationClick(rec)}
                style={styles.actionButton}
              />
            </Card>
          ))
        ) : (
          <Text style={styles.noData}>No recommendations available right now.</Text>
        )}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: spacing.xl,
    paddingTop: 60,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },
  section: {
    padding: spacing.lg,
  },
  recommendationCard: {
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  recHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  recName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  recCategory: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  recPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  matchScoreContainer: {
    backgroundColor: '#E6F4EA',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  matchScoreText: {
    fontSize: 12,
    color: '#1E8E3E',
    fontWeight: '600',
  },
  actionButton: {
    marginTop: spacing.sm,
  },
  noData: {
    textAlign: 'center',
    color: colors.textSecondary,
    marginTop: spacing.xl,
  },
});

export default RecommendationsScreen;
