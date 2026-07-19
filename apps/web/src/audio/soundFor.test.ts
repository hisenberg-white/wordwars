import { describe, expect, it } from 'vitest';
import type { CombatEvent, PlayerId } from '@wordwars/shared';
import { comboPitch, keystrokeSound, soundFor } from './soundFor';

const ME = 'me' as PlayerId;
const THEM = 'them' as PlayerId;

const attack = (
  overrides: Partial<Extract<CombatEvent, { type: 'attack' }>> = {},
): CombatEvent => ({
  type: 'attack',
  t: 1,
  actor: ME,
  target: THEM,
  damage: 60,
  kind: 'punch',
  combo: 0,
  crit: false,
  weight: 0.6,
  ...overrides,
});

describe('the combo pitch ladder', () => {
  /**
   * The oldest trick in arcade audio: each clean hit voiced slightly higher
   * than the last, so a streak audibly climbs. The player hears their momentum
   * before they have time to read the counter.
   */
  it('climbs with the combo', () => {
    expect(comboPitch(5)).toBeGreaterThan(comboPitch(0));
    expect(comboPitch(20)).toBeGreaterThan(comboPitch(5));
  });

  /** Uncapped, a 40-combo ends somewhere between shrill and inaudible. */
  it('is capped so a long streak stays triumphant rather than painful', () => {
    expect(comboPitch(1000)).toBeLessThanOrEqual(1.6);
  });

  it('starts at the base voicing', () => {
    expect(comboPitch(0)).toBe(1);
  });

  it('carries through to attack sounds', () => {
    const early = soundFor(attack({ combo: 0 }))!;
    const late = soundFor(attack({ combo: 25 }))!;

    expect(late.pitch).toBeGreaterThan(early.pitch);
  });
});

describe('attacks', () => {
  it('gets louder with weight', () => {
    expect(soundFor(attack({ weight: 1 }))!.gain).toBeGreaterThan(
      soundFor(attack({ weight: 0 }))!.gain,
    );
  });

  it('gives a crit its own voice, not a louder impact', () => {
    expect(soundFor(attack())!.kind).toBe('impact');
    expect(soundFor(attack({ crit: true }))!.kind).toBe('crit');
  });

  it('makes a crit louder than a normal hit', () => {
    expect(soundFor(attack({ crit: true }))!.gain).toBeGreaterThan(soundFor(attack())!.gain);
  });

  it('keeps gain within the mixer’s range', () => {
    for (const weight of [0, 0.5, 1]) {
      for (const crit of [false, true]) {
        const spec = soundFor(attack({ weight, crit }))!;
        expect(spec.gain).toBeGreaterThan(0);
        expect(spec.gain).toBeLessThanOrEqual(1.2);
      }
    }
  });
});

describe('ducking', () => {
  /** Plan §5.5 — "Silence sells impact." */
  it('ducks hardest for the biggest moments', () => {
    const normal = soundFor(attack())!.duckMs;
    const crit = soundFor(attack({ crit: true }))!.duckMs;
    const ultimate = soundFor({
      type: 'ultimate',
      t: 1,
      actor: ME,
      target: THEM,
      damage: 400,
    })!.duckMs;
    const ko = soundFor({ type: 'knockout', t: 1, winner: ME, loser: THEM })!.duckMs;

    expect(normal).toBe(0);
    expect(crit).toBeGreaterThan(0);
    expect(ultimate).toBeGreaterThan(crit);
    expect(ko).toBeGreaterThan(ultimate);
  });

  it('never ducks for routine hits, which would make the mix pump', () => {
    expect(soundFor(attack({ weight: 1 }))!.duckMs).toBe(0);
  });
});

describe('misses', () => {
  const miss: CombatEvent = { type: 'miss', t: 1, actor: ME, comboLost: 8 };

  /**
   * The player must distinguish a mistake from a weak hit with their eyes on
   * the next word rather than the fighters — so a miss gets its own voice,
   * never a quieter impact.
   */
  it('has a distinct voice rather than a quiet impact', () => {
    expect(soundFor(miss)!.kind).toBe('miss');
  });

  it('is quieter than any hit', () => {
    expect(soundFor(miss)!.gain).toBeLessThan(soundFor(attack({ weight: 0 }))!.gain);
  });
});

describe('combo tiers', () => {
  const tier = (t: 0 | 1 | 2 | 3 | 4): CombatEvent => ({
    type: 'combo-tier',
    t: 1,
    actor: ME,
    tier: t,
    combo: t * 10,
  });

  it('stays silent for the first two tiers, matching the FX layer', () => {
    expect(soundFor(tier(0))).toBeNull();
    expect(soundFor(tier(1))).toBeNull();
  });

  it('rises in pitch with each tier above that', () => {
    expect(soundFor(tier(4))!.pitch).toBeGreaterThan(soundFor(tier(2))!.pitch);
  });
});

describe('keystrokes', () => {
  /**
   * In a game where every word is an attack, the WORD is the loud event.
   * Prominent keystrokes would turn the mix into a keyboard recording and bury
   * the combat underneath it.
   */
  it('whispers compared to a hit', () => {
    expect(keystrokeSound(true).gain).toBeLessThan(soundFor(attack({ weight: 0 }))!.gain / 3);
  });

  it('makes a mistake more audible than a correct key', () => {
    expect(keystrokeSound(false).gain).toBeGreaterThan(keystrokeSound(true).gain);
  });

  it('uses a different voice for an error', () => {
    expect(keystrokeSound(false).kind).not.toBe(keystrokeSound(true).kind);
  });

  it('never ducks — that would pump the mix on every letter', () => {
    expect(keystrokeSound(true).duckMs).toBe(0);
    expect(keystrokeSound(false).duckMs).toBe(0);
  });
});

describe('silent events', () => {
  it.each<CombatEvent>([{ type: 'rage', t: 1, multiplier: 1.5 }])(
    '$type makes no sound of its own',
    (event) => {
      expect(soundFor(event)).toBeNull();
    },
  );
});
