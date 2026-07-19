import type { CombatEvent, MatchSnapshot, PlayerId } from '@wordwars/shared';

/**
 * What the HUD shows, as plain data.
 *
 * Pure and separate from any component, for the same reason the FX layer is
 * split: the interesting behaviour here is *reconciliation* — predicted damage
 * applied instantly, then corrected by the server — and that is worth testing
 * rather than eyeballing. A HUD that drifts from the server is a player who
 * thinks they won.
 */
export interface FighterHud {
  readonly playerId: PlayerId;
  readonly hp: number;
  readonly maxHp: number;
  readonly combo: number;
  readonly ultimateCharge: number;
  readonly ultimateReady: boolean;
}

export interface HudState {
  readonly fighters: readonly [FighterHud, FighterHud];
  readonly rageMultiplier: number;
  /** Current round, 1-based. Always 1 in a best-of-1. */
  readonly round: number;
  /** Rounds won, indexed by fighter slot. */
  readonly score: readonly [number, number];
  /**
   * True between rounds.
   *
   * The HUD needs this as well as the score: during an intermission the fight
   * is frozen and the typing band must stop accepting input, or a player keeps
   * attacking a fighter who is already down.
   */
  readonly intermission: boolean;
}

export function createHudState(players: readonly [PlayerId, PlayerId], maxHp: number): HudState {
  return {
    fighters: [blank(players[0], maxHp), blank(players[1], maxHp)],
    rageMultiplier: 1,
    round: 1,
    score: [0, 0],
    intermission: false,
  };
}

function blank(playerId: PlayerId, maxHp: number): FighterHud {
  return { playerId, hp: maxHp, combo: 0, ultimateCharge: 0, ultimateReady: false, maxHp };
}

/**
 * Applies a combat event optimistically.
 *
 * Used for BOTH predicted and confirmed events. The HUD deliberately cannot
 * tell them apart — a predicted hit must move the bar on the same frame as the
 * keystroke, and the 10Hz snapshot corrects any drift a moment later
 * (plan §1.1 D1).
 */
export function applyEvent(state: HudState, event: CombatEvent): HudState {
  switch (event.type) {
    case 'attack':
    case 'ultimate': {
      const damage = event.damage;

      return map(state, (fighter) => {
        if (fighter.playerId === event.target) {
          return { ...fighter, hp: Math.max(0, fighter.hp - damage) };
        }

        if (fighter.playerId === event.actor) {
          return event.type === 'ultimate'
            ? { ...fighter, ultimateCharge: 0, ultimateReady: false, combo: fighter.combo + 1 }
            : { ...fighter, combo: event.combo + 1 };
        }

        return fighter;
      });
    }

    case 'miss':
      return map(state, (fighter) =>
        fighter.playerId === event.actor ? { ...fighter, combo: 0 } : fighter,
      );

    case 'ultimate-ready':
      return map(state, (fighter) =>
        fighter.playerId === event.actor
          ? { ...fighter, ultimateCharge: 100, ultimateReady: true }
          : fighter,
      );

    case 'knockout':
      return map(state, (fighter) =>
        fighter.playerId === event.loser ? { ...fighter, hp: 0 } : fighter,
      );

    /*
     * A round ended but the match did not.
     *
     * The score comes from the event rather than being counted here: the
     * server already decided it, and a client that tallies its own rounds is
     * one dropped packet away from disagreeing about who is winning.
     */
    case 'round-end': {
      const dropped = map(state, (fighter) =>
        fighter.playerId === event.loser ? { ...fighter, hp: 0 } : fighter,
      );

      return { ...dropped, round: event.round, score: event.score, intermission: true };
    }

    case 'rage':
      return { ...state, rageMultiplier: event.multiplier };

    default:
      return state;
  }
}

/**
 * Corrects toward the server's authoritative snapshot.
 *
 * The server wins on everything it reports. Prediction exists to remove
 * latency from the *feel*, never to argue with the result.
 */
export function reconcile(state: HudState, snapshot: MatchSnapshot): HudState {
  return {
    ...state,
    rageMultiplier: snapshot.rageMultiplier,
    round: snapshot.round,
    score: snapshot.score,
    // The server decides when the next round starts, so the intermission ends
    // when IT says so — not on a client timer that could drift out of step.
    intermission: snapshot.phase === 'intermission',
    fighters: state.fighters.map((fighter) => {
      const authoritative = snapshot.fighters.find((f) => f.playerId === fighter.playerId);
      if (!authoritative) return fighter;

      return {
        ...fighter,
        hp: authoritative.hp,
        maxHp: authoritative.maxHp,
        combo: authoritative.combo,
        ultimateCharge: authoritative.ultimateCharge,
        ultimateReady: authoritative.ultimateReady,
      };
    }) as unknown as readonly [FighterHud, FighterHud],
  };
}

function map(state: HudState, fn: (fighter: FighterHud) => FighterHud): HudState {
  return {
    ...state,
    fighters: [fn(state.fighters[0]), fn(state.fighters[1])],
  };
}

export const hpFraction = (fighter: FighterHud): number =>
  fighter.maxHp === 0 ? 0 : Math.max(0, Math.min(1, fighter.hp / fighter.maxHp));

/**
 * When the HP bar should read as "in danger".
 *
 * A quarter of a bar is roughly two clean hits at a decent combo — late enough
 * to mean something, early enough that the player can still do something
 * about it.
 */
export const isCritical = (fighter: FighterHud): boolean => hpFraction(fighter) <= 0.25;
