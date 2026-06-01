import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
  Share,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useThemeColors } from '../hooks/useThemeColors';
import { useLoyaltyStore } from '../store/loyaltyStore';
import { useWalletStore } from '../store/walletStore';
import { useGamificationStore } from '../store/gamificationStore';
import { Card } from '../components/common/Card';
import { LoyaltyTier, RewardType, TierBenefits, PointTxType, StreakInfo } from '../types/loyalty';

const LoyaltyDashboardScreen: React.FC = () => {
  const colors = useThemeColors();
  const {
    loyaltyStatus,
    transactions,
    rewards,
    program,
    streak,
    referral,
    isLoading,
    initializeProgram,
    fetchLoyaltyStatus,
    accumulatePoints,
    redeemPoints,
    earnReferralBonus,
    generateReferralCode,
  } = useLoyaltyStore();
  const { address } = useWalletStore();
  const { earnedBadges, earnedAchievements } = useGamificationStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedReward, setSelectedReward] = useState<string>('');
  const [badgeModalVisible, setBadgeModalVisible] = useState(false);

  useEffect(() => {
    if (!program) {
      initializeProgram();
    }
    if (address) {
      fetchLoyaltyStatus(address);
    }
  }, [program, initializeProgram, address, fetchLoyaltyStatus]);

  useEffect(() => {
    if (address && loyaltyStatus) {
      const timer = setInterval(() => {
        useLoyaltyStore.getState().checkTierUpgrade();
      }, 60000);
      return () => clearInterval(timer);
    }
  }, [address, loyaltyStatus]);

  const handleShareReferral = useCallback(async () => {
    const code = generateReferralCode();
    try {
      await Share.share({
        message: `Join SubTrackr and use my referral code: ${code}. You'll earn bonus points!`,
        title: 'Invite a Friend',
      });
    } catch {
      // user cancelled
    }
  }, [generateReferralCode]);

  const handleRedeemReward = useCallback(async () => {
    if (!selectedReward) {
      Alert.alert('Error', 'Please select a reward');
      return;
    }

    const success = await redeemPoints(selectedReward);
    if (success) {
      Alert.alert('Success', 'Reward redeemed successfully!');
    } else {
      Alert.alert('Error', 'Not enough points or reward unavailable');
    }
    setModalVisible(false);
    setSelectedReward('');
  }, [selectedReward, redeemPoints]);

  const getTierColor = (tier: LoyaltyTier): string => {
    switch (tier) {
      case LoyaltyTier.PLATINUM:
        return colors.textSecondary;
      case LoyaltyTier.GOLD:
        return colors.status.warning;
      case LoyaltyTier.SILVER:
        return colors.border.default;
      default:
        return colors.brand.secondary;
    }
  };

  const getNextTierInfo = (): TierBenefits | null => {
    if (!program || !loyaltyStatus) return null;
    const currentTierIndex = program.tiers.findIndex((t) => t.tier === loyaltyStatus.tier);
    if (currentTierIndex >= program.tiers.length - 1) return null;
    return program.tiers[currentTierIndex + 1];
  };

  const renderStreakCard = () => {
    if (!loyaltyStatus) return null;
    const currentStreak = loyaltyStatus.streak || streak.current;
    return (
      <Card style={styles.streakCard}>
        <View style={styles.streakHeader}>
          <Text style={styles.streakIcon}>🔥</Text>
          <View style={styles.streakInfo}>
            <Text style={styles.streakValue}>
              {currentStreak > 0 ? `${currentStreak}-day streak` : 'Start a streak!'}
            </Text>
            <Text style={styles.streakSubtext}>
              {currentStreak >= 10
                ? 'Amazing! You earned a streak bonus!'
                : currentStreak >= 5
                  ? 'Keep going! Almost at bonus milestone.'
                  : 'Pay on time to build your streak.'}
            </Text>
          </View>
        </View>
        {currentStreak > 0 && (
          <View style={styles.streakProgress}>
            <View style={styles.streakBar}>
              <View
                style={[
                  styles.streakFill,
                  { width: `${Math.min(100, (currentStreak % 10) * 10)}%` },
                ]}
              />
            </View>
            <Text style={styles.streakMilestone}>
              {10 - (currentStreak % 10)} charges to next streak bonus
            </Text>
          </View>
        )}
      </Card>
    );
  };

  const renderReferralCard = () => (
    <Card style={styles.referralCard}>
      <Text style={styles.referralTitle}>Refer a Friend</Text>
      <Text style={styles.referralDesc}>
        Earn {referral.bonusPoints} bonus points for each friend who joins!
      </Text>
      <TouchableOpacity style={styles.shareButton} onPress={handleShareReferral}>
        <Text style={styles.shareButtonText}>Share Referral Code</Text>
      </TouchableOpacity>
      {referral.totalReferrals > 0 && (
        <Text style={styles.referralStats}>
          {referral.totalReferrals} friend{referral.totalReferrals > 1 ? 's' : ''} joined
        </Text>
      )}
    </Card>
  );

  const renderBadgesCard = () => {
    if (earnedBadges.length === 0 && earnedAchievements.length === 0) return null;
    return (
      <Card style={styles.badgesCard}>
        <View style={styles.badgesHeader}>
          <Text style={styles.badgesTitle}>Badges & Achievements</Text>
          <TouchableOpacity onPress={() => setBadgeModalVisible(true)}>
            <Text style={styles.badgesViewAll}>View all →</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.badgeRow}>
          {earnedBadges.slice(0, 4).map((badge, idx) => (
            <View key={idx} style={styles.badgeItem}>
              <Text style={styles.badgeIcon}>🏆</Text>
              <Text style={styles.badgeName} numberOfLines={1}>{badge}</Text>
            </View>
          ))}
        </View>
      </Card>
    );
  };

  const renderStatusCard = () => {
    if (!loyaltyStatus) {
      return (
        <Card style={styles.statusCard}>
          <Text style={styles.emptyText}>No loyalty status yet</Text>
          <Text style={styles.emptySubtext}>Start subscribing to earn rewards!</Text>
        </Card>
      );
    }

    const nextTier = getNextTierInfo();
    const pointsToNextTier = nextTier ? nextTier.pointsThreshold - loyaltyStatus.lifetimePoints : 0;

    return (
      <Card style={styles.statusCard}>
        <View style={styles.tierHeader}>
          <View style={[styles.tierBadge, { backgroundColor: getTierColor(loyaltyStatus.tier) }]}>
            <Text style={styles.tierBadgeText}>{loyaltyStatus.tier.toUpperCase()}</Text>
          </View>
          <Text style={styles.memberSince}>
            Member since {new Date(loyaltyStatus.memberSince).toLocaleDateString()}
          </Text>
        </View>

        <View style={styles.pointsDisplay}>
          <Text style={styles.pointsValue}>{loyaltyStatus.points}</Text>
          <Text style={styles.pointsLabel}>Available Points</Text>
        </View>

        {nextTier && pointsToNextTier > 0 && (
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressText}>
                {pointsToNextTier.toLocaleString()} points to {nextTier.tier}
              </Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, (1 - pointsToNextTier / nextTier.pointsThreshold) * 100)}%`,
                  },
                ]}
              />
            </View>
          </View>
        )}

        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{loyaltyStatus.lifetimePoints.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Lifetime Points</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>${loyaltyStatus.totalSpent.toFixed(0)}</Text>
            <Text style={styles.statLabel}>Total Spent</Text>
          </View>
        </View>
      </Card>
    );
  };

  const renderRewardsCard = () => (
    <Card style={styles.rewardsCard}>
      <View style={styles.rewardsHeader}>
        <Text style={styles.rewardsTitle}>Available Rewards</Text>
        <TouchableOpacity
          onPress={() => setModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Redeem rewards">
          <Text style={styles.redeemLink}>Redeem →</Text>
        </TouchableOpacity>
      </View>

      <FlashList
        data={rewards.filter((r) => r.isActive)}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderItem={({ item: reward }) => (
          <TouchableOpacity
            style={styles.rewardItem}
            onPress={() => {
              setSelectedReward(reward.id);
              setModalVisible(true);
            }}>
            <View style={styles.rewardInfo}>
              <Text style={styles.rewardName}>{reward.name}</Text>
              <Text style={styles.rewardDesc}>{reward.description}</Text>
            </View>
            <View style={styles.rewardCost}>
              <Text style={styles.costValue}>{reward.pointsCost}</Text>
              <Text style={styles.costLabel}>pts</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </Card>
  );

  const renderTransactionsCard = () => (
    <Card style={styles.transactionsCard}>
      <Text style={styles.transactionsTitle}>Points History</Text>
      {transactions.length === 0 ? (
        <Text style={styles.emptyText}>No transactions yet</Text>
      ) : (
        transactions.slice(0, 15).map((tx) => (
          <View key={tx.id} style={styles.transactionItem}>
            <View style={styles.transactionInfo}>
              <Text style={styles.transactionDesc}>{tx.description}</Text>
              <Text style={styles.transactionType}>
                {tx.type === PointTxType.EARNED && 'Earned'}
                {tx.type === PointTxType.REDEEMED && 'Redeemed'}
                {tx.type === PointTxType.EXPIRED && 'Expired'}
                {tx.type === PointTxType.REFERRAL_BONUS && 'Referral'}
                {tx.type === PointTxType.STREAK_BONUS && 'Streak Bonus'}
                {tx.type === PointTxType.ACHIEVEMENT && 'Achievement'}
              </Text>
              <Text style={styles.transactionDate}>
                {new Date(tx.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Text
              style={[
                styles.transactionAmount,
                tx.amount > 0 ? styles.positiveAmount : styles.negativeAmount,
              ]}>
              {tx.amount > 0 ? '+' : ''}
              {tx.amount} pts
            </Text>
          </View>
        ))
      )}
    </Card>
  );

  const renderTierComparison = () => {
    if (!program) return null;
    return (
      <Card style={styles.membersCard}>
        <Text style={styles.membersTitle}>Tier Benefits</Text>
        {program.tiers.map((tier) => (
          <View key={tier.tier} style={styles.tierItem}>
            <View style={styles.tierInfo}>
              <View style={[styles.tierDot, { backgroundColor: getTierColor(tier.tier) }]} />
              <Text style={styles.tierName}>{tier.tier.toUpperCase()}</Text>
            </View>
            <Text style={styles.tierThreshold}>{tier.pointsThreshold.toLocaleString()} pts</Text>
          </View>
        ))}
      </Card>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Loyalty Dashboard</Text>
          <Text style={styles.subtitle}>Earn points, unlock rewards</Text>
        </View>

        {renderStatusCard()}
        {renderStreakCard()}
        {renderBadgesCard()}
        {renderReferralCard()}
        {renderRewardsCard()}
        {renderTransactionsCard()}
        {renderTierComparison()}
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Redeem Reward</Text>
            <Text style={styles.modalSubtitle}>Select a reward to redeem your points</Text>

            <FlashList
              data={rewards.filter((r) => r.isActive)}
              keyExtractor={(item) => item.id}
              renderItem={({ item: reward }) => (
                <TouchableOpacity
                  style={[
                    styles.rewardOption,
                    selectedReward === reward.id && styles.rewardOptionSelected,
                  ]}
                  onPress={() => setSelectedReward(reward.id)}>
                  <View style={styles.rewardOptionInfo}>
                    <Text style={styles.rewardOptionName}>{reward.name}</Text>
                    <Text style={styles.rewardOptionDesc}>{reward.description}</Text>
                  </View>
                  <Text style={styles.rewardOptionCost}>{reward.pointsCost} pts</Text>
                </TouchableOpacity>
              )}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setModalVisible(false);
                  setSelectedReward('');
                }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={handleRedeemReward}>
                <Text style={styles.confirmButtonText}>Redeem</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={badgeModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setBadgeModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Badges & Achievements</Text>
            <Text style={styles.modalSubtitle}>
              {earnedBadges.length} badges earned
            </Text>
            <FlatList
              data={earnedBadges}
              keyExtractor={(item, idx) => `${idx}`}
              renderItem={({ item: badge }) => (
                <View style={styles.badgeRow}>
                  <Text style={styles.badgeIcon}>🏆</Text>
                  <Text style={styles.badgeName}>{badge}</Text>
                </View>
              )}
            />
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setBadgeModalVisible(false)}>
              <Text style={styles.cancelButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.body2.fontSize,
  },
  header: {
    padding: spacing.md,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: typography.h2.fontSize,
    fontWeight: typography.h2.fontWeight,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statusCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  tierBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  tierBadgeText: {
    color: colors.text,
    fontSize: typography.small.fontSize,
    fontWeight: '700',
  },
  memberSince: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
  },
  pointsDisplay: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  pointsValue: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.text,
  },
  pointsLabel: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  progressSection: {
    marginTop: spacing.md,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  progressText: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.lg,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: colors.text,
  },
  statLabel: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  rewardsCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  rewardsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  rewardsTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
  },
  redeemLink: {
    fontSize: typography.body.fontSize,
    color: colors.primary,
    fontWeight: '600',
  },
  rewardItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rewardInfo: {
    flex: 1,
  },
  rewardName: {
    fontSize: typography.body.fontSize,
    color: colors.text,
    fontWeight: '600',
  },
  rewardDesc: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  rewardCost: {
    alignItems: 'flex-end',
  },
  costValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  costLabel: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
  },
  transactionsCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  transactionsTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  transactionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionDesc: {
    fontSize: typography.body2.fontSize,
    color: colors.text,
  },
  transactionDate: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  transactionAmount: {
    fontSize: typography.body2.fontSize,
    fontWeight: '700',
  },
  positiveAmount: {
    color: colors.success,
  },
  negativeAmount: {
    color: colors.error,
  },
  membersCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
    marginBottom: spacing.lg,
  },
  membersTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  tierItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tierInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tierDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: spacing.sm,
  },
  tierName: {
    fontSize: typography.body2.fontSize,
    color: colors.text,
    fontWeight: '600',
  },
  tierThreshold: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
  },
  emptyText: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  transactionType: {
    fontSize: typography.fontSizeXs,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  streakCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  streakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  streakIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  streakInfo: {
    flex: 1,
  },
  streakValue: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  streakSubtext: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  streakProgress: {
    marginTop: spacing.md,
  },
  streakBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  streakFill: {
    height: '100%',
    backgroundColor: '#FF6B35',
  },
  streakMilestone: {
    fontSize: typography.fontSizeXs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  referralCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  referralTitle: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  referralDesc: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  shareButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  shareButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
  },
  referralStats: {
    fontSize: typography.fontSizeSm,
    color: colors.success,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  badgesCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  badgesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  badgesTitle: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  badgesViewAll: {
    fontSize: typography.fontSizeSm,
    color: colors.primary,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badgeItem: {
    alignItems: 'center',
    width: 60,
  },
  badgeIcon: {
    fontSize: 28,
  },
  badgeName: {
    fontSize: typography.fontSizeXs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    padding: spacing.lg,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  rewardOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  rewardOptionSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  rewardOptionInfo: {
    flex: 1,
  },
  rewardOptionName: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.text,
  },
  rewardOptionDesc: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  rewardOptionCost: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.text,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: colors.text,
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
});

export default LoyaltyDashboardScreen;
