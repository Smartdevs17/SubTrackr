/**
 * Gamification components for the Loyalty Dashboard.
 * Issue #394: streaks, achievements, rewards catalog, progress bars.
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Share,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { Card } from '../common/Card';
import { Achievement, StreakData } from '../../store/loyaltyStore';
import { Reward, LoyaltyTier } from '../../types/loyalty';

// ── StreakCard ───────────────────────────────────────────────────────────────

interface StreakCardProps {
  streak: StreakData;
  onShare?: () => void;
}

export const StreakCard: React.FC<StreakCardProps> = ({ streak, onShare }) => {
  const theme = useTheme();

  const handleShare = useCallback(async () => {
    if (onShare) {
      onShare();
      return;
    }
    await Share.share({
      message: `🔥 I'm on a ${streak.current}-day payment streak on SubTrackr! My longest is ${streak.longest} days. Join me!`,
    });
  }, [streak, onShare]);

  return (
    <Card style={styles.streakCard}>
      <View style={styles.streakRow}>
        <Text style={styles.streakFlame}>🔥</Text>
        <View style={styles.streakInfo}>
          <Text style={[styles.streakCount, { color: theme.colors.primary }]}>
            {streak.current}
          </Text>
          <Text style={[styles.streakLabel, { color: theme.colors.textSecondary }]}>
            day streak
          </Text>
        </View>
        <View style={styles.streakBest}>
          <Text style={[styles.streakBestLabel, { color: theme.colors.textSecondary }]}>Best</Text>
          <Text style={[styles.streakBestCount, { color: theme.colors.text.primary }]}>
            {streak.longest}
          </Text>
        </View>
      </View>
      {streak.frozenUntil && (
        <Text style={[styles.frozenBadge, { color: '#4FC3F7' }]}>
          ❄️ Streak frozen until {streak.frozenUntil}
        </Text>
      )}
      <TouchableOpacity
        style={[styles.shareBtn, { borderColor: theme.colors.primary }]}
        onPress={handleShare}
        accessibilityLabel="Share streak"
        accessibilityRole="button">
        <Text style={[styles.shareBtnText, { color: theme.colors.primary }]}>Share 🔗</Text>
      </TouchableOpacity>
    </Card>
  );
};

// ── AchievementCard ──────────────────────────────────────────────────────────

interface AchievementCardProps {
  achievement: Achievement;
  onShare?: (achievement: Achievement) => void;
}

export const AchievementCard: React.FC<AchievementCardProps> = ({ achievement, onShare }) => {
  const theme = useTheme();
  const isUnlocked = !!achievement.unlockedAt;

  const handleShare = useCallback(async () => {
    if (onShare) {
      onShare(achievement);
      return;
    }
    if (!isUnlocked) return;
    await Share.share({
      message: `${achievement.icon} I just unlocked "${achievement.name}" on SubTrackr! ${achievement.description}`,
    });
  }, [achievement, isUnlocked, onShare]);

  return (
    <Card style={[styles.achievementCard, !isUnlocked && { opacity: 0.45 }]}>
      <View
        style={[
          styles.achievementIcon,
          { backgroundColor: isUnlocked ? theme.colors.primary + '22' : theme.colors.border.default },
        ]}>
        <Text style={styles.achievementEmoji}>{achievement.icon}</Text>
      </View>
      <Text style={[styles.achievementName, { color: theme.colors.text.primary }]} numberOfLines={1}>
        {achievement.name}
      </Text>
      <Text
        style={[styles.achievementDesc, { color: theme.colors.textSecondary }]}
        numberOfLines={2}>
        {achievement.description}
      </Text>
      {isUnlocked ? (
        <TouchableOpacity
          onPress={handleShare}
          accessibilityLabel={`Share achievement ${achievement.name}`}
          accessibilityRole="button">
          <Text style={[styles.shareSmall, { color: theme.colors.primary }]}>Share 🔗</Text>
        </TouchableOpacity>
      ) : (
        <Text style={[styles.lockedText, { color: theme.colors.textSecondary }]}>Locked</Text>
      )}
    </Card>
  );
};

// ── TierProgressBar ──────────────────────────────────────────────────────────

const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  [LoyaltyTier.BRONZE]: 0,
  [LoyaltyTier.SILVER]: 1000,
  [LoyaltyTier.GOLD]: 5000,
  [LoyaltyTier.PLATINUM]: 15000,
};

const NEXT_TIER: Partial<Record<LoyaltyTier, LoyaltyTier>> = {
  [LoyaltyTier.BRONZE]: LoyaltyTier.SILVER,
  [LoyaltyTier.SILVER]: LoyaltyTier.GOLD,
  [LoyaltyTier.GOLD]: LoyaltyTier.PLATINUM,
};

interface TierProgressBarProps {
  currentTier: LoyaltyTier;
  lifetimePoints: number;
}

export const TierProgressBar: React.FC<TierProgressBarProps> = ({
  currentTier,
  lifetimePoints,
}) => {
  const theme = useTheme();
  const nextTier = NEXT_TIER[currentTier];

  if (!nextTier) {
    return (
      <View style={styles.progressContainer}>
        <Text style={[styles.progressLabel, { color: theme.colors.text.primary }]}>
          🏆 Maximum tier reached!
        </Text>
      </View>
    );
  }

  const from = TIER_THRESHOLDS[currentTier];
  const to = TIER_THRESHOLDS[nextTier];
  const progress = Math.min(1, Math.max(0, (lifetimePoints - from) / (to - from)));

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <Text style={[styles.progressLabel, { color: theme.colors.text.primary }]}>
          {currentTier.toUpperCase()} → {nextTier.toUpperCase()}
        </Text>
        <Text style={[styles.progressPoints, { color: theme.colors.textSecondary }]}>
          {lifetimePoints.toLocaleString()} / {to.toLocaleString()} pts
        </Text>
      </View>
      <View style={[styles.barBg, { backgroundColor: theme.colors.border.default }]}>
        <View
          style={[
            styles.barFg,
            { width: `${progress * 100}%`, backgroundColor: theme.colors.primary },
          ]}
        />
      </View>
      <Text style={[styles.progressRemaining, { color: theme.colors.textSecondary }]}>
        {(to - lifetimePoints).toLocaleString()} pts to {nextTier}
      </Text>
    </View>
  );
};

// ── RewardsCatalog ───────────────────────────────────────────────────────────

interface RewardsCatalogProps {
  rewards: Reward[];
  currentPoints: number;
  onRedeem: (rewardId: string) => void;
}

export const RewardsCatalog: React.FC<RewardsCatalogProps> = ({
  rewards,
  currentPoints,
  onRedeem,
}) => {
  const theme = useTheme();

  const renderReward = useCallback(
    ({ item }: { item: Reward }) => {
      const canRedeem = item.isActive && currentPoints >= item.pointsCost;
      return (
        <Card style={styles.rewardCard}>
          <View style={styles.rewardHeader}>
            <Text style={[styles.rewardName, { color: theme.colors.text.primary }]}>{item.name}</Text>
            <Text style={[styles.rewardCost, { color: theme.colors.primary }]}>
              {item.pointsCost.toLocaleString()} pts
            </Text>
          </View>
          <Text style={[styles.rewardDesc, { color: theme.colors.textSecondary }]}>
            {item.description}
          </Text>
          <TouchableOpacity
            style={[
              styles.redeemBtn,
              {
                backgroundColor: canRedeem ? theme.colors.primary : theme.colors.border.default,
              },
            ]}
            onPress={() => canRedeem && onRedeem(item.id)}
            disabled={!canRedeem}
            accessibilityLabel={`Redeem ${item.name}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canRedeem }}>
            <Text
              style={[
                styles.redeemBtnText,
                { color: canRedeem ? '#fff' : theme.colors.textSecondary },
              ]}>
              {canRedeem
                ? 'Redeem'
                : `Need ${(item.pointsCost - currentPoints).toLocaleString()} more`}
            </Text>
          </TouchableOpacity>
        </Card>
      );
    },
    [currentPoints, onRedeem, theme]
  );

  return (
    <View>
      <Text style={[styles.catalogTitle, { color: theme.colors.text.primary }]}>Rewards Catalog</Text>
      <FlatList
        data={rewards.filter((r) => r.isActive)}
        keyExtractor={(r) => r.id}
        renderItem={renderReward}
        scrollEnabled={false}
      />
    </View>
  );
};

// ── AchievementsList ─────────────────────────────────────────────────────────

interface AchievementsListProps {
  achievements: Achievement[];
}

export const AchievementsList: React.FC<AchievementsListProps> = ({ achievements }) => {
  const theme = useTheme();
  return (
    <View>
      <Text style={[styles.catalogTitle, { color: theme.colors.text.primary }]}>Achievements</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {achievements.map((a) => (
          <AchievementCard key={a.id} achievement={a} />
        ))}
      </ScrollView>
    </View>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  streakCard: { padding: 16, marginBottom: 12 },
  streakRow: { flexDirection: 'row', alignItems: 'center' },
  streakFlame: { fontSize: 36, marginRight: 12 },
  streakInfo: { flex: 1 },
  streakCount: { fontSize: 40, fontWeight: 'bold' },
  streakLabel: { fontSize: 14 },
  streakBest: { alignItems: 'flex-end' },
  streakBestLabel: { fontSize: 12 },
  streakBestCount: { fontSize: 20, fontWeight: 'bold' },
  frozenBadge: { marginTop: 8, fontSize: 13 },
  shareBtn: { marginTop: 12, borderWidth: 1, borderRadius: 8, padding: 8, alignItems: 'center' },
  shareBtnText: { fontWeight: '600' },

  achievementCard: { width: 110, padding: 12, alignItems: 'center', marginRight: 10 },
  achievementIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  achievementEmoji: { fontSize: 26 },
  achievementName: { fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  achievementDesc: { fontSize: 10, textAlign: 'center', marginTop: 4 },
  shareSmall: { fontSize: 11, marginTop: 6 },
  lockedText: { fontSize: 10, marginTop: 6 },

  progressContainer: { marginVertical: 12 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 14, fontWeight: '600' },
  progressPoints: { fontSize: 12 },
  barBg: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFg: { height: '100%' },
  progressRemaining: { fontSize: 11, marginTop: 4 },

  catalogTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12, marginTop: 8 },
  rewardCard: { padding: 14, marginBottom: 10 },
  rewardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  rewardName: { fontSize: 16, fontWeight: '600' },
  rewardCost: { fontSize: 14, fontWeight: 'bold' },
  rewardDesc: { fontSize: 13, marginBottom: 10 },
  redeemBtn: { borderRadius: 8, padding: 10, alignItems: 'center' },
  redeemBtnText: { fontWeight: '600', fontSize: 14 },
});
