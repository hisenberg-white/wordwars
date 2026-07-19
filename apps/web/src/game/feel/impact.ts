import type { CombatEvent } from '@wordwars/shared';

/**
 * Game feel.
 *
 * Plan §5.5 calls hit-stop "most of the difference between a web animation and
 * a game", and that is not hyperbole: a brief freeze on impact is what makes a
 * hit feel like contact rather than two sprites overlapping. This module
 * decides how much of it each event earns.
 *
 * Pure, so the escalation can be tested — a crit must out-punch a normal hit,
 * an Ultimate must out-punch a crit, and a knockout must out-punch everything.
 * Those are the claims that make impacts read as a hierarchy instead of noise.
 */
export interface ImpactFeel {
  /** Milliseconds to freeze the scene. Zero means no freeze. */
  readonly hitStopMs: number;
  readonly shake: { readonly intensity: number; readonly durationMs: number } | null;
  readonly damageNumber: {
    readonly value: number;
    readonly scale: number;
    readonly crit: boolean;
    readonly ultimate: boolean;
  } | null;
}

export interface FeelOptions {
  /** Honours `prefers-reduced-motion`, and later the in-game toggle (5.5). */
  readonly reducedMotion: boolean;
  readonly maxHp: number;
}

const NONE: ImpactFeel = { hitStopMs: 0, shake: null, damageNumber: null };

/** Freeze durations, in ascending order of how big the moment is. */
const STOP_LIGHT = 55;
const STOP_HEAVY = 90;
const STOP_CRIT = 140;
const STOP_ULTIMATE = 190;
const STOP_KO = 320;

/**
 * Shake is capped hard.
 *
 * An uncapped shake proportional to damage means a late-match Ultimate makes
 * the text unreadable — and the player still has to type through it. Feel must
 * never cost legibility in a game where reading is the input.
 */
const SHAKE_MAX = 0.012;

export function feelFor(event: CombatEvent, options: FeelOptions): ImpactFeel {
  switch (event.type) {
    case 'attack': {
      // Weight, not damage — a long word lands heavily even when its damage
      // number is small early on (same rule as the FX layer).
      const hitStopMs = Math.round(
        event.crit ? STOP_CRIT : STOP_LIGHT + (STOP_HEAVY - STOP_LIGHT) * event.weight,
      );

      return {
        hitStopMs,
        shake: shakeFor(event.damage, options, event.crit ? 1.6 : 1),
        damageNumber: {
          value: event.damage,
          scale: event.crit ? 1.7 : 0.9 + event.weight * 0.5,
          crit: event.crit,
          ultimate: false,
        },
      };
    }

    case 'ultimate':
      return {
        hitStopMs: STOP_ULTIMATE,
        shake: shakeFor(event.damage, options, 2.2),
        damageNumber: { value: event.damage, scale: 2.4, crit: false, ultimate: true },
      };

    case 'knockout':
      return {
        hitStopMs: STOP_KO,
        shake: shakeFor(options.maxHp, options, 2.5),
        damageNumber: null,
      };

    /*
     * A miss gets NO hit-stop.
     *
     * Freezing on a mistake would punish the player twice — once by breaking
     * their combo, again by interrupting the flow they are trying to rebuild.
     * The cost of a miss is the combo, and only the combo (plan §5.3).
     */
    case 'miss':
      return NONE;

    default:
      return NONE;
  }
}

/**
 * Damage that earns a full-strength shake.
 *
 * Calibrated against real hits rather than the health bar: an early attack is
 * ~30 damage and a late one ~150, so referencing a large fraction of max HP
 * meant every hit for the first third of a match produced NO shake and the
 * game felt flat exactly when a new player is deciding whether they like it.
 * 4% of a bar puts a chip hit at a perceptible tremor and a heavy hit near the
 * cap.
 */
const SHAKE_REFERENCE_FRACTION = 0.04;

function shakeFor(damage: number, options: FeelOptions, multiplier: number): ImpactFeel['shake'] {
  if (options.reducedMotion) return null;

  const fraction = Math.min(1, damage / (options.maxHp * SHAKE_REFERENCE_FRACTION));
  const intensity = Math.min(SHAKE_MAX, fraction * multiplier * 0.006);

  // Below this the shake is imperceptible but still costs a camera update.
  if (intensity < 0.0005) return null;

  return { intensity, durationMs: Math.round(90 + fraction * 140) };
}

/**
 * Combines the feel of several events landing in one batch.
 *
 * Takes the MAXIMUM rather than the sum. Two hits arriving in the same 33ms
 * flush must not freeze the game for the total of both — accumulating hit-stop
 * during a fast exchange is how a game turns into a slideshow exactly when it
 * should feel fastest.
 */
export function combineFeel(feels: readonly ImpactFeel[]): ImpactFeel {
  let hitStopMs = 0;
  let shake: ImpactFeel['shake'] = null;

  for (const feel of feels) {
    hitStopMs = Math.max(hitStopMs, feel.hitStopMs);

    if (feel.shake && (!shake || feel.shake.intensity > shake.intensity)) {
      shake = feel.shake;
    }
  }

  return { hitStopMs, shake, damageNumber: null };
}
