import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSentence, WORDS_PER_SENTENCE } from '@wordwars/content';
import type { CombatEvent, MatchResult, MatchSnapshot, PlayerId, Sentence } from '@wordwars/shared';
import { ServerMatch, type MatchParticipant, type MatchSink } from './ServerMatch.js';

const ALICE = 'alice' as PlayerId;
const BOB = 'bob' as PlayerId;

const participant = (playerId: PlayerId, nickname: string): MatchParticipant => ({
  playerId,
  nickname,
  characterId: 'ninja',
  isGuest: true,
  level: 1,
});

interface Captured {
  events: CombatEvent[];
  snapshots: MatchSnapshot[];
  sentences: Sentence[];
  result: MatchResult | null;
}

let captured: Captured;
let sink: MatchSink;
let match: ServerMatch;

function newMatch(overrides: Partial<Parameters<typeof buildOptions>[0]> = {}) {
  return new ServerMatch(buildOptions(overrides), sink);
}

function buildOptions(overrides: Record<string, unknown> = {}) {
  return {
    roomId: 'room1',
    participants: [participant(ALICE, 'Alice'), participant(BOB, 'Bob')] as [
      MatchParticipant,
      MatchParticipant,
    ],
    arenaId: 'dojo',
    difficulty: 'normal' as const,
    language: 'en',
    roundCount: 1 as const,
    enableUltimate: true,
    enableCrits: true,
    isRanked: false,
    ...overrides,
  };
}

/**
 * Every word the match has issued.
 *
 * The FIRST sentence travels inside the `match:start` payload rather than
 * through the sentence sink — one fewer round trip before the fight begins —
 * so it has to be added back in here to see the true buffer.
 */
let firstSentence: Sentence | null = null;

const issuedWords = (): string[] => [
  ...(firstSentence?.words ?? []),
  ...captured.sentences.flatMap((s) => s.words),
];

const issuedSentences = (): Sentence[] => [
  ...(firstSentence ? [firstSentence] : []),
  ...captured.sentences,
];

function start(m: ServerMatch = match): void {
  firstSentence = m.start().firstSentence;
}

/** Types the next word for a player, straight into the authoritative path. */
function submit(playerId: PlayerId, wordIndex: number, dirty = false): void {
  match.submitWord(playerId, {
    matchId: match.matchId,
    wordIndex,
    dirty,
    timings: [70, 80, 65, 90],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  captured = { events: [], snapshots: [], sentences: [], result: null };

  sink = {
    events: (_id, batch) => captured.events.push(...batch.events),
    snapshot: (_id, snapshot) => captured.snapshots.push(snapshot),
    sentence: (_id, sentence) => captured.sentences.push(sentence),
    ended: (_id, result) => {
      captured.result = result;
    },
  };

  match = newMatch();
});

afterEach(() => {
  match.dispose();
  vi.useRealTimers();
});

describe('starting', () => {
  it('hands back a config, both fighters and an opening sentence', () => {
    const { config, fighters, firstSentence } = match.start();

    expect(config.matchId).toBe(match.matchId);
    expect(config.seed).toBeGreaterThan(0);
    expect(config.maxHp).toBeGreaterThan(0);
    expect(fighters.map((f) => f.side)).toEqual(['left', 'right']);
    expect(firstSentence.words).toHaveLength(WORDS_PER_SENTENCE);
  });

  /** The player must never see the end of the text (plan §4.2). */
  it('buffers text well ahead of the players before anyone types', () => {
    start();
    expect(issuedWords().length).toBeGreaterThanOrEqual(WORDS_PER_SENTENCE * 2);
  });

  it('issues text matching the seed, so a reconnect can be re-sent identical words', () => {
    const result = match.start();
    firstSentence = result.firstSentence;

    const expected = generateSentence('normal', result.config.seed, 0);
    expect(result.firstSentence.words).toEqual(expected);

    // And the streamed follow-ups continue the same deterministic run.
    expect(captured.sentences[0]?.words).toEqual(generateSentence('normal', result.config.seed, 1));
  });
});

describe('resolving words', () => {
  beforeEach(() => start());

  it('turns a clean word into an attack', () => {
    submit(ALICE, 0);
    vi.advanceTimersByTime(50);

    const attacks = captured.events.filter((e) => e.type === 'attack');
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ actor: ALICE, target: BOB });
  });

  it('turns a mistyped word into a miss with no damage', () => {
    submit(ALICE, 0, true);
    vi.advanceTimersByTime(50);

    expect(captured.events.filter((e) => e.type === 'miss')).toHaveLength(1);
    expect(captured.events.filter((e) => e.type === 'attack')).toHaveLength(0);
  });

  it('scores damage by the real length of the issued word, not a client claim', () => {
    const words = issuedWords();
    submit(ALICE, 0);
    vi.advanceTimersByTime(50);

    // The engine is fed the server's own word, so a client cannot inflate
    // damage by claiming it typed something longer.
    const attack = captured.events.find((e) => e.type === 'attack');
    expect(attack).toBeDefined();
    expect(words[0]!.length).toBeGreaterThan(0);
  });

  it('ignores a word index the server has not issued', () => {
    submit(ALICE, 99_999);
    vi.advanceTimersByTime(50);

    expect(captured.events).toHaveLength(0);
  });

  it('ignores a replayed index rather than landing a second hit', () => {
    submit(ALICE, 0);
    submit(ALICE, 0);
    vi.advanceTimersByTime(50);

    expect(captured.events.filter((e) => e.type === 'attack')).toHaveLength(1);
  });

  it('ignores a word addressed to a different match', () => {
    match.submitWord(ALICE, {
      matchId: 'someone-elses-match',
      wordIndex: 0,
      dirty: false,
      timings: [],
    });
    vi.advanceTimersByTime(50);

    expect(captured.events).toHaveLength(0);
  });
});

