/**
 * notificationTemplateStore — client-side notification template versions (#1748)
 *
 * The backend `NotificationTemplateVersionService` owns persisted versioning and
 * rollback over HTTP; this store is the on-device mirror the template editor
 * reads and writes. It keeps the same model — every save is a new immutable
 * version, and a rollback republishes an earlier snapshot as the next version,
 * never rewinding the number — so the two never disagree about what a version
 * means.
 *
 * Persisted, because an editor session should survive a relaunch; a draft that
 * disappeared on navigation would be worse than no history at all.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { asyncStorageAdapter } from '../utils/storage';
import type { NotificationChannel, NotificationType } from '../types/notification';

const STORAGE_KEY = 'subtrackr-notification-template-versions';

/** Identifier of a template within the library: `type:channel`. */
export type TemplateKey = string;

export interface NotificationTemplateVersion {
  id: TemplateKey;
  type: NotificationType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  variables: string[];
  version: number;
  createdAt: string;
  /** Set when this version was produced by rolling back. */
  restoredFrom?: number;
}

export interface TemplateDraft {
  type: NotificationType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  variables: string[];
}

export interface NotificationTemplateState {
  /** Versions per template key, oldest first. */
  versions: Record<TemplateKey, NotificationTemplateVersion[]>;
}

export interface NotificationTemplateActions {
  /** Save a draft as a new version; a no-op save returns the current version. */
  saveDraft: (draft: TemplateDraft) => { version: NotificationTemplateVersion; created: boolean };
  /**
   * Republish `targetVersion`'s content as the next version.
   * Returns null when the template or version is unknown.
   */
  rollback: (
    type: NotificationType,
    channel: NotificationChannel,
    targetVersion: number
  ) => NotificationTemplateVersion | null;
}

export interface NotificationTemplateSelectors {
  listVersions: (
    type: NotificationType,
    channel: NotificationChannel
  ) => NotificationTemplateVersion[];
  getCurrent: (
    type: NotificationType,
    channel: NotificationChannel
  ) => NotificationTemplateVersion | null;
}

export type NotificationTemplateStore = NotificationTemplateState &
  NotificationTemplateActions &
  NotificationTemplateSelectors;

export const templateKeyOf = (type: NotificationType, channel: NotificationChannel): TemplateKey =>
  `${type}:${channel}`;

const nowIso = (): string => new Date().toISOString();

function sameContent(version: NotificationTemplateVersion, draft: TemplateDraft): boolean {
  return (
    version.subject === draft.subject &&
    version.body === draft.body &&
    version.variables.length === draft.variables.length &&
    version.variables.every((name, index) => name === draft.variables[index])
  );
}

export const useNotificationTemplateStore = create<NotificationTemplateStore>()(
  persist(
    (set, get) => ({
      versions: {},

      saveDraft: (draft) => {
        const id = templateKeyOf(draft.type, draft.channel);
        const history = get().versions[id] ?? [];
        const latest = history[history.length - 1];

        if (latest && sameContent(latest, draft)) {
          return { version: latest, created: false };
        }

        const version: NotificationTemplateVersion = {
          ...draft,
          id,
          variables: [...draft.variables],
          version: (latest?.version ?? 0) + 1,
          createdAt: nowIso(),
        };
        set((state) => ({ versions: { ...state.versions, [id]: [...history, version] } }));
        return { version, created: true };
      },

      rollback: (type, channel, targetVersion) => {
        const id = templateKeyOf(type, channel);
        const history = get().versions[id] ?? [];
        const target = history.find((version) => version.version === targetVersion);
        if (!target) return null;

        const latest = history[history.length - 1]!;
        if (latest.version === target.version) return latest;

        const restored: NotificationTemplateVersion = {
          id,
          type,
          channel,
          subject: target.subject,
          body: target.body,
          variables: [...target.variables],
          version: latest.version + 1,
          createdAt: nowIso(),
          restoredFrom: target.version,
        };
        set((state) => ({ versions: { ...state.versions, [id]: [...history, restored] } }));
        return restored;
      },

      listVersions: (type, channel) => {
        const history = get().versions[templateKeyOf(type, channel)] ?? [];
        return [...history].sort((a, b) => a.version - b.version);
      },

      getCurrent: (type, channel) => {
        const history = get().versions[templateKeyOf(type, channel)] ?? [];
        return history.length === 0 ? null : history[history.length - 1]!;
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({ versions: state.versions }),
    }
  )
);
