import type { CombatEvent, PlayerId } from '@wordwars/shared';
import { MAX_HP, ULTIMATE_MAX_CHARGE, ULTIMATE_MISS_PENALTY } from './constants.js';
import {
  accuracyBpFromCounts,
  attackKind,
  comboTier,
  computeDamage,
  impactWeight,
  rageMultiplier,
  rollCrit,
  ultimateChargeGain,
  ultimateDamage,
} from './formulas.js';
import {
  EMPTY_DELTA,
  type EngineConfig,
  type EngineFighter,
  type EngineMatchState,
  type MatchDelta,
  type WordAttempt,
} from './types.js';

function createFighter(playerId: PlayerId, slot: number): EngineFighter {
  return {
    playerId,
    slot,
    hp: MAX_HP,
    combo: 0,
    maxCombo: 0,
    ultimateCharge: 0,
    ultimateReady: false,
    wordIndex: 0,
    damageDealt: 0,
    damageTaken: 0,
    wordsTyped: 0,
    wordsMissed: 0,
    charsTyped: 0,
    ultimatesUsed: 0,
    lastWordAtMs: null,
    firstWordAtMs: null,
    peakWpm: 0,
    roundsWon: 0,
  };
}

/** Rounds needed to take the match: 1, 2 or 3. */
export const roundsToWin = (roundCount: 1 | 3 | 5): number => Math.ceil(roundCount / 2);

export function createMatchState(config: EngineConfig): EngineMatchState {
  const maxHp = config.maxHp ?? MAX_HP;

  const fighters: [EngineFighter, EngineFighter] = [
    createFighter(config.players[0], 0),
    createFighter(config.players[1], 1),
  ];

  for (const fighter of fighters) fighter.hp = maxHp;

  return {
    matchId: config.matchId,
    seed: config.seed,
    maxHp,
    enableUltimate: config.enableUltimate ?? true,
    enableCrits: config.enableCrits ?? true,
    roundCount: config.roundCount ?? 1,
    phase: 'combat',
    tickCount: 0,
    elapsedMs: 0,
    round: 1,
    roundStartedMs: 0,
    rageMultiplier: 1,
    fighters,
    winnerId: null,
  };
}

/** The MATCH is over. An intermission is not terminal — more rounds follow. */
export const isTerminal = (state: EngineMatchState): boolean =>
  state.phase === 'knockout' || state.phase === 'results';

/** Between rounds: input is refused, but the match continues. */
export const isIntermission = (state: EngineMatchState): boolean => state.phase === 'intermission';

function findFighter(state: EngineMatchState, playerId: PlayerId): EngineFighter | null {
  return state.fighters.find((f) => f.playerId === playerId) ?? null;
}

function opponentOf(state: EngineMatchState, fighter: EngineFighter): EngineFighter {
  // Exactly two fighters, so the other one always exists.
  return state.fighters[0] === fighter ? state.fighters[1] : state.fighters[0];
}

/**
 * Resolves one committed word.
 *
 * The single entry point for combat. Runs identically on the client (predicting
 * its own attacks) and the server (authoritative for both), which is what makes
 * client-side prediction safe — see plan §1.1 D1.
 */
