import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@wordwars/shared';
import { createGateway, type GameServer } from './gateway.js';

/**
 * Gateway integration tests.
 *
 * These boot a real HTTP server, a real Socket.io gateway and a real client
 * over a real WebSocket — no mocks. The socket layer is where the client and
 * server contracts meet, and a mock on either side would happily agree with
 * itself while production disagreed.
 */

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: HttpServer;
let gateway: GameServer;
let url: string;
const clients: TestClient[] = [];

function connectClient(): Promise<TestClient> {
  const socket: TestClient = createClient(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  clients.push(socket);

  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

beforeEach(async () => {
  httpServer = createServer();
  gateway = createGateway(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const { port } = httpServer.address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const client of clients) client.disconnect();
  clients.length = 0;
  await gateway.close();
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
});

describe('gateway', () => {
  it('accepts a websocket connection', async () => {
    const client = await connectClient();
    expect(client.connected).toBe(true);
  });

  it('assigns every socket an identity before any handler runs', async () => {
    await connectClient();

    const sockets = await gateway.fetchSockets();
    expect(sockets).toHaveLength(1);

    const data = sockets[0]?.data;
    expect(data?.playerId).toBeTruthy();
    expect(data?.identity.isGuest).toBe(true);
    expect(data?.roomId).toBeNull();
    expect(data?.matchId).toBeNull();
  });

  it('gives distinct identities to distinct sockets', async () => {
    await connectClient();
    await connectClient();

    const sockets = await gateway.fetchSockets();
    const ids = new Set(sockets.map((s) => s.data.playerId));

    expect(sockets).toHaveLength(2);
    expect(ids.size).toBe(2);
  });

  it('answers a heartbeat with server time', async () => {
    const client = await connectClient();
    const before = Date.now();

    const response = await client
      .timeout(2_000)
      .emitWithAck('match:heartbeat', { clientTime: before });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('unreachable');

    // Enough to compute a clock offset, and sane.
    expect(response.data.serverTime).toBeGreaterThanOrEqual(before);
    expect(response.data.serverTime).toBeLessThanOrEqual(Date.now());
  });

  /**
   * The single most important guarantee of the socket layer: a malformed
   * payload is rejected rather than reaching a handler that assumes shape.
   */
  it('rejects a malformed payload without invoking the handler', async () => {
    const client = await connectClient();

    const response = await client
      .timeout(2_000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .emitWithAck('match:heartbeat', { clientTime: 'not-a-number' } as any);

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.error.code).toBe('INVALID_PAYLOAD');
  });

  it('rate limits a flooding socket rather than serving it', async () => {
    const client = await connectClient();

    const rateLimited = new Promise<string>((resolve) => {
      client.on('error', (err) => resolve(err.code));
    });

    // Well past the default burst of 20.
    for (let i = 0; i < 60; i += 1) {
      client.emit('match:heartbeat', { clientTime: Date.now() }, () => {});
    }

    await expect(rateLimited).resolves.toBe('RATE_LIMITED');
  });

  describe('guest identity', () => {
    it('issues a generated identity to a new guest', async () => {
      const client = await connectClient();
      const res = await client.timeout(2_000).emitWithAck('guest:init', {});

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error('unreachable');

      expect(res.data.identity.isGuest).toBe(true);
      expect(res.data.identity.nickname).toMatch(/^[A-Za-z0-9_]+$/);
      expect(res.data.token.token).toContain('.');
      expect(res.data.token.expiresAt).toBeGreaterThan(Date.now());
    });

    it('accepts a chosen nickname', async () => {
      const client = await connectClient();
      const res = await client.timeout(2_000).emitWithAck('guest:init', { nickname: 'SilentFox' });

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error('unreachable');
      expect(res.data.identity.nickname).toBe('SilentFox');
    });

    /**
     * The behaviour the token exists for: a refresh, or a reconnect to a
     * different server process, must not turn the player into someone else.
     */
    it('restores the same identity from a stored token on a fresh socket', async () => {
      const first = await connectClient();
      const initial = await first.timeout(2_000).emitWithAck('guest:init', {});
      if (!initial.ok) throw new Error('unreachable');

      first.disconnect();

      const second = await connectClient();
      const restored = await second
        .timeout(2_000)
        .emitWithAck('guest:init', { token: initial.data.token.token });

      expect(restored.ok).toBe(true);
      if (!restored.ok) throw new Error('unreachable');

      expect(restored.data.identity.playerId).toBe(initial.data.identity.playerId);
      expect(restored.data.identity.nickname).toBe(initial.data.identity.nickname);
    });

    it('keeps the player id when renaming', async () => {
      const client = await connectClient();
      const initial = await client.timeout(2_000).emitWithAck('guest:init', {});
      if (!initial.ok) throw new Error('unreachable');

      const renamed = await client.timeout(2_000).emitWithAck('guest:init', {
        token: initial.data.token.token,
        nickname: 'CrimsonPanda',
      });

      expect(renamed.ok).toBe(true);
      if (!renamed.ok) throw new Error('unreachable');

      expect(renamed.data.identity.nickname).toBe('CrimsonPanda');
      expect(renamed.data.identity.playerId).toBe(initial.data.identity.playerId);
    });

    it('rejects a reserved nickname', async () => {
      const client = await connectClient();
      const res = await client.timeout(2_000).emitWithAck('guest:init', { nickname: 'Admin' });

      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      expect(res.error.code).toBe('INVALID_PAYLOAD');
    });

    /** A junk token should read as a normal first visit, not an error state. */
    it('silently issues a fresh identity when the token is invalid', async () => {
      const client = await connectClient();
      const res = await client.timeout(2_000).emitWithAck('guest:init', { token: 'garbage.token' });

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error('unreachable');
      expect(res.data.identity.nickname).toBeTruthy();
    });

    it('updates the identity stored on the socket', async () => {
      const client = await connectClient();
      await client.timeout(2_000).emitWithAck('guest:init', { nickname: 'IronViper' });

      const sockets = await gateway.fetchSockets();
      expect(sockets[0]?.data.identity.nickname).toBe('IronViper');
    });
  });

  describe('matchmaking', () => {
    /** Establishes a real identity, as the client does before queueing. */
    async function identified(nickname: string): Promise<TestClient> {
      const client = await connectClient();
      await client.timeout(2_000).emitWithAck('guest:init', { nickname });
      return client;
    }

    const waitFor = <T>(client: TestClient, event: 'mm:found' | 'mm:searching') =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 4_000);
        client.once(event, ((payload: T) => {
          clearTimeout(timer);
          resolve(payload);
        }) as never);
      });

    it('puts a lone player into a searching state', async () => {
      const client = await identified('AloneWolf');
      const searching = waitFor<{ queuedAt: number; estimatedWaitMs: number }>(
        client,
        'mm:searching',
      );

      const res = await client.timeout(2_000).emitWithAck('mm:join', {
        mode: '1v1',
        characterId: 'ninja',
      });

      expect(res.ok).toBe(true);
      await expect(searching).resolves.toMatchObject({
        queuedAt: expect.any(Number),
        estimatedWaitMs: expect.any(Number),
      });
    });

    /** The core of the whole step: two humans find each other. */
    it('pairs two queued players and tells each about the other', async () => {
      const alice = await identified('SilentFox');
      const bob = await identified('IronViper');

      const aliceFound = waitFor<{ roomId: string; opponent: { nickname: string } }>(
        alice,
        'mm:found',
      );
      const bobFound = waitFor<{ roomId: string; opponent: { nickname: string } }>(bob, 'mm:found');

      await alice.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });
      await bob.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'samurai' });

      const [a, b] = await Promise.all([aliceFound, bobFound]);

      // Each is told about the OTHER, and both land in the same room.
      expect(a.opponent.nickname).toBe('IronViper');
      expect(b.opponent.nickname).toBe('SilentFox');
      expect(a.roomId).toBe(b.roomId);
    });

    it('places both players in a room containing exactly the two of them', async () => {
      const alice = await identified('SilentFox');
      const bob = await identified('IronViper');

      const roomState = new Promise<{ members: Array<{ nickname: string }> }>((resolve) => {
        alice.once('room:state', resolve as never);
      });

      await alice.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });
      await bob.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'samurai' });

      const state = await roomState;
      expect(state.members.map((m) => m.nickname).sort()).toEqual(['IronViper', 'SilentFox']);
    });

    it('refuses a second queue join from the same player', async () => {
      const client = await identified('DoubleDipper');

      await client.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });
      const second = await client
        .timeout(2_000)
        .emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });

      expect(second.ok).toBe(false);
      if (second.ok) throw new Error('unreachable');
      expect(second.error.code).toBe('ALREADY_IN_QUEUE');
    });

    it('lets a player leave the queue', async () => {
      const alice = await identified('Leaver');
      await alice.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });

      const cancelled = new Promise<void>((resolve) => alice.once('mm:cancelled', resolve));
      await alice.timeout(2_000).emitWithAck('mm:leave');
      await cancelled;

      // Someone joining now must wait rather than pair with the departed player.
      const bob = await identified('Later');
      const searching = waitFor(bob, 'mm:searching');
      await bob.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });

      await expect(searching).resolves.toBeTruthy();
    });

    /**
     * The ghost-match case: someone closes the tab while queued. The next
     * player must not be paired against a socket that no longer exists.
     */
    it('drops a disconnected player from the queue', async () => {
      const quitter = await identified('Quitter');
      await quitter.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });

      quitter.disconnect();
      await new Promise((r) => setTimeout(r, 200));

      const arrival = await identified('Arrival');
      const searching = waitFor(arrival, 'mm:searching');
      await arrival.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });

      // Still searching means it correctly refused to pair with the ghost.
      await expect(searching).resolves.toBeTruthy();
    });
  });

  it('drops the socket record on disconnect', async () => {
    const client = await connectClient();
    expect(await gateway.fetchSockets()).toHaveLength(1);

    client.disconnect();
    await new Promise((r) => setTimeout(r, 150));

    expect(await gateway.fetchSockets()).toHaveLength(0);
  });
});
