/**
 * mobile/src/screens/support/SupportChatWidget.tsx
 *
 * Inline support chat surface. The component is intentionally presentational:
 * all state transitions live in `supportChatController` so they can be unit
 * tested without the React Native Jest preset.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ChatMessage, SupportChatController, SupportChatState } from './types';

export interface SupportChatWidgetProps {
  controller: SupportChatController;
  title?: string;
  placeholder?: string;
  testID?: string;
}

const COLORS = {
  background: '#FFFFFF',
  border: '#E2E8F0',
  primary: '#2563EB',
  agent: '#F1F5F9',
  user: '#DBEAFE',
  muted: '#64748B',
  error: '#B91C1C',
  text: '#0F172A',
};

export const SupportChatWidget: React.FC<SupportChatWidgetProps> = ({
  controller,
  title = 'Support',
  placeholder = 'Describe your issue…',
  testID = 'support-chat-widget',
}) => {
  const [state, setState] = useState<SupportChatState>(() => controller.getState());
  const [draft, setDraft] = useState('');

  useEffect(() => controller.subscribe(setState), [controller]);

  useEffect(() => {
    void controller.load();
  }, [controller]);

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body || state.isSending) return;
    setDraft('');
    try {
      await controller.send(body);
    } catch {
      setDraft(body);
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }): React.ReactElement => (
    <View
      accessibilityRole="text"
      style={[
        styles.bubble,
        item.role === 'user' ? styles.userBubble : styles.agentBubble,
        item.status === 'failed' ? styles.failedBubble : null,
      ]}
      testID={`${testID}-message-${item.id}`}>
      <Text style={styles.messageText}>{item.body}</Text>
    </View>
  );

  return (
    <View
      accessibilityRole="form"
      accessibilityLabel={title}
      style={styles.container}
      testID={testID}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {state.ticket ? (
        <Text accessibilityRole="text" style={styles.ticketBanner} testID={`${testID}-ticket`}>
          {`Ticket ${state.ticket.id} · ${state.ticket.status}`}
        </Text>
      ) : null}
      <FlatList
        data={state.messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        style={styles.list}
        testID={`${testID}-messages`}
      />
      {state.error ? (
        <Text accessibilityRole="alert" style={styles.error} testID={`${testID}-error`}>
          {state.error}
        </Text>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Support message"
          multiline
          onChangeText={setDraft}
          placeholder={placeholder}
          style={styles.input}
          testID={`${testID}-input`}
          value={draft}
        />
        {state.isSending ? (
          <ActivityIndicator accessibilityLabel="Sending message" testID={`${testID}-sending`} />
        ) : null}
        <TouchableOpacity
          accessibilityLabel="Send message"
          accessibilityRole="button"
          disabled={state.isSending || draft.trim().length === 0}
          onPress={() => void send()}
          style={styles.sendButton}
          testID={`${testID}-send`}>
          <Text style={styles.sendLabel}>Send</Text>
        </TouchableOpacity>
      </View>
      {state.ticket ? null : (
        <TouchableOpacity
          accessibilityLabel="Request a human support agent"
          accessibilityRole="button"
          onPress={() => void controller.requestHandoff()}
          style={styles.handoffButton}
          testID={`${testID}-handoff`}>
          <Text style={styles.handoffLabel}>Talk to a person</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 560,
    padding: 12,
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  ticketBanner: {
    color: COLORS.muted,
    fontSize: 12,
    marginBottom: 8,
  },
  list: {
    flexGrow: 0,
    maxHeight: 360,
  },
  bubble: {
    borderRadius: 10,
    marginVertical: 4,
    maxWidth: '85%',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.user,
  },
  agentBubble: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.agent,
  },
  failedBubble: {
    borderColor: COLORS.error,
    borderWidth: 1,
  },
  messageText: {
    color: COLORS.text,
    fontSize: 14,
  },
  error: {
    color: COLORS.error,
    fontSize: 12,
    marginTop: 6,
  },
  composer: {
    alignItems: 'center',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
  },
  input: {
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    maxHeight: 96,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sendButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendLabel: {
    color: COLORS.background,
    fontWeight: '600',
  },
  handoffButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 6,
  },
  handoffLabel: {
    color: COLORS.primary,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
