import { randomInt } from 'node:crypto';
import {
  accuracyBpFromCounts,
  applyWordAttempt,
  averageWpm,
  createMatchState,
  isIntermission,
  scoreOf,
  startNextRound,
  tick,
  type EngineFighter,
  type EngineMatchState,
} from '@wordwars/engine';
import { WORDS_PER_SENTENCE, generateSentence } from '@wordwars/content';
import type {
  CombatEvent,
  Difficulty,
  FighterResult,
  MatchConfig,
  MatchEndReason,
  MatchFighter,
  MatchResult,
  MatchSnapshot,
  MatchWordPayload,
  PlayerId,
  Sentence,
} from '@wordwars/shared';
import { asMatchId } from '@wordwars/shared';
import { logger } from '../logger.js';
import { CheatMonitor } from './CheatMonitor.js';

/**
 * Cadences.
 *
 * Events at 30Hz and snapshots at 10Hz (plan §7.2). Events are the narration —
 * they must feel immediate. Snapshots exist only to correct prediction drift,
 * and drift accumulates slowly, so sending them three times less often costs
 * nothing and roughly halves the bandwidth.
 */
export const EVENT_FLUSH_MS = 33;
export const SNAPSHOT_MS = 100;
export const TICK_MS = 250;

/**
 * Keep this many words ahead of the fastest player.
 *
 * The player must never see the end of the text. Running out mid-combo would
 * be a stall in the one place the game promises never to stall (plan §4.2).
 */
const LOOKAHEAD_WORDS = WORDS_PER_SENTENCE * 2;

export interface MatchParticipant {
  readonly playerId: PlayerId;
  readonly nickname: string;
  readonly characterId: string;
  readonly isGuest: boolean;
  readonly level: number;
}

/**
 * The pause between rounds of a best-of-3/5.
 *
 * Long enough to read the score, short enough that nobody reaches for another
 * tab. This is the one moment in a match when both players look up.
 */
export const INTERMISSION_MS = 4_000;

export interface ServerMatchOptions {
  readonly roomId: string;
  readonly participants: readonly [MatchParticipant, MatchParticipant];
  readonly arenaId: string;
  readonly difficulty: Difficulty;
  readonly language: string;
  readonly roundCount: 1 | 3 | 5;
  readonly enableUltimate: boolean;
  readonly enableCrits: boolean;
  readonly isRanked: boolean;
}

export interface MatchSink {
  /** Narration batch, 30Hz. */
  events(matchId: string, batch: { tick: number; events: CombatEvent[] }): void;
  /** Reconciliation snapshot, 10Hz. */
  snapshot(matchId: string, snapshot: MatchSnapshot): void;
  sentence(matchId: string, sentence: Sentence): void;
  ended(matchId: string, result: MatchResult): void;
}

/**
 * One live match.
 *
 * Owns its own timers and engine state, entirely in this process (plan §1.1
 * D2). Nothing here touches Redis or the database: a match is a 60-second
 * stateful object with sub-100ms latency requirements, and a round trip to
 * external storage per word is what turns "scales to thousands" into "dies at
 * two hundred".
 */
export class ServerMatch {
  readonly matchId: string;
  readonly config: MatchConfig;
  readonly fighters: readonly MatchFighter[];

  private readonly state: EngineMatchState;
  private readonly options: ServerMatchOptions;
  private readonly sink: MatchSink;
  private readonly monitors = new Map<PlayerId, CheatMonitor>();

  private readonly pendingEvents: CombatEvent[] = [];
  private sentencesSent = 0;
  private wordsSent = 0;

  private intermissionTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Paused matches stay registered with the scheduler but take no beats.
   *
   * Deregistering and re-registering would work too, but this keeps the
   * pause/resume decision in one place — the match knows whether it is paused;
   * the scheduler should not have to.
   */
  private ticking = false;

  private startedAt = 0;
  private finished = false;

  /** Set while a player is disconnected and the fight is on hold (§7.3). */
  private pausedAt: number | null = null;
  /**
   * Total time spent paused, subtracted from elapsed.
   *
   * Without this a twenty-second disconnect would advance the match clock by
   * twenty seconds — pushing a fight toward sudden death, and corrupting every
   * WPM figure on the results screen, because of something neither player did.
   */
  private pausedTotalMs = 0;

