import { describe, expect, it } from 'vitest';
import type { AttackKind, CombatEvent, PlayerId } from '@wordwars/shared';
import { effectLifetime, effectsFor, type EffectContext } from './effects';

const ME = 'me' as PlayerId;
const THEM = 'them' as PlayerId;

const CTX: EffectContext = { actorColor: 0xff2f57, arenaAccent: 0x00e0ff };

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

const totalScale = (event: CombatEvent) =>
  effectsFor(event, CTX).reduce((sum, e) => sum + e.scale * Math.max(1, e.count), 0);

describe('attacks', () => {
  it('always produces an impact at the target', () => {
    const effects = effectsFor(attack(), CTX);
    const impact = effects.find((e) => e.kind === 'impact');

    expect(impact).toBeDefined();
    expect(impact?.anchor).toBe('target');
  });

  /**
   * Weight, not damage, drives the visuals — the engine keeps them separate so
   * a long word always LANDS heavily even when its damage number is small
   * early in a match.
   */
  it('scales with weight rather than damage', () => {
    const light = effectsFor(attack({ weight: 0.5, damage: 200 }), CTX);
    const heavy = effectsFor(attack({ weight: 1, damage: 10 }), CTX);

    const impactOf = (fx: typeof light) => fx.find((e) => e.kind === 'impact')!;

    expect(impactOf(heavy).scale).toBeGreaterThan(impactOf(light).scale);
    expect(impactOf(heavy).count).toBeGreaterThan(impactOf(light).count);
  });

  it('makes a critical hit unmistakably bigger than a normal one', () => {
    expect(totalScale(attack({ crit: true }))).toBeGreaterThan(totalScale(attack()));
  });

  /** Not merely "a bigger orange one" — a crit gets a shape of its own. */
  it('gives a critical hit its own shockwave', () => {
    const normal = effectsFor(attack(), CTX);
    const crit = effectsFor(attack({ crit: true }), CTX);

    expect(normal.some((e) => e.kind === 'shockwave')).toBe(false);
    expect(crit.some((e) => e.kind === 'shockwave')).toBe(true);
  });

  it('colours a critical hit differently from the fighter', () => {
    const crit = effectsFor(attack({ crit: true }), CTX).find((e) => e.kind === 'impact')!;
    expect(crit.color).not.toBe(CTX.actorColor);
  });

  it('colours a normal hit as the attacking fighter, so hits read as theirs', () => {
    const impact = effectsFor(attack(), CTX).find((e) => e.kind === 'impact')!;
    expect(impact.color).toBe(CTX.actorColor);
  });

  describe('ranged versus melee', () => {
    it.each<AttackKind>(['fireball', 'arrow', 'laser', 'magic'])(
      '%s travels before it lands',
      (kind) => {
        const effects = effectsFor(attack({ kind }), CTX);
        const projectile = effects.find((e) => e.kind === 'projectile');
        const impact = effects.find((e) => e.kind === 'impact')!;

        expect(projectile).toBeDefined();
        // The impact waits for the shot to arrive, rather than firing with it.
        expect(impact.delayMs).toBeGreaterThan(0);
        expect(impact.delayMs).toBeGreaterThanOrEqual(projectile!.durationMs);
      },
    );

    it.each<AttackKind>(['punch', 'kick'])('%s lands immediately', (kind) => {
      const effects = effectsFor(attack({ kind }), CTX);

      expect(effects.some((e) => e.kind === 'projectile')).toBe(false);
      expect(effects.find((e) => e.kind === 'impact')!.delayMs).toBe(0);
    });

    it('draws an arc for a slash', () => {
      expect(effectsFor(attack({ kind: 'slash' }), CTX).some((e) => e.kind === 'slash')).toBe(true);
    });
  });
});

describe('ultimate', () => {
  const ultimate: CombatEvent = {
    type: 'ultimate',
    t: 1,
    actor: ME,
    target: THEM,
    damage: 400,
  };

  it('dwarfs even a critical hit', () => {
    expect(totalScale(ultimate)).toBeGreaterThan(totalScale(attack({ crit: true, weight: 1 })));
  });

  /** Charge, beam, impact — three stages, so it reads as an event not a punch. */
  it('is staged rather than instantaneous', () => {
    const effects = effectsFor(ultimate, CTX);
    const delays = effects.map((e) => e.delayMs);

    expect(new Set(delays).size).toBeGreaterThan(1);
    expect(effects.some((e) => e.kind === 'beam')).toBe(true);
    expect(effects.some((e) => e.kind === 'aura' && e.anchor === 'actor')).toBe(true);
  });

  it('starts at the caster before reaching the target', () => {
    const effects = effectsFor(ultimate, CTX);
    const aura = effects.find((e) => e.kind === 'aura')!;
    const impact = effects.find((e) => e.kind === 'impact')!;

    expect(aura.anchor).toBe('actor');
    expect(aura.delayMs).toBeLessThan(impact.delayMs);
  });

  it('lasts long enough to be a moment', () => {
    expect(effectLifetime(effectsFor(ultimate, CTX))).toBeGreaterThan(800);
  });
});

