/**
 * mobile/src/screens/support/types.ts
 *
 * Contracts for the inline support chat widget and its ticket handoff.
 */

export type ChatRole = 'user' | 'agent' | 'system';

export type ChatDeliveryStatus = 'sending' | 'sent' | 'failed';

export type HandoffReason =
  | 'user_request'
  | 'repeated_questions'
  | 'negative_sentiment'
  | 'complex_topic'
  | 'manual';

export type TicketStatus = 'open' | 'pending' | 'resolved';

export type TicketPriority = 'normal' | 'high';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  body: string;
  createdAt: number;
  status?: ChatDeliveryStatus;
}

export interface SupportTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: number;
  handoffReason: HandoffReason;
  transcript: ChatMessage[];
}

export type SupportChatStatus = 'idle' | 'active' | 'handed_off' | 'error';

export interface SupportChatState {
  messages: ChatMessage[];
  ticket: SupportTicket | null;
  status: SupportChatStatus;
  error: string | null;
  isSending: boolean;
  unreadCount: number;
}

export interface TicketHandoffRequest {
  subject: string;
  reason: HandoffReason;
  transcript: ChatMessage[];
}

export interface SupportChatApi {
  sendMessage(body: string, ticketId?: string): Promise<ChatMessage>;
  createTicket(request: TicketHandoffRequest): Promise<SupportTicket>;
}

export interface SupportChatStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SupportChatLogger {
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface SupportChatMetrics {
  increment?(name: string, value?: number, tags?: Record<string, string>): void;
}

export interface HandoffPolicy {
  /** Consecutive user turns without an agent reply before escalating. */
  maxUnansweredUserTurns: number;
  /** Phrases that explicitly ask for a human. */
  humanRequestPhrases: string[];
  /** Phrases that indicate a high-risk complaint. */
  negativePhrases: string[];
  /** Phrases that need a specialist rather than an automated answer. */
  complexPhrases: string[];
  /** Maximum characters kept in a generated ticket subject. */
  subjectLength: number;
}

export interface HandoffDecision {
  shouldHandoff: boolean;
  reason: HandoffReason | null;
  subject: string | null;
}

export interface SupportChatController {
  getState(): SupportChatState;
  subscribe(listener: (state: SupportChatState) => void): () => void;
  load(): Promise<void>;
  send(body: string): Promise<ChatMessage>;
  requestHandoff(reason?: HandoffReason): Promise<SupportTicket>;
  markRead(): void;
  reset(): Promise<void>;
}