  constructor(options: ServerMatchOptions, sink: MatchSink) {
    this.options = options;
    this.sink = sink;
    this.matchId = asMatchId(`m_${randomInt(1e9).toString(36)}${Date.now().toString(36)}`);

    const [a, b] = options.participants;
    const seed = randomInt(1, 2 ** 31 - 1);

    this.config = {
      matchId: asMatchId(this.matchId),
      mode: '1v1',
      arenaId: options.arenaId as MatchConfig['arenaId'],
      difficulty: options.difficulty,
      language: options.language,
      seed,
      maxHp: 0, // Replaced below from the engine's own default.
      enableUltimate: options.enableUltimate,
      enableCrits: options.enableCrits,
      roundCount: options.roundCount,
      isRanked: options.isRanked,
    };

    this.state = createMatchState({
      matchId: this.matchId,
      seed,
      players: [a.playerId, b.playerId],
      roundCount: options.roundCount,
      enableUltimate: options.enableUltimate,
      enableCrits: options.enableCrits,
    });

    this.config = { ...this.config, maxHp: this.state.maxHp };

    this.fighters = [{ ...toFighter(a, 'left') }, { ...toFighter(b, 'right') }];

    for (const participant of options.participants) {
      this.monitors.set(participant.playerId, new CheatMonitor());
    }
  }

  /** The opening sentence, handed over with `match:start`. */
  start(): { config: MatchConfig; fighters: readonly MatchFighter[]; firstSentence: Sentence } {
    this.startedAt = Date.now();

    const firstSentence = this.buildSentence();
    // Enough text buffered that no player can reach the end before the stream
    // catches up, even at superhuman speed.
    this.streamAhead();

    this.startTimers();

    logger.info(
      { matchId: this.matchId, arena: this.options.arenaId, seed: this.config.seed },
      'Match started',
    );

    return { config: this.config, fighters: this.fighters, firstSentence };
  }

  /**
   * Resolves a word from a client.
   *
   * The authoritative path. Note what is NOT trusted: the client's own idea of
   * when it typed. See `atMs` below.
   */
  submitWord(playerId: PlayerId, payload: MatchWordPayload): void {
    if (this.finished) return;
    // Words arriving during a pause are dropped. The surviving player must not
    // be able to keep landing hits on an opponent who cannot fight back.
    if (this.pausedAt !== null) return;
    if (payload.matchId !== this.matchId) return;

    const word = this.wordAt(payload.wordIndex);
    if (word === null) return; // Beyond anything we have issued.

    /*
     * Server receipt time, not the client's timestamp.
     *
     * Plan §7.4 suggested deriving tempo from client-reported timings. Using
     * our own arrival time instead removes an entire cheat vector — a client
     * cannot claim to have typed faster than it did — at the cost of some
     * network jitter in the tempo bonus. That cost is small: constant latency
     * shifts both arrivals equally and cancels out of the GAP, and only
     * jitter remains, which is tens of ms against a 400-1200ms scale.
     *
     * The client's reported timings are still collected, but exclusively for
     * cheat heuristics — never for damage.
     */
    // Pause-corrected, not raw wall time: after a twenty-second disconnect the
    // first word back would otherwise show a twenty-second gap, tanking the
    // returning player's tempo bonus for something that was not their doing.
    const atMs = this.elapsedMs();

    const flag = this.monitors.get(playerId)?.record(atMs, word.length, payload.timings);

    if (flag) {
      logger.warn(
        { matchId: this.matchId, playerId, reason: flag.reason, detail: flag.detail },
        'Timing flag raised',
      );
    }

    const delta = applyWordAttempt(this.state, {
      playerId,
      wordIndex: payload.wordIndex,
      wordLength: word.length,
      dirty: payload.dirty,
      atMs,
    });

    if (delta.rejected) {
      logger.debug(
        { matchId: this.matchId, playerId, reason: delta.rejected },
        'Word attempt rejected',
      );
      return;
    }

    this.pendingEvents.push(...delta.events);
    this.streamAhead();

    if (delta.terminal) {
      // Flush immediately rather than waiting up to 33ms — the KO is the one
      // event that must never arrive late.
      this.flushEvents();
      this.finish('knockout');
      return;
    }

    // A round ended but the match did not: hold, then start the next one.
    if (isIntermission(this.state)) {
      this.flushEvents();
      this.beginIntermission();
    }
  }

