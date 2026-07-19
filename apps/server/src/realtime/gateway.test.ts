import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, RoomState, ServerToClientEvents } from '@wordwars/shared';
import { createGateway, type GameServer } from './gateway.js';
import { createMemoryRepositories } from '../db/memory.js';

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
  // Fresh repositories per test, so accounts and stats never leak between them.
  gateway = createGateway(httpServer, createMemoryRepositories());

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

    /**
     * Deliberately reversed: a duplicate queue request now SUCCEEDS.
     *
     * Refusing looked correct and broke the product. React StrictMode
     * double-invokes effects in development, and a screen guarding on its own
     * `status` reads the render it closed over — so the client queued twice,
     * got ALREADY_IN_QUEUE back, and showed "Matchmaking failed" to a player
     * the server was searching for perfectly happily.
     *
     * Clients re-send this for ordinary reasons: a re-render, a reconnect, an
     * impatient second click. The honest answer to "please queue me" from
     * somebody already queued is yes.
     */
    it('treats a second queue join from the same player as a no-op', async () => {
      const client = await identified('DoubleDipper');

      await client.timeout(2_000).emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });
      const second = await client
        .timeout(2_000)
        .emitWithAck('mm:join', { mode: '1v1', characterId: 'ninja' });

      expect(second.ok).toBe(true);
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

  describe('private rooms', () => {
    async function identified(nickname: string): Promise<TestClient> {
      const client = await connectClient();
      await client.timeout(2_000).emitWithAck('guest:init', { nickname });
      return client;
    }

    const SETTINGS = {
      mode: '1v1',
      arenaId: 'dojo',
      randomArena: false,
      randomCharacter: false,
      difficulty: 'normal',
      language: 'en',
      roundCount: 3,
      enableUltimate: true,
      enableCrits: true,
      isPublic: false,
      maxPlayers: 2,
      allowSpectators: true,
    } as const;

    /**
     * Typed wrapper around `emitWithAck`.
     *
     * socket.io-client does not infer our `Ack<T>` return type through
     * `emitWithAck`, so raw calls come back as `any` — which silently turns
     * every assertion below into a no-op check against an untyped value.
     * Naming the type here restores real coverage; typecheck caught this,
     * the tests could not.
     */
    async function joinRoom(
      client: TestClient,
      payload: { code: string; password?: string; asSpectator?: boolean },
    ): Promise<Ack<RoomState>> {
      return (await client.timeout(3_000).emitWithAck('room:join', payload)) as Ack<RoomState>;
    }

    async function createRoom(client: TestClient, password?: string) {
      const res = await client
        .timeout(3_000)
        .emitWithAck('room:create', { settings: SETTINGS, ...(password ? { password } : {}) });
      if (!res.ok) throw new Error(`create failed: ${res.error.code}`);
      return res.data;
    }

    it('creates a room with the creator as host', async () => {
      const host = await identified('HostFox');
      const room = await createRoom(host);

      expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
      expect(room.members).toHaveLength(1);
      expect(room.members[0]?.nickname).toBe('HostFox');
      expect(room.members[0]?.isHost).toBe(true);
      expect(room.settings.hasPassword).toBe(false);
    });

    it('lets a second player join by code', async () => {
      const host = await identified('HostFox');
      const guest = await identified('GuestViper');
      const room = await createRoom(host);

      const res = await joinRoom(guest, { code: room.code });

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error('unreachable');
      expect(res.data.members.map((m) => m.nickname).sort()).toEqual(['GuestViper', 'HostFox']);
    });

    it('tells the host when someone joins', async () => {
      const host = await identified('HostFox');
      const guest = await identified('GuestViper');
      const room = await createRoom(host);

      const updated = new Promise<{ members: Array<{ nickname: string }> }>((resolve) => {
        host.once('room:state', resolve as never);
      });

      await guest.timeout(3_000).emitWithAck('room:join', { code: room.code });

      const state = await updated;
      expect(state.members).toHaveLength(2);
    });

    it('rejects an unknown code', async () => {
      const client = await identified('Lost');
      const res = await client.timeout(3_000).emitWithAck('room:join', { code: 'ZZZZZZ' });

      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      expect(res.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('refuses to over-fill a room', async () => {
      const host = await identified('HostFox');
      const guest = await identified('GuestViper');
      const third = await identified('ThirdWheel');
      const room = await createRoom(host);

      await guest.timeout(3_000).emitWithAck('room:join', { code: room.code });
      const res = await third.timeout(3_000).emitWithAck('room:join', { code: room.code });

      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      expect(res.error.code).toBe('ROOM_FULL');
    });

    it('admits a spectator past the player cap', async () => {
      const host = await identified('HostFox');
      const guest = await identified('GuestViper');
      const watcher = await identified('Watcher');
      const room = await createRoom(host);

      await guest.timeout(3_000).emitWithAck('room:join', { code: room.code });
      const res = await joinRoom(watcher, { code: room.code, asSpectator: true });

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error('unreachable');
      expect(res.data.members.find((m) => m.nickname === 'Watcher')?.isSpectator).toBe(true);
    });

    describe('passwords', () => {
      it('admits a correct password', async () => {
        const host = await identified('HostFox');
        const guest = await identified('GuestViper');
        const room = await createRoom(host, 'hunter2');

        expect(room.settings.hasPassword).toBe(true);

        const res = await guest
          .timeout(3_000)
          .emitWithAck('room:join', { code: room.code, password: 'hunter2' });

        expect(res.ok).toBe(true);
      });

      it.each([
        ['a wrong password', 'wrong'],
        ['no password at all', undefined],
      ])('refuses %s', async (_label, password) => {
        const host = await identified('HostFox');
        const guest = await identified('GuestViper');
        const room = await createRoom(host, 'hunter2');

        const res = await guest.timeout(3_000).emitWithAck('room:join', {
          code: room.code,
          ...(password ? { password } : {}),
        });

        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('unreachable');
        expect(res.error.code).toBe('WRONG_PASSWORD');
      });

      /**
       * A failed guess must not evict the player from the room they are
       * already sitting in — that would turn a typo into losing your seat.
       */
      it('leaves the player in their current room after a failed attempt', async () => {
        const host = await identified('HostFox');
        const wanderer = await identified('Wanderer');

        const ownRoom = await createRoom(wanderer);
        const locked = await createRoom(host, 'hunter2');

        const failed = await wanderer
          .timeout(3_000)
          .emitWithAck('room:join', { code: locked.code, password: 'nope' });
        expect(failed.ok).toBe(false);

        // Still a member of the original room.
        const rejoin = await joinRoom(wanderer, { code: ownRoom.code });
        expect(rejoin.ok).toBe(true);
        if (!rejoin.ok) throw new Error('unreachable');
        expect(rejoin.data.members.map((m) => m.nickname)).toContain('Wanderer');
      });
    });

    it('treats rejoining the same room as a no-op', async () => {
      const host = await identified('HostFox');
      const room = await createRoom(host);

      const again = await host.timeout(3_000).emitWithAck('room:join', { code: room.code });

      expect(again.ok).toBe(true);
      if (!again.ok) throw new Error('unreachable');
      expect(again.data.members).toHaveLength(1);
    });

    it('moves a player between rooms rather than refusing', async () => {
      const host = await identified('HostFox');
      const mover = await identified('Mover');

      const first = await createRoom(mover);
      const second = await createRoom(host);

      await mover.timeout(3_000).emitWithAck('room:join', { code: second.code });

      // Gone from the first room, which had only them, so it is destroyed.
      const orphan = await host.timeout(3_000).emitWithAck('room:join', { code: first.code });
      expect(orphan.ok).toBe(false);
    });

    it('removes a leaving player and updates everyone else', async () => {
      const host = await identified('HostFox');
      const guest = await identified('GuestViper');
      const room = await createRoom(host);
      await guest.timeout(3_000).emitWithAck('room:join', { code: room.code });

      const updated = new Promise<{ members: unknown[] }>((resolve) => {
        host.once('room:state', resolve as never);
      });

      await guest.timeout(3_000).emitWithAck('room:leave');

      const state = await updated;
      expect(state.members).toHaveLength(1);
    });

    it('promotes a new host when the host leaves', async () => {
      const host = await identified('HostFox');
      const guest = await identified('GuestViper');
      const room = await createRoom(host);
      await guest.timeout(3_000).emitWithAck('room:join', { code: room.code });

      const updated = new Promise<{ members: Array<{ nickname: string; isHost: boolean }> }>(
        (resolve) => guest.once('room:state', resolve as never),
      );

      await host.timeout(3_000).emitWithAck('room:leave');

      const state = await updated;
      expect(state.members.find((m) => m.isHost)?.nickname).toBe('GuestViper');
    });
  });

  describe('lobby', () => {
    async function identified(nickname: string): Promise<TestClient> {
      const client = await connectClient();
      await client.timeout(2_000).emitWithAck('guest:init', { nickname });
      return client;
    }

    const SETTINGS = {
      mode: '1v1',
      arenaId: 'dojo',
      randomArena: false,
      randomCharacter: false,
      difficulty: 'normal',
      language: 'en',
      roundCount: 3,
      enableUltimate: true,
      enableCrits: true,
      isPublic: false,
      maxPlayers: 2,
      allowSpectators: true,
    } as const;

    async function roomWithTwo() {
      const host = await identified('HostFox');
      const guest = await identified('GuestViper');

      const created = await host.timeout(3_000).emitWithAck('room:create', { settings: SETTINGS });
      if (!created.ok) throw new Error('create failed');

      const joined = await guest
        .timeout(3_000)
        .emitWithAck('room:join', { code: created.data.code });
      if (!joined.ok) throw new Error('join failed');

      return { host, guest, code: created.data.code };
    }

    /**
     * Waits for a room snapshot satisfying `predicate`.
     *
     * Deliberately NOT `once('room:state')`. Snapshots also arrive from
     * unrelated causes — ping updates especially — so grabbing "the next one"
     * races against whatever was already in flight. Waiting for the state we
     * actually care about is both correct and stable as more broadcast
     * triggers are added.
     */
    const waitForState = (
      client: TestClient,
      predicate: (s: RoomState) => boolean,
      timeoutMs = 3_000,
    ) =>
      new Promise<RoomState>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for room state')),
          timeoutMs,
        );

        const onState = (state: RoomState) => {
          if (!predicate(state)) return;
          clearTimeout(timer);
          client.off('room:state', onState);
          resolve(state);
        };

        client.on('room:state', onState);
      });

    const memberNamed = (s: RoomState, nickname: string) =>
      s.members.find((m) => m.nickname === nickname);

    it('changes a character and tells everyone', async () => {
      const { host, guest } = await roomWithTwo();
      const seen = waitForState(guest, (s) => memberNamed(s, 'HostFox')?.characterId === 'viking');

      const res = await host.timeout(3_000).emitWithAck('room:character', {
        characterId: 'viking',
      });

      expect(res.ok).toBe(true);
      await expect(seen).resolves.toBeTruthy();
    });

    it('marks a player ready and tells everyone', async () => {
      const { host, guest } = await roomWithTwo();
      const seen = waitForState(guest, (s) => memberNamed(s, 'HostFox')?.isReady === true);

      await host.timeout(3_000).emitWithAck('room:ready', { ready: true });

      await expect(seen).resolves.toBeTruthy();
    });

    it('lets a player un-ready', async () => {
      const { host, guest } = await roomWithTwo();

      const readied = waitForState(guest, (s) => memberNamed(s, 'HostFox')?.isReady === true);
      await host.timeout(3_000).emitWithAck('room:ready', { ready: true });
      await readied;

      const unreadied = waitForState(guest, (s) => memberNamed(s, 'HostFox')?.isReady === false);
      await host.timeout(3_000).emitWithAck('room:ready', { ready: false });

      await expect(unreadied).resolves.toBeTruthy();
    });

    it('delivers chat to the whole room', async () => {
      const { host, guest } = await roomWithTwo();

      const received = new Promise<{ text: string; nickname: string; system: boolean }>(
        (resolve) => {
          guest.on('room:chat', (m) => {
            if (!m.system) resolve(m);
          });
        },
      );

      await host.timeout(3_000).emitWithAck('room:chat', { text: 'good luck' });

      const message = await received;
      expect(message.text).toBe('good luck');
      expect(message.nickname).toBe('HostFox');
    });

    /**
     * Chat is rendered as text by React, never as HTML. The server must NOT
     * sanitise, or it would mangle legitimate messages — this pins that
     * decision so nobody "fixes" it by adding escaping later.
     */
    it('delivers chat text verbatim, including characters that look like markup', async () => {
      const { host, guest } = await roomWithTwo();

      const received = new Promise<{ text: string }>((resolve) => {
        guest.on('room:chat', (m) => {
          if (!m.system) resolve(m);
        });
      });

      await host.timeout(3_000).emitWithAck('room:chat', { text: '5 < 6 && 7 > 2' });

      expect((await received).text).toBe('5 < 6 && 7 > 2');
    });

    it('rejects an empty chat message', async () => {
      const { host } = await roomWithTwo();
      const res = await host.timeout(3_000).emitWithAck('room:chat', { text: '   ' });

      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      expect(res.error.code).toBe('INVALID_PAYLOAD');
    });

    it('announces joins as a system message', async () => {
      const host = await identified('HostFox');
      const guest = await identified('GuestViper');

      const created = await host.timeout(3_000).emitWithAck('room:create', { settings: SETTINGS });
      if (!created.ok) throw new Error('create failed');

      const system = new Promise<{ text: string; system: boolean }>((resolve) => {
        host.on('room:chat', (m) => {
          if (m.system) resolve(m);
        });
      });

      await guest.timeout(3_000).emitWithAck('room:join', { code: created.data.code });

      const message = await system;
      expect(message.system).toBe(true);
      expect(message.text).toContain('GuestViper');
    });

    describe('kick', () => {
      it('lets the host remove someone', async () => {
        const { host, guest } = await roomWithTwo();

        const removed = new Promise<{ reason: string }>((resolve) => {
          guest.once('room:closed', resolve);
        });

        const sockets = await gateway.fetchSockets();
        const guestId = sockets.find((s) => s.data.identity.nickname === 'GuestViper')?.data
          .playerId;

        const res = await host.timeout(3_000).emitWithAck('room:kick', { playerId: guestId! });

        expect(res.ok).toBe(true);
        if (!res.ok) throw new Error('unreachable');
        expect(res.data.members).toHaveLength(1);
        await expect(removed).resolves.toBeTruthy();
      });

      /** Anyone being able to kick would make every public room unusable. */
      it('refuses a non-host', async () => {
        const { guest } = await roomWithTwo();

        const sockets = await gateway.fetchSockets();
        const hostId = sockets.find((s) => s.data.identity.nickname === 'HostFox')?.data.playerId;

        const res = await guest.timeout(3_000).emitWithAck('room:kick', { playerId: hostId! });

        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('unreachable');
        expect(res.error.code).toBe('NOT_HOST');
      });
    });

    describe('host settings', () => {
      it('applies a settings change', async () => {
        const { host, guest } = await roomWithTwo();
        const seen = waitForState(guest, (s) => s.settings.arenaId === 'volcano');

        const res = await host.timeout(3_000).emitWithAck('room:update', {
          settings: { arenaId: 'volcano', roundCount: 5 },
        });

        expect(res.ok).toBe(true);
        const state = await seen;
        expect(state.settings.roundCount).toBe(5);
      });

      /**
       * Ready has to mean "ready for THESE rules". Otherwise a host can ready
       * everyone under one ruleset, silently swap it, and start.
       */
      it('un-readies everyone when the rules change', async () => {
        const { host, guest } = await roomWithTwo();

        const bothReady = waitForState(host, (s) => s.members.every((m) => m.isReady));
        await host.timeout(3_000).emitWithAck('room:ready', { ready: true });
        await guest.timeout(3_000).emitWithAck('room:ready', { ready: true });
        await bothReady;

        // Annotated because emitWithAck does not carry our Ack<T> through.
        const res: Ack<RoomState> = await host.timeout(3_000).emitWithAck('room:update', {
          settings: { roundCount: 5 },
        });

        expect(res.ok).toBe(true);
        if (!res.ok) throw new Error('unreachable');
        expect(res.data.members.every((m) => !m.isReady)).toBe(true);
      });

      it('refuses a non-host', async () => {
        const { guest } = await roomWithTwo();

        const res = await guest.timeout(3_000).emitWithAck('room:update', {
          settings: { arenaId: 'volcano' },
        });

        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('unreachable');
        expect(res.error.code).toBe('NOT_HOST');
      });
    });

    describe('countdown', () => {
      async function readyRoom() {
        const { host, guest } = await roomWithTwo();
        const bothReady = waitForState(host, (s) => s.members.every((m) => m.isReady));
        await host.timeout(3_000).emitWithAck('room:ready', { ready: true });
        await guest.timeout(3_000).emitWithAck('room:ready', { ready: true });
        await bothReady;
        return { host, guest };
      }

      it('starts with an absolute deadline rather than a tick count', async () => {
        const { host, guest } = await readyRoom();
        const counting = waitForState(guest, (s) => s.phase === 'countdown');

        const res = await host.timeout(3_000).emitWithAck('room:start');
        expect(res.ok).toBe(true);

        const state = await counting;
        expect(state.countdownEndsAt).toBeGreaterThan(Date.now());
        // Roughly three seconds out — the client derives every frame from this.
        expect(state.countdownEndsAt! - Date.now()).toBeLessThanOrEqual(3_000);
      });

      it('refuses to start when a player is not ready', async () => {
        const { host } = await roomWithTwo();
        await host.timeout(3_000).emitWithAck('room:ready', { ready: true });

        const res = await host.timeout(3_000).emitWithAck('room:start');

        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('unreachable');
        expect(res.error.code).toBe('PLAYERS_NOT_READY');
      });

      it('refuses to start with only one player', async () => {
        const host = await identified('Lonely');
        const created = await host
          .timeout(3_000)
          .emitWithAck('room:create', { settings: SETTINGS });
        if (!created.ok) throw new Error('create failed');

        await host.timeout(3_000).emitWithAck('room:ready', { ready: true });
        const res = await host.timeout(3_000).emitWithAck('room:start');

        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('unreachable');
        expect(res.error.code).toBe('NOT_ENOUGH_PLAYERS');
      });

      it('refuses a non-host', async () => {
        const { guest } = await readyRoom();
        const res = await guest.timeout(3_000).emitWithAck('room:start');

        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('unreachable');
        expect(res.error.code).toBe('NOT_HOST');
      });

      /** "Wait, no" has to work — a running timer is not a commitment. */
      it('aborts when a player un-readies mid-count', async () => {
        const { host, guest } = await readyRoom();

        const counting = waitForState(guest, (s) => s.phase === 'countdown');
        await host.timeout(3_000).emitWithAck('room:start');
        await counting;

        const aborted = waitForState(host, (s) => s.phase === 'lobby');
        await guest.timeout(3_000).emitWithAck('room:ready', { ready: false });

        const state = await aborted;
        expect(state.countdownEndsAt).toBeNull();
      });

      /**
       * The one that matters most: without this the timer still fires and the
       * survivor is dropped into a fight against nobody.
       */
      it('aborts when a player leaves mid-count', async () => {
        const { host, guest } = await readyRoom();

        const counting = waitForState(host, (s) => s.phase === 'countdown');
        await host.timeout(3_000).emitWithAck('room:start');
        await counting;

        const aborted = waitForState(host, (s) => s.phase === 'lobby');
        await guest.timeout(3_000).emitWithAck('room:leave');

        const state = await aborted;
        expect(state.countdownEndsAt).toBeNull();
        expect(state.members).toHaveLength(1);
      });

      it('reaches the match once the count completes', async () => {
        const { host, guest } = await readyRoom();

        const inMatch = waitForState(guest, (s) => s.phase === 'in-match', 6_000);
        await host.timeout(3_000).emitWithAck('room:start');

        const state = await inMatch;
        expect(state.countdownEndsAt).toBeNull();
      });

      it('resolves a random arena before the count, so both see the same stage', async () => {
        const { host, guest } = await roomWithTwo();

        await host.timeout(3_000).emitWithAck('room:update', {
          settings: { randomArena: true },
        });

        const bothReady = waitForState(host, (s) => s.members.every((m) => m.isReady));
        await host.timeout(3_000).emitWithAck('room:ready', { ready: true });
        await guest.timeout(3_000).emitWithAck('room:ready', { ready: true });
        await bothReady;

        const hostSees = waitForState(host, (s) => s.phase === 'countdown');
        const guestSees = waitForState(guest, (s) => s.phase === 'countdown');
        await host.timeout(3_000).emitWithAck('room:start');

        const [a, b] = await Promise.all([hostSees, guestSees]);
        expect(a.settings.arenaId).toBe(b.settings.arenaId);
      });
    });

    it('refuses lobby actions from a player who is not in a room', async () => {
      const drifter = await identified('Drifter');

      const res = await drifter.timeout(3_000).emitWithAck('room:ready', { ready: true });

      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      expect(res.error.code).toBe('NOT_IN_MATCH');
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
