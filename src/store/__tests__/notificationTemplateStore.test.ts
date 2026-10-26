/**
 * Tests for notificationTemplateStore (#1748)
 */

import { useNotificationTemplateStore, templateKeyOf } from '../notificationTemplateStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const store = () => useNotificationTemplateStore.getState();

const draft = (overrides: Record<string, unknown> = {}) => ({
  type: 'renewal_reminder' as const,
  channel: 'email' as const,
  subject: 'Renewal soon',
  body: 'Hi {{name}}',
  variables: ['name'],
  ...overrides,
});

beforeEach(() => {
  useNotificationTemplateStore.setState({ versions: {} });
});

describe('templateKeyOf', () => {
  it('joins type and channel', () => {
    expect(templateKeyOf('digest', 'push')).toBe('digest:push');
  });
});

describe('notificationTemplateStore.saveDraft', () => {
  it('starts at version 1', () => {
    const { version, created } = store().saveDraft(draft());
    expect(created).toBe(true);
    expect(version.version).toBe(1);
  });

  it('increments on a changed save', () => {
    store().saveDraft(draft());
    const { version } = store().saveDraft(draft({ body: 'Changed' }));
    expect(version.version).toBe(2);
  });

  it('is a no-op when content is unchanged', () => {
    store().saveDraft(draft());
    const { created, version } = store().saveDraft(draft());
    expect(created).toBe(false);
    expect(version.version).toBe(1);
    expect(store().listVersions('renewal_reminder', 'email')).toHaveLength(1);
  });

  it('keeps histories independent per channel', () => {
    store().saveDraft(draft({ channel: 'email' }));
    store().saveDraft(draft({ channel: 'sms' }));
    expect(store().listVersions('renewal_reminder', 'email')).toHaveLength(1);
    expect(store().listVersions('renewal_reminder', 'sms')).toHaveLength(1);
  });
});

describe('notificationTemplateStore.rollback', () => {
  it('republishes an earlier snapshot as a new version', () => {
    store().saveDraft(draft({ subject: 'Good' }));
    store().saveDraft(draft({ subject: 'Bad' }));

    const restored = store().rollback('renewal_reminder', 'email', 1);

    expect(restored?.version).toBe(3);
    expect(restored?.subject).toBe('Good');
    expect(restored?.restoredFrom).toBe(1);
  });

  it('keeps the bad version in history', () => {
    store().saveDraft(draft({ subject: 'Good' }));
    store().saveDraft(draft({ subject: 'Bad' }));
    store().rollback('renewal_reminder', 'email', 1);

    const versions = store().listVersions('renewal_reminder', 'email');
    expect(versions.map((v) => v.subject)).toEqual(['Good', 'Bad', 'Good']);
  });

  it('returns null for an unknown version', () => {
    store().saveDraft(draft());
    expect(store().rollback('renewal_reminder', 'email', 99)).toBeNull();
  });

  it('returns the current version when already current', () => {
    store().saveDraft(draft());
    const current = store().getCurrent('renewal_reminder', 'email');
    expect(store().rollback('renewal_reminder', 'email', current!.version)?.version).toBe(1);
  });
});

describe('notificationTemplateStore selectors', () => {
  it('returns null for an unknown template', () => {
    expect(store().getCurrent('digest', 'push')).toBeNull();
    expect(store().listVersions('digest', 'push')).toEqual([]);
  });

  it('returns versions oldest first', () => {
    store().saveDraft(draft({ subject: 'v1' }));
    store().saveDraft(draft({ subject: 'v2' }));
    expect(
      store()
        .listVersions('renewal_reminder', 'email')
        .map((v) => v.subject)
    ).toEqual(['v1', 'v2']);
  });
});