  /**
   * The pause between rounds.
   *
   * Long enough to read the score and feel the round land, short enough that
   * nobody reaches for another tab. Fighting games make a meal of this moment
   * and they are right to — it is the only time in a match where both players
   * look up.
   */
  private beginIntermission(): void {
    if (this.intermissionTimer) return;

    this.intermissionTimer = setTimeout(() => {
      this.intermissionTimer = null;
      if (this.finished) return;

      startNextRound(this.state, this.elapsedMs());

      // The stream keeps advancing across rounds, so the next round opens on
      // fresh text rather than replaying the last one.
      this.streamAhead();
      this.sink.snapshot(this.matchId, this.snapshot());
    }, INTERMISSION_MS);

    this.intermissionTimer.unref?.();
  }

  /** Ends the match early — forfeit, disconnect, or room teardown. */
  abort(reason: MatchEndReason, winnerId: PlayerId | null = null): void {
    if (this.finished) return;
    if (winnerId) this.state.winnerId = winnerId;
    this.finish(reason);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Current snapshot, used on reconnect to resynchronise a returning player. */
  snapshot(): MatchSnapshot {
    return {
      tick: this.state.tickCount,
      phase: this.state.phase,
      rageMultiplier: this.state.rageMultiplier,
      elapsedMs: this.elapsedMs(),
      round: this.state.round,
      score: scoreOf(this.state),
      fighters: this.state.fighters.map((f) => ({
        playerId: f.playerId,
        hp: f.hp,
        maxHp: this.state.maxHp,
        combo: f.combo,
        maxCombo: f.maxCombo,
        ultimateCharge: f.ultimateCharge,
        ultimateReady: f.ultimateReady,
        wordIndex: f.wordIndex,
        roundsWon: f.roundsWon,
      })),
    };
  }

  /** Every sentence issued so far, for a reconnecting client. */
  issuedSentences(): Sentence[] {
    return Array.from({ length: this.sentencesSent }, (_, index) => ({
      index,
      words: generateSentence(this.options.difficulty, this.config.seed, index),
    }));
  }

  // ---- Internals --------------------------------------------------------

  private elapsedMs(): number {
    if (this.startedAt === 0) return 0;

    const pausedNow = this.pausedAt === null ? 0 : Date.now() - this.pausedAt;
    return Date.now() - this.startedAt - this.pausedTotalMs - pausedNow;
  }

  get isPaused(): boolean {
    return this.pausedAt !== null;
  }

  /**
   * Halts the fight while a player is away.
   *
   * Timers stop rather than the match simply ignoring input: leaving the tick
   * loop running would keep broadcasting snapshots to a room where nothing is
   * happening, and would let sudden death engage during a pause.
   */
  pause(): void {
    if (this.finished || this.pausedAt !== null) return;

    this.pausedAt = Date.now();
    this.stopTimers();
    // Flush first, so the last events before the drop are not stranded in the
    // buffer for the whole pause.
    this.flushEvents();
  }

  resume(): void {
    if (this.finished || this.pausedAt === null) return;

    this.pausedTotalMs += Date.now() - this.pausedAt;
    this.pausedAt = null;
    this.startTimers();
  }

  private wordAt(globalIndex: number): string | null {
    if (globalIndex < 0 || globalIndex >= this.wordsSent) return null;

    const sentenceIndex = Math.floor(globalIndex / WORDS_PER_SENTENCE);
    const offset = globalIndex % WORDS_PER_SENTENCE;

    return (
      generateSentence(this.options.difficulty, this.config.seed, sentenceIndex)[offset] ?? null
    );
  }

  private buildSentence(): Sentence {
    const index = this.sentencesSent;
    const words = generateSentence(this.options.difficulty, this.config.seed, index);

    this.sentencesSent += 1;
    this.wordsSent += words.length;

    return { index, words };
  }

  /** Issues more text while any fighter is within the lookahead of the end. */
  private streamAhead(): void {
    const furthest = Math.max(...this.state.fighters.map((f) => f.wordIndex));

    while (this.wordsSent - furthest < LOOKAHEAD_WORDS) {
      const sentence = this.buildSentence();
      this.sink.sentence(this.matchId, sentence);
    }
  }

  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;

    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    this.sink.events(this.matchId, { tick: this.state.tickCount, events });
  }

