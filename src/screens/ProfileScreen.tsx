import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/common/Card';
import { RootStackParamList } from '../navigation/types';
import { useCommunityStore, CommunityPrivacy } from '../store/communityStore';
import { useWalletStore } from '../store';
import { borderRadius, colors, spacing, typography } from '../utils/constants';

type ProfileRouteProp = RouteProp<RootStackParamList, 'Profile'>;
type ProfileNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const privacyOptions: CommunityPrivacy[] = ['public', 'subscribers', 'private'];

const ProfileScreen: React.FC = () => {
  const route = useRoute<ProfileRouteProp>();
  const navigation = useNavigation<ProfileNavigationProp>();
  const walletAddress = useWalletStore((state) => state.address);
  const { currentSubscriber, setCurrentSubscriber, updateProfile, getVisibleProfile } =
    useCommunityStore();

  useEffect(() => {
    if (walletAddress) {
      setCurrentSubscriber(walletAddress);
    }
  }, [setCurrentSubscriber, walletAddress]);

  const viewer = walletAddress ?? currentSubscriber;
  const targetSubscriber = route.params?.subscriber ?? viewer;
  const profile = getVisibleProfile(viewer, targetSubscriber);
  const isOwnProfile = viewer.toLowerCase() === targetSubscriber.toLowerCase();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [avatar, setAvatar] = useState(profile?.avatar ?? '');
  const [privacy, setPrivacy] = useState<CommunityPrivacy>(profile?.privacy ?? 'public');
  const [interests, setInterests] = useState((profile?.interests ?? []).join(', '));

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setBio(profile?.bio ?? '');
    setAvatar(profile?.avatar ?? '');
    setPrivacy(profile?.privacy ?? 'public');
    setInterests((profile?.interests ?? []).join(', '));
  }, [profile]);

  const memberSince = useMemo(() => {
    if (!profile?.joinedAt) return '';
    return new Date(profile.joinedAt).toLocaleDateString();
  }, [profile?.joinedAt]);

  const handleSave = () => {
    updateProfile(viewer, {
      displayName: displayName.trim() || 'New Member',
      bio: bio.trim(),
      avatar: (avatar.trim() || displayName.trim().slice(0, 2) || 'NM').slice(0, 2).toUpperCase(),
      privacy,
      interests: interests
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    });
    Alert.alert('Profile updated', 'Your community profile has been saved.');
    navigation.setParams({ subscriber: viewer });
  };

  if (!profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <Text style={styles.title}>Private Profile</Text>
          <Text style={styles.subtitle}>This member has hidden their subscriber profile.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{profile.avatar}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>{profile.displayName}</Text>
            <Text style={styles.subtitle}>{profile.subscriber}</Text>
            <Text style={styles.meta}>Member since {memberSince || 'recently'}</Text>
          </View>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.bioText}>{profile.bio || 'No bio added yet.'}</Text>
          <View style={styles.tagRow}>
            {profile.interests.map((interest) => (
              <View key={interest} style={styles.tag}>
                <Text style={styles.tagText}>{interest}</Text>
              </View>
            ))}
          </View>
        </Card>

        {isOwnProfile && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Edit Profile</Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Display name"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Bio"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[styles.input, styles.textArea]}
            />
            <TextInput
              value={avatar}
              onChangeText={setAvatar}
              placeholder="Avatar initials"
              placeholderTextColor={colors.textSecondary}
              maxLength={2}
              autoCapitalize="characters"
              style={styles.input}
            />
            <TextInput
              value={interests}
              onChangeText={setInterests}
              placeholder="Interests, comma separated"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Privacy</Text>
            <View style={styles.optionRow}>
              {privacyOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.optionButton, privacy === option && styles.optionButtonActive]}
                  onPress={() => setPrivacy(option)}>
                  <Text style={[styles.optionText, privacy === option && styles.optionTextActive]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={handleSave}>
              <Text style={styles.primaryButtonText}>Save profile</Text>
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.h2, color: colors.text },
  title: { ...typography.h2, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary },
  meta: { ...typography.caption, color: colors.accent, marginTop: spacing.xs },
  section: { marginBottom: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  bioText: { ...typography.body, color: colors.textSecondary },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '22',
  },
  tagText: { ...typography.caption, color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    marginBottom: spacing.md,
  },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  fieldLabel: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  optionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  optionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  optionButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { ...typography.caption, color: colors.textSecondary, textTransform: 'capitalize' },
  optionTextActive: { color: colors.text, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { ...typography.body, color: colors.text, fontWeight: '700' },
});

export default ProfileScreen;