describe('misses', () => {
  const miss: CombatEvent = { type: 'miss', t: 1, actor: ME, comboLost: 12 };

  /** A miss must be legible without competing with a hit for attention. */
  it('is far smaller than any hit', () => {
    expect(totalScale(miss)).toBeLessThan(totalScale(attack({ weight: 0.1 })));
  });

  it('appears at the player who erred, not the opponent', () => {
    expect(effectsFor(miss, CTX).every((e) => e.anchor === 'actor')).toBe(true);
  });

  it('is drab rather than coloured, so it never looks like a hit', () => {
    expect(effectsFor(miss, CTX).every((e) => e.color !== CTX.actorColor)).toBe(true);
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

  /** Flourishing on every early combo would make the later ones mean nothing. */
  it('stays silent for the first two tiers', () => {
    expect(effectsFor(tier(0), CTX)).toHaveLength(0);
    expect(effectsFor(tier(1), CTX)).toHaveLength(0);
  });

  it('grows with each tier above that', () => {
    const two = effectsFor(tier(2), CTX)[0]!;
    const four = effectsFor(tier(4), CTX)[0]!;

    expect(four.scale).toBeGreaterThan(two.scale);
  });
});

describe('knockout', () => {
  const ko: CombatEvent = { type: 'knockout', t: 1, winner: ME, loser: THEM };

  it('is the biggest thing on screen', () => {
    expect(totalScale(ko)).toBeGreaterThan(totalScale(attack({ crit: true, weight: 1 })));
  });

  it('happens at the fallen fighter', () => {
    expect(effectsFor(ko, CTX).every((e) => e.anchor === 'target')).toBe(true);
  });
});

describe('effectLifetime', () => {
  it('accounts for delay as well as duration', () => {
    expect(
      effectLifetime([
        {
          kind: 'impact',
          anchor: 'target',
          color: 0,
          scale: 1,
          durationMs: 100,
          count: 1,
          delayMs: 0,
        },
        {
          kind: 'impact',
          anchor: 'target',
          color: 0,
          scale: 1,
          durationMs: 100,
          count: 1,
          delayMs: 400,
        },
      ]),
    ).toBe(500);
  });

  it('is zero for nothing', () => {
    expect(effectLifetime([])).toBe(0);
  });
});

describe('quality scaling', () => {
  const attack = (): CombatEvent => ({
    type: 'attack',
    t: 1,
    actor: 'a' as PlayerId,
    target: 'b' as PlayerId,
    damage: 120,
    kind: 'punch',
    combo: 5,
    crit: false,
    weight: 1,
  });

  const base = { actorColor: 0xffffff, arenaAccent: 0x000000 };

  it('spawns fewer particles at lower quality', () => {
    const full = effectsFor(attack(), base);
    const light = effectsFor(attack(), { ...base, particleScale: 0.35 });

    const total = (specs: ReturnType<typeof effectsFor>) =>
      specs.reduce((sum, s) => sum + s.count, 0);

    expect(total(light)).toBeLessThan(total(full));
  });

  /** An effect that spawns nothing reads as the hit not registering at all. */
  it('never scales an effect down to zero particles', () => {
    for (const spec of effectsFor(attack(), { ...base, particleScale: 0.01 })) {
      expect(spec.count).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * Quality changes how MANY particles appear, never how hard the hit reads.
   * If `low` altered which hits felt big, quality would be a gameplay setting
   * wearing a performance setting's clothes.
   */
  it('leaves the weight of a hit alone', () => {
    const full = effectsFor(attack(), base);
    const light = effectsFor(attack(), { ...base, particleScale: 0.35 });

    expect(light.map((s) => s.kind)).toEqual(full.map((s) => s.kind));
    expect(light.map((s) => s.scale)).toEqual(full.map((s) => s.scale));
    expect(light.map((s) => s.durationMs)).toEqual(full.map((s) => s.durationMs));
  });

  it('is a no-op at full quality', () => {
    expect(effectsFor(attack(), { ...base, particleScale: 1 })).toEqual(effectsFor(attack(), base));
  });
});
