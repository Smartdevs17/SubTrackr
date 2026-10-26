import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useGamificationStore } from '../store/gamificationStore';
import { useUserStore } from '../store/userStore';
import { gamificationService } from '../services/gamificationService';
import { useTheme } from '../theme/useTheme';
import { LeaderboardCategory } from '../types/gamification';
import { useAccessibilityAnnouncement } from '../hooks/useAccessibilityAnnouncement';
import { A11yRole } from '../utils/accessibility';
import {
  BadgeCard,
  LevelProgressBar,
  LeaderboardList,
  GamificationAnalyticsCard,
  RewardsList,
  GamificationConfigModal,
} from '../components/gamification/GamificationComponents';

type GamificationTab = 'dashboard' | 'rewards' | 'leaderboard';

/** The top-level tabs, in display order. Drives both render and a11y labels. */
const TABS: readonly { key: GamificationTab; label: string; glyph: string }[] = [
  { key: 'dashboard', label: 'Dashboard', glyph: '📊' },
  { key: 'rewards', label: 'Rewards', glyph: '🎁' },
  { key: 'leaderboard', label: 'Leaderboard', glyph: '🏆' },
];

export const GamificationScreen: React.FC = () => {
  const theme = useTheme();
  const { announceIfChanged } = useAccessibilityAnnouncement();
  const {
    points,
    level,
    earnedBadges,
    earnedRewards,
    config,
    claimReward,
    redeemReward,
    updateConfig,
    resetProgress,
    getAnalytics,
  } = useGamificationStore();
  const { user } = useUserStore();

  const [activeTab, setActiveTab] = useState<GamificationTab>('dashboard');
  const [leaderboardCategory, setLeaderboardCategory] = useState<LeaderboardCategory>('all_time');
  const [settingsVisible, setSettingsVisible] = useState(false);

  const allBadges = gamificationService.getBadges();
  const leaderboard = gamificationService.getLeaderboard(
    points,
    user?.name || 'You',
    leaderboardCategory,
    useGamificationStore.getState().streak
  );
  const analytics = getAnalytics();

  const handleShareProgress = async () => {
    await gamificationService.shareLevel(useGamificationStore.getState());
  };

  // Switching tabs changes most of the screen, so announce it rather than
  // leaving a screen reader user to infer it from the focus position.
  const activeTabLabel = TABS.find((tab) => tab.key === activeTab)?.label ?? activeTab;
  useEffect(() => {
    announceIfChanged(`${activeTabLabel} tab selected`);
  }, [activeTabLabel, announceIfChanged]);

  const pendingRewardCount = earnedRewards.filter((reward) => !reward.isClaimed).length;

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background.primary }]}
      accessibilityLabel="Gamification hub"
      testID="gamification-screen">
      <View style={styles.topHeader}>
        <View>
          <Text
            style={[styles.headerTitle, { color: theme.colors.text.primary }]}
            accessibilityRole={A11yRole.header}
            accessibilityLabel="Gamification hub">
            🎮 Gamification Hub
          </Text>
          <Text style={[styles.headerSubtitle, { color: theme.colors.text.secondary }]}>
            Earn XP, unlock rewards, and compete!
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.shareBtn, { backgroundColor: theme.colors.background.secondary }]}
            onPress={handleShareProgress}
            accessibilityRole={A11yRole.button}
            accessibilityLabel="Share your progress"
            accessibilityHint="Opens the system share sheet with your level and points">
            <Text style={styles.shareBtnText}>🚀 Share</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.settingsBtn, { backgroundColor: theme.colors.background.secondary }]}
            onPress={() => setSettingsVisible(true)}
            accessibilityRole={A11yRole.button}
            accessibilityLabel="Open gamification settings"
            accessibilityHint="Opens sound, notification and leaderboard options"
            testID="gamification-settings-button">
            <Text style={styles.settingsBtnText} accessible={false}>
              ⚙️
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.headerBar}>
        <LevelProgressBar points={points} level={level} />
      </View>

      <View
        style={[styles.navTabs, { borderBottomColor: theme.colors.border.default }]}
        accessibilityRole={A11yRole.tablist}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.navTab,
                isActive && styles.navTabActive,
                isActive && { borderBottomColor: theme.colors.brand.primary },
              ]}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole={A11yRole.tab}
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              testID={`gamification-tab-${tab.key}`}>
              <Text
                style={[
                  styles.navTabText,
                  {
                    color: isActive ? theme.colors.brand.primary : theme.colors.text.secondary,
                  },
                ]}>
                {tab.glyph} {tab.label}
                {tab.key === 'rewards' && pendingRewardCount > 0 ? ` (${pendingRewardCount})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {activeTab === 'dashboard' && (
          <>
            <GamificationAnalyticsCard analytics={analytics} />

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text
                  style={[styles.sectionTitle, { color: theme.colors.text.primary }]}
                  accessibilityRole={A11yRole.header}
                  accessibilityLabel={`Your badges, ${earnedBadges.length} of ${allBadges.length} earned`}>
                  Your Badges ({earnedBadges.length}/{allBadges.length})
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.badgeScroll}>
                {allBadges.map((badge) => (
                  <BadgeCard
                    key={badge.id}
                    badge={badge}
                    isUnlocked={earnedBadges.includes(badge.id)}
                    userProgress={useGamificationStore.getState()}
                  />
                ))}
              </ScrollView>
            </View>

            <View style={styles.section}>
              <LeaderboardList
                data={leaderboard.slice(0, 3)}
                category={leaderboardCategory}
                onSelectCategory={setLeaderboardCategory}
              />
            </View>
          </>
        )}

        {activeTab === 'rewards' && (
          <View style={styles.section}>
            <Text style={[styles.sectionDesc, { color: theme.colors.text.secondary }]}>
              Unlock achievements to earn discount coupons and loyalty credits. Claim and use them
              on your subscriptions!
            </Text>
            <RewardsList rewards={earnedRewards} onClaim={claimReward} onRedeem={redeemReward} />
          </View>
        )}

        {activeTab === 'leaderboard' && (
          <View style={styles.section}>
            <LeaderboardList
              data={leaderboard}
              category={leaderboardCategory}
              onSelectCategory={setLeaderboardCategory}
            />
          </View>
        )}

        <View style={styles.footer} />
      </ScrollView>

      <GamificationConfigModal
        visible={settingsVisible}
        config={config}
        onClose={() => setSettingsVisible(false)}
        onUpdate={updateConfig}
        onReset={resetProgress}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shareBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  shareBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  settingsBtn: {
    // 44pt meets the WCAG 2.5.5 / MIN_TOUCH_TARGET floor; this was 36pt.
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsBtnText: {
    fontSize: 18,
  },
  headerBar: {
    paddingHorizontal: 20,
  },
  navTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginTop: 8,
  },
  navTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  navTabActive: {
    borderBottomWidth: 2,
  },
  navTabText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  sectionDesc: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  badgeScroll: {
    paddingRight: 20,
  },
  footer: {
    height: 40,
  },
});
