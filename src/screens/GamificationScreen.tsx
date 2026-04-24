import React from 'react';
import { View, Text, StyleSheet, ScrollView, FlatList } from 'react-native';
import { useGamificationStore } from '../store/gamificationStore';
import { useUserStore } from '../store/userStore';
import { gamificationService } from '../services/gamificationService';
import { useTheme } from '../theme/useTheme';
import { BadgeCard, LevelProgressBar, LeaderboardList } from '../components/gamification/GamificationComponents';

export const GamificationScreen: React.FC = () => {
  const { theme } = useTheme();
  const { points, level, earnedBadges } = useGamificationStore();
  const { user } = useUserStore();
  
  const allBadges = gamificationService.getBadges();
  const leaderboard = gamificationService.getLeaderboard(points, user?.name || 'You');

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <LevelProgressBar points={points} level={level} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Your Badges</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeScroll}>
          {allBadges.map((badge) => (
            <BadgeCard 
              key={badge.id} 
              badge={badge} 
              isUnlocked={earnedBadges.includes(badge.id)} 
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <LeaderboardList data={leaderboard} />
      </View>
      
      <View style={styles.footer} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 10,
  },
  section: {
    padding: 20,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  badgeScroll: {
    paddingRight: 20,
  },
  footer: {
    height: 40,
  },
});
