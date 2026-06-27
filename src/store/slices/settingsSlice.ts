/**
 * Settings Slice – user settings, profile, and community features.
 */
import type { StateCreator } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '../../types/api';
import { SubscriptionTier } from '../../types/subscription';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface SettingsSlice {
  preferredCurrency: string;
  notificationsEnabled: boolean;
  exchangeRates: any | null;
  settingsLoading: boolean;
  setPreferredCurrency: (currency: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  updateExchangeRates: () => Promise<void>;
  initializeSettings: () => Promise<void>;
}

export interface UserSlice {
  user: UserProfile | null;
  subscriptionTier: SubscriptionTier;
  consent: { analytics: boolean; marketing: boolean; notifications: boolean; hasAcceptedPolicy: boolean };
  setUser: (user: UserProfile | null) => void;
  setSubscriptionTier: (tier: SubscriptionTier) => void;
  setConsent: (consent: Partial<{ analytics: boolean; marketing: boolean; notifications: boolean; hasAcceptedPolicy: boolean }>) => void;
  acceptAll: () => void;
  resetConsent: () => void;
}

export interface CommunitySlice {
  communitySubscriber: string;
  communityProfiles: Record<string, any>;
  communityThreads: any[];
  moderationQueue: string[];
  setCommunitySubscriber: (subscriber: string) => void;
  updateCommunityProfile: (subscriber: string, profile: Partial<any>) => void;
  getCommunitySubscribers: (filter?: any) => any[];
  getVisibleProfile: (viewer: string, target: string) => any | null;
  createForumThread: (author: string, input: { title: string; body: string; category: string }) => { ok: boolean; reason?: string };
  replyToForumThread: (threadId: string, author: string, body: string) => { ok: boolean; reason?: string };
  moderateContent: (threadId: string, status: string, postId?: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const CURRENT_SUBSCRIBER_FALLBACK = '0x742d35Cc6634C0532925a3b844Bc9e7595f0fAb1';
const FLAGGED_TERMS = ['spam', 'scam', 'hate'];

const normalizeSubscriber = (value: string): string => value.trim().toLowerCase();
const now = () => new Date().toISOString();
const generateId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const seedProfiles = (): Record<string, any> => {
  const profiles = [
    { subscriber: CURRENT_SUBSCRIBER_FALLBACK, displayName: 'You', bio: 'Tracking subscription spend.', avatar: 'YO', privacy: 'public', role: 'moderator', joinedAt: '2026-01-10T12:00:00.000Z', interests: ['FinOps', 'Streaming', 'Automation'] },
    { subscriber: '0x1f8f6a4c9b2478e559c028f39b2be4f03bb11ad7', displayName: 'Ada Flux', bio: 'Builder focused on clean billing operations.', avatar: 'AF', privacy: 'public', role: 'member', joinedAt: '2026-01-12T12:00:00.000Z', interests: ['Analytics', 'SaaS', 'Metrics'] },
    { subscriber: '0x928ca9b2644b1a4a7cf0f5a7ce3ef6173ef9a200', displayName: 'Mina Vale', bio: 'Helps creators manage recurring revenue.', avatar: 'MV', privacy: 'subscribers', role: 'member', joinedAt: '2026-02-01T12:00:00.000Z', interests: ['Creators', 'Community', 'Growth'] },
    { subscriber: '0x31357f0e8b09f5b41fed083ee4f2d10ccde3229c', displayName: 'Jon Byte', bio: 'Enjoys experiments with bundled plans.', avatar: 'JB', privacy: 'public', role: 'member', joinedAt: '2026-02-14T12:00:00.000Z', interests: ['Bundles', 'Gaming', 'Forums'] },
  ];
  return profiles.reduce<Record<string, any>>((acc, profile) => {
    acc[normalizeSubscriber(profile.subscriber)] = { ...profile, subscriber: normalizeSubscriber(profile.subscriber) };
    return acc;
  }, {});
};

const seedThreads = (profiles: Record<string, any>): any[] => {
  const you = normalizeSubscriber(CURRENT_SUBSCRIBER_FALLBACK);
  const ada = normalizeSubscriber('0x1f8f6a4c9b2478e559c028f39b2be4f03bb11ad7');
  const mina = normalizeSubscriber('0x928ca9b2644b1a4a7cf0f5a7ce3ef6173ef9a200');
  return [
    { id: 'thread-welcome', title: 'How are you organizing yearly renewals?', category: 'Billing', authorSubscriber: ada, createdAt: '2026-04-20T09:00:00.000Z', updatedAt: '2026-04-21T15:00:00.000Z', moderationStatus: 'visible', mentions: [you], posts: [{ id: 'post-welcome-1', authorSubscriber: ada, body: 'I keep a yearly bucket and tag high-cost plans. @You have you found a better flow?', createdAt: '2026-04-20T09:00:00.000Z', mentions: [], moderationStatus: 'visible' }] },
    { id: 'thread-directory', title: 'Best profile fields for subscriber discovery', category: 'Community', authorSubscriber: you, createdAt: '2026-04-22T11:30:00.000Z', updatedAt: '2026-04-22T12:15:00.000Z', moderationStatus: 'visible', mentions: [], posts: [{ id: 'post-directory-1', authorSubscriber: you, body: 'Display name, short bio, and interests feel like the minimum.', createdAt: '2026-04-22T11:30:00.000Z', mentions: [], moderationStatus: 'visible' }] },
  ];
};

type SettingsStore = SettingsSlice & UserSlice & CommunitySlice;
type SettingsCreator = StateCreator<SettingsStore & any, [], [], SettingsStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createSettingsSlice: SettingsCreator = (set, get) => {
  const initialProfiles = seedProfiles();
  return {
    // ── Settings state ─────────────────────────────────────────────
    preferredCurrency: 'USD',
    notificationsEnabled: true,
    exchangeRates: null,
    settingsLoading: false,

    setPreferredCurrency: (currency) => {
      set({ preferredCurrency: currency });
      void get().updateExchangeRates();
    },

    setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),

    updateExchangeRates: async () => {
      set({ settingsLoading: true });
      const rates = { base: 'USD', rates: {}, timestamp: Date.now() };
      set({ exchangeRates: rates, settingsLoading: false });
    },

    initializeSettings: async () => {
      const { exchangeRates } = get();
      if (!exchangeRates) { await get().updateExchangeRates(); }
    },

    // ── User state ─────────────────────────────────────────────────
    user: null,
    subscriptionTier: SubscriptionTier.FREE,
    consent: { analytics: false, marketing: false, notifications: true, hasAcceptedPolicy: false },

    setUser: (user) => set((s) => ({ user, subscriptionTier: user ? (user.subscriptionTier ?? s.subscriptionTier) : SubscriptionTier.FREE })),
    setSubscriptionTier: (subscriptionTier) => set({ subscriptionTier }),
    setConsent: (newConsent) => set((s) => ({ consent: { ...s.consent, ...newConsent } })),
    acceptAll: () => set({ consent: { analytics: true, marketing: true, notifications: true, hasAcceptedPolicy: true } }),
    resetConsent: () => set({ consent: { analytics: false, marketing: false, notifications: false, hasAcceptedPolicy: false } }),

    // ── Community state ────────────────────────────────────────────
    communitySubscriber: normalizeSubscriber(CURRENT_SUBSCRIBER_FALLBACK),
    communityProfiles: initialProfiles,
    communityThreads: seedThreads(initialProfiles),
    moderationQueue: [],

    setCommunitySubscriber: (subscriber) => {
      const normalized = normalizeSubscriber(subscriber || CURRENT_SUBSCRIBER_FALLBACK);
      set((s) => {
        const existing = s.communityProfiles[normalized];
        const nextProfiles = existing ? s.communityProfiles : { ...s.communityProfiles, [normalized]: { subscriber: normalized, displayName: 'New Member', bio: '...', avatar: 'NM', privacy: 'public', role: 'member', joinedAt: now(), interests: ['Subscriptions'] } };
        return { communitySubscriber: normalized, communityProfiles: nextProfiles };
      });
    },

    updateCommunityProfile: (subscriber, profile) => {
      const normalized = normalizeSubscriber(subscriber);
      set((s) => {
        const current = s.communityProfiles[normalized] || { subscriber: normalized, displayName: 'New Member', bio: '', avatar: 'NM', privacy: 'public', role: 'member', joinedAt: now(), interests: [] };
        return { communityProfiles: { ...s.communityProfiles, [normalized]: { ...current, ...profile, subscriber: normalized } } };
      });
    },

    getCommunitySubscribers: (filter) => {
      return Object.values(get().communityProfiles).filter(() => true).sort((a: any, b: any) => a.displayName?.localeCompare(b.displayName));
    },

    getVisibleProfile: (viewer, target) => {
      const profile = get().communityProfiles[normalizeSubscriber(target)];
      return profile ?? null;
    },

    createForumThread: (author, input) => {
      const normalized = normalizeSubscriber(author);
      const body = input.body.trim();
      if (!input.title.trim() || !body) return { ok: false, reason: 'Title and post are required.' };
      const status = FLAGGED_TERMS.some((t) => body.toLowerCase().includes(t)) ? 'flagged' : 'visible';
      set((s) => {
        const thread = { id: generateId('thread'), title: input.title.trim(), category: input.category.trim() || 'General', authorSubscriber: normalized, createdAt: now(), updatedAt: now(), moderationStatus: status, mentions: [], posts: [{ id: generateId('post'), authorSubscriber: normalized, body, createdAt: now(), mentions: [], moderationStatus: status }] };
        const queue = status === 'flagged' ? [...new Set([...s.moderationQueue, thread.id])] : s.moderationQueue;
        return { communityThreads: [thread, ...s.communityThreads], moderationQueue: queue };
      });
      return status === 'flagged' ? { ok: true, reason: 'Flagged for review.' } : { ok: true };
    },

    replyToForumThread: (threadId, author, body) => {
      const trimmed = body.trim();
      if (!trimmed) return { ok: false, reason: 'Reply cannot be empty.' };
      const status = FLAGGED_TERMS.some((t) => trimmed.toLowerCase().includes(t)) ? 'flagged' : 'visible';
      set((s) => {
        const nextThreads = s.communityThreads.map((t: any) => t.id !== threadId ? t : { ...t, updatedAt: now(), posts: [...t.posts, { id: generateId('post'), authorSubscriber: normalizeSubscriber(author), body: trimmed, createdAt: now(), mentions: [], moderationStatus: status }] });
        const queue = status === 'flagged' ? [...new Set([...s.moderationQueue, threadId])] : s.moderationQueue;
        return { communityThreads: nextThreads, moderationQueue: queue };
      });
      return status === 'flagged' ? { ok: true, reason: 'Flagged for review.' } : { ok: true };
    },

    moderateContent: (threadId, status, postId) => {
      set((s) => {
        const nextThreads = s.communityThreads.map((t: any) => {
          if (t.id !== threadId) return t;
          if (!postId) return { ...t, moderationStatus: status };
          const nextPosts = t.posts.map((p: any) => p.id === postId ? { ...p, moderationStatus: status } : p);
          return { ...t, posts: nextPosts };
        });
        const queue = nextThreads.filter((t: any) => t.moderationStatus === 'flagged').map((t: any) => t.id);
        return { communityThreads: nextThreads, moderationQueue: queue };
      });
    },
  };
};
