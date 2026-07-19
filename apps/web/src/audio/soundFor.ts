import type { CombatEvent } from '@wordwars/shared';

/**
 * What a combat event should sound like.
 *
 * Pure, for the same reason the FX and feel layers are: the interesting
 * decisions here are musical, not technical. "A combo climbs in pitch", "an
 * Ultimate silences everything else", "a miss is a dull thud rather than a
 * hit" — those are claims worth failing a build over, and none of them are
 * checkable by reading `AudioContext` code.
 */
export type SoundKind =
  | 'impact'
  | 'crit'
  | 'ultimate'
  | 'ko'
  | 'miss'
  | 'combo-up'
  | 'ultimate-ready'
  | 'keystroke'
  | 'keystroke-error';

export interface SoundSpec {
  readonly kind: SoundKind;
  /** 0–1, before the SFX bus volume is applied. */
  readonly gain: number;
  /** Playback rate multiplier. 1 is the base voicing. */
  readonly pitch: number;
  /**
   * Milliseconds to duck everything else beneath this sound.
   *
   * Plan §5.5: "Audio ducks during ultimates. Silence sells impact." Pulling
   * the floor out from under a big hit makes it land harder than raising its
   * own volume ever could.
   */
  readonly duckMs: number;
}

/**
 * The combo pitch ladder.
 *
 * Each clean hit in a streak is voiced slightly higher than the last, so a
 * long combo audibly climbs. It is the oldest trick in arcade audio and it
 * works: the player hears their momentum building before they have time to
 * read the counter.
 *
 * Capped, because an uncapped ladder ends somewhere between shrill and
 * inaudible, and a 40-combo should feel triumphant rather than painful.
 */
const PITCH_STEP = 0.035;
const PITCH_CAP = 1.6;

export function comboPitch(combo: number): number {
  return Math.min(PITCH_CAP, 1 + combo * PITCH_STEP);
}

export function soundFor(event: CombatEvent): SoundSpec | null {
  switch (event.type) {
    case 'attack':
      return {
        kind: event.crit ? 'crit' : 'impact',
        // Weight, not damage — consistent with the FX and feel layers, so a
        // long word sounds heavy even when its damage number is small.
        gain: (event.crit ? 0.85 : 0.5) + event.weight * 0.25,
        pitch: comboPitch(event.combo),
        duckMs: event.crit ? 90 : 0,
      };

    case 'ultimate':
      return { kind: 'ultimate', gain: 1, pitch: 1, duckMs: 700 };

    case 'knockout':
      return { kind: 'ko', gain: 1, pitch: 1, duckMs: 900 };

    /*
     * A miss is a dull, low thud — never a hit sound at lower volume.
     *
     * The player must be able to tell a mistake from a weak hit with their
     * eyes closed, because in a fast exchange they are reading the next word
     * rather than watching the fighters.
     */
    case 'miss':
      return { kind: 'miss', gain: 0.4, pitch: 1, duckMs: 0 };

    case 'combo-tier':
      // Only from tier 2, matching the FX layer: a flourish on every early
      // combo makes the later ones mean nothing.
      return event.tier >= 2
        ? { kind: 'combo-up', gain: 0.5, pitch: 1 + event.tier * 0.12, duckMs: 0 }
        : null;

    case 'ultimate-ready':
      return { kind: 'ultimate-ready', gain: 0.7, pitch: 1, duckMs: 0 };

    default:
      return null;
  }
}

/**
 * The sound of a single keystroke.
 *
 * Deliberately quiet. In a game where every word is an attack, the WORD is the
 * loud event; keystrokes only whisper underneath it. Making them prominent
 * would turn the mix into a mechanical keyboard recording and bury the combat.
 */
export function keystrokeSound(correct: boolean): SoundSpec {
  return correct
    ? { kind: 'keystroke', gain: 0.1, pitch: 1, duckMs: 0 }
    : { kind: 'keystroke-error', gain: 0.22, pitch: 1, duckMs: 0 };
}