export function applyWordAttempt(state: EngineMatchState, attempt: WordAttempt): MatchDelta {
  if (isTerminal(state)) return { ...EMPTY_DELTA, rejected: 'match-over' };

  const actor = findFighter(state, attempt.playerId);
  if (!actor) return { ...EMPTY_DELTA, rejected: 'unknown-player' };

  /*
   * Words must arrive in order.
   *
   * This is the anti-cheat floor, not a nicety: without it a client could
   * replay word 7 repeatedly and land unlimited hits. The server owns
   * `wordIndex`, so a duplicate or skipped index is refused outright.
   */
  if (attempt.wordIndex !== actor.wordIndex) {
    return { ...EMPTY_DELTA, rejected: 'wrong-word-index' };
  }

  /*
   * A word that arrives DURING an intermission is consumed, not refused.
   *
   * It deals no damage — the round is over and the loser is on the floor —
   * but the fighter's word index still advances, because the client already
   * advanced its own when it sent it. This is not a nicety: a client pauses
   * input the moment it learns a round ended, but words already in flight
   * cannot be recalled, and network latency guarantees there will be some.
   * Refusing them would leave the two indices permanently one apart, and every
   * word of the next round would be rejected as the wrong index. The player
   * would simply stop being able to play, with no error and no way back.
   */
  if (state.phase === 'intermission') {
    actor.wordIndex += 1;
    return { ...EMPTY_DELTA, rejected: 'intermission' };
  }

  if (state.phase !== 'combat') return { ...EMPTY_DELTA, rejected: 'match-over' };

  const target = opponentOf(state, actor);
  const events: CombatEvent[] = [];

  state.tickCount += 1;
  state.elapsedMs = Math.max(state.elapsedMs, attempt.atMs);
  actor.wordIndex += 1;

  if (attempt.dirty) {
    events.push(...resolveMiss(state, actor));
    return { events, terminal: false };
  }

  events.push(...resolveHit(state, actor, target, attempt));

  if (target.hp > 0) return { events, terminal: false };

  /*
   * Someone hit zero. In a best-of-1 that ends the match; otherwise it ends
   * the ROUND, and the match continues until one fighter takes the majority.
   */
  target.hp = 0;
  actor.roundsWon += 1;

  const decided = actor.roundsWon >= roundsToWin(state.roundCount);

  if (decided) {
    state.phase = 'knockout';
    state.winnerId = actor.playerId;

    events.push({
      type: 'knockout',
      t: state.tickCount,
      winner: actor.playerId,
      loser: target.playerId,
    });

    return { events, terminal: true };
  }

  state.phase = 'intermission';

  events.push({
    type: 'round-end',
    t: state.tickCount,
    winner: actor.playerId,
    loser: target.playerId,
    round: state.round,
    score: scoreOf(state),
  });

  return { events, terminal: false };
}

/**
 * A mistyped word.
 *
 * Costs combo and Ultimate charge but never HP (plan §5.3): self-damage would
 * make a struggling player's match end faster, which is exactly backwards —
 * the player having a bad time should get more game, not less.
 */
function resolveMiss(state: EngineMatchState, actor: EngineFighter): CombatEvent[] {
  const comboLost = actor.combo;

  actor.combo = 0;
  actor.wordsMissed += 1;
  actor.ultimateCharge = Math.max(0, actor.ultimateCharge - ULTIMATE_MISS_PENALTY);
  actor.ultimateReady = actor.ultimateCharge >= ULTIMATE_MAX_CHARGE;

  return [{ type: 'miss', t: state.tickCount, actor: actor.playerId, comboLost }];
}

function resolveHit(
  state: EngineMatchState,
  actor: EngineFighter,
  target: EngineFighter,
  attempt: WordAttempt,
): CombatEvent[] {
  const events: CombatEvent[] = [];
  const comboAtStrike = actor.combo;

  const deltaMs = actor.lastWordAtMs === null ? null : attempt.atMs - actor.lastWordAtMs;

  let damage: number;

  if (actor.ultimateReady && state.enableUltimate) {
    // Ultimates ignore crits: a cinematic finisher that sometimes did 1.8×
    // more would make the biggest moment in the game feel arbitrary.
    damage = Math.round(ultimateDamage(comboAtStrike) * state.rageMultiplier);

    actor.ultimateCharge = 0;
    actor.ultimateReady = false;
    actor.ultimatesUsed += 1;

    events.push({
      type: 'ultimate',
      t: state.tickCount,
      actor: actor.playerId,
      target: target.playerId,
      damage,
    });
  } else {
    const crit =
      state.enableCrits && rollCrit(state.seed, actor.slot, attempt.wordIndex, comboAtStrike);

    damage = computeDamage({
      wordLength: attempt.wordLength,
      combo: comboAtStrike,
      deltaMs,
      crit,
      rageMultiplier: state.rageMultiplier,
    });

    events.push({
      type: 'attack',
      t: state.tickCount,
      actor: actor.playerId,
      target: target.playerId,
      damage,
      kind: attackKind(attempt.wordLength, state.seed, actor.slot, attempt.wordIndex),
      combo: comboAtStrike,
      crit,
      weight: impactWeight(attempt.wordLength, crit),
    });
  }

  target.hp = Math.max(0, target.hp - damage);
  target.damageTaken += damage;
  actor.damageDealt += damage;

  // Combo advances AFTER the strike, so a word is scored at the combo the
  // player had when they committed it, not the one it earns them.
  actor.combo += 1;
  actor.maxCombo = Math.max(actor.maxCombo, actor.combo);
  actor.wordsTyped += 1;
  actor.charsTyped += attempt.wordLength;

  if (comboTier(actor.combo) !== comboTier(comboAtStrike)) {
    events.push({
      type: 'combo-tier',
      t: state.tickCount,
      actor: actor.playerId,
      tier: comboTier(actor.combo),
      combo: actor.combo,
    });
  }

  if (state.enableUltimate && !actor.ultimateReady) {
    actor.ultimateCharge = Math.min(
      ULTIMATE_MAX_CHARGE,
      actor.ultimateCharge + ultimateChargeGain(actor.combo),
    );

    if (actor.ultimateCharge >= ULTIMATE_MAX_CHARGE) {
      actor.ultimateReady = true;
      events.push({ type: 'ultimate-ready', t: state.tickCount, actor: actor.playerId });
    }
  }

  recordTiming(actor, attempt, deltaMs);
  return events;
}

