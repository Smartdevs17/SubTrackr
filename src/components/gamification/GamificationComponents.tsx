import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Badge, LeaderboardEntry } from '../../types/gamification';
import { useTheme } from '../../theme/useTheme';
import { Card } from '../common/Card';

// ── BadgeCard ───────────────────────────────────────────────────────────────

interface BadgeCardProps {
  badge: Badge;
  isUnlocked: boolean;
}

export const BadgeCard: React.FC<BadgeCardProps> = ({ badge, isUnlocked }) => {
  const theme = useTheme();

  return (
    <Card style={[styles.badgeCard, !isUnlocked && { opacity: 0.5 }]}>
      <View
        style={[
          styles.badgeIconContainer,
          { backgroundColor: isUnlocked ? badge.color : theme.colors.border },
        ]}>
        <Text style={styles.badgeIcon}>{badge.icon}</Text>
      </View>
      <Text style={[styles.badgeName, { color: theme.colors.text }]} numberOfLines={1}>
        {badge.name}
      </Text>
      {!isUnlocked && (
        <Text style={[styles.lockedText, { color: theme.colors.textSecondary }]}>Locked</Text>
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
        <Text style={[styles.levelText, { color: theme.colors.text }]}>Level {level}</Text>
        <Text style={[styles.pointsText, { color: theme.colors.textSecondary }]}>
          {points} / {nextLevelPoints} XP
        </Text>
      </View>
      <View style={[styles.barBackground, { backgroundColor: theme.colors.border }]}>
        <View
          style={[
            styles.barForeground,
            {
              width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              backgroundColor: theme.colors.primary,
            },
          ]}
        />
      </View>
    </View>
  );
};

// ── LeaderboardList ────────────────────────────────────────────────────────

interface LeaderboardListProps {
  data: LeaderboardEntry[];
}

export const LeaderboardList: React.FC<LeaderboardListProps> = ({ data }) => {
  const theme = useTheme();

  const renderItem = ({ item }: { item: LeaderboardEntry }) => (
    <View
      style={[
        styles.leaderboardItem,
        item.isCurrentUser && { backgroundColor: theme.colors.primary + '20', borderRadius: 8 },
      ]}>
      <Text style={[styles.rankText, { color: theme.colors.textSecondary }]}>{item.rank}</Text>
      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: theme.colors.text }]}>
          {item.name} {item.isCurrentUser && '(You)'}
        </Text>
        <Text style={[styles.userLevel, { color: theme.colors.textSecondary }]}>
          Lvl {item.level}
        </Text>
      </View>
      <Text style={[styles.userPoints, { color: theme.colors.primary }]}>{item.points} XP</Text>
    </View>
  );

  return (
    <View style={styles.leaderboardContainer}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Global Leaderboard</Text>
      {data.map((item) => (
        <React.Fragment key={item.name}>{renderItem({ item })}</React.Fragment>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  badgeCard: {
    width: 100,
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
  progressContainer: {
    marginVertical: 16,
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
  leaderboardContainer: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  leaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  rankText: {
    width: 30,
    fontSize: 16,
    fontWeight: 'bold',
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
  userPoints: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});