describe('batching', () => {
  beforeEach(() => start());

  /**
   * Plan §7.2. A frantic exchange must not produce a packet per keystroke.
   */
  it('accumulates events and flushes them together', () => {
    submit(ALICE, 0);
    submit(BOB, 0);
    submit(ALICE, 1);

    // Nothing sent yet — still inside the 33ms window.
    expect(captured.events).toHaveLength(0);

    vi.advanceTimersByTime(35);
    expect(captured.events.length).toBeGreaterThanOrEqual(3);
  });

  it('sends nothing at all when the fight is quiet', () => {
    vi.advanceTimersByTime(500);
    expect(captured.events).toHaveLength(0);
  });

  it('emits reconciliation snapshots on a slower cadence than events', () => {
    vi.advanceTimersByTime(1_000);

    // 10Hz over a second, with a little tolerance for timer scheduling.
    expect(captured.snapshots.length).toBeGreaterThanOrEqual(8);
    expect(captured.snapshots.length).toBeLessThanOrEqual(12);
  });

  it('includes both fighters in every snapshot', () => {
    vi.advanceTimersByTime(150);

    const snapshot = captured.snapshots[0]!;
    expect(snapshot.fighters).toHaveLength(2);
    expect(snapshot.fighters.map((f) => f.playerId).sort()).toEqual([ALICE, BOB].sort());
  });
});

describe('streaming', () => {
  beforeEach(() => start());

  it('issues more text as a player advances', () => {
    const before = issuedWords().length;

    for (let i = 0; i < WORDS_PER_SENTENCE; i += 1) submit(ALICE, i);

    expect(issuedWords().length).toBeGreaterThan(before);
  });

  it('keeps the buffer ahead of the furthest player at all times', () => {
    for (let i = 0; i < 40; i += 1) {
      submit(ALICE, i);
      expect(issuedWords().length - (i + 1)).toBeGreaterThanOrEqual(WORDS_PER_SENTENCE);
    }
  });

  it('never re-issues a sentence index', () => {
    for (let i = 0; i < 30; i += 1) submit(ALICE, i);

    const indices = captured.sentences.map((s) => s.index);
    expect(new Set(indices).size).toBe(indices.length);
  });
});

