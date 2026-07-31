import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Switch,
  Alert,
  ScrollView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Badge,
  LeaderboardCategory,
  LeaderboardEntry,
  RewardItem,
  GamificationAnalytics,
  GamificationConfig,
  UserProgress,
} from '../../types/gamification';
import { useTheme } from '../../theme/useTheme';
import { Card } from '../common/Card';
import { gamificationService } from '../../services/gamificationService';

// ── BadgeCard ───────────────────────────────────────────────────────────────

interface BadgeCardProps {
  badge: Badge;
  isUnlocked: boolean;
  userProgress: UserProgress;
}

export const BadgeCard: React.FC<BadgeCardProps> = ({ badge, isUnlocked, userProgress }) => {
  const theme = useTheme();

  const handleShare = async () => {
    if (!isUnlocked) return;
    await gamificationService.shareBadge(badge, userProgress);
  };

  return (
    <Card style={[styles.badgeCard, !isUnlocked && { opacity: 0.5 }]}>
      <View
        style={[
          styles.badgeIconContainer,
          { backgroundColor: isUnlocked ? badge.color : theme.colors.border.default },
        ]}>
        <Text style={styles.badgeIcon}>{badge.icon}</Text>
      </View>
      <Text style={[styles.badgeName, { color: theme.colors.text.primary }]} numberOfLines={1}>
        {badge.name}
      </Text>
      {!isUnlocked ? (
        <Text style={[styles.lockedText, { color: theme.colors.text.secondary }]}>Locked</Text>
      ) : (
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
          <Text style={[styles.shareBtnText, { color: theme.colors.brand.primary }]}>📤 Share</Text>
        </TouchableOpacity>
      )}
    </Card>
  );
};

// ── LevelProgressBar ────────────────────────────────────────────────────────

interface LevelProgressBarProps {
  points: number;
  level: number;
}

export const LevelProgressBar: React.FC<LevelProgressBarProps> = ({ points, level }) => {
  const theme = useTheme();
  const currentLevelPoints = Math.floor(100 * Math.pow(level - 1, 1.5));
  const nextLevelPoints = Math.floor(100 * Math.pow(level, 1.5));
  const progress = (points - currentLevelPoints) / (nextLevelPoints - currentLevelPoints);

  return (
    <View style={styles.progressContainer}>
      <View style={styles.levelHeader}>
        <Text style={[styles.levelText, { color: theme.colors.text.primary }]}>Level {level}</Text>
        <Text style={[styles.pointsText, { color: theme.colors.text.secondary }]}>
          {points} / {nextLevelPoints} XP
        </Text>
      </View>
      <View style={[styles.barBackground, { backgroundColor: theme.colors.border.default }]}>
        <View
          style={[
            styles.barForeground,
            {
              width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              backgroundColor: theme.colors.brand.primary,
            },
          ]}
        />
      </View>
    </View>
  );
};

// ── RewardCard & RewardsList ────────────────────────────────────────────────

interface RewardCardProps {
  item: RewardItem;
  onClaim: (id: string) => void;
  onRedeem: (id: string) => void;
}

