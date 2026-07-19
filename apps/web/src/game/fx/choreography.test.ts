import { describe, expect, it } from 'vitest';
import type { CombatEvent, PlayerId } from '@wordwars/shared';
import { choreographyFor } from './choreography';

const ME = 'me' as PlayerId;
const THEM = 'them' as PlayerId;

function attack(overrides: Partial<Extract<CombatEvent, { type: 'attack' }>> = {}): CombatEvent {
  return {
    type: 'attack',
    t: 1,
    actor: ME,
    target: THEM,
    damage: 40,
    kind: 'punch',
    combo: 0,
    crit: false,
    weight: 0.6,
    ...overrides,
  };
}

describe('attacks', () => {
  it('swings the attacker and staggers the target', () => {
    const cues = choreographyFor(attack());

    expect(cues.find((c) => c.playerId === ME)?.animation).toBe('attack');
    expect(cues.find((c) => c.playerId === THEM)?.animation).toBe('hit');
  });

  /**
   * A target that flinches at the exact instant the attacker starts moving
   * reads as two unrelated animations playing at once. The offset is what
   * makes it read as cause and effect.
   */
  it('delays the reaction so it reads as cause and effect', () => {
    const cues = choreographyFor(attack());

    const swing = cues.find((c) => c.playerId === ME)!;
    const flinch = cues.find((c) => c.playerId === THEM)!;

    expect(swing.delayMs).toBe(0);
    expect(flinch.delayMs).toBeGreaterThan(0);
  });

  it('upgrades to the heavier animation at high combo', () => {
    expect(choreographyFor(attack({ combo: 9 }))[0]!.animation).toBe('attack');
    expect(choreographyFor(attack({ combo: 10 }))[0]!.animation).toBe('combo');
    expect(choreographyFor(attack({ combo: 40 }))[0]!.animation).toBe('combo');
  });
});

describe('ultimate', () => {
  const ultimate: CombatEvent = { type: 'ultimate', t: 1, actor: ME, target: THEM, damage: 400 };

  it('plays the ultimate and lands much later than a normal hit', () => {
    const cues = choreographyFor(ultimate);
    const normalFlinch = choreographyFor(attack()).find((c) => c.playerId === THEM)!;

    expect(cues.find((c) => c.playerId === ME)?.animation).toBe('ultimate');

    // The reaction must wait out the wind-up, or the target flinches at a
    // fighter who has not swung yet.
    const flinch = cues.find((c) => c.playerId === THEM)!;
    expect(flinch.delayMs).toBeGreaterThan(normalFlinch.delayMs * 3);
  });
});

describe('misses', () => {
  const miss: CombatEvent = { type: 'miss', t: 1, actor: ME, comboLost: 5 };

  /** Silence on a mistake reads as dropped input rather than a missed swing. */
  it('still animates the player who erred', () => {
    const cues = choreographyFor(miss);

    expect(cues).toHaveLength(1);
    expect(cues[0]!.playerId).toBe(ME);
  });

  it('never animates the opponent', () => {
    expect(choreographyFor(miss).some((c) => c.playerId === THEM)).toBe(false);
  });
});

describe('knockout', () => {
  const ko: CombatEvent = { type: 'knockout', t: 1, winner: ME, loser: THEM };

  it('drops the loser and celebrates the winner', () => {
    const cues = choreographyFor(ko);

    expect(cues.find((c) => c.playerId === THEM)?.animation).toBe('ko');
    expect(cues.find((c) => c.playerId === ME)?.animation).toBe('victory');
  });

  it('plays both immediately', () => {
    expect(choreographyFor(ko).every((c) => c.delayMs === 0)).toBe(true);
  });
});

/**
 * These change how a fighter GLOWS, not what they are doing. Interrupting an
 * attack mid-swing to play an idle pose because a combo tier ticked over would
 * make the fight stutter.
 */
describe('FX-only events', () => {
  it.each<CombatEvent>([
    { type: 'combo-tier', t: 1, actor: ME, tier: 3, combo: 20 },
    { type: 'ultimate-ready', t: 1, actor: ME },
    { type: 'rage', t: 1, multiplier: 1.5 },
  ])('$type does not interrupt the fighter', (event) => {
    expect(choreographyFor(event)).toHaveLength(0);
  });
});
