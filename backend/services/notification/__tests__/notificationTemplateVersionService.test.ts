/**
 * Notification template versioning (#1748) — service.
 */

import {
  NotificationTemplateVersionService,
  InMemoryTemplateVersionRepository,
  TemplateVersionError,
  templateKeyOf,
} from '../notificationTemplateVersionService';

function makeService(): NotificationTemplateVersionService {
  let tick = 0;
  const base = Date.UTC(2026, 2, 1, 12, 0, 0);
  return new NotificationTemplateVersionService(
    new InMemoryTemplateVersionRepository(),
    () => new Date(base + tick++ * 1000)
  );
}

const draft = (overrides: Record<string, unknown> = {}) => ({
  type: 'renewal_reminder' as const,
  channel: 'email' as const,
  subject: 'Your renewal is coming up',
  body: 'Hi {{name}}, {{plan}} renews soon.',
  variables: ['name', 'plan'],
  ...overrides,
});

describe('templateKeyOf', () => {
  it('joins type and channel', () => {
    expect(templateKeyOf('renewal_reminder', 'sms')).toBe('renewal_reminder:sms');
  });
});

describe('NotificationTemplateVersionService.saveDraft', () => {
  it('starts a template at version 1', async () => {
    const service = makeService();
    const { version, created } = await service.saveDraft(draft());

    expect(created).toBe(true);
    expect(version.version).toBe(1);
    expect(version.supersedes).toBeUndefined();
    expect(version.subject).toBe('Your renewal is coming up');
  });

  it('increments the version on a changed save', async () => {
    const service = makeService();
    await service.saveDraft(draft());
    const { version } = await service.saveDraft(draft({ body: 'New body {{name}}' }));

    expect(version.version).toBe(2);
    expect(version.supersedes).toBe(1);
  });

  it('is a no-op when the content is unchanged', async () => {
    const service = makeService();
    await service.saveDraft(draft());
    const { version, created } = await service.saveDraft(draft());

    expect(created).toBe(false);
    expect(version.version).toBe(1);
    expect(await service.listVersions('renewal_reminder', 'email')).toHaveLength(1);
  });

  it('treats a reordered variable list as a change', async () => {
    const service = makeService();
    await service.saveDraft(draft({ variables: ['name', 'plan'] }));
    const { version } = await service.saveDraft(draft({ variables: ['plan', 'name'] }));
    expect(version.version).toBe(2);
  });

  it('keeps independent histories per channel', async () => {
    const service = makeService();
    await service.saveDraft(draft({ channel: 'email' }));
    await service.saveDraft(draft({ channel: 'sms' }));

    expect(await service.listVersions('renewal_reminder', 'email')).toHaveLength(1);
    expect(await service.listVersions('renewal_reminder', 'sms')).toHaveLength(1);
  });
});

describe('NotificationTemplateVersionService queries', () => {
  it('returns the current version', async () => {
    const service = makeService();
    await service.saveDraft(draft());
    await service.saveDraft(draft({ subject: 'Second' }));

    const current = await service.getCurrent('renewal_reminder', 'email');
    expect(current?.version).toBe(2);
    expect(current?.subject).toBe('Second');
  });

  it('returns null for an unknown template', async () => {
    const service = makeService();
    expect(await service.getCurrent('digest', 'push')).toBeNull();
  });

  it('lists templates with recorded versions', async () => {
    const service = makeService();
    await service.saveDraft(draft({ channel: 'email' }));
    await service.saveDraft(draft({ type: 'security_alert', channel: 'sms' }));

    expect(await service.listTemplates()).toEqual(['renewal_reminder:email', 'security_alert:sms']);
  });

  it('returns versions oldest first', async () => {
    const service = makeService();
    await service.saveDraft(draft({ subject: 'v1' }));
    await service.saveDraft(draft({ subject: 'v2' }));
    await service.saveDraft(draft({ subject: 'v3' }));

    const versions = await service.listVersions('renewal_reminder', 'email');
    expect(versions.map((v) => v.subject)).toEqual(['v1', 'v2', 'v3']);
  });
});

describe('NotificationTemplateVersionService.rollback', () => {
  it('republishes an earlier snapshot as a new version', async () => {
    const service = makeService();
    await service.saveDraft(draft({ subject: 'Good v1' }));
    await service.saveDraft(draft({ subject: 'Bad v2' }));

    const restored = await service.rollback('renewal_reminder', 'email', 1);

    expect(restored.version).toBe(3);
    expect(restored.subject).toBe('Good v1');
    expect(restored.restoredFrom).toBe(1);
  });

  it('keeps the bad version in the history', async () => {
    const service = makeService();
    await service.saveDraft(draft({ subject: 'Good v1' }));
    await service.saveDraft(draft({ subject: 'Bad v2' }));
    await service.rollback('renewal_reminder', 'email', 1);

    const versions = await service.listVersions('renewal_reminder', 'email');
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions[1]!.subject).toBe('Bad v2');
  });

  it('makes the restored content current', async () => {
    const service = makeService();
    await service.saveDraft(draft({ subject: 'Good v1' }));
    await service.saveDraft(draft({ subject: 'Bad v2' }));
    await service.rollback('renewal_reminder', 'email', 1);

    const current = await service.getCurrent('renewal_reminder', 'email');
    expect(current?.subject).toBe('Good v1');
    expect(current?.version).toBe(3);
  });

  it('is a no-op when rolling back to the current version', async () => {
    const service = makeService();
    await service.saveDraft(draft());
    await service.saveDraft(draft({ subject: 'Latest' }));

    const restored = await service.rollback('renewal_reminder', 'email', 2);
    expect(restored.version).toBe(2);
    expect(await service.listVersions('renewal_reminder', 'email')).toHaveLength(2);
  });

  it('throws for an unknown version', async () => {
    const service = makeService();
    await service.saveDraft(draft());
    await expect(service.rollback('renewal_reminder', 'email', 99)).rejects.toMatchObject({
      code: 'invalid_version',
    });
  });

  it('throws when there is no history at all', async () => {
    const service = makeService();
    await expect(service.rollback('digest', 'push', 1)).rejects.toBeInstanceOf(TemplateVersionError);
  });
});
