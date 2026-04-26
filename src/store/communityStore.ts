import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CommunityPrivacy = 'public' | 'subscribers' | 'private';
export type CommunityRole = 'member' | 'moderator';
export type ModerationStatus = 'visible' | 'flagged' | 'hidden';

export interface CommunityProfile {
  subscriber: string;
  displayName: string;
  bio: string;
  avatar: string;
  privacy: CommunityPrivacy;
  role: CommunityRole;
  joinedAt: string;
  interests: string[];
}

export interface CommunityFilter {
  query?: string;
  privacy?: CommunityPrivacy | 'all';
}

export interface ForumPost {
  id: string;
  authorSubscriber: string;
  body: string;
  createdAt: string;
  mentions: string[];
  moderationStatus: ModerationStatus;
}

export interface ForumThread {
  id: string;
  title: string;
  category: string;
  authorSubscriber: string;
  createdAt: string;
  updatedAt: string;
  moderationStatus: ModerationStatus;
  mentions: string[];
  posts: ForumPost[];
}

interface CreateThreadInput {
  title: string;
  body: string;
  category: string;
}

interface CommunityState {
  currentSubscriber: string;
  profiles: Record<string, CommunityProfile>;
  threads: ForumThread[];
  moderationQueue: string[];
  setCurrentSubscriber: (subscriber: string) => void;
  updateProfile: (
    subscriber: string,
    profile: Partial<
      Pick<CommunityProfile, 'displayName' | 'bio' | 'avatar' | 'privacy' | 'interests'>
    >
  ) => void;
  getSubscribers: (filter?: CommunityFilter) => CommunityProfile[];
  getVisibleProfile: (viewer: string, target: string) => CommunityProfile | null;
  createThread: (
    authorSubscriber: string,
    input: CreateThreadInput
  ) => { ok: boolean; reason?: string };
  replyToThread: (
    threadId: string,
    authorSubscriber: string,
    body: string
  ) => { ok: boolean; reason?: string };
  moderateContent: (threadId: string, status: ModerationStatus, postId?: string) => void;
}

const STORAGE_KEY = 'subtrackr-community-store';
const CURRENT_SUBSCRIBER_FALLBACK = '0x742d35Cc6634C0532925a3b844Bc9e7595f0fAb1';
const FLAGGED_TERMS = ['spam', 'scam', 'hate'];

const now = () => new Date().toISOString();

const generateId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeSubscriber = (value: string): string => value.trim().toLowerCase();

const extractMentions = (body: string, profiles: Record<string, CommunityProfile>): string[] => {
  const mentionTokens = body.match(/@[a-z0-9._-]+/gi) ?? [];
  if (mentionTokens.length === 0) return [];

  const lookup = new Map<string, string>();
  Object.values(profiles).forEach((profile) => {
    lookup.set(profile.displayName.trim().toLowerCase().replace(/\s+/g, ''), profile.subscriber);
  });

  return Array.from(
    new Set(
      mentionTokens
        .map((token) => token.slice(1).toLowerCase())
        .map((token) => lookup.get(token))
        .filter((value): value is string => Boolean(value))
    )
  );
};

const getModerationStatus = (body: string): ModerationStatus => {
  const normalized = body.toLowerCase();
  return FLAGGED_TERMS.some((term) => normalized.includes(term)) ? 'flagged' : 'visible';
};

const seedProfiles = (): Record<string, CommunityProfile> => {
  const profiles: CommunityProfile[] = [
    {
      subscriber: CURRENT_SUBSCRIBER_FALLBACK,
      displayName: 'You',
      bio: 'Tracking subscription spend, experiments, and automation flows.',
      avatar: 'YO',
      privacy: 'public',
      role: 'moderator',
      joinedAt: '2026-01-10T12:00:00.000Z',
      interests: ['FinOps', 'Streaming', 'Automation'],
    },
    {
      subscriber: '0x1f8f6a4c9b2478e559c028f39b2be4f03bb11ad7',
      displayName: 'Ada Flux',
      bio: 'Builder focused on clean billing operations and subscription analytics.',
      avatar: 'AF',
      privacy: 'public',
      role: 'member',
      joinedAt: '2026-01-12T12:00:00.000Z',
      interests: ['Analytics', 'SaaS', 'Metrics'],
    },
    {
      subscriber: '0x928ca9b2644b1a4a7cf0f5a7ce3ef6173ef9a200',
      displayName: 'Mina Vale',
      bio: 'Helps creators manage recurring revenue communities.',
      avatar: 'MV',
      privacy: 'subscribers',
      role: 'member',
      joinedAt: '2026-02-01T12:00:00.000Z',
      interests: ['Creators', 'Community', 'Growth'],
    },
    {
      subscriber: '0x31357f0e8b09f5b41fed083ee4f2d10ccde3229c',
      displayName: 'Jon Byte',
      bio: 'Enjoys experiments with bundled plans and member perks.',
      avatar: 'JB',
      privacy: 'public',
      role: 'member',
      joinedAt: '2026-02-14T12:00:00.000Z',
      interests: ['Bundles', 'Gaming', 'Forums'],
    },
  ];

  return profiles.reduce<Record<string, CommunityProfile>>((acc, profile) => {
    acc[normalizeSubscriber(profile.subscriber)] = {
      ...profile,
      subscriber: normalizeSubscriber(profile.subscriber),
    };
    return acc;
  }, {});
};

