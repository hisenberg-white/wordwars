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

  it('drops the socket record on disconnect', async () => {
    const client = await connectClient();
    expect(await gateway.fetchSockets()).toHaveLength(1);

    client.disconnect();
    await new Promise((r) => setTimeout(r, 150));

    expect(await gateway.fetchSockets()).toHaveLength(0);
  });
});
