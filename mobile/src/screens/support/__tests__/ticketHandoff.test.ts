import {
  DEFAULT_HANDOFF_POLICY,
  countUnansweredUserTurns,
  detectHandoffReason,
  evaluateHandoff,
  generateTicketSubject,
  matchesPhrase,
  priorityForReason,
} from '../ticketHandoff';
import type { ChatMessage } from '../types';

function message(role: ChatMessage['role'], body: string, id = 'm'): ChatMessage {
  return { id, role, body, createdAt: 1 };
}

describe('phrase detection', () => {
  it('matches whole phrases case-insensitively', () => {
    expect(matchesPhrase('Can I talk to a human?', 'human')).toBe(true);
    expect(matchesPhrase('I need a REAL PERSON please', 'real person')).toBe(true);
    expect(matchesPhrase('This is not humanity related', 'human')).toBe(false);
  });

  it('classifies explicit, negative and complex requests', () => {
    expect(detectHandoffReason('Let me speak to an agent')).toBe('user_request');
    expect(detectHandoffReason('I will file a chargeback')).toBe('negative_sentiment');
    expect(detectHandoffReason('There was an unauthorized charge')).toBe('complex_topic');
    expect(detectHandoffReason('Thanks for the help')).toBeNull();
  });
});

describe('evaluateHandoff', () => {
  it('does not escalate a normal exchange', () => {
    const result = evaluateHandoff([message('user', 'Where is my invoice?')]);
    expect(result).toEqual({ shouldHandoff: false, reason: null, subject: null });
  });

  it('escalates after too many unanswered turns', () => {
    const messages = [
      message('user', 'First question'),
      message('system', 'Thinking…'),
      message('user', 'Still there?'),
      message('user', 'Hello?'),
      message('user', 'Anyone?'),
    ];
    expect(countUnansweredUserTurns(messages)).toBe(3);
    const result = evaluateHandoff(messages);
    expect(result.shouldHandoff).toBe(true);
    expect(result.reason).toBe('repeated_questions');
    expect(result.subject).toBe('First question');
  });

  it('prefers an explicit request over the turn count', () => {
    const messages = [
      message('user', 'Question one'),
      message('user', 'Question two'),
      message('user', 'Can I speak to a representative?'),
    ];
    expect(evaluateHandoff(messages).reason).toBe('user_request');
  });

  it('respects a custom policy', () => {
    const policy = {
      ...DEFAULT_HANDOFF_POLICY,
      maxUnansweredUserTurns: 1,
      subjectLength: 13,
    };
    const result = evaluateHandoff([message('user', 'A very long question indeed')], policy);
    expect(result.reason).toBe('repeated_questions');
    expect(result.subject).toBe('A very long...');
  });

  it('truncates and flattens generated subjects', () => {
    const subject = generateTicketSubject([message('user', 'Line one\nline   two')]);
    expect(subject).toBe('Line one line two');
    expect(generateTicketSubject([])).toBe('SubTrackr support conversation');
  });

  it('maps high-risk reasons to high priority', () => {
    expect(priorityForReason('negative_sentiment')).toBe('high');
    expect(priorityForReason('complex_topic')).toBe('high');
    expect(priorityForReason('manual')).toBe('normal');
  });
});
