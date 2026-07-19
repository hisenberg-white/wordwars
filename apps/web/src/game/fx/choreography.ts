import type { CombatEvent, FighterAnimation, PlayerId } from '@wordwars/shared';

/**
 * Who animates, how, and when.
 *
 * Extracted from the scene so the choreography can be tested without a
 * renderer. The rules here are behavioural claims worth pinning down — "the
 * target reacts slightly AFTER the strike, not simultaneously", "a knockout
 * animates both fighters" — and every one of them is invisible in a code
 * review but obvious in a test.
 */
export interface AnimationCue {
  readonly playerId: PlayerId;
  readonly animation: FighterAnimation;
  /**
   * Delay before playing.
   *
   * Non-zero for reactions on purpose: a target that flinches at the exact
   * instant the attacker starts moving reads as two unrelated animations
   * playing at once. A short offset is what makes it read as cause and effect.
   */
  readonly delayMs: number;
}

/** Roughly when a melee swing would connect. */
const MELEE_CONNECT_MS = 70;
/** The Ultimate's wind-up, so the reaction lands on the commit rather than the charge. */
const ULTIMATE_CONNECT_MS = 420;

/** Combo tier at which attacks upgrade to the heavier animation. */
const COMBO_ANIMATION_THRESHOLD = 10;

export function choreographyFor(event: CombatEvent): AnimationCue[] {
  switch (event.type) {
    case 'attack':
      return [
        {
          playerId: event.actor,
          animation: event.combo >= COMBO_ANIMATION_THRESHOLD ? 'combo' : 'attack',
          delayMs: 0,
        },
        { playerId: event.target, animation: 'hit', delayMs: MELEE_CONNECT_MS },
      ];

    case 'ultimate':
      return [
        { playerId: event.actor, animation: 'ultimate', delayMs: 0 },
        { playerId: event.target, animation: 'hit', delayMs: ULTIMATE_CONNECT_MS },
      ];

    case 'miss':
      // A whiff still animates. Silence on a mistake reads as dropped input
      // rather than a missed swing.
      return [{ playerId: event.actor, animation: 'walk', delayMs: 0 }];

    case 'knockout':
      return [
        { playerId: event.loser, animation: 'ko', delayMs: 0 },
        { playerId: event.winner, animation: 'victory', delayMs: 0 },
      ];

    default:
      // combo-tier, ultimate-ready and rage are FX-only: they change how the
      // fighter GLOWS, not what they are doing.
      return [];
  }
}
