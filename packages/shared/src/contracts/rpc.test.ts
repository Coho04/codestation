import { describe, expect, it, vi } from 'vitest';
import { createRpcClient, serveRpc, type RpcTransport } from './rpc.js';
import { appError, CodeStationError } from '../result.js';

interface Api extends Record<string, (...args: never[]) => Promise<unknown>> {
  add(a: number, b: number): Promise<number>;
  boom(): Promise<never>;
}

/** Two transports wired back to back, as a MessageChannel would be. */
function linkedPair(): readonly [RpcTransport, RpcTransport] {
  const listenersA = new Set<(m: unknown) => void>();
  const listenersB = new Set<(m: unknown) => void>();
  const make = (own: Set<(m: unknown) => void>, peer: Set<(m: unknown) => void>): RpcTransport => ({
    post: (message) => queueMicrotask(() => peer.forEach((l) => l(message))),
    subscribe: (listener) => {
      own.add(listener);
      return () => own.delete(listener);
    },
  });
  return [make(listenersA, listenersB), make(listenersB, listenersA)];
}

describe('rpc', () => {
  it('round-trips a call and its result', async () => {
    const [clientSide, serverSide] = linkedPair();
    serveRpc<Api>(serverSide, {
      add: (a, b) => Promise.resolve(a + b),
      boom: () => Promise.reject(new Error('nope')),
    });
    const client = createRpcClient<Api>(clientSide);
    await expect(client.add(2, 3)).resolves.toBe(5);
  });

  it('delivers a rejection as a structured error, not a flattened message', async () => {
    const [clientSide, serverSide] = linkedPair();
    serveRpc<Api>(serverSide, {
      add: () => Promise.resolve(0),
      boom: () => Promise.reject(appError('CWD_MISSING', 'Projektordner fehlt', '/tmp/gone')),
    });
    const client = createRpcClient<Api>(clientSide);
    // A real Error (so there is a stack trace locally) that still carries the
    // structured code across the boundary.
    await expect(client.boom()).rejects.toBeInstanceOf(CodeStationError);
    await expect(client.boom()).rejects.toMatchObject({
      error: { code: 'CWD_MISSING', detail: '/tmp/gone' },
    });
  });

  it('answers an unknown method instead of hanging the caller', async () => {
    const [clientSide, serverSide] = linkedPair();
    serveRpc<Api>(serverSide, { add: () => Promise.resolve(0), boom: () => Promise.reject(new Error()) });
    const client = createRpcClient<Record<string, () => Promise<unknown>>>(clientSide);
    await expect(client['nope']!()).rejects.toMatchObject({ error: { code: 'INTERNAL' } });
  });

  it('keeps concurrent calls apart', async () => {
    const [clientSide, serverSide] = linkedPair();
    serveRpc<Api>(serverSide, {
      add: (a, b) => new Promise((r) => setTimeout(() => r(a + b), a)),
      boom: () => Promise.reject(new Error()),
    });
    const client = createRpcClient<Api>(clientSide);
    const results = await Promise.all([client.add(30, 1), client.add(1, 2), client.add(10, 3)]);
    expect(results).toEqual([31, 3, 13]);
  });

  it('rejects pending calls when the transport is disposed rather than leaking them', async () => {
    const [clientSide] = linkedPair();
    const client = createRpcClient<Api>(clientSide);
    const pending = client.add(1, 1);
    client.dispose();
    await expect(pending).rejects.toMatchObject({ error: { code: 'INTERNAL' } });
  });

  it('times out a call whose peer never answers', async () => {
    vi.useFakeTimers();
    const [clientSide] = linkedPair();
    const client = createRpcClient<Api>(clientSide, { timeoutMs: 1000 });
    const pending = client.add(1, 1);
    const assertion = expect(pending).rejects.toMatchObject({ error: { code: 'INTERNAL' } });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    vi.useRealTimers();
  });
});
