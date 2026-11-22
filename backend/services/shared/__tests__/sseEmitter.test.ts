// backend/services/shared/__tests__/sseEmitter.test.ts
import type http from 'node:http';
import { SseEmitter } from '../sseEmitter';

function createRes() {
  return {
    writeHead: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
}

function createReq() {
  const handlers: Record<string, (() => void) | undefined> = {};
  return {
    on: jest.fn((event: string, cb: () => void) => {
      handlers[event] = cb;
    }),
    simulateDisconnect() {
      handlers.close?.();
    },
  };
}

function headers(res: ReturnType<typeof createRes>): Record<string, string> {
  return res.writeHead.mock.calls[0][1] as Record<string, string>;
}

describe('SseEmitter CORS hardening', () => {
  it('never emits the Access-Control-Allow-Origin wildcard', () => {
    const res = createRes();
    new SseEmitter(createReq() as unknown as http.IncomingMessage, res as any, {
      allowedOrigin: '*',
    });

    expect(headers(res)['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('omits the CORS header when no origin is allowed', () => {
    const res = createRes();
    new SseEmitter(createReq() as unknown as http.IncomingMessage, res as any);

    expect(headers(res)['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('echoes only the explicitly allowed origin', () => {
    const res = createRes();
    new SseEmitter(createReq() as unknown as http.IncomingMessage, res as any, {
      allowedOrigin: 'https://app.subtrackr.io',
    });

    expect(headers(res)['Access-Control-Allow-Origin']).toBe('https://app.subtrackr.io');
  });

  it('reflects the request origin only when it matches the allowlist', () => {
    const res = createRes();
    new SseEmitter(createReq() as unknown as http.IncomingMessage, res as any, {
      allowedOrigin: 'https://app.subtrackr.io',
    });

    expect(headers(res)['Access-Control-Allow-Origin']).not.toBe('*');
    expect(headers(res)['Access-Control-Allow-Origin']).not.toBe('null');
  });
});

describe('SseEmitter stream behaviour', () => {
  it('sets the SSE response headers', () => {
    const res = createRes();
    new SseEmitter(createReq() as unknown as http.IncomingMessage, res as any);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    }));
  });

  it('writes a framed event with a monotonic id', () => {
    const res = createRes();
    const emitter = new SseEmitter(createReq() as unknown as http.IncomingMessage, res as any);

    emitter.progress({ percent: 10, message: 'working', recordsProcessed: 1, totalRecords: 10 });

    expect(res.write).toHaveBeenCalledWith(
      'id: 1\nevent: progress\ndata: {"percent":10,"message":"working","recordsProcessed":1,"totalRecords":10}\n\n\n'
    );
  });

  it('stops emitting after the client disconnects', () => {
    const req = createReq();
    const res = createRes();
    const emitter = new SseEmitter(req as unknown as http.IncomingMessage, res as any);

    req.simulateDisconnect();

    expect(emitter.isConnected).toBe(false);
    emitter.progress({ percent: 50, message: 'x', recordsProcessed: 1 });
    expect(res.write).not.toHaveBeenCalled();
  });

  it('closes the response exactly once', () => {
    const res = createRes();
    const emitter = new SseEmitter(createReq() as unknown as http.IncomingMessage, res as any);

    emitter.close();
    emitter.close();

    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
