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
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useLoyaltyStore } from '../store/loyaltyStore';
import { useWalletStore } from '../store/walletStore';
import { Card } from '../components/common/Card';
import { LoyaltyTier, TierBenefits } from '../types/loyalty';
import {
  StreakCard,
  AchievementsList,
  TierProgressBar,
  RewardsCatalog,
} from '../components/gamification/LoyaltyComponents';

const LoyaltyDashboardScreen: React.FC = () => {
  const {
    loyaltyStatus,
    transactions,
    rewards,
    program,
    streak,
    achievements,
    newlyUnlocked,
    isLoading,
    initializeProgram,
    redeemPoints,
    clearNewlyUnlocked,
    evaluateAchievements,
  } = useLoyaltyStore();
  const { address } = useWalletStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedReward, setSelectedReward] = useState<string>('');

  // Initialize program on mount
  useEffect(() => {
    if (!program) initializeProgram();
  }, [program, initializeProgram]);

  // Retroactive achievement evaluation on mount
  useEffect(() => {
    evaluateAchievements();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tier upgrade check every minute
  useEffect(() => {
    if (!address || !loyaltyStatus) return;
    const timer = setInterval(() => useLoyaltyStore.getState().checkTierUpgrade(), 60_000);
    return () => clearInterval(timer);
  }, [address, loyaltyStatus]);

  // Show newly unlocked achievement toasts
  useEffect(() => {
    if (newlyUnlocked.length === 0) return;
    const names = newlyUnlocked.map((a) => `${a.icon} ${a.name}`).join('\n');
    Alert.alert('Achievement Unlocked! 🎉', names);
    clearNewlyUnlocked();
  }, [newlyUnlocked, clearNewlyUnlocked]);

  const handleRedeemReward = useCallback(async () => {
    if (!selectedReward) {
      Alert.alert('Error', 'Please select a reward');
      return;
    }
    const success = await redeemPoints(selectedReward);
    Alert.alert(success ? 'Success' : 'Error', success ? 'Reward redeemed!' : 'Not enough points or reward unavailable');
    setModalVisible(false);
    setSelectedReward('');
  }, [selectedReward, redeemPoints]);

  const getTierColor = (tier: LoyaltyTier): string => {
    switch (tier) {
      case LoyaltyTier.PLATINUM: return '#E5E4E2';
      case LoyaltyTier.GOLD: return '#FFD700';
      case LoyaltyTier.SILVER: return '#C0C0C0';
      default: return '#CD7F32';
    }
  };

  const getNextTierInfo = (): TierBenefits | null => {
    if (!program || !loyaltyStatus) return null;
    const idx = program.tiers.findIndex((t) => t.tier === loyaltyStatus.tier);
    return idx >= program.tiers.length - 1 ? null : program.tiers[idx + 1];
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

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
          <Text style={styles.pointsValue}>{loyaltyStatus.points.toLocaleString()}</Text>
          <Text style={styles.pointsLabel}>Available Points</Text>
        </View>

        {/* Tier progress bar */}
        <TierProgressBar
          currentTier={loyaltyStatus.tier}
          lifetimePoints={loyaltyStatus.lifetimePoints}
        />

        {nextTier && pointsToNextTier > 0 && (
          <View style={styles.progressSection}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, (1 - pointsToNextTier / nextTier.pointsThreshold) * 100)}%` },
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

  const renderTransactionsCard = () => (
    <Card style={styles.transactionsCard}>
      <Text style={styles.transactionsTitle}>Points History</Text>
      {transactions.length === 0 ? (
        <Text style={styles.emptyText}>No transactions yet</Text>
      ) : (
        transactions.slice(0, 10).map((tx) => (
          <View key={tx.id} style={styles.transactionItem}>
            <View style={styles.transactionInfo}>
              <Text style={styles.transactionDesc}>{tx.description}</Text>
              <Text style={styles.transactionDate}>
                {new Date(tx.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Text style={[styles.transactionAmount, tx.amount > 0 ? styles.positiveAmount : styles.negativeAmount]}>
              {tx.amount > 0 ? '+' : ''}{tx.amount} pts
            </Text>
          </View>
        ))
      )}
    </Card>
  );

  const renderTierBenefits = () => {
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

        {/* Status + tier progress */}
        {renderStatusCard()}

        {/* Streak card */}
        <View style={styles.section}>
          <StreakCard streak={streak} />
        </View>

        {/* Achievements */}
        <View style={styles.section}>
          <AchievementsList achievements={achievements} />
        </View>

        {/* Rewards catalog with inline redemption */}
        <View style={styles.section}>
          <RewardsCatalog
            rewards={rewards}
            currentPoints={loyaltyStatus?.points ?? 0}
            onRedeem={(id) => {
              setSelectedReward(id);
              setModalVisible(true);
            }}
          />
        </View>

        {/* Points history */}
        {renderTransactionsCard()}

        {/* Tier benefits */}
        {renderTierBenefits()}
      </ScrollView>

      {/* Redemption confirmation modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Redeem Reward</Text>
            <Text style={styles.modalSubtitle}>Select a reward to redeem your points</Text>

            <FlatList
              data={rewards.filter((r) => r.isActive)}
              keyExtractor={(item) => item.id}
              renderItem={({ item: reward }) => (
                <TouchableOpacity
                  style={[styles.rewardOption, selectedReward === reward.id && styles.rewardOptionSelected]}
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
                onPress={() => { setModalVisible(false); setSelectedReward(''); }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={handleRedeemReward}>
                <Text style={styles.confirmButtonText}>Redeem</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: typography.fontSizeMd },
  header: { padding: spacing.md, paddingTop: spacing.lg },
  title: { fontSize: typography.fontSizeXl, fontWeight: typography.fontWeightBold, color: colors.text },
  subtitle: { fontSize: typography.fontSizeMd, color: colors.textSecondary, marginTop: spacing.xs },
  section: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  statusCard: { padding: spacing.md, margin: spacing.md, marginTop: 0 },
  tierHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  tierBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: borderRadius.md },
  tierBadgeText: { color: colors.text, fontSize: typography.fontSizeSm, fontWeight: typography.fontWeightBold },
  memberSince: { fontSize: typography.fontSizeSm, color: colors.textSecondary },
  pointsDisplay: { alignItems: 'center', paddingVertical: spacing.lg },
  pointsValue: { fontSize: 48, fontWeight: typography.fontWeightBold, color: colors.text },
  pointsLabel: { fontSize: typography.fontSizeMd, color: colors.textSecondary, marginTop: spacing.xs },
  progressSection: { marginTop: spacing.md },
  progressBar: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.lg },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: typography.fontSizeLg, fontWeight: typography.fontWeightBold, color: colors.text },
  statLabel: { fontSize: typography.fontSizeSm, color: colors.textSecondary, marginTop: spacing.xs },
  transactionsCard: { padding: spacing.md, margin: spacing.md, marginTop: 0 },
  transactionsTitle: { fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightBold, color: colors.text, marginBottom: spacing.md },
  transactionItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  transactionInfo: { flex: 1 },
  transactionDesc: { fontSize: typography.fontSizeSm, color: colors.text },
  transactionDate: { fontSize: typography.fontSizeXs, color: colors.textSecondary, marginTop: spacing.xs },
  transactionAmount: { fontSize: typography.fontSizeSm, fontWeight: typography.fontWeightBold },
  positiveAmount: { color: colors.success },
  negativeAmount: { color: colors.danger },
  membersCard: { padding: spacing.md, margin: spacing.md, marginTop: 0, marginBottom: spacing.lg },
  membersTitle: { fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightBold, color: colors.text, marginBottom: spacing.md },
  tierItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  tierInfo: { flexDirection: 'row', alignItems: 'center' },
  tierDot: { width: 12, height: 12, borderRadius: 6, marginRight: spacing.sm },
  tierName: { fontSize: typography.fontSizeSm, color: colors.text, fontWeight: typography.fontWeightMedium },
  tierThreshold: { fontSize: typography.fontSizeSm, color: colors.textSecondary },
  emptyText: { fontSize: typography.fontSizeMd, color: colors.textSecondary, textAlign: 'center' },
  emptySubtext: { fontSize: typography.fontSizeSm, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.lg, borderTopRightRadius: borderRadius.lg, padding: spacing.lg, maxHeight: '70%' },
  modalTitle: { fontSize: typography.fontSizeLg, fontWeight: typography.fontWeightBold, color: colors.text, marginBottom: spacing.xs },
  modalSubtitle: { fontSize: typography.fontSizeMd, color: colors.textSecondary, marginBottom: spacing.lg },
  rewardOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, backgroundColor: colors.background },
  rewardOptionSelected: { borderWidth: 2, borderColor: colors.primary },
  rewardOptionInfo: { flex: 1 },
  rewardOptionName: { fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightMedium, color: colors.text },
  rewardOptionDesc: { fontSize: typography.fontSizeSm, color: colors.textSecondary, marginTop: spacing.xs },
  rewardOptionCost: { fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightBold, color: colors.primary },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg, gap: spacing.md },
  cancelButton: { flex: 1, backgroundColor: colors.background, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center' },
  cancelButtonText: { color: colors.text, fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightMedium },
  confirmButton: { flex: 1, backgroundColor: colors.primary, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center' },
  confirmButtonText: { color: colors.text, fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightBold },
});

export default LoyaltyDashboardScreen;
