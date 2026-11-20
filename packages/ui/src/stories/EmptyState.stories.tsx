import { EmptyState } from '../EmptyState';

export default {
  title: 'Shared/EmptyState',
  component: EmptyState,
};

export const Basic = {
  args: { icon: '📭', title: 'No subscriptions', message: 'Add your first subscription to start tracking.' },
};

export const WithAction = {
  args: {
    icon: '➕',
    title: 'Nothing here yet',
    message: 'Import subscriptions from a CSV or add one manually.',
    actionText: 'Add subscription',
    onAction: () => undefined,
  },
};
