export type CommCategory = 'billing' | 'product' | 'marketing' | 'security' | 'survey';
export type CommChannel = 'email' | 'push' | 'sms' | 'in_app';

export interface ChannelPreference {
  enabled: boolean;
  /** Ordered fallback channels if primary fails */
  fallbackOrder: CommChannel[];
}

export interface CategoryPreference {
  category: CommCategory;
  channels: Record<CommChannel, ChannelPreference>;
  /** Regulatory-required: cannot be opted out */
  required: boolean;
}

export interface SubscriberPreference {
  userId: string;
  categories: Record<CommCategory, CategoryPreference>;
  updatedAt: string;
  syncVersion: number;
}

/** Default waterfall rules per category */
export const DEFAULT_WATERFALL: Record<CommCategory, CommChannel[]> = {
  billing: ['email', 'push'],
  security: ['email', 'push', 'sms'],
  product: ['push', 'in_app'],
  marketing: ['email'],
  survey: ['email', 'in_app'],
};

export const REQUIRED_CATEGORIES: CommCategory[] = ['billing', 'security'];

export function buildDefaultPreferences(userId: string): SubscriberPreference {
  const categories = {} as Record<CommCategory, CategoryPreference>;
  const allCategories: CommCategory[] = ['billing', 'product', 'marketing', 'security', 'survey'];

  for (const category of allCategories) {
    const waterfall = DEFAULT_WATERFALL[category];
    const channels = {} as Record<CommChannel, ChannelPreference>;
    const allChannels: CommChannel[] = ['email', 'push', 'sms', 'in_app'];

    for (const ch of allChannels) {
      channels[ch] = {
        enabled: waterfall.includes(ch),
        fallbackOrder: waterfall.filter((c) => c !== ch),
      };
    }
    categories[category] = {
      category,
      channels,
      required: REQUIRED_CATEGORIES.includes(category),
    };
  }

  return { userId, categories, updatedAt: new Date().toISOString(), syncVersion: 1 };
}