  private sendSnapshot(): void {
    if (this.finished) return;
    this.sink.snapshot(this.matchId, this.snapshot());
  }

  private advance(): void {
    if (this.finished) return;

    const delta = tick(this.state, this.elapsedMs());
    if (delta.events.length > 0) this.pendingEvents.push(...delta.events);
  }

  private finish(reason: MatchEndReason): void {
    if (this.finished) return;
    this.finished = true;

    this.stopTimers();
    this.flushEvents();

    const durationMs = this.elapsedMs();
    const result: MatchResult = {
      matchId: asMatchId(this.matchId),
      winnerId: this.state.winnerId,
      reason,
      durationMs,
      fighters: this.state.fighters.map((f) => this.toResult(f, durationMs)),
      xpAwarded: {},
    };

    logger.info(
      {
        matchId: this.matchId,
        reason,
        durationMs,
        winner: this.state.winnerId,
        flagged: [...this.monitors.values()].some((m) => m.flagged),
      },
      'Match finished',
    );

    this.sink.ended(this.matchId, result);
  }

  private toResult(fighter: EngineFighter, durationMs: number): FighterResult {
    return {
      playerId: fighter.playerId,
      hpRemaining: fighter.hp,
      damageDealt: fighter.damageDealt,
      wordsTyped: fighter.wordsTyped,
      wordsMissed: fighter.wordsMissed,
      accuracy: accuracyBpFromCounts(fighter.wordsTyped, fighter.wordsMissed) / 100,
      avgWpm: averageWpm(fighter, durationMs),
      peakWpm: fighter.peakWpm,
      maxCombo: fighter.maxCombo,
      ultimatesUsed: fighter.ultimatesUsed,
      roundsWon: fighter.roundsWon,
    };
  }

  /*
   * The three beats, driven by the shared MatchScheduler.
   *
   * These used to be three `setInterval`s per match. The 5.8 load test showed
   * that cost was per-MATCH rather than per-word — 200 idle matches degraded
   * the loop more than 100 busy ones — so the clock now lives in one place and
   * every match is a callback on it. See MatchScheduler.
   */
  flushDue(): void {
    if (this.ticking) this.flushEvents();
  }

  snapshotDue(): void {
    if (this.ticking) this.sendSnapshot();
  }

  tickDue(): void {
    if (this.ticking) this.advance();
  }

  private startTimers(): void {
    this.ticking = true;
  }

  private stopTimers(): void {
    this.ticking = false;
    // A forfeit or disconnect DURING an intermission must not resurrect the
    // match four seconds later by starting a round nobody is in.
    if (this.intermissionTimer) clearTimeout(this.intermissionTimer);
    this.intermissionTimer = null;
  }

  /** True if either player tripped a timing heuristic (plan §4.3). */
  get flagSummary(): string | null {
    const parts = [...this.monitors.entries()]
      .map(([playerId, monitor]) => {
        const summary = monitor.summarise();
        return summary ? `${playerId}: ${summary}` : null;
      })
      .filter((s): s is string => s !== null);

    return parts.length > 0 ? parts.join(' | ') : null;
  }

  /** Fired when the room is torn down, so timers cannot outlive the match. */
  dispose(): void {
    this.stopTimers();
    this.finished = true;
  }
}

function toFighter(participant: MatchParticipant, side: 'left' | 'right'): MatchFighter {
  return {
    playerId: participant.playerId,
    nickname: participant.nickname,
    characterId: participant.characterId as MatchFighter['characterId'],
    isGuest: participant.isGuest,
    level: participant.level,
    side,
  };
}
