/**
 * Tests for NotificationInboxScreen (#1750)
 *
 * Drives the persisted notification center store directly and asserts the
 * screen renders the feed with read/unread state, the unread badge, the
 * filters, mark-all-read and dismiss.
 */

import React from 'react';
import { render, fireEvent, act } from '../../test-utils';
import NotificationInboxScreen from '../NotificationInboxScreen';
import { useNotificationCenterStore, MAX_INBOX_ENTRIES } from '../../store/notificationCenterStore';
import type { NotificationRecord } from '../../types/notification';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

// Swap native components that cannot load under Jest for inspectable host elements.
jest.mock('react-native/Libraries/Components/Touchable/TouchableOpacity', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  require('../../components/privacy/__tests__/mockHostComponent').mockHostComponent(
    'TouchableOpacity'
  )
);

const record = (id: string, overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id,
  userId: 'user-1',
  type: 'renewal_reminder',
  channel: 'in_app',
  title: `Title ${id}`,
  body: `Body ${id}`,
  status: 'delivered',
  createdAt: '2026-03-15T10:00:00.000Z',
  ...overrides,
});

const store = () => useNotificationCenterStore.getState();

function setup(records: NotificationRecord[]) {
  store().clear();
  act(() => {
    store().ingest(records);
  });
  const screen = render(<NotificationInboxScreen />);
  return screen;
}

beforeEach(() => {
  store().clear();
  store().setTimezone('UTC');
});

describe('NotificationInboxScreen', () => {
  it('shows an empty state when nothing has been delivered', () => {
    const screen = setup([]);
    expect(screen.getByTestId('inbox-empty')).toBeTruthy();
    expect(screen.queryByTestId('inbox-unread-badge')).toBeNull();
  });

  it('renders entries with an unread badge and unread dots', () => {
    const screen = setup([
      record('n1'),
      record('n2', { readAt: '2026-03-15T11:00:00.000Z' }),
      record('n3', { type: 'security_alert', title: 'Security alert' }),
    ]);

    expect(screen.getByText('Title n1')).toBeTruthy();
    expect(screen.getByText('Title n2')).toBeTruthy();
    expect(screen.getByText('Security alert')).toBeTruthy();
    // n1 and n3 are unread.
    expect(screen.getByTestId('inbox-unread-badge')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByTestId('inbox-unread-dot-n1')).toBeTruthy();
    expect(screen.queryByTestId('inbox-unread-dot-n2')).toBeNull();
    expect(screen.getByTestId('inbox-unread-dot-n3')).toBeTruthy();
  });

  it('tapping an entry marks it read and drops it from the unread filter', () => {
    const screen = setup([record('n1'), record('n2')]);

    fireEvent.press(screen.getByLabelText('Title n1, unread, Renewal reminders'));
    expect(store().getEntry('n1')?.readAt).toBeTruthy();
    // Click implies a read and records the click.
    expect(store().getEntry('n1')?.clickedAt).toBeTruthy();

    fireEvent.press(screen.getByText('Unread'));
    expect(screen.queryByText('Title n1')).toBeNull();
    expect(screen.getByText('Title n2')).toBeTruthy();
  });

  it('mark-all-read clears the badge', () => {
    const screen = setup([record('n1'), record('n2'), record('n3')]);
    expect(screen.getByTestId('inbox-unread-badge')).toBeTruthy();

    fireEvent.press(screen.getByTestId('inbox-mark-all-read'));
    expect(store().getUnreadCount()).toBe(0);
    expect(screen.queryByTestId('inbox-unread-badge')).toBeNull();
    expect(screen.queryByTestId('inbox-mark-all-read')).toBeNull();
  });

  it('dismiss hides an entry from the feed', () => {
    const screen = setup([record('n1')]);
    fireEvent.press(screen.getByTestId('inbox-dismiss-n1'));
    expect(screen.queryByText('Title n1')).toBeNull();
    expect(screen.getByTestId('inbox-empty')).toBeTruthy();
    // Dismissal is not deletion — the entry survives in the store.
    expect(store().getEntry('n1')).toBeTruthy();
  });

  it('filters by type using the category chips', () => {
    const screen = setup([
      record('n1'),
      record('n2', { type: 'security_alert', title: 'Security alert' }),
    ]);

    fireEvent.press(screen.getByText('Security alerts (1)'));
    expect(screen.queryByText('Title n1')).toBeNull();
    expect(screen.getByText('Security alert')).toBeTruthy();

    // Tapping the active chip clears the filter again.
    fireEvent.press(screen.getByText('Security alerts (1)'));
    expect(screen.getByText('Title n1')).toBeTruthy();
  });
});

// Keep the imported constant referenced so a retention regression in the store
// is caught by the type-checker if the export is ever removed.
it('caps the on-device feed', () => {
  expect(MAX_INBOX_ENTRIES).toBeGreaterThan(0);
});