function recordTiming(actor: EngineFighter, attempt: WordAttempt, deltaMs: number | null): void {
  if (actor.firstWordAtMs === null) actor.firstWordAtMs = attempt.atMs;
  actor.lastWordAtMs = attempt.atMs;

  // Instantaneous WPM from this one word. The standard definition is five
  // characters per "word", which is why this is not simply 60000/deltaMs.
  if (deltaMs !== null && deltaMs > 0) {
    const wpm = (attempt.wordLength / 5) * (60_000 / deltaMs);
    actor.peakWpm = Math.max(actor.peakWpm, Math.round(wpm));
  }
}

/**
 * Advances match time.
 *
 * Only responsibility today is engaging sudden death. Kept as a separate entry
 * point because the server drives it on a timer while the client calls it from
 * its render loop — both need the Rage transition without a word being typed.
 */
export function tick(state: EngineMatchState, elapsedMs: number): MatchDelta {
  if (state.phase !== 'combat') return EMPTY_DELTA;

  state.elapsedMs = Math.max(state.elapsedMs, elapsedMs);

  // Measured from the start of THIS round — see `roundStartedMs`.
  const next = rageMultiplier(state.elapsedMs - state.roundStartedMs);

  if (next === state.rageMultiplier) return EMPTY_DELTA;

  state.rageMultiplier = next;
  state.tickCount += 1;

  return {
    events: [{ type: 'rage', t: state.tickCount, multiplier: next }],
    terminal: false,
  };
}

/** Rounds won, indexed by fighter slot. */
export function scoreOf(state: EngineMatchState): [number, number] {
  return [state.fighters[0].roundsWon, state.fighters[1].roundsWon];
}

/**
 * Begins the next round after an intermission.
 *
 * What resets and what does NOT is the whole design of a multi-round match:
 *
 *   - **HP, combo and Ultimate charge reset.** Carrying meter would let whoever
 *     was mid-charge when the round ended open the next one with an instant
 *     Ultimate — an opening nuke nobody could answer, awarded for losing.
 *   - **Rage resets**, because it exists to stop a single round dragging.
 *   - **Word index does NOT reset.** The stream keeps advancing, so round two
 *     is fresh text rather than a replay of round one.
 *   - **Career stats do NOT reset.** Words, damage and accuracy accumulate
 *     across the whole match, because that is what the results screen reports.
 */
export function startNextRound(state: EngineMatchState, atMs: number): void {
  if (state.phase !== 'intermission') return;

  for (const fighter of state.fighters) {
    fighter.hp = state.maxHp;
    fighter.combo = 0;
    fighter.ultimateCharge = 0;
    fighter.ultimateReady = false;
  }

  state.round += 1;
  state.roundStartedMs = Math.max(state.elapsedMs, atMs);
  state.elapsedMs = state.roundStartedMs;
  state.rageMultiplier = 1;
  state.phase = 'combat';
}

/** Average WPM across the whole match, for the results screen. */
export function averageWpm(fighter: EngineFighter, matchEndMs: number): number {
  if (fighter.firstWordAtMs === null) return 0;

  const durationMs = matchEndMs - fighter.firstWordAtMs;
  if (durationMs <= 0) return 0;

  return Math.round((fighter.charsTyped / 5) * (60_000 / durationMs));
}

/** Accuracy in basis points (0–10000), matching the DB column. */
export function accuracyBp(fighter: EngineFighter): number {
  return accuracyBpFromCounts(fighter.wordsTyped, fighter.wordsMissed);
}
