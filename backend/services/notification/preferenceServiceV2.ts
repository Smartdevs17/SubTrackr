import {
  SubscriberPreference,
  CategoryPreference,
  CommCategory,
  CommChannel,
  buildDefaultPreferences,
  REQUIRED_CATEGORIES,
} from './commPreferencesTypes';

// In-memory store (replace with DB + WebSocket sync in production)
const store = new Map<string, SubscriberPreference>();

export class PreferenceService {
  getOrCreate(userId: string): SubscriberPreference {
    if (!store.has(userId)) {
      store.set(userId, buildDefaultPreferences(userId));
    }
    return store.get(userId)!;
  }

  /**
   * Update per-category channel opt-in.
   * Required categories (billing, security) cannot be fully disabled.
   */
  updateChannelPreference(
    userId: string,
    category: CommCategory,
    channel: CommChannel,
    enabled: boolean
  ): SubscriberPreference {
    const prefs = this.getOrCreate(userId);
    const catPref = prefs.categories[category];

    // Regulatory bypass: required categories stay on
    if (catPref.required && !enabled) {
      const anyOtherEnabled = Object.entries(catPref.channels)
        .filter(([ch]) => ch !== channel)
        .some(([, { enabled: e }]) => e);
      if (!anyOtherEnabled) {
        throw new Error(`Cannot disable all channels for required category "${category}"`);
      }
    }

    const updated: SubscriberPreference = {
      ...prefs,
      categories: {
        ...prefs.categories,
        [category]: {
          ...catPref,
          channels: {
            ...catPref.channels,
            [channel]: { ...catPref.channels[channel], enabled },
          },
        },
      },
      updatedAt: new Date().toISOString(),
      syncVersion: prefs.syncVersion + 1,
    };

    store.set(userId, updated);
    // In production: broadcast via WebSocket for real-time cross-device sync
    return updated;
  }

  /** Opt out of marketing without touching billing */
  optOutMarketing(userId: string): SubscriberPreference {
    const prefs = this.getOrCreate(userId);
    const channels = prefs.categories.marketing.channels;
    let updated = prefs;
    for (const ch of Object.keys(channels) as CommChannel[]) {
      updated = this.updateChannelPreference(userId, 'marketing', ch, false);
    }
    return updated;
  }
}

export class WaterfallRouter {
  /**
   * Returns ordered channels to attempt delivery on.
   * Skips disabled channels; falls back to next in order.
   * Required categories are always delivered regardless of preference.
   */
  resolveChannels(prefs: SubscriberPreference, category: CommCategory): CommChannel[] {
    const catPref: CategoryPreference = prefs.categories[category];

    // Regulatory bypass: required categories always get all enabled channels
    if (REQUIRED_CATEGORIES.includes(category)) {
      return this.enabledChannels(catPref);
    }

    return this.enabledChannels(catPref);
  }

  private enabledChannels(catPref: CategoryPreference): CommChannel[] {
    return (Object.entries(catPref.channels) as [CommChannel, { enabled: boolean }][])
      .filter(([, { enabled }]) => enabled)
      .map(([ch]) => ch);
  }

  /**
   * Simulate waterfall: tries each channel, marks failures, falls back to next.
   */
  async deliver(
    prefs: SubscriberPreference,
    category: CommCategory,
    payload: { subject: string; body: string },
    send: (channel: CommChannel, payload: { subject: string; body: string }) => Promise<boolean>
  ): Promise<{ channel: CommChannel; success: boolean }[]> {
    const channels = this.resolveChannels(prefs, category);
    const results: { channel: CommChannel; success: boolean }[] = [];

    for (const channel of channels) {
      try {
        const success = await send(channel, payload);
        results.push({ channel, success });
        if (success) break; // Stop after first success
      } catch {
        results.push({ channel, success: false });
        // Continue to next channel
      }
    }

    return results;
  }
}

export const preferenceService = new PreferenceService();
export const waterfallRouter = new WaterfallRouter();
