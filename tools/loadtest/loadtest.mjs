#!/usr/bin/env node
/**
 * WordWars load test.
 *
 * Answers one question: **how many simultaneous fights can one server process
 * run before the players notice?**
 *
 * "Notice" is the important word. Requests-per-second is the wrong measure for
 * a fighting game — what ruins a match is not throughput but *stutter*, and in
 * this architecture every live match shares one event loop (plan §1.1 D2). A
 * server at 80% CPU with a flat loop is healthy; a server at 30% CPU with
 * 200ms lag spikes is already ruining every fight it is hosting, all at once.
 *
 * So the headline numbers here are event-loop lag and the round trip from
 * "player commits a word" to "the attack comes back". Everything else is
 * supporting evidence.
 *
 * Usage:
 *   node tools/loadtest/loadtest.mjs                  # default ramp
 *   node tools/loadtest/loadtest.mjs --tiers 10,50    # specific tiers
 *   node tools/loadtest/loadtest.mjs --seconds 20     # longer soak per tier
 *   node tools/loadtest/loadtest.mjs --url http://host:4000
 */

import { io } from 'socket.io-client';

const args = parseArgs(process.argv.slice(2));
const URL = args.url ?? 'http://localhost:4000';
const TIERS = args.tiers ?? [5, 25, 50, 100];
const SECONDS = args.seconds ?? 12;

/**
 * Words per second per bot.
 *
 * 2.4/s is roughly 100 WPM at this word length — a strong human, not a machine.
 * Driving bots faster would measure the rate limiter rather than the game, and
 * would tell us how the server copes with traffic no real player generates.
 */
const WORDS_PER_SECOND = args.wps ?? 2.4;

const SETTINGS = {
  mode: '1v1',
  arenaId: 'dojo',
  randomArena: false,
  randomCharacter: false,
  difficulty: 'normal',
  language: 'en',
  roundCount: 1,
  enableUltimate: true,
  enableCrits: true,
  isPublic: false,
  hasPassword: false,
  maxPlayers: 2,
  allowSpectators: true,
};

