import React, { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { useCampaignStore } from '../store/campaignStore';
import { RedemptionContext } from '../types/campaign';
import { borderRadius, colors, spacing, typography } from '../utils/constants';

const PromotionManagementScreen: React.FC = () => {
  const navigation = useNavigation();
  const { campaigns, validateCoupon, getCampaignPerformance, generateCoupons } = useCampaignStore();

  const [testCode, setTestCode] = useState('');
  const [testResultText, setTestResultText] = useState<string | null>(null);

  const promotionalCampaigns = useMemo(() => campaigns.filter((c) => c.promotionRule), [campaigns]);

  const handleTestCode = () => {
    if (!testCode.trim()) return;
    const context: RedemptionContext = {
      userId: 'preview-user',
      subscriptionId: 'preview-subscription',
      purchaseAmount: 100,
      userRedemptionCount: 0,
    };
    const result = validateCoupon(testCode.trim(), context);
    setTestResultText(
      result.isValid
        ? `Valid — discount ${result.discountAmount?.toFixed(2)}, final price ${result.finalPrice?.toFixed(2)}`
        : `Invalid — ${result.error}`
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Promotions</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionLabel}>Test a coupon code</Text>
        <Card style={styles.testCard}>
          <View style={styles.testRow}>
            <TextInput
              style={styles.testInput}
              placeholder="Enter coupon code"
              placeholderTextColor={colors.textSecondary}
              value={testCode}
              onChangeText={setTestCode}
              autoCapitalize="characters"
            />
            <Button title="Validate" onPress={handleTestCode} size="small" />
          </View>
          {testResultText && <Text style={styles.testResult}>{testResultText}</Text>}
        </Card>

        <Text style={styles.sectionLabel}>Active promotions</Text>
        {promotionalCampaigns.length === 0 && (
          <Text style={styles.emptyText}>No promotional campaigns yet.</Text>
        )}
        {promotionalCampaigns.map((campaign) => {
          const performance = getCampaignPerformance(campaign.id);
          const coupons = campaign.couponCodes ?? [];

          return (
            <Card key={campaign.id} style={styles.campaignCard}>
              <View style={styles.campaignHeader}>
                <Text style={styles.campaignName}>{campaign.name}</Text>
                <Text style={styles.campaignStatus}>{campaign.status}</Text>
              </View>

              <View style={styles.statsRow}>
                <Text style={styles.statText}>
                  Redemptions: {campaign.currentRedemptions ?? 0}
                  {campaign.maxRedemptions != null ? ` / ${campaign.maxRedemptions}` : ''}
                </Text>
                <Text style={styles.statText}>
                  Rate: {((performance.redemptionRate ?? 0) * 100).toFixed(1)}%
                </Text>
              </View>
              <View style={styles.statsRow}>
                <Text style={styles.statText}>
                  Discount given: {(performance.totalDiscountGiven ?? 0).toFixed(2)}
                </Text>
                <Text style={styles.statText}>
                  Cannibalization: {((performance.cannibalizationRate ?? 0) * 100).toFixed(0)}%
                </Text>
              </View>

              <Text style={styles.couponCountText}>{coupons.length} coupon code(s) generated</Text>

              <Button
                title="Generate 10 Coupons"
                variant="outline"
                size="small"
                onPress={() => generateCoupons(campaign.id, 10)}
                style={styles.generateButton}
              />
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { marginRight: spacing.md },
  title: { ...typography.h3, color: colors.text },
  scrollContent: { padding: spacing.md },
  sectionLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  testCard: { gap: spacing.sm },
  testRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  testInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  },
  testResult: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  emptyText: { ...typography.caption, color: colors.textSecondary },
  campaignCard: { marginBottom: spacing.sm, gap: spacing.xs },
  campaignHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  campaignName: { ...typography.body, fontWeight: '600', color: colors.text },
  campaignStatus: { ...typography.caption, color: colors.primary, textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statText: { ...typography.caption, color: colors.textSecondary },
  couponCountText: { ...typography.caption, color: colors.text, marginTop: spacing.xs },
  generateButton: { marginTop: spacing.sm },
});

export default PromotionManagementScreen;