const seedThreads = (profiles: Record<string, CommunityProfile>): ForumThread[] => {
  const you = normalizeSubscriber(CURRENT_SUBSCRIBER_FALLBACK);
  const ada = normalizeSubscriber('0x1f8f6a4c9b2478e559c028f39b2be4f03bb11ad7');
  const mina = normalizeSubscriber('0x928ca9b2644b1a4a7cf0f5a7ce3ef6173ef9a200');

  return [
    {
      id: 'thread-welcome',
      title: 'How are you organizing yearly renewals?',
      category: 'Billing',
      authorSubscriber: ada,
      createdAt: '2026-04-20T09:00:00.000Z',
      updatedAt: '2026-04-21T15:00:00.000Z',
      moderationStatus: 'visible',
      mentions: [you],
      posts: [
        {
          id: 'post-welcome-1',
          authorSubscriber: ada,
          body: 'I keep a yearly bucket and tag high-cost plans. @You have you found a better flow?',
          createdAt: '2026-04-20T09:00:00.000Z',
          mentions: extractMentions(
            'I keep a yearly bucket and tag high-cost plans. @You have you found a better flow?',
            profiles
          ),
          moderationStatus: 'visible',
        },
        {
          id: 'post-welcome-2',
          authorSubscriber: mina,
          body: 'We review 60 days before renewal and move uncertain plans into a watchlist.',
          createdAt: '2026-04-21T15:00:00.000Z',
          mentions: [],
          moderationStatus: 'visible',
        },
      ],
    },
    {
      id: 'thread-directory',
      title: 'Best profile fields for subscriber discovery',
      category: 'Community',
      authorSubscriber: you,
      createdAt: '2026-04-22T11:30:00.000Z',
      updatedAt: '2026-04-22T12:15:00.000Z',
      moderationStatus: 'visible',
      mentions: [],
      posts: [
        {
          id: 'post-directory-1',
          authorSubscriber: you,
          body: 'Display name, short bio, and interests feel like the minimum for a useful directory.',
          createdAt: '2026-04-22T11:30:00.000Z',
          mentions: [],
          moderationStatus: 'visible',
        },
      ],
    },
  ];
};

const createDefaultProfile = (subscriber: string): CommunityProfile => ({
  subscriber,
  displayName: 'New Member',
  bio: 'Tell the community what subscriptions or topics you care about.',
  avatar: 'NM',
  privacy: 'public',
  role: 'member',
  joinedAt: now(),
  interests: ['Subscriptions'],
});

const canViewProfile = (viewer: string, target: CommunityProfile): boolean => {
  if (viewer === target.subscriber) return true;
  if (target.privacy === 'public') return true;
  if (target.privacy === 'subscribers') return true;
  return false;
};

