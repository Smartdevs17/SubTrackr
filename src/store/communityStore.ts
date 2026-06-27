/**
 * @deprecated Use \`useStore\` from \`./combinedStore\` instead.
 * All stores are now combined into a single store using the slices pattern.
 */
export { useStore as useCommunityStore } from './combinedStore';

export type CommunityPrivacy = 'public' | 'subscribers' | 'private';
export type CommunityRole = 'member' | 'moderator';
export type ModerationStatus = 'visible' | 'flagged' | 'hidden';

export interface CommunityProfile {
  subscriber: string;
  displayName: string;
  avatar: string;
  bio: string;
  privacy: CommunityPrivacy;
  role: CommunityRole;
  joinedAt: string;
  interests: string[];
}

export interface CommunityFilter {
  query?: string;
  privacy?: CommunityPrivacy;
}

export interface ForumPost {
  id: string;
  threadId: string;
  authorSubscriber: string;
  body: string;
  mentions: string[];
  moderationStatus: ModerationStatus;
  createdAt: string;
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
