import { describe, expect, it } from 'vitest';
import type { PlayerId } from '@wordwars/shared';
import { MAX_HP } from './constants.js';
import { applyWordAttempt, createMatchState, isTerminal, tick } from './match.js';

/**
 * Balance validation for the 3.11 gate.
 *
 * The gate asks "is it fun?", which no test can answer. But a large part of
 * whether it is fun is whether the tuning produces the SHAPE the design
 * intends — and that is measurable. These run thousands of matches through the
 * real engine (not a reimplementation) and assert the design's own claims.
 *
 * A failure here is a design failure, not a code failure. If one of these ever
 * goes red after a tuning change, the change broke a promise the game makes to
 * its players.
 */

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;

interface Profile {
  readonly wpm: number;
  /** Fraction of words typed cleanly. */
  readonly accuracy: number;
}

interface Outcome {
  readonly winner: PlayerId | null;
  readonly durationMs: number;
  readonly wordsA: number;
  readonly peakCombo: number;
  readonly ultimates: number;
  readonly loserHpAtHalfway: number;
  readonly winnerHpRemaining: number;
}

/** Average word length in the normal bank, near enough for pacing maths. */
const AVG_WORD_LENGTH = 7;

/**
 * Runs one match to completion.
 *
 * Both fighters type on their own cadence derived from WPM, interleaved by
 * arrival time exactly as the server would resolve them.
 */
function simulate(profileA: Profile, profileB: Profile, seed: number): Outcome {
  const state = createMatchState({ matchId: 'sim', seed, players: [A, B] });

  // Deterministic per-run randomness for accuracy rolls, so a failing case can
  // be reproduced from its seed.
  let rng = seed * 2654435761;
  const roll = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  const msPerWord = (p: Profile) => (AVG_WORD_LENGTH / 5) * (60_000 / p.wpm);

  const fighters = [
    { id: A, profile: profileA, next: msPerWord(profileA), index: 0 },
    { id: B, profile: profileB, next: msPerWord(profileB), index: 0 },
  ];

  let now = 0;
  let ultimates = 0;
  let loserHpAtHalfway = MAX_HP;
  let halfwayRecorded = false;

  while (!isTerminal(state) && now < 300_000) {
    const actor = fighters[0]!.next <= fighters[1]!.next ? fighters[0]! : fighters[1]!;
    now = actor.next;
    actor.next += msPerWord(actor.profile);

    const delta = applyWordAttempt(state, {
      playerId: actor.id,
      wordIndex: actor.index,
      wordLength: AVG_WORD_LENGTH,
      dirty: roll() > actor.profile.accuracy,
      atMs: now,
    });

    actor.index += 1;
    ultimates += delta.events.filter((e) => e.type === 'ultimate').length;

    tick(state, now);

    // Snapshot the trailing fighter's HP once someone is halfway down, to see
    // whether a comeback was still arithmetically available.
    if (!halfwayRecorded) {
      const behind = [...state.fighters].sort((x, y) => x.hp - y.hp)[0]!;
      if (behind.hp <= MAX_HP * 0.5) {
        loserHpAtHalfway = behind.hp;
        halfwayRecorded = true;
      }
    }
  }

  const winner = state.winnerId;
  const winnerFighter = state.fighters.find((f) => f.playerId === winner);

  return {
    winner,
    durationMs: now,
    wordsA: fighters[0]!.index,
    peakCombo: Math.max(...state.fighters.map((f) => f.maxCombo)),
    ultimates,
    loserHpAtHalfway,
    winnerHpRemaining: winnerFighter?.hp ?? 0,
  };
}

