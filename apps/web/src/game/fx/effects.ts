import type { AttackKind, CombatEvent } from '@wordwars/shared';

/**
 * What an effect looks like, described without any renderer.
 *
 * The FX layer is split deliberately: **this file decides what a hit should
 * look like, and `FxLayer` only draws it.** That split is what makes the
 * interesting half testable — "a crit is bigger than a normal hit", "a ranged
 * attack travels before it lands", "an Ultimate is unmistakable" are design
 * claims that should fail a test if broken, not things discovered by eye three
 * phases later.
 */
export type EffectKind =
  | 'impact' // burst at the point of contact
  | 'projectile' // travels from actor to target
  | 'slash' // an arc drawn across the target
  | 'shockwave' // expanding ring
  | 'aura' // sustained glow on a fighter
  | 'beam' // sustained line, actor to target
  | 'debris'; // scattered fragments

export type Anchor = 'actor' | 'target' | 'midpoint';

export interface EffectSpec {
  readonly kind: EffectKind;
  readonly anchor: Anchor;
  readonly color: number;
  /** 1 is the baseline hit. Bigger means a bigger moment. */
  readonly scale: number;
  readonly durationMs: number;
  /** Particles, where the effect spawns several. */
  readonly count: number;
  /** Delay before spawning, used to sequence a travel-then-land sequence. */
  readonly delayMs: number;
}

export interface EffectContext {
  /** Colour of the acting fighter, so effects read as belonging to them. */
  readonly actorColor: number;
  readonly arenaAccent: number;
  /**
   * Particle multiplier from the quality setting. 1 is full.
   *
   * Scales how MANY particles spawn, never how hard a hit reads: a low-end
   * machine should render a lighter version of the same fight, not a different
   * one. Every effect funnels through `spec()`, so this is applied in exactly
   * one place and cannot drift between effect kinds.
   */
  readonly particleScale?: number;
}

const CRIT_COLOR = 0xff8a1f;
const ULTIMATE_COLOR = 0xffc53d;
const MISS_COLOR = 0x6e6e8f;

/** Ranged attacks travel; melee lands immediately. */
const RANGED: ReadonlySet<AttackKind> = new Set(['fireball', 'arrow', 'laser', 'magic']);

const TRAVEL_MS = 160;

/**
 * Translates one combat event into the effects it should produce.
 *
 * Pure. Given the same event it always returns the same description, which is
 * what lets the renderer stay a dumb consumer.
 */
export function effectsFor(event: CombatEvent, ctx: EffectContext): EffectSpec[] {
  const effects = describeEffects(event, ctx);
  const scale = ctx.particleScale ?? 1;
  if (scale === 1) return effects;

  /*
   * Quality scales particle COUNT and nothing else.
   *
   * Applied here rather than at each of the fifteen `spec()` call sites, so a
   * new effect cannot be added that quietly ignores the setting. Never below
   * one: an effect that spawns zero particles reads as the hit not registering
   * at all, which is a worse experience than a heavy one.
   */
  return effects.map((effect) => ({
    ...effect,
    count: Math.max(1, Math.round(effect.count * scale)),
  }));
}

function describeEffects(event: CombatEvent, ctx: EffectContext): EffectSpec[] {
  switch (event.type) {
    case 'attack':
      return attackEffects(event, ctx);

    case 'ultimate':
      return [
        // Charge at the caster, beam across, then a shockwave that dwarfs a
        // normal hit. Three stages so it reads as an event, not a big punch.
        spec('aura', 'actor', ULTIMATE_COLOR, 2.4, 420, 1, 0),
        spec('beam', 'midpoint', ULTIMATE_COLOR, 2.2, 260, 1, 380),
        spec('shockwave', 'target', ULTIMATE_COLOR, 3.4, 520, 1, 420),
        spec('impact', 'target', ULTIMATE_COLOR, 3, 460, 26, 430),
        spec('debris', 'target', ULTIMATE_COLOR, 2.2, 700, 14, 440),
      ];

    case 'miss':
      // Deliberately small and grey. A miss must be legible without competing
      // with a hit for attention.
      return [spec('debris', 'actor', MISS_COLOR, 0.6, 320, 5, 0)];

    case 'combo-tier':
      // Only from the second tier up: flourishing on every early combo would
      // make the later ones mean nothing.
      return event.tier >= 2
        ? [spec('aura', 'actor', ctx.actorColor, 1 + event.tier * 0.35, 520, 1, 0)]
        : [];

    case 'ultimate-ready':
      return [spec('aura', 'actor', ULTIMATE_COLOR, 1.8, 900, 1, 0)];

    case 'knockout':
      return [
        spec('shockwave', 'target', 0xffffff, 4, 640, 1, 0),
        spec('impact', 'target', 0xffffff, 3.2, 560, 30, 0),
        spec('debris', 'target', 0xffffff, 2.6, 900, 18, 60),
      ];

    case 'rage':
      return [spec('aura', 'actor', 0xff2f57, 2, 800, 1, 0)];

    default:
      return [];
  }
}

function attackEffects(
  event: Extract<CombatEvent, { type: 'attack' }>,
  ctx: EffectContext,
): EffectSpec[] {
  const color = event.crit ? CRIT_COLOR : ctx.actorColor;

  /*
   * Weight, not damage, drives the visuals.
   *
   * The engine keeps them separate on purpose (§3.1): a chip hit and a heavy
   * hit can do similar numbers at different combo tiers but must not FEEL the
   * same. Sizing FX by weight means a long word always lands heavily, even
   * early in a match when its damage number is small.
   */
  const base = 0.7 + event.weight * 0.8;
  const scale = event.crit ? base * 1.5 : base;

  const effects: EffectSpec[] = [];
  const ranged = RANGED.has(event.kind);

  if (ranged) {
    effects.push(spec('projectile', 'midpoint', color, scale, TRAVEL_MS, 1, 0));
  } else if (event.kind === 'slash') {
    effects.push(spec('slash', 'target', color, scale * 1.2, 180, 1, 0));
  }

  const landsAt = ranged ? TRAVEL_MS : 0;

  effects.push(
    spec('impact', 'target', color, scale, 300, Math.round(6 + event.weight * 10), landsAt),
  );

  if (event.crit) {
    // A crit gets its own ring, so it is distinguishable at a glance rather
    // than merely "a slightly larger orange one".
    effects.push(spec('shockwave', 'target', CRIT_COLOR, scale * 1.6, 380, 1, landsAt));
  }

  return effects;
}

function spec(
  kind: EffectKind,
  anchor: Anchor,
  color: number,
  scale: number,
  durationMs: number,
  count: number,
  delayMs: number,
): EffectSpec {
  return { kind, anchor, color, scale, durationMs, count, delayMs };
}

/** Longest time any effect from this batch stays on screen. */
export function effectLifetime(effects: readonly EffectSpec[]): number {
  return effects.reduce((max, e) => Math.max(max, e.delayMs + e.durationMs), 0);
}
