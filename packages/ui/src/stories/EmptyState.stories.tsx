import { View } from 'react-native';
import { EmptyState } from '../EmptyState';

export default {
  title: 'Shared/EmptyState',
  component: EmptyState,
  parameters: {
    docs: {
      description: {
        component:
          'An accessible placeholder for a collection with no content. The action appears only when both actionText and onAction are supplied.',
      },
    },
  },
  argTypes: {
    icon: { control: 'text', description: 'Emoji or short text symbol shown above the title.' },
    title: { control: 'text' },
    message: { control: 'text' },
    actionText: { control: 'text' },
    onAction: { action: 'action pressed' },
  },
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

export const WithoutAction = {
  args: {
    icon: '🗂️',
    title: 'No saved views',
    message: 'Your saved filters will appear here.',
  },
};

export const ActionRequiresHandler = {
  args: {
    icon: '📭',
    title: 'No messages',
    message: 'There are no new messages to review.',
    actionText: 'Review messages',
  },
  render: () => (
    <EmptyState
      icon="📭"
      title="No messages"
      message="There are no new messages to review."
      actionText="Review messages"
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'An action label without a handler does not render an inert button.',
      },
    },
  },
};

export const InACollectionPanel = {
  render: () => (
    <View style={{ width: 340, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
      <EmptyState
        icon="🔎"
        title="No matching subscriptions"
        message="Try changing your search or clearing the selected filters."
      />
    </View>
  ),
  parameters: { controls: { disable: true } },
};
