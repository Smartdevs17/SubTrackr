/**
 * mobile/src/screens/support/supportChatController.ts
 *
 * Transport-agnostic state machine behind the inline support widget:
 * optimistic messages, delivery failures, conversation persistence and
 * automatic/manual handoff into a support ticket.
 */

import {
  DEFAULT_HANDOFF_POLICY,
  detectHandoffReason,
  evaluateHandoff,
  generateTicketSubject,
} from './ticketHandoff';
import type {
  ChatMessage,
  HandoffPolicy,
  HandoffReason,
  SupportChatApi,
  SupportChatController,
  SupportChatLogger,
  SupportChatMetrics,
  SupportChatState,
  SupportChatStorage,
  SupportTicket,
} from './types';

const DEFAULT_STORAGE_KEY = '@subtrackr_support_chat';
const MAX_MESSAGE_LENGTH = 2000;
const METRIC_PREFIX = 'subtrackr.supportChat';

export interface SupportChatControllerOptions {
  api: SupportChatApi;
  storage?: SupportChatStorage;
  storageKey?: string;
  policy?: HandoffPolicy;
  logger?: SupportChatLogger;
  metrics?: SupportChatMetrics;
  idFactory?: () => string;
  now?: () => number;
}

function initialState(): SupportChatState {
  return {
    messages: [],
    ticket: null,
    status: 'idle',
    error: null,
    isSending: false,
    unreadCount: 0,
  };
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Partial<ChatMessage>;
  return (
    typeof message.id === 'string' &&
    typeof message.body === 'string' &&
    typeof message.createdAt === 'number' &&
    (message.role === 'user' || message.role === 'agent' || message.role === 'system')
  );
}

function isSupportTicket(value: unknown): value is SupportTicket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ticket = value as Partial<SupportTicket>;
  return (
    typeof ticket.id === 'string' &&
    typeof ticket.subject === 'string' &&
    typeof ticket.createdAt === 'number' &&
    Array.isArray(ticket.transcript)
  );
}

export function createSupportChatController(
  options: SupportChatControllerOptions
): SupportChatController {
  const api = options.api;
  const storage = options.storage;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const policy = options.policy ?? DEFAULT_HANDOFF_POLICY;
  const log = options.logger;
  const metrics = options.metrics;
  const idFactory = options.idFactory ?? (() => `chat-${Date.now()}-${Math.random()}`);
  const now = options.now ?? Date.now;

  let state = initialState();
  const listeners = new Set<(next: SupportChatState) => void>();

  const emit = (): void => {
    for (const listener of listeners) listener(state);
  };

  const setState = (patch: Partial<SupportChatState>): void => {
    state = { ...state, ...patch };
    emit();
  };

  const persist = async (): Promise<void> => {
    if (!storage) return;
    try {
      await storage.setItem(
        storageKey,
        JSON.stringify({ messages: state.messages, ticket: state.ticket })
      );
    } catch (error) {
      log?.warn?.('Support chat could not be persisted', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  };

  const emitMetric = (name: string, tags?: Record<string, string>): void => {
    metrics?.increment?.(`${METRIC_PREFIX}.${name}`, 1, tags);
  };

  const requestHandoff = async (reason: HandoffReason = 'manual'): Promise<SupportTicket> => {
    if (state.ticket) return state.ticket;

    const decision = evaluateHandoff(state.messages, policy);
    const resolvedReason: HandoffReason =
      reason === 'manual' ? (decision.reason ?? 'manual') : reason;
    const transcript = state.messages.filter((message) => message.status !== 'sending');
    const subject = decision.subject ?? generateTicketSubject(transcript, policy);

    try {
      const ticket = await api.createTicket({ subject, reason: resolvedReason, transcript });
      const notice: ChatMessage = {
        id: idFactory(),
        role: 'system',
        body: `Support ticket ${ticket.id} created. An agent will continue here.`,
        createdAt: now(),
      };
      setState({
        ticket,
        messages: [...state.messages, notice],
        status: 'handed_off',
        error: null,
      });
      await persist();
      emitMetric('ticket_created', { reason: resolvedReason, priority: ticket.priority });
      log?.info?.('Support ticket handoff completed', {
        ticketId: ticket.id,
        reason: resolvedReason,
      });
      return ticket;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ticket could not be created';
      setState({ status: 'error', error: message });
      emitMetric('handoff_failed');
      log?.error?.('Support ticket handoff failed', { reason: message });
      throw error;
    }
  };

  return {
    getState(): SupportChatState {
      return state;
    },

    subscribe(listener: (next: SupportChatState) => void): () => void {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },

    async load(): Promise<void> {
      if (!storage) return;
      try {
        const raw = await storage.getItem(storageKey);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        const saved = parsed as { messages?: unknown; ticket?: unknown };
        const messages = Array.isArray(saved.messages) ? saved.messages.filter(isChatMessage) : [];
        const ticket = isSupportTicket(saved.ticket) ? saved.ticket : null;
        setState({
          messages,
          ticket,
          status: ticket ? 'handed_off' : messages.length > 0 ? 'active' : 'idle',
          error: null,
        });
      } catch (error) {
        log?.warn?.('Stored support chat could not be read', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    },

    async send(body: string): Promise<ChatMessage> {
      const trimmed = body.trim();
      if (!trimmed) throw new Error('Message cannot be empty');
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
      }

      const optimistic: ChatMessage = {
        id: idFactory(),
        role: 'user',
        body: trimmed,
        createdAt: now(),
        status: 'sending',
      };
      setState({
        messages: [...state.messages, optimistic],
        status: state.status === 'idle' ? 'active' : state.status,
        error: null,
        isSending: true,
      });
      await persist();

      try {
        const delivered = await api.sendMessage(trimmed, state.ticket?.id);
        const confirmed: ChatMessage = {
          ...delivered,
          status: 'sent',
          id: delivered.id || optimistic.id,
          createdAt: delivered.createdAt || optimistic.createdAt,
        };
        const messages = state.messages.map((message) =>
          message.id === optimistic.id ? confirmed : message
        );
        setState({ messages, status: state.ticket ? 'handed_off' : 'active', isSending: false });
        await persist();
        emitMetric('message_sent');

        if (!state.ticket) {
          const reason = detectHandoffReason(trimmed, policy);
          if (reason) {
            emitMetric('handoff_detected', { reason });
            await requestHandoff(reason);
          }
        }
        return confirmed;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Message could not be sent';
        const messages = state.messages.map((item) =>
          item.id === optimistic.id ? { ...item, status: 'failed' as const } : item
        );
        setState({ messages, status: 'error', error: message, isSending: false });
        await persist();
        emitMetric('send_failed');
        log?.error?.('Support chat message failed', { reason: message });
        throw error;
      }
    },

    requestHandoff,

    markRead(): void {
      setState({ unreadCount: 0 });
    },

    async reset(): Promise<void> {
      state = initialState();
      emit();
      if (storage) {
        try {
          await storage.removeItem(storageKey);
        } catch (error) {
          log?.warn?.('Support chat could not be cleared', {
            error: error instanceof Error ? error.message : 'unknown',
          });
        }
      }
    },
  };
}