export const RewardCard: React.FC<RewardCardProps> = ({ item, onClaim, onRedeem }) => {
  const theme = useTheme();

  const handleCopyCode = async () => {
    if (!item.code) return;
    try {
      await Clipboard.setStringAsync(item.code);
      Alert.alert('Code Copied!', `Coupon code ${item.code} copied to clipboard.`);
    } catch {
      Alert.alert('Copy failed', 'Could not copy to clipboard.');
    }
  };

  const getStatusBadge = () => {
    if (item.isRedeemed) {
      return (
        <View style={[styles.statusBadge, { backgroundColor: '#64748b' }]}>
          <Text style={styles.statusBadgeText}>Redeemed</Text>
        </View>
      );
    }
    if (item.isClaimed) {
      return (
        <View style={[styles.statusBadge, { backgroundColor: '#10b981' }]}>
          <Text style={styles.statusBadgeText}>Ready to Use</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <Card style={[styles.rewardCard, item.isRedeemed && { opacity: 0.6 }]}>
      <View style={styles.rewardHeader}>
        <View style={styles.rewardTypeBadge}>
          <Text style={styles.rewardTypeText}>
            {item.type === 'discount' ? '🏷️ Discount' : item.type === 'credit' ? '💰 Credits' : '🎖️ Badge'}
          </Text>
        </View>
        {getStatusBadge()}
      </View>
      <Text style={[styles.rewardTitle, { color: theme.colors.text.primary }]}>{item.title}</Text>
      <Text style={[styles.rewardDesc, { color: theme.colors.text.secondary }]}>{item.description}</Text>

      {item.isClaimed && !item.isRedeemed && item.code && (
        <TouchableOpacity
          style={[styles.codeContainer, { backgroundColor: theme.colors.background.secondary }]}
          onPress={handleCopyCode}>
          <Text style={[styles.codeText, { color: theme.colors.brand.primary }]}>{item.code}</Text>
          <Text style={styles.copyHint}>Tap to Copy</Text>
        </TouchableOpacity>
      )}

      <View style={styles.rewardActions}>
        {!item.isClaimed && !item.isRedeemed && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.brand.primary }]}
            onPress={() => onClaim(item.id)}>
            <Text style={styles.actionBtnText}>Claim Reward</Text>
          </TouchableOpacity>
        )}
        {item.isClaimed && !item.isRedeemed && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#3b82f6' }]}
            onPress={() => onRedeem(item.id)}>
            <Text style={styles.actionBtnText}>Mark Redeemed</Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );
};

interface RewardsListProps {
  rewards: RewardItem[];
  onClaim: (id: string) => void;
  onRedeem: (id: string) => void;
}

export const RewardsList: React.FC<RewardsListProps> = ({ rewards, onClaim, onRedeem }) => {
  const theme = useTheme();

  if (rewards.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: theme.colors.text.secondary }]}>
          No rewards unlocked yet. Complete achievements to earn discounts and loyalty credits!
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.rewardsList}>
      {rewards.map((reward) => (
        <RewardCard key={reward.id} item={reward} onClaim={onClaim} onRedeem={onRedeem} />
      ))}
    </View>
  );
};

// ── GamificationAnalyticsCard ───────────────────────────────────────────────

interface GamificationAnalyticsCardProps {
  analytics: GamificationAnalytics;
}

export const GamificationAnalyticsCard: React.FC<GamificationAnalyticsCardProps> = ({ analytics }) => {
  const theme = useTheme();

  return (
    <Card style={styles.analyticsCard}>
      <Text style={[styles.analyticsTitle, { color: theme.colors.text.primary }]}>
        📊 Engagement & Progress
      </Text>
      
      <View style={styles.statsGrid}>
        <View style={[styles.statBox, { backgroundColor: theme.colors.background.secondary }]}>
          <Text style={[styles.statValue, { color: theme.colors.brand.primary }]}>
            {analytics.totalPointsEarned}
          </Text>
          <Text style={[styles.statLabel, { color: theme.colors.text.secondary }]}>Total XP</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: theme.colors.background.secondary }]}>
          <Text style={[styles.statValue, { color: '#f59e0b' }]}>
            {analytics.longestStreak} 🔥
          </Text>
          <Text style={[styles.statLabel, { color: theme.colors.text.secondary }]}>Max Streak</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: theme.colors.background.secondary }]}>
          <Text style={[styles.statValue, { color: '#10b981' }]}>
            {analytics.totalAchievementsUnlocked}
          </Text>
          <Text style={[styles.statLabel, { color: theme.colors.text.secondary }]}>Achievements</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: theme.colors.background.secondary }]}>
          <Text style={[styles.statValue, { color: '#8b5cf6' }]}>
            {analytics.totalRewardsClaimed}
          </Text>
          <Text style={[styles.statLabel, { color: theme.colors.text.secondary }]}>Rewards</Text>
        </View>
      </View>

      <View style={styles.completionContainer}>
        <View style={styles.completionHeader}>
          <Text style={[styles.completionLabel, { color: theme.colors.text.primary }]}>
            Completion Rate
          </Text>
          <Text style={[styles.completionValue, { color: theme.colors.brand.primary }]}>
            {analytics.completionRate}%
          </Text>
        </View>
        <View style={[styles.barBackground, { backgroundColor: theme.colors.border.default }]}>
          <View
            style={[
              styles.barForeground,
              {
                width: `${analytics.completionRate}%`,
                backgroundColor: '#10b981',
              },
            ]}
          />
        </View>
      </View>
    </Card>
  );
};

