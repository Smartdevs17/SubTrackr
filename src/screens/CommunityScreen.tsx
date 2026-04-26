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
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/common/Card';
import { RootStackParamList } from '../navigation/types';
import {
  CommunityPrivacy,
  ForumPost,
  ForumThread,
  useCommunityStore,
} from '../store/communityStore';
import { useWalletStore } from '../store';
import { borderRadius, colors, spacing, typography } from '../utils/constants';

type CommunityNavigationProp = NativeStackNavigationProp<RootStackParamList>;
type CommunityTab = 'directory' | 'forum' | 'moderation';

const privacyFilters: (CommunityPrivacy | 'all')[] = ['all', 'public', 'subscribers', 'private'];

const formatTimestamp = (value: string): string => new Date(value).toLocaleString();

const MentionText: React.FC<{ body: string }> = ({ body }) => {
  const parts = body.split(/(@[a-z0-9._-]+)/gi);

  return (
    <Text style={styles.threadBody}>
      {parts.map((part, index) => {
        const isMention = /^@[a-z0-9._-]+$/i.test(part);
        return (
          <Text key={`${part}-${index}`} style={isMention ? styles.mentionText : undefined}>
            {part}
          </Text>
        );
      })}
    </Text>
  );
};

const PostItem: React.FC<{
  post: ForumPost;
  authorName: string;
  threadId: string;
  canModerate: boolean;
  onModerate: (threadId: string, status: 'visible' | 'hidden', postId: string) => void;
}> = ({ post, authorName, threadId, canModerate, onModerate }) => (
  <View style={styles.postCard}>
    <View style={styles.threadMetaRow}>
      <Text style={styles.threadAuthor}>{authorName}</Text>
      <Text style={styles.threadMeta}>{formatTimestamp(post.createdAt)}</Text>
    </View>
    <MentionText body={post.body} />
    {post.mentions.length > 0 && (
      <Text style={styles.mentionMeta}>Mentions: {post.mentions.length}</Text>
    )}
    {post.moderationStatus !== 'visible' && (
      <Text style={styles.flaggedText}>Status: {post.moderationStatus}</Text>
    )}
    {canModerate && (
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => onModerate(threadId, 'visible', post.id)}>
          <Text style={styles.secondaryButtonText}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButton, styles.dangerSurface]}
          onPress={() => onModerate(threadId, 'hidden', post.id)}>
          <Text style={styles.dangerText}>Hide</Text>
        </TouchableOpacity>
      </View>
    )}
  </View>
);