async function main() {
  console.log(`\nWordWars load test → ${URL}`);
  console.log(`tiers: ${TIERS.join(', ')} concurrent matches · ${SECONDS}s each\n`);

  const health = await fetch(`${URL}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`No server at ${URL}. Start it with: pnpm --filter @wordwars/server dev`);
    process.exit(1);
  }

  const results = [];
  for (const tier of TIERS) {
    results.push(await runTier(tier));
  }

  report(results);
}

async function runTier(matchCount) {
  process.stdout.write(`  ${String(matchCount).padStart(4)} matches  `);

  // The histogram is cumulative since boot, so each tier starts clean or the
  // previous tier's worst spike would haunt every number after it.
  await fetch(`${URL}/metrics/reset`, { method: 'POST' }).catch(() => {});

  const matches = [];
  const failures = [];

  for (let i = 0; i < matchCount; i += 1) {
    try {
      matches.push(await startMatch(i));
    } catch (error) {
      failures.push(String(error?.message ?? error));
    }
    // Staggered: 200 sockets arriving in the same millisecond measures the
    // accept queue, not the game.
    await sleep(15);
  }

  process.stdout.write(`started ${matches.length}  `);

  const live = matches.filter(Boolean);
  const latencies = [];
  const stop = Date.now() + SECONDS * 1000;

  // Steady state: every bot types at a human pace until the clock runs out.
  await Promise.all(live.map((match) => driveMatch(match, stop, latencies)));

  const metrics = await fetch(`${URL}/metrics`)
    .then((r) => r.json())
    .catch(() => null);

  for (const match of live) {
    match.a.disconnect();
    match.b.disconnect();
  }
  await sleep(400);

  const result = {
    matchCount,
    started: live.length,
    failures: failures.length,
    samples: latencies.length,
    latency: percentiles(latencies),
    eventLoop: metrics?.eventLoop ?? null,
    memory: metrics?.memory ?? null,
    liveMatches: metrics?.matches?.live ?? null,
    sockets: metrics?.connections?.sockets ?? null,
  };

  console.log(
    `p50 ${fmt(result.latency.p50)}ms  p95 ${fmt(result.latency.p95)}ms  ` +
      `loop p99 ${fmt(result.eventLoop?.p99Ms)}ms  rss ${result.memory?.rssMb ?? '?'}MB`,
  );

  return result;
}

function startMatch(index) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout starting match')), 20_000);

    void (async () => {
      try {
        const a = await connect();
        const b = await connect();

        await ack(a, 'guest:init', { nickname: `Load${index}A` });
        await ack(b, 'guest:init', { nickname: `Load${index}B` });

        const match = { a, b, index, started: null, selfA: null, sentAt: null, latency: undefined };

        a.on('match:start', (payload) => {
          match.started = payload;
          match.selfA = payload.fighters[0]?.playerId ?? null;
        });

        /*
         * The number that matters: word committed → its attack comes back.
         *
         * Measured on the wire rather than from a server log, because the
         * player's experience includes every queue between the two — and it
         * deliberately includes the 30Hz event batching, since a hit that
         * waits 33ms for the next flush waited 33ms as far as the player's
         * eyes are concerned.
         */
        a.on('match:events', ({ events }) => {
          if (match.sentAt === null) return;

          for (const event of events) {
            if (event.type !== 'attack' || event.actor !== match.selfA) continue;
            match.latency = Date.now() - match.sentAt;
            match.sentAt = null;
            break;
          }
        });

        const room = await ack(a, 'room:create', { settings: SETTINGS });
        if (!room.ok) throw new Error(`room:create ${room.error?.code}`);

        const joined = await ack(b, 'room:join', { code: room.data.code });
        if (!joined.ok) throw new Error(`room:join ${joined.error?.code}`);

        await ack(a, 'room:ready', { ready: true });
        await ack(b, 'room:ready', { ready: true });
        await ack(a, 'room:start');

        clearTimeout(timer);
        resolve(match);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    })();
  });
}

async function driveMatch(match, stopAt, latencies) {
  // Wait out the countdown before typing into a fight that has not begun.
  const deadline = Date.now() + 8_000;
  while (!match.started && Date.now() < deadline) await sleep(100);
  if (!match.started) return;

  const matchId = match.started.config.matchId;
  const interval = 1000 / WORDS_PER_SECOND;
  let index = 0;
  let ended = false;

  match.a.on('match:end', () => {
    ended = true;
  });

  // Bots stagger their first word so a hundred matches do not all fire on the
  // same tick — real players are not synchronised, and pretending they are
  // would invent a thundering herd the product never sees.
  await sleep(Math.random() * interval);

  while (Date.now() < stopAt && !ended) {
    // Only time a word when the previous one has already been answered, so a
    // sample is never the sum of two overlapping round trips.
    if (match.sentAt === null) match.sentAt = Date.now();
    match.a.emit('match:word', { matchId, wordIndex: index, dirty: false, timings: [70, 65, 72] });

    await sleep(interval);
    if (match.latency !== undefined) {
      latencies.push(match.latency);
      match.latency = undefined;
    }

    index += 1;

    /*
     * Follow the server's authoritative index if we have drifted — the same
     * correction the real client makes. Without it a single dropped word ends
     * the match early and the tier silently measures fewer fights than it
     * claims.
     */
    if (index % 20 === 0) {
      const authoritative = match.a.serverIndex;
      if (typeof authoritative === 'number' && authoritative !== index) index = authoritative;
    }
  }
}

// --- plumbing ---------------------------------------------------------------

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 15_000);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.on('match:state', (snapshot) => {
        socket.serverIndex = snapshot.fighters?.[0]?.wordIndex;
      });
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const ack = (socket, event, payload) =>
  payload === undefined
    ? socket.timeout(10_000).emitWithAck(event)
    : socket.timeout(10_000).emitWithAck(event, payload);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentiles(values) {
  if (values.length === 0) return { p50: null, p95: null, p99: null, max: null };

  const sorted = [...values].sort((x, y) => x - y);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
}

const fmt = (value) => (value === null || value === undefined ? '?' : String(Math.round(value)));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (!key || value === undefined) continue;
    if (key === 'tiers') out.tiers = value.split(',').map(Number);
    else if (key === 'seconds') out.seconds = Number(value);
    else if (key === 'url') out.url = value;
    else if (key === 'wps') out.wps = Number(value);
  }
  return out;
}

function report(results) {
  console.log('\n  matches   started   word→hit p50/p95   loop p50/p99      rss     live');
  console.log('  ' + '-'.repeat(72));

  for (const r of results) {
    console.log(
      `  ${String(r.matchCount).padStart(7)}   ${String(r.started).padStart(7)}   ` +
        `${(fmt(r.latency.p50) + '/' + fmt(r.latency.p95) + 'ms').padStart(16)}   ` +
        `${(fmt(r.eventLoop?.p50Ms) + '/' + fmt(r.eventLoop?.p99Ms) + 'ms').padStart(13)}   ` +
        `${String(r.memory?.rssMb ?? '?').padStart(4)}MB   ${String(r.liveMatches ?? '?').padStart(4)}`,
    );
  }

  console.log('');

  /*
   * Thresholds, stated rather than left to interpretation.
   *
   * 50ms of event-loop lag is roughly three dropped frames at 60fps — the
   * point at which a hit stops landing when the player expects it to.
   */
  const worst = results[results.length - 1];
  const loopP99 = worst?.eventLoop?.p99Ms ?? Infinity;

  if (loopP99 > 50) {
    console.log(`  ⚠ event loop p99 ${fmt(loopP99)}ms at ${worst.matchCount} matches — players`);
    console.log(`    would feel this. Capacity is BELOW this tier.\n`);
  } else {
    console.log(`  ✓ event loop stayed under 50ms through ${worst?.matchCount} matches.\n`);
  }

  console.log('  Note: bots run on the same machine as the server, so they compete');
  console.log('  for the same CPU. Real capacity on dedicated hardware is higher.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
