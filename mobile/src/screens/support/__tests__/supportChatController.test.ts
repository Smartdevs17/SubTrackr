import { createSupportChatController } from '../supportChatController';
import type {
  ChatMessage,
  SupportChatApi,
  SupportChatStorage,
  SupportTicket,
  TicketHandoffRequest,
} from '../types';

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    values,
  } satisfies SupportChatStorage & { values: Map<string, string> };
}

function makeApi() {
  let replyCount = 0;
  const sendMessage = jest.fn(async (_body: string): Promise<ChatMessage> => {
    replyCount += 1;
    return {
      id: `agent-${replyCount}`,
      role: 'agent',
      body: 'Thanks for reaching out',
      createdAt: 2,
    };
  });
  const createTicket = jest.fn(async (request: TicketHandoffRequest): Promise<SupportTicket> => {
    return {
      id: 'ticket-1',
      subject: request.subject,
      status: 'open',
      priority: 'normal',
      createdAt: 3,
      handoffReason: request.reason,
      transcript: request.transcript,
    };
  });
  return { sendMessage, createTicket } satisfies SupportChatApi;
}

function makeController(overrides: Record<string, unknown> = {}) {
  const api = makeApi();
  const storage = makeStorage();
  const metrics = { increment: jest.fn() };
  const controller = createSupportChatController({
    api,
    storage,
    metrics,
    idFactory: () => `local-${Math.random().toString(36).slice(2)}`,
    now: () => 1000,
    ...overrides,
  });
  return { controller, api, storage, metrics };
}

describe('createSupportChatController', () => {
  it('shows an optimistic message then replaces it with the delivered reply', async () => {
    const { controller } = makeController();
    const states: string[] = [];
    controller.subscribe((state) => states.push(state.messages[0]?.status ?? 'none'));

    const delivered = await controller.send('Where is my invoice?');

    expect(delivered.status).toBe('sent');
    expect(controller.getState().messages).toHaveLength(2);
    expect(controller.getState().messages[0].status).toBe('sent');
    expect(controller.getState().messages[1].role).toBe('agent');
    expect(states).toContain('sending');
    expect(controller.getState().isSending).toBe(false);
  });

  it('automatically hands off when a user asks for a human', async () => {
    const { controller, api, metrics } = makeController();

    await controller.send('Can I speak to an agent please?');

    expect(api.createTicket).toHaveBeenCalledTimes(1);
    expect(api.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Can I speak to an agent please?',
        reason: 'user_request',
      })
    );
    expect(controller.getState().status).toBe('handed_off');
    expect(controller.getState().ticket?.id).toBe('ticket-1');
    expect(controller.getState().messages.some((item) => item.role === 'system')).toBe(true);
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.supportChat.ticket_created', 1, {
      reason: 'user_request',
      priority: 'normal',
    });
  });

  it('uses the detected reason for a manual handoff', async () => {
    const { controller, api } = makeController();
    await controller.send('First question');
    await controller.send('Still there?');
    await controller.send('Anyone?');

    const ticket = await controller.requestHandoff();

    expect(ticket.handoffReason).toBe('repeated_questions');
    expect(api.createTicket).toHaveBeenCalledTimes(1);
  });

  it('does not create a second ticket', async () => {
    const { controller, api } = makeController();
    await controller.send('I need a real person');

    const first = await controller.requestHandoff();
    const second = await controller.requestHandoff();

    expect(second).toBe(first);
    expect(api.createTicket).toHaveBeenCalledTimes(1);
  });

  it('restores a persisted conversation', async () => {
    const { controller, storage } = makeController();
    await controller.send('Hello there');
    expect(storage.setItem).toHaveBeenCalled();

    const restored = makeController({ storage }).controller;
    await restored.load();

    expect(restored.getState().messages).toHaveLength(2);
    expect(restored.getState().status).toBe('active');
  });

  it('marks a failed delivery and preserves the draft through the widget', async () => {
    const api = makeApi();
    api.sendMessage.mockRejectedValueOnce(new Error('network down'));
    const controller = createSupportChatController({ api, idFactory: () => 'local-1' });

    await expect(controller.send('Hello')).rejects.toThrow('network down');
    expect(controller.getState().messages[0].status).toBe('failed');
    expect(controller.getState().status).toBe('error');
    expect(controller.getState().error).toBe('network down');
  });

  it('rejects empty and oversized messages', async () => {
    const { controller, api } = makeController();
    await expect(controller.send('   ')).rejects.toThrow(/empty/);
    await expect(controller.send('x'.repeat(2001))).rejects.toThrow(/2000/);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('reports a failed ticket handoff without losing the conversation', async () => {
    const api = makeApi();
    api.createTicket.mockRejectedValueOnce(new Error('ticket service down'));
    const controller = createSupportChatController({
      api,
      idFactory: () => 'local-2',
      metrics: { increment: jest.fn() },
    });
    await controller.send('A plain question');

    await expect(controller.requestHandoff()).rejects.toThrow('ticket service down');

    expect(controller.getState().ticket).toBeNull();
    expect(controller.getState().messages).toHaveLength(2);
    expect(controller.getState().status).toBe('error');
  });

  it('resets state and storage', async () => {
    const { controller, storage } = makeController();
    await controller.send('Hello');
    await controller.reset();

    expect(controller.getState().messages).toHaveLength(0);
    expect(controller.getState().status).toBe('idle');
    expect(storage.removeItem).toHaveBeenCalled();
  });
});