// ── LeaderboardList ────────────────────────────────────────────────────────

interface LeaderboardListProps {
  data: LeaderboardEntry[];
  category: LeaderboardCategory;
  onSelectCategory: (cat: LeaderboardCategory) => void;
}

export const LeaderboardList: React.FC<LeaderboardListProps> = ({
  data,
  category,
  onSelectCategory,
}) => {
  const theme = useTheme();

  const renderRankBadge = (rank: number) => {
    if (rank === 1) return <Text style={styles.podiumIcon}>🥇</Text>;
    if (rank === 2) return <Text style={styles.podiumIcon}>🥈</Text>;
    if (rank === 3) return <Text style={styles.podiumIcon}>🥉</Text>;
    return <Text style={[styles.rankText, { color: theme.colors.text.secondary }]}>{rank}</Text>;
  };

  const renderItem = ({ item }: { item: LeaderboardEntry }) => (
    <View
      style={[
        styles.leaderboardItem,
        { borderBottomColor: theme.colors.border.default },
        item.isCurrentUser && {
          backgroundColor: theme.colors.brand.primary + '20',
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.brand.primary,
        },
      ]}>
      <View style={styles.rankContainer}>{renderRankBadge(item.rank)}</View>
      <Text style={styles.avatarText}>{item.avatar || '👤'}</Text>
      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: theme.colors.text.primary }]}>
          {item.name} {item.isCurrentUser && '(You)'}
        </Text>
        <Text style={[styles.userLevel, { color: theme.colors.text.secondary }]}>
          Lvl {item.level} {item.streak ? `• 🔥 ${item.streak}d` : ''}
        </Text>
      </View>
      <View style={styles.scoreContainer}>
        <Text style={[styles.userPoints, { color: theme.colors.brand.primary }]}>
          {category === 'streaks' ? `${item.streak || 0} days` : `${item.points} XP`}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.leaderboardContainer}>
      <View style={styles.leaderboardHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text.primary }]}>
          🏆 Leaderboard
        </Text>
      </View>

      <View style={[styles.tabBar, { backgroundColor: theme.colors.background.secondary }]}>
        {(['all_time', 'weekly', 'streaks'] as LeaderboardCategory[]).map((cat) => {
          const isActive = category === cat;
          const label = cat === 'all_time' ? 'All Time' : cat === 'weekly' ? 'Weekly' : 'Streaks';
          return (
            <TouchableOpacity
              key={cat}
              style={[styles.tabItem, isActive && { backgroundColor: theme.colors.brand.primary }]}
              onPress={() => onSelectCategory(cat)}>
              <Text style={[styles.tabText, { color: isActive ? '#fff' : theme.colors.text.secondary }]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {data.map((item) => (
        <React.Fragment key={`${item.rank}-${item.name}`}>{renderItem({ item })}</React.Fragment>
      ))}
    </View>
  );
};

// ── GamificationConfigModal ─────────────────────────────────────────────────

interface GamificationConfigModalProps {
  visible: boolean;
  config: GamificationConfig;
  onClose: () => void;
  onUpdate: (patch: Partial<GamificationConfig>) => void;
  onReset: () => void;
}

export const GamificationConfigModal: React.FC<GamificationConfigModalProps> = ({
  visible,
  config,
  onClose,
  onUpdate,
  onReset,
}) => {
  const theme = useTheme();

  const confirmReset = () => {
    Alert.alert(
      'Reset Gamification Progress?',
      'This will clear all earned XP, levels, badges, and claimed rewards. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            onReset();
            onClose();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.background.primary }]}>
          <Text style={[styles.modalTitle, { color: theme.colors.text.primary }]}>
            ⚙️ Gamification Settings
          </Text>

          <ScrollView style={styles.settingsScroll}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text.primary }]}>
                  Sound Effects
                </Text>
                <Text style={[styles.settingDesc, { color: theme.colors.text.secondary }]}>
                  Play audio cues on level ups and badges
                </Text>
              </View>
              <Switch
                value={config.soundEffectsEnabled}
                onValueChange={(val) => onUpdate({ soundEffectsEnabled: val })}
                trackColor={{ false: '#767577', true: theme.colors.brand.primary }}
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text.primary }]}>
                  Achievement Notifications
                </Text>
                <Text style={[styles.settingDesc, { color: theme.colors.text.secondary }]}>
                  Show local alerts when unlocking milestones
                </Text>
              </View>
              <Switch
                value={config.notificationsEnabled}
                onValueChange={(val) => onUpdate({ notificationsEnabled: val })}
                trackColor={{ false: '#767577', true: theme.colors.brand.primary }}
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text.primary }]}>
                  Leaderboard Visibility
                </Text>
                <Text style={[styles.settingDesc, { color: theme.colors.text.secondary }]}>
                  Display your username and XP on public leaderboards
                </Text>
              </View>
              <Switch
                value={config.showOnLeaderboard}
                onValueChange={(val) => onUpdate({ showOnLeaderboard: val })}
                trackColor={{ false: '#767577', true: theme.colors.brand.primary }}
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text.primary }]}>
                  Daily Streak Reminders
                </Text>
                <Text style={[styles.settingDesc, { color: theme.colors.text.secondary }]}>
                  Remind me daily to check subscription status and keep streaks
                </Text>
              </View>
              <Switch
                value={config.dailyReminderEnabled}
                onValueChange={(val) => onUpdate({ dailyReminderEnabled: val })}
                trackColor={{ false: '#767577', true: theme.colors.brand.primary }}
              />
            </View>

            <TouchableOpacity style={styles.resetBtn} onPress={confirmReset}>
              <Text style={styles.resetBtnText}>⚠️ Reset All Progress</Text>
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: theme.colors.brand.primary }]}
            onPress={onClose}>
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  badgeCard: {
    width: 110,
    padding: 12,
    alignItems: 'center',
    marginRight: 12,
  },
  badgeIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeIcon: {
    fontSize: 24,
  },
  badgeName: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  lockedText: {
    fontSize: 10,
    marginTop: 4,
  },
  shareBtn: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  shareBtnText: {
    fontSize: 10,
    fontWeight: '600',
  },
  progressContainer: {
    marginVertical: 8,
  },
  levelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  levelText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  pointsText: {
    fontSize: 14,
  },
  barBackground: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  barForeground: {
    height: '100%',
  },
  rewardCard: {
    padding: 16,
    marginBottom: 12,
  },
  rewardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rewardTypeBadge: {
    backgroundColor: '#3b82f620',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  rewardTypeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3b82f6',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  rewardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  rewardDesc: {
    fontSize: 14,
    marginBottom: 12,
  },
  codeContainer: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3b82f640',
    borderStyle: 'dashed',
  },
  codeText: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  copyHint: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  rewardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
  },
  rewardsList: {
    marginTop: 8,
  },
  analyticsCard: {
    padding: 16,
    marginBottom: 16,
  },
  analyticsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statBox: {
    width: '48%',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  completionContainer: {
    marginTop: 4,
  },
  completionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  completionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  completionValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  leaderboardContainer: {
    marginTop: 16,
  },
  leaderboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  leaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  rankContainer: {
    width: 34,
    alignItems: 'center',
  },
  podiumIcon: {
    fontSize: 20,
  },
  rankText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  avatarText: {
    fontSize: 20,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
  },
  userLevel: {
    fontSize: 12,
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  userPoints: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  settingsScroll: {
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#33415520',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  settingDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  resetBtn: {
    marginTop: 24,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#ef444420',
    alignItems: 'center',
  },
  resetBtnText: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 14,
  },
  closeBtn: {
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
