/**
 * Notification template versioning (#1748)
 *
 * `NotificationCenterService.upsertTemplate` keeps only the current template per
 * `(type, channel)` pair — every save overwrites the last, so a bad edit is
 * irreversible. This service adds the missing history: each save is a new
 * immutable version chained to a stable root, and a rollback republishes an
 * earlier snapshot as a *new* version rather than rewinding time.
 *
 * Why rollback is a forward move
 * ──────────────────────────────
 * Rewriting the version number to an old value would make two different bodies
 * claim the same version, so a message sent after a rollback could not be told
 * apart from one sent before the bad edit. Publishing the restored snapshot as
 * the next version keeps every version number unique and monotonic, and the
 * `restoredFrom` marker records where the content came from.
 *
 * Mirrors the versioning model of `PlanTemplateService` and the frontend
 * `EmailTemplateService` so the two surfaces behave the same.
 */

import type { NotificationChannel, NotificationType } from '../../../src/types/notification';

/** Identifier of a template within the library: `type:channel`. */
export type TemplateKey = string;

export interface NotificationTemplateVersion {
  /** Template identity, `type:channel`. */
  id: TemplateKey;
  type: NotificationType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  variables: string[];
  /** Monotonic within a template; never reused. */
  version: number;
  createdAt: string;
  /** Set when this version was produced by rolling back to `restoredFrom`. */
  restoredFrom?: number;
}

export interface TemplateVersionSnapshot extends NotificationTemplateVersion {
  /** Present on every non-first version — the version it superseded. */
  supersedes?: number;
}

export interface TemplateDraft {
  type: NotificationType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  variables: string[];
}

/** Storage abstraction — implemented by the persistence layer. */
export interface TemplateVersionRepository {
  /** Append a version; never overwrites an existing one. */
  save(version: NotificationTemplateVersion): Promise<void>;
  /** All versions of one template, oldest first. */
  listVersions(id: TemplateKey): Promise<NotificationTemplateVersion[]>;
  listAll(): Promise<NotificationTemplateVersion[]>;
}

/** In-memory repository — tests and local development. */
export class InMemoryTemplateVersionRepository implements TemplateVersionRepository {
  private readonly byId = new Map<TemplateKey, NotificationTemplateVersion[]>();

  async save(version: NotificationTemplateVersion): Promise<void> {
    const history = this.byId.get(version.id) ?? [];
    history.push({ ...version, variables: [...version.variables] });
    this.byId.set(version.id, history);
  }

  async listVersions(id: TemplateKey): Promise<NotificationTemplateVersion[]> {
    return (this.byId.get(id) ?? []).map(cloneVersion).sort((a, b) => a.version - b.version);
  }

  async listAll(): Promise<NotificationTemplateVersion[]> {
    return [...this.byId.values()]
      .flat()
      .map(cloneVersion)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

function cloneVersion(version: NotificationTemplateVersion): NotificationTemplateVersion {
  return { ...version, variables: [...version.variables] };
}

export const templateKeyOf = (type: NotificationType, channel: NotificationChannel): TemplateKey =>
  `${type}:${channel}`;

/** Errors raised by the service — the router maps these onto HTTP statuses. */
export class TemplateVersionError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid_version' | 'no_versions'
  ) {
    super(message);
    this.name = 'TemplateVersionError';
  }
}

export class NotificationTemplateVersionService {
  constructor(
    private readonly repo: TemplateVersionRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Save a draft as the next version of its template.
   *
   * Returns both the stored version and whether the content actually changed —
   * a no-op save does not create a version, so the history stays meaningful.
   */
  async saveDraft(
    draft: TemplateDraft
  ): Promise<{ version: NotificationTemplateVersion; created: boolean }> {
    const id = templateKeyOf(draft.type, draft.channel);
    const history = await this.repo.listVersions(id);
    const latest = history[history.length - 1];

    if (latest && sameContent(latest, draft)) {
      return { version: latest, created: false };
    }

    const version: TemplateVersionSnapshot = {
      ...draft,
      id,
      version: (latest?.version ?? 0) + 1,
      createdAt: this.now().toISOString(),
      supersedes: latest?.version,
    };
    await this.repo.save(version);
    return { version, created: true };
  }

  /** The currently active version for a template, or null. */
  async getCurrent(type: NotificationType, channel: NotificationChannel): Promise<NotificationTemplateVersion | null> {
    const history = await this.repo.listVersions(templateKeyOf(type, channel));
    return history.length === 0 ? null : history[history.length - 1];
  }

  /** Every version of a template, oldest first. */
  async listVersions(type: NotificationType, channel: NotificationChannel): Promise<NotificationTemplateVersion[]> {
    return this.repo.listVersions(templateKeyOf(type, channel));
  }

  /** Templates with at least one version, as `type:channel` keys. */
  async listTemplates(): Promise<TemplateKey[]> {
    const all = await this.repo.listAll();
    return [...new Set(all.map((version) => version.id))].sort();
  }

  /**
   * Roll back a template to `targetVersion` by republishing its content as the
   * next version. The bad version stays in the history — nothing is deleted.
   */
  async rollback(
    type: NotificationType,
    channel: NotificationChannel,
    targetVersion: number
  ): Promise<NotificationTemplateVersion> {
    const id = templateKeyOf(type, channel);
    const history = await this.repo.listVersions(id);
    if (history.length === 0) {
      throw new TemplateVersionError(`No versions recorded for ${id}`, 'no_versions');
    }

    const target = history.find((version) => version.version === targetVersion);
    if (!target) {
      throw new TemplateVersionError(
        `Version ${targetVersion} does not exist for ${id}`,
        'invalid_version'
      );
    }

    const latest = history[history.length - 1]!;
    if (latest.version === target.version) {
      // Rolling back to the current version is a no-op, not an error.
      return latest;
    }

    const restored: NotificationTemplateVersion = {
      id,
      type,
      channel,
      subject: target.subject,
      body: target.body,
      variables: [...target.variables],
      version: latest.version + 1,
      createdAt: this.now().toISOString(),
      restoredFrom: target.version,
    };
    await this.repo.save(restored);
    return restored;
  }
}

/** True when the draft would not change the latest version's content. */
function sameContent(
  version: NotificationTemplateVersion,
  draft: TemplateDraft
): boolean {
  return (
    version.subject === draft.subject &&
    version.body === draft.body &&
    version.variables.length === draft.variables.length &&
    version.variables.every((name, index) => name === draft.variables[index])
  );
}

export const templateVersionRepository = new InMemoryTemplateVersionRepository();
export const notificationTemplateVersionService = new NotificationTemplateVersionService(
  templateVersionRepository
);
