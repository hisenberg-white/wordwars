import { asPlayerId, type PlayerId } from '@wordwars/shared';
import { logger } from '../logger.js';
import type { ServerMatch } from './ServerMatch.js';

/**
 * A computer opponent.
 *
 * Exists because the honest state of a new game is that nobody else is online,
 * and "Searching for an opponent" forever is not a game. A player who wants to
 * measure their own speed should be able to, at any hour, without needing a
 * second human to volunteer.
 *
 * The bot is a **real participant in a real match** rather than a simulation.
 * It submits words through the same `submitWord` the network path uses, so the
 * engine, the events, the snapshots, the results screen and the rendering are
 * all exactly what a human match produces. A separate practice mode with its
 * own scoring would drift from the real game within a week, and the numbers it
 * reported would slowly stop meaning anything.
 */

export type BotDifficulty = 'rookie' | 'fighter' | 'veteran' | 'champion';

export interface BotProfile {
  readonly id: BotDifficulty;
  readonly name: string;
  /** Target words per minute. */
  readonly wpm: number;
  /** Chance a given word is typed cleanly. */
  readonly accuracy: number;
  readonly description: string;
}

/**
 * The ladder.
 *
 * Deliberately topping out below the human record rather than at it: a bot that
 * cannot be beaten teaches nothing and is not fun to meet. `rookie` is set
 * genuinely slow, because the player most in need of a practice opponent is the
 * one who would lose to a fast one every time.
 */
export const BOT_PROFILES: readonly BotProfile[] = [
  {
    id: 'rookie',
    name: 'Sparring Dummy',
    wpm: 35,
    accuracy: 0.9,
    description: 'Slow and clumsy. Somewhere to start.',
  },
  {
    id: 'fighter',
    name: 'Club Fighter',
    wpm: 55,
    accuracy: 0.94,
    description: 'A steady average typist.',
  },
  {
    id: 'veteran',
    name: 'Veteran',
    wpm: 80,
    accuracy: 0.97,
    description: 'Quick, and rarely slips.',
  },
  {
    id: 'champion',
    name: 'Champion',
    wpm: 105,
    accuracy: 0.99,
    description: 'You will have to earn this one.',
  },
];

export const findProfile = (id: string): BotProfile | undefined =>
  BOT_PROFILES.find((p) => p.id === id);

/** Bot ids are marked so nothing downstream can mistake one for a person. */
const BOT_PREFIX = 'bot:';

export const newBotId = (): PlayerId =>
  asPlayerId(`${BOT_PREFIX}${Math.random().toString(36).slice(2, 10)}`);

export const isBotId = (playerId: string): boolean => playerId.startsWith(BOT_PREFIX);

/** Average characters per word in the generated text, for pacing. */
const AVG_WORD_CHARS = 7;

class Bot {
  private nextWordAt: number;
  private wordIndex = 0;

  constructor(
    readonly match: ServerMatch,
    readonly playerId: PlayerId,
    private readonly profile: BotProfile,
    startedAt: number,
  ) {
    // Opens a beat late rather than on the same millisecond as the countdown,
    // so the first exchange feels like two people starting rather than a
    // machine firing the instant it is allowed to.
    this.nextWordAt = startedAt + 400 + Math.random() * 400;
  }

  tick(now: number): void {
    if (this.match.isFinished || now < this.nextWordAt) return;

    /*
     * Accuracy is spent as whole words, not characters.
     *
     * A miss costs the bot its combo exactly as it would a human — that is the
     * mechanic the player is learning to exploit, so the opponent has to be
     * subject to it. A bot that never broke combo would be teaching the wrong
     * lesson about why accuracy matters.
     */
    const dirty = Math.random() > this.profile.accuracy;

    this.match.submitWord(this.playerId, {
      matchId: this.match.matchId,
      wordIndex: this.wordIndex,
      dirty,
      timings: [],
    });

    this.wordIndex += 1;
    this.nextWordAt = now + this.intervalMs();
  }

  /**
   * How long until the next word.
   *
   * Jittered ±25%, because a perfectly metronomic opponent reads as a machine
   * within about five words. Real typing arrives in bursts and hesitations, and
   * the variance is most of what makes the fight feel like it has someone on
   * the other side of it.
   */
  private intervalMs(): number {
    const base = (60_000 / this.profile.wpm) * (AVG_WORD_CHARS / 5);
    return base * (0.75 + Math.random() * 0.5);
  }
}

/**
 * Drives every bot in the process from ONE timer.
 *
 * The 5.8 load test showed per-match timers, not per-word work, were what
 * degraded the event loop — so a new one per bot would reintroduce exactly the
 * cost that was just removed. Bots are cheap; timers are not.
 */
class BotRegistry {
  private readonly bots = new Set<Bot>();
  private timer: ReturnType<typeof setInterval> | null = null;

  add(match: ServerMatch, playerId: PlayerId, profile: BotProfile): void {
    this.bots.add(new Bot(match, playerId, profile, Date.now()));
    if (!this.timer) this.start();
  }

  private start(): void {
    this.timer = setInterval(() => {
      const now = Date.now();

      for (const bot of [...this.bots]) {
        if (bot.match.isFinished) {
          this.bots.delete(bot);
          continue;
        }

        try {
          bot.tick(now);
        } catch (error) {
          // One misbehaving bot must not stop the others; they share this timer.
          logger.error({ err: error, matchId: bot.match.matchId }, 'Bot tick failed');
          this.bots.delete(bot);
        }
      }

      if (this.bots.size === 0) this.stop();
    }, TICK_MS);

    this.timer.unref?.();
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  get size(): number {
    return this.bots.size;
  }

  clear(): void {
    this.bots.clear();
    this.stop();
  }
}

/**
 * Resolution of the bot clock.
 *
 * Fine enough that word timing is not visibly quantised, coarse enough that a
 * hundred practice matches cost almost nothing.
 */
const TICK_MS = 50;

export const bots = new BotRegistry();