function runMany(a: Profile, b: Profile, count = 400) {
  const outcomes = Array.from({ length: count }, (_, i) => simulate(a, b, i + 1));

  return {
    outcomes,
    winRateA: outcomes.filter((o) => o.winner === A).length / count,
    medianDurationMs: median(outcomes.map((o) => o.durationMs)),
    medianWords: median(outcomes.map((o) => o.wordsA)),
    medianPeakCombo: median(outcomes.map((o) => o.peakCombo)),
    medianUltimates: median(outcomes.map((o) => o.ultimates)),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

// ---------------------------------------------------------------------------

describe('the central premise: accuracy beats raw speed', () => {
  /**
   * The claim the whole game rests on. It is stated in the brief, on the
   * landing page, and in the matchmaking tips — if a fast sloppy typist beats
   * a slower accurate one, every one of those is a lie and the combo system is
   * decoration.
   */
  it('a slower, accurate typist beats a faster, sloppy one', () => {
    const accurate = { wpm: 70, accuracy: 0.98 };
    const sloppy = { wpm: 100, accuracy: 0.86 };

    const { winRateA } = runMany(accurate, sloppy);

    expect(winRateA).toBeGreaterThan(0.5);
  });

  it('holds across a realistic range of speed advantages', () => {
    for (const fastWpm of [95, 105]) {
      const { winRateA } = runMany({ wpm: 70, accuracy: 0.98 }, { wpm: fastWpm, accuracy: 0.85 });

      expect(winRateA, `accurate 70wpm vs sloppy ${fastWpm}wpm`).toBeGreaterThan(0.5);
    }
  });

  /**
   * The crossover, pinned deliberately.
   *
   * Accuracy does NOT beat speed forever, and it should not: if it did, speed
   * would be worthless and the game would become a slow-and-careful contest
   * with no excitement. Somebody typing 64% faster is genuinely better overall,
   * even at 13 points less accuracy, and the tuning agrees — it lands near a
   * coin flip there.
   *
   * This test exists so the crossover cannot drift silently. It is also why the
   * matchmaking tip says "a steady 70 will beat a frantic 100" rather than
   * "accuracy beats speed, every time" — the game should not promise something
   * its own numbers break.
   */
  it('but a large enough speed advantage does eventually win out', () => {
    const { winRateA } = runMany({ wpm: 70, accuracy: 0.98 }, { wpm: 115, accuracy: 0.85 });

    // Near even at this gap — neither side dominant.
    expect(winRateA).toBeGreaterThan(0.35);
    expect(winRateA).toBeLessThan(0.6);
  });

  /**
   * The other half of the claim: accuracy must not be so dominant that speed
   * stops mattering, or the game becomes a slow-and-careful contest with no
   * excitement.
   */
  it('but speed still decides a match between equally accurate players', () => {
    const { winRateA } = runMany({ wpm: 95, accuracy: 0.95 }, { wpm: 75, accuracy: 0.95 });

    // A 27% speed advantage at equal accuracy wins ~84% of the time: decisive
    // enough that speed clearly matters, uncertain enough that the slower
    // player is not simply told the result in advance.
    expect(winRateA).toBeGreaterThan(0.8);
  });
});

describe('match pacing', () => {
  const EVEN = { wpm: 75, accuracy: 0.95 };

  it('an even match lasts long enough to have a shape', () => {
    const { medianDurationMs } = runMany(EVEN, { wpm: 72, accuracy: 0.94 });

    // Long enough to build and lose a combo more than once; short enough that
    // a rematch never feels like a commitment.
    expect(medianDurationMs).toBeGreaterThan(30_000);
    expect(medianDurationMs).toBeLessThan(110_000);
  });

  /**
   * The failure this catches is the one that broke the ORIGINAL tuning: at
   * 1000 HP matches ran ~23 words, so combo 35 — the top damage tier — was
   * mathematically unreachable and the whole tier was dead content.
   */
  it('is long enough that the top combo tier is reachable', () => {
    const { medianPeakCombo } = runMany(EVEN, { wpm: 72, accuracy: 0.96 });

    expect(medianPeakCombo).toBeGreaterThan(20);
  });

  it('rewards a clean player with a genuinely high combo', () => {
    const { medianPeakCombo } = runMany({ wpm: 80, accuracy: 0.99 }, { wpm: 78, accuracy: 0.99 });

    expect(medianPeakCombo).toBeGreaterThanOrEqual(35);
  });
});

describe('the ultimate is an event, not a routine', () => {
  /**
   * Each Ultimate freezes the scene for ~190ms and runs a ~1.2s cinematic. Six
   * per match would spend a fifth of the fight in cutscenes and make the
   * biggest moment in the game feel like a chore.
   */
  it('fires a few times per match, not constantly', () => {
    const { medianUltimates } = runMany({ wpm: 75, accuracy: 0.95 }, { wpm: 75, accuracy: 0.95 });

    expect(medianUltimates).toBeGreaterThanOrEqual(2);
    expect(medianUltimates).toBeLessThanOrEqual(8);
  });

  it('is earned by accuracy rather than handed out for showing up', () => {
    const clean = runMany({ wpm: 70, accuracy: 0.99 }, { wpm: 70, accuracy: 0.99 });
    const messy = runMany({ wpm: 70, accuracy: 0.8 }, { wpm: 70, accuracy: 0.8 });

    expect(clean.medianUltimates).toBeGreaterThan(messy.medianUltimates);
  });
});

describe('matches stay competitive', () => {
  /**
   * Plan §5.2 claims a comeback stays possible until roughly the last fifth of
   * a health bar. If the losing player is mathematically dead long before the
   * KO, the back half of every match is a formality they have to sit through.
   */
  it('a trailing player is not already mathematically dead at halfway', () => {
    const { outcomes } = runMany({ wpm: 82, accuracy: 0.95 }, { wpm: 75, accuracy: 0.93 });

    const winnerFinishedHealthy =
      outcomes.filter((o) => o.winnerHpRemaining > MAX_HP * 0.6).length / outcomes.length;

    // A winner who routinely ends near full health means the loser never had a
    // chance — the fight was decided in the opening exchanges.
    expect(winnerFinishedHealthy).toBeLessThan(0.5);
  });

  it('a small skill edge wins often but not always', () => {
    const { winRateA } = runMany({ wpm: 80, accuracy: 0.95 }, { wpm: 75, accuracy: 0.94 });

    // Decisive enough that skill matters, uncertain enough that the underdog
    // has a reason to keep playing.
    expect(winRateA).toBeGreaterThan(0.55);
    expect(winRateA).toBeLessThan(0.95);
  });

  /**
   * Crits add swing, and swing is good — but a match decided by the RNG rather
   * than by the players would be infuriating. Identical players must land near
   * a coin flip.
   */
  it('luck alone does not decide a match between identical players', () => {
    const { winRateA } = runMany({ wpm: 80, accuracy: 0.95 }, { wpm: 80, accuracy: 0.95 }, 600);

    expect(winRateA).toBeGreaterThan(0.38);
    expect(winRateA).toBeLessThan(0.62);
  });
});

describe('matches converge', () => {
  /**
   * The measurement that drove the Rage retune.
   *
   * Two beginners originally slogged for 189 SECONDS — over three minutes,
   * inflicted on exactly the players most likely to give up on the game. The
   * cause was the old health gate switching Rage off the moment either fighter
   * dropped low, i.e. precisely when the match most needed to end.
   */
  it('does not leave two beginners in a multi-minute slog', () => {
    const { medianDurationMs } = runMany({ wpm: 40, accuracy: 0.85 }, { wpm: 40, accuracy: 0.85 });

    expect(medianDurationMs).toBeLessThan(130_000);
  });

  it('narrows the spread between the slowest and fastest matches', () => {
    const slow = runMany({ wpm: 40, accuracy: 0.85 }, { wpm: 40, accuracy: 0.85 });
    const fast = runMany({ wpm: 120, accuracy: 0.98 }, { wpm: 120, accuracy: 0.98 });

    // Beginners will always take longer than experts; the point is that the
    // gap stays within a factor the design can live with.
    expect(slow.medianDurationMs / fast.medianDurationMs).toBeLessThan(5);
  });

  /** Rage exists to converge SLOW fights, never to rush well-played ones. */
  it('leaves a well-played match entirely free of sudden death', () => {
    const { medianDurationMs } = runMany({ wpm: 85, accuracy: 0.96 }, { wpm: 85, accuracy: 0.96 });

    expect(medianDurationMs).toBeLessThan(60_000);
  });
});

describe('the skill floor and ceiling', () => {
  it('a beginner still lands hits and sees combos', () => {
    const { medianPeakCombo, medianDurationMs } = runMany(
      { wpm: 40, accuracy: 0.85 },
      { wpm: 40, accuracy: 0.85 },
    );

    // A new player must experience the mechanics, not merely survive them.
    expect(medianPeakCombo).toBeGreaterThanOrEqual(5);
    expect(medianDurationMs).toBeLessThan(130_000);
  });

  it('an expert beats a beginner decisively', () => {
    const { winRateA } = runMany({ wpm: 110, accuracy: 0.98 }, { wpm: 45, accuracy: 0.88 });

    expect(winRateA).toBeGreaterThan(0.97);
  });
});