const CommunityScreen: React.FC = () => {
  const navigation = useNavigation<CommunityNavigationProp>();
  const address = useWalletStore((state) => state.address);
  const {
    currentSubscriber,
    setCurrentSubscriber,
    profiles,
    threads,
    moderationQueue,
    getSubscribers,
    createThread,
    replyToThread,
    moderateContent,
  } = useCommunityStore();

  useEffect(() => {
    if (address) {
      setCurrentSubscriber(address);
    }
  }, [address, setCurrentSubscriber]);

  const viewer = address ?? currentSubscriber;
  const activeProfile = profiles[viewer.toLowerCase()];
  const canModerate = activeProfile?.role === 'moderator';

  const [activeTab, setActiveTab] = useState<CommunityTab>('directory');
  const [query, setQuery] = useState('');
  const [privacyFilter, setPrivacyFilter] = useState<CommunityPrivacy | 'all'>('all');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [body, setBody] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const subscribers = useMemo(
    () => getSubscribers({ query, privacy: privacyFilter }),
    [getSubscribers, privacyFilter, query]
  );

  const visibleThreads = useMemo(
    () => threads.filter((thread) => thread.moderationStatus !== 'hidden'),
    [threads]
  );

  const flaggedThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          moderationQueue.includes(thread.id) ||
          thread.moderationStatus === 'flagged' ||
          thread.posts.some((post) => post.moderationStatus === 'flagged')
      ),
    [moderationQueue, threads]
  );

  const handleCreateThread = () => {
    const result = createThread(viewer, { title, body, category });
    if (!result.ok) {
      Alert.alert('Thread not created', result.reason ?? 'Check your input and try again.');
      return;
    }

    setTitle('');
    setBody('');
    setCategory('General');
    Alert.alert('Discussion started', result.reason ?? 'Your thread is now live.');
    setActiveTab('forum');
  };

  const handleReply = (threadId: string) => {
    const draft = replyDrafts[threadId] ?? '';
    const result = replyToThread(threadId, viewer, draft);
    if (!result.ok) {
      Alert.alert('Reply not sent', result.reason ?? 'Reply cannot be empty.');
      return;
    }

    setReplyDrafts((state) => ({ ...state, [threadId]: '' }));
    if (result.reason) {
      Alert.alert('Reply queued', result.reason);
    }
  };

  const handleModeration = (threadId: string, status: 'visible' | 'hidden', postId?: string) => {
    moderateContent(threadId, status, postId);
  };

  const renderDirectory = () => (
    <>
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Subscriber Directory</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, bio, address, or interests"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}>
          {privacyFilters.map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.filterChip, privacyFilter === filter && styles.filterChipActive]}
              onPress={() => setPrivacyFilter(filter)}>
              <Text
                style={[
                  styles.filterChipText,
                  privacyFilter === filter && styles.filterChipTextActive,
                ]}>
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Card>

      {subscribers.map((profile) => (
        <TouchableOpacity
          key={profile.subscriber}
          onPress={() => navigation.navigate('Profile', { subscriber: profile.subscriber })}>
          <Card style={styles.section}>
            <View style={styles.directoryRow}>
              <View style={styles.miniAvatar}>
                <Text style={styles.miniAvatarText}>{profile.avatar}</Text>
              </View>
              <View style={styles.directoryContent}>
                <Text style={styles.directoryTitle}>{profile.displayName}</Text>
                <Text style={styles.directoryMeta}>
                  {profile.privacy} profile | {profile.role}
                </Text>
                <Text style={styles.directoryBio}>{profile.bio}</Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      ))}
    </>
  );

  const renderThread = (thread: ForumThread) => {
    const author = profiles[thread.authorSubscriber]?.displayName ?? thread.authorSubscriber;

    return (
      <Card key={thread.id} style={styles.section}>
        <View style={styles.threadMetaRow}>
          <Text style={styles.threadCategory}>{thread.category}</Text>
          <Text style={styles.threadMeta}>{formatTimestamp(thread.updatedAt)}</Text>
        </View>
        <Text style={styles.threadTitle}>{thread.title}</Text>
        <Text style={styles.threadMeta}>Started by {author}</Text>
        {thread.moderationStatus !== 'visible' && (
          <Text style={styles.flaggedText}>Thread status: {thread.moderationStatus}</Text>
        )}
        <View style={styles.postList}>
          {thread.posts
            .filter((post) => post.moderationStatus !== 'hidden')
            .map((post) => (
              <PostItem
                key={post.id}
                post={post}
                authorName={profiles[post.authorSubscriber]?.displayName ?? post.authorSubscriber}
                threadId={thread.id}
                canModerate={canModerate}
                onModerate={handleModeration}
              />
            ))}
        </View>
        <TextInput
          value={replyDrafts[thread.id] ?? ''}
          onChangeText={(text) => setReplyDrafts((state) => ({ ...state, [thread.id]: text }))}
          placeholder="Reply to the discussion. Use @DisplayName for mentions."
          placeholderTextColor={colors.textSecondary}
          multiline
          style={[styles.input, styles.replyInput]}
        />
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => handleReply(thread.id)}>
            <Text style={styles.secondaryButtonText}>Reply</Text>
          </TouchableOpacity>
          {canModerate && (
            <TouchableOpacity
              style={[styles.secondaryButton, styles.dangerSurface]}
              onPress={() => handleModeration(thread.id, 'hidden')}>
              <Text style={styles.dangerText}>Hide thread</Text>
            </TouchableOpacity>
          )}
        </View>
      </Card>
    );
  };

  const renderForum = () => (
    <>
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Start a Discussion</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Thread title"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        <TextInput
          value={category}
          onChangeText={setCategory}
          placeholder="Category"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="What do you want to discuss? Mention members with @DisplayName"
          placeholderTextColor={colors.textSecondary}
          multiline
          style={[styles.input, styles.textArea]}
        />
        <TouchableOpacity style={styles.primaryButton} onPress={handleCreateThread}>
          <Text style={styles.primaryButtonText}>Post thread</Text>
        </TouchableOpacity>
      </Card>

      {visibleThreads.map(renderThread)}
    </>
  );

  const renderModeration = () => (
    <>
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Moderation Queue</Text>
        <Text style={styles.directoryMeta}>
          {flaggedThreads.length} thread{flaggedThreads.length === 1 ? '' : 's'} need review.
        </Text>
      </Card>
      {flaggedThreads.map((thread) => (
        <Card key={`moderation-${thread.id}`} style={styles.section}>
          <Text style={styles.threadTitle}>{thread.title}</Text>
          <Text style={styles.flaggedText}>Status: {thread.moderationStatus}</Text>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => handleModeration(thread.id, 'visible')}>
              <Text style={styles.secondaryButtonText}>Approve thread</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.dangerSurface]}
              onPress={() => handleModeration(thread.id, 'hidden')}>
              <Text style={styles.dangerText}>Hide thread</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ))}
    </>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Community</Text>
            <Text style={styles.subtitle}>Profiles, subscriber directory, and discussions.</Text>
          </View>
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => navigation.navigate('Profile', { subscriber: viewer })}>
            <Text style={styles.profileButtonText}>My profile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabRow}>
          {(['directory', 'forum', 'moderation'] as CommunityTab[])
            .filter((tab) => canModerate || tab !== 'moderation')
            .map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
                onPress={() => setActiveTab(tab)}>
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
        </View>

        {activeTab === 'directory' && renderDirectory()}
        {activeTab === 'forum' && renderForum()}
        {activeTab === 'moderation' && canModerate && renderModeration()}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  profileButton: {
    backgroundColor: colors.accent + '22',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  profileButtonText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tabButton: {
    flex: 1,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  tabButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...typography.caption, color: colors.textSecondary, textTransform: 'capitalize' },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  section: { marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  textArea: { minHeight: 110, textAlignVertical: 'top' },
  filterRow: { gap: spacing.sm },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  filterChipTextActive: { color: colors.text, fontWeight: '700' },
  directoryRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  miniAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarText: { ...typography.body, color: colors.text, fontWeight: '700' },
  directoryContent: { flex: 1 },
  directoryTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  directoryMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  directoryBio: { ...typography.caption, color: colors.text, marginTop: spacing.xs },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { ...typography.body, color: colors.text, fontWeight: '700' },
  threadMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  threadCategory: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  threadMeta: { ...typography.caption, color: colors.textSecondary },
  threadTitle: { ...typography.h3, color: colors.text, marginTop: spacing.sm },
  threadAuthor: { ...typography.caption, color: colors.text, fontWeight: '700' },
  threadBody: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  mentionText: { color: colors.accent, fontWeight: '700' },
  mentionMeta: { ...typography.small, color: colors.accent, marginTop: spacing.xs },
  flaggedText: { ...typography.caption, color: colors.warning, marginTop: spacing.sm },
  postList: { gap: spacing.md, marginTop: spacing.md },
  postCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  replyInput: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 76,
    textAlignVertical: 'top',
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  secondaryButtonText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  dangerSurface: { backgroundColor: colors.error + '12', borderColor: colors.error + '55' },
  dangerText: { ...typography.caption, color: colors.error, fontWeight: '700' },
});

export default CommunityScreen;
