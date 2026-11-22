/**
 * mobile/src/screens/support/ticketHandoff.ts
 *
 * Pure decision logic for escalating an inline support conversation to a
 * human-owned ticket. Kept free of React Native imports so it can be unit
 * tested with the TypeScript Jest config.
 */

import type {
  ChatMessage,
  HandoffDecision,
  HandoffPolicy,
  HandoffReason,
  TicketPriority,
} from './types';

export const DEFAULT_HANDOFF_POLICY: HandoffPolicy = {
  maxUnansweredUserTurns: 3,
  humanRequestPhrases: ['human', 'agent', 'representative', 'real person', 'someone help'],
  negativePhrases: ['chargeback', 'lawyer', 'legal action', 'this is fraud'],
  complexPhrases: ['unauthorized charge', 'security breach', 'data breach', 'double charged'],
  subjectLength: 80,
};

function escapeWord(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseMatcher(phrase: string): RegExp {
  const pattern = phrase.trim().split(/\s+/).filter(Boolean).map(escapeWord).join('\\s+');
  return new RegExp(`(^|\\W)${pattern}(\\W|$)`, 'i');
}

export function matchesPhrase(body: string, phrase: string): boolean {
  if (!body || !phrase.trim()) return false;
  return phraseMatcher(phrase).test(body);
}

export function detectHandoffReason(
  body: string,
  policy: HandoffPolicy = DEFAULT_HANDOFF_POLICY
): HandoffReason | null {
  if (policy.humanRequestPhrases.some((phrase) => matchesPhrase(body, phrase))) {
    return 'user_request';
  }
  if (policy.negativePhrases.some((phrase) => matchesPhrase(body, phrase))) {
    return 'negative_sentiment';
  }
  if (policy.complexPhrases.some((phrase) => matchesPhrase(body, phrase))) {
    return 'complex_topic';
  }
  return null;
}

export function countUnansweredUserTurns(messages: ChatMessage[]): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') break;
    count += 1;
  }
  return count;
}

export function generateTicketSubject(
  messages: ChatMessage[],
  policy: HandoffPolicy = DEFAULT_HANDOFF_POLICY
): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) return 'SubTrackr support conversation';
  const singleLine = firstUserMessage.body.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= policy.subjectLength) return singleLine;
  return `${singleLine.slice(0, Math.max(0, policy.subjectLength - 3))}...`;
}

export function evaluateHandoff(
  messages: ChatMessage[],
  policy: HandoffPolicy = DEFAULT_HANDOFF_POLICY
): HandoffDecision {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  if (!lastUserMessage) {
    return { shouldHandoff: false, reason: null, subject: null };
  }

  const explicitReason = detectHandoffReason(lastUserMessage.body, policy);
  const repeatedQuestions = countUnansweredUserTurns(messages) >= policy.maxUnansweredUserTurns;
  const reason: HandoffReason | null =
    explicitReason ?? (repeatedQuestions ? 'repeated_questions' : null);

  if (!reason) {
    return { shouldHandoff: false, reason: null, subject: null };
  }
  return {
    shouldHandoff: true,
    reason,
    subject: generateTicketSubject(messages, policy),
  };
}

export function priorityForReason(reason: HandoffReason): TicketPriority {
  return reason === 'negative_sentiment' || reason === 'complex_topic' ? 'high' : 'normal';
}