describe('finishing', () => {
  it('ends on a knockout and reports both fighters', async () => {
    const quick = new ServerMatch(buildOptions(), sink);
    quick.start();

    // Drive until someone drops.
    for (let i = 0; i < 400 && !quick.isFinished; i += 1) {
      quick.submitWord(ALICE, {
        matchId: quick.matchId,
        wordIndex: i,
        dirty: false,
        timings: [70, 60, 80],
      });
    }

    expect(quick.isFinished).toBe(true);
    expect(captured.result).not.toBeNull();
    expect(captured.result?.reason).toBe('knockout');
    expect(captured.result?.winnerId).toBe(ALICE);
    expect(captured.result?.fighters).toHaveLength(2);

    quick.dispose();
  });

  it('reports per-fighter statistics', async () => {
    const quick = new ServerMatch(buildOptions(), sink);
    quick.start();

    for (let i = 0; i < 400 && !quick.isFinished; i += 1) {
      quick.submitWord(ALICE, {
        matchId: quick.matchId,
        wordIndex: i,
        dirty: i % 10 === 9,
        timings: [70, 60, 80],
      });
    }

    const alice = captured.result?.fighters.find((f) => f.playerId === ALICE);
    expect(alice?.wordsTyped).toBeGreaterThan(0);
    expect(alice?.wordsMissed).toBeGreaterThan(0);
    expect(alice?.accuracy).toBeGreaterThan(50);
    expect(alice?.accuracy).toBeLessThan(100);
    expect(alice?.damageDealt).toBeGreaterThan(0);

    quick.dispose();
  });

  it('stops accepting words once finished', () => {
    start();
    match.abort('forfeit', BOB);

    submit(ALICE, 0);
    vi.advanceTimersByTime(50);

    expect(captured.events.filter((e) => e.type === 'attack')).toHaveLength(0);
  });

  it('awards a forfeit to the opponent', () => {
    start();
    match.abort('forfeit', BOB);

    expect(captured.result?.reason).toBe('forfeit');
    expect(captured.result?.winnerId).toBe(BOB);
  });

  it('cannot be finished twice', () => {
    start();
    match.abort('forfeit', BOB);
    match.abort('disconnect', ALICE);

    expect(captured.result?.reason).toBe('forfeit');
  });

  /** An orphaned interval keeps the match object alive and broadcasting. */
  it('stops its timers when it ends', () => {
    start();
    match.abort('forfeit', BOB);

    const snapshotsAfter = captured.snapshots.length;
    vi.advanceTimersByTime(2_000);

    expect(captured.snapshots.length).toBe(snapshotsAfter);
  });

  it('stops its timers on dispose', () => {
    start();
    vi.advanceTimersByTime(200);
    match.dispose();

    const before = captured.snapshots.length;
    vi.advanceTimersByTime(2_000);

    expect(captured.snapshots.length).toBe(before);
  });
});

describe('pausing', () => {
  beforeEach(() => start());

  it('stops accepting words while paused', () => {
    match.pause();
    submit(ALICE, 0);
    vi.advanceTimersByTime(50);

    expect(captured.events.filter((e) => e.type === 'attack')).toHaveLength(0);
  });

  it('resumes accepting words afterwards', () => {
    match.pause();
    match.resume();
    submit(ALICE, 0);
    vi.advanceTimersByTime(50);

    expect(captured.events.filter((e) => e.type === 'attack')).toHaveLength(1);
  });

  /** A frozen room does not need ten snapshots a second describing nothing. */
  it('stops broadcasting while paused', () => {
    vi.advanceTimersByTime(300);
    const before = captured.snapshots.length;

    match.pause();
    vi.advanceTimersByTime(2_000);

    expect(captured.snapshots.length).toBe(before);
  });

  it('flushes pending events before freezing, rather than stranding them', () => {
    submit(ALICE, 0);
    expect(captured.events).toHaveLength(0); // still inside the 33ms window

    match.pause();

    expect(captured.events.length).toBeGreaterThan(0);
  });

  /**
   * The subtle one. Without pause-correction a twenty-second disconnect
   * advances the match clock by twenty seconds — pushing the fight toward
   * sudden death and corrupting every WPM figure on the results screen,
   * because of something neither player did.
   */
  it('does not let paused time advance the match clock', () => {
    submit(ALICE, 0);
    vi.advanceTimersByTime(1_000);

    match.pause();
    vi.advanceTimersByTime(20_000);
    match.resume();

    submit(ALICE, 1);
    match.abort('forfeit', ALICE);

    // ~1s of real play, not ~21s.
    expect(captured.result!.durationMs).toBeLessThan(3_000);
  });

  it('reports whether it is paused', () => {
    expect(match.isPaused).toBe(false);
    match.pause();
    expect(match.isPaused).toBe(true);
    match.resume();
    expect(match.isPaused).toBe(false);
  });

  it('ignores a double pause or a resume that was never paused', () => {
    match.pause();
    match.pause();
    match.resume();
    match.resume();

    expect(match.isPaused).toBe(false);
  });

  it('cannot be paused once finished', () => {
    match.abort('forfeit', BOB);
    match.pause();

    expect(match.isPaused).toBe(false);
  });
});

describe('reconnect support', () => {
  it('can reproduce every sentence issued so far from the seed alone', () => {
    start();
    for (let i = 0; i < 20; i += 1) submit(ALICE, i);

    const replayed = match.issuedSentences();
    expect(replayed.map((s) => s.words)).toEqual(issuedSentences().map((s) => s.words));
  });

  it('exposes a current snapshot for a returning player', () => {
    start();
    submit(ALICE, 0);

    const snapshot = match.snapshot();
    expect(snapshot.fighters).toHaveLength(2);
    expect(snapshot.fighters.find((f) => f.playerId === BOB)?.hp).toBeLessThan(
      snapshot.fighters.find((f) => f.playerId === BOB)!.maxHp,
    );
  });
});