export const useCommunityStore = create<CommunityState>()(
  persist(
    (set, get) => {
      const profiles = seedProfiles();
      return {
        currentSubscriber: normalizeSubscriber(CURRENT_SUBSCRIBER_FALLBACK),
        profiles,
        threads: seedThreads(profiles),
        moderationQueue: [],
        setCurrentSubscriber: (subscriber) => {
          const normalized = normalizeSubscriber(subscriber || CURRENT_SUBSCRIBER_FALLBACK);
          set((state) => {
            const existing = state.profiles[normalized];
            const nextProfiles: Record<string, CommunityProfile> = existing
              ? state.profiles
              : {
                  ...state.profiles,
                  [normalized]: createDefaultProfile(normalized),
                };

            return {
              currentSubscriber: normalized,
              profiles: nextProfiles,
            };
          });
        },
        updateProfile: (subscriber, profile) => {
          const normalized = normalizeSubscriber(subscriber);
          set((state) => {
            const current = state.profiles[normalized] ?? createDefaultProfile(normalized);

            return {
              profiles: {
                ...state.profiles,
                [normalized]: {
                  ...current,
                  ...profile,
                  subscriber: normalized,
                  interests: profile.interests ?? current.interests,
                },
              },
            };
          });
        },
        getSubscribers: (filter) => {
          const { profiles, currentSubscriber } = get();
          const query = filter?.query?.trim().toLowerCase() ?? '';
          const privacy = filter?.privacy ?? 'all';

          return Object.values(profiles)
            .filter((profile) => canViewProfile(currentSubscriber, profile))
            .filter((profile) => privacy === 'all' || profile.privacy === privacy)
            .filter((profile) => {
              if (!query) return true;
              const haystack = [
                profile.displayName,
                profile.bio,
                profile.subscriber,
                ...profile.interests,
              ]
                .join(' ')
                .toLowerCase();
              return haystack.includes(query);
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
        },
        getVisibleProfile: (viewer, target) => {
          const normalizedTarget = normalizeSubscriber(target);
          const profile = get().profiles[normalizedTarget];
          if (!profile) return null;
          return canViewProfile(normalizeSubscriber(viewer), profile) ? profile : null;
        },
        createThread: (authorSubscriber, input) => {
          const normalizedAuthor = normalizeSubscriber(authorSubscriber);
          const title = input.title.trim();
          const body = input.body.trim();
          const category = input.category.trim() || 'General';

          if (!title || !body) {
            return { ok: false, reason: 'Title and opening post are required.' };
          }

          const status = getModerationStatus(`${title} ${body}`);
          const threadId = generateId('thread');
          const post: ForumPost = {
            id: generateId('post'),
            authorSubscriber: normalizedAuthor,
            body,
            createdAt: now(),
            mentions: extractMentions(body, get().profiles),
            moderationStatus: status,
          };

          set((state) => {
            const queue: string[] =
              status === 'flagged'
                ? [...new Set([...state.moderationQueue, threadId])]
                : state.moderationQueue;
            return {
              threads: [
                {
                  id: threadId,
                  title,
                  category,
                  authorSubscriber: normalizedAuthor,
                  createdAt: now(),
                  updatedAt: now(),
                  moderationStatus: status,
                  mentions: extractMentions(`${title} ${body}`, state.profiles),
                  posts: [post],
                },
                ...state.threads,
              ],
              moderationQueue: queue,
            };
          });

          return status === 'flagged'
            ? { ok: true, reason: 'Thread created and flagged for moderator review.' }
            : { ok: true };
        },
        replyToThread: (threadId, authorSubscriber, body) => {
          const normalizedAuthor = normalizeSubscriber(authorSubscriber);
          const trimmedBody = body.trim();
          if (!trimmedBody) {
            return { ok: false, reason: 'Reply cannot be empty.' };
          }

          const status = getModerationStatus(trimmedBody);
          set((state) => {
            const nextThreads: ForumThread[] = state.threads.map((thread) => {
              if (thread.id !== threadId) return thread;
              return {
                ...thread,
                updatedAt: now(),
                moderationStatus:
                  thread.moderationStatus === 'flagged' ? 'flagged' : thread.moderationStatus,
                mentions: Array.from(
                  new Set([...thread.mentions, ...extractMentions(trimmedBody, state.profiles)])
                ),
                posts: [
                  ...thread.posts,
                  {
                    id: generateId('post'),
                    authorSubscriber: normalizedAuthor,
                    body: trimmedBody,
                    createdAt: now(),
                    mentions: extractMentions(trimmedBody, state.profiles),
                    moderationStatus: status,
                  },
                ],
              };
            });

            const queue: string[] =
              status === 'flagged'
                ? [...new Set([...state.moderationQueue, threadId])]
                : state.moderationQueue;

            return {
              threads: nextThreads,
              moderationQueue: queue,
            };
          });

          return status === 'flagged'
            ? { ok: true, reason: 'Reply submitted and flagged for review.' }
            : { ok: true };
        },
        moderateContent: (threadId, status, postId) => {
          set((state) => {
            const nextThreads: ForumThread[] = state.threads.map((thread) => {
              if (thread.id !== threadId) return thread;
              if (!postId) return { ...thread, moderationStatus: status };

              const nextPosts = thread.posts.map((post) =>
                post.id === postId ? { ...post, moderationStatus: status } : post
              );
              const hasFlaggedPosts = nextPosts.some((post) => post.moderationStatus === 'flagged');

              return {
                ...thread,
                posts: nextPosts,
                moderationStatus:
                  status === 'hidden' && thread.posts.length === 1
                    ? 'hidden'
                    : hasFlaggedPosts
                      ? 'flagged'
                      : thread.moderationStatus === 'hidden'
                        ? 'hidden'
                        : 'visible',
              };
            });

            const queue = nextThreads
              .filter(
                (thread) =>
                  thread.moderationStatus === 'flagged' ||
                  thread.posts.some((post) => post.moderationStatus === 'flagged')
              )
              .map((thread) => thread.id);

            return {
              threads: nextThreads,
              moderationQueue: queue,
            };
          });
        },
      };
    },
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
