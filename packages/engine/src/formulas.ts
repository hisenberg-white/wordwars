import type { AttackKind, ComboTier } from '@wordwars/shared';
import {
  BASE_DAMAGE_LENGTH_CAP,
  BASE_DAMAGE_LENGTH_FLOOR,
  BASE_DAMAGE_MIN,
  BASE_DAMAGE_PER_CHAR,
  COMBO_TIERS,
  CRIT_CHANCE_BASE,
  CRIT_CHANCE_MAX,
  CRIT_CHANCE_PER_COMBO,
  CRIT_MULTIPLIER,
  RAGE_FIRST_AT_MS,
  RAGE_FIRST_MULTIPLIER,
  RAGE_HP_FRACTION,
  RAGE_SECOND_AT_MS,
  RAGE_SECOND_MULTIPLIER,
  TEMPO_DIVISOR,
  TEMPO_INTERCEPT,
  TEMPO_MAX,
  TEMPO_MIN,
  ULTIMATE_CHARGE_BASE,
  ULTIMATE_CHARGE_PER_COMBO,
  ULTIMATE_DAMAGE_BASE,
  ULTIMATE_DAMAGE_PER_COMBO,
  WEIGHT_MAX,
  WEIGHT_MIN,
} from './constants.js';
import { pickDeterministic, rollUnit } from './rng.js';

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Longer words hit harder, up to a cap. 18 at 3 chars, 54 at 12+. */
export function baseDamage(wordLength: number): number {
  const effective = clamp(wordLength - BASE_DAMAGE_LENGTH_FLOOR, 0, BASE_DAMAGE_LENGTH_CAP);
  return BASE_DAMAGE_MIN + BASE_DAMAGE_PER_CHAR * effective;
}

/** Which tier a combo sits in. Exposed so the HUD can flourish on a change. */
export function comboTier(combo: number): ComboTier {
  let tier = 0;
  for (let i = 0; i < COMBO_TIERS.length; i += 1) {
    if (combo >= COMBO_TIERS[i]!.at) tier = i;
  }
  return tier as ComboTier;
}

export function comboMultiplier(combo: number): number {
  return COMBO_TIERS[comboTier(combo)]!.multiplier;
}

/**
 * Faster typing hits harder.
 *
 * `deltaMs` is the gap since this player's previous *successful* word. See the
 * TEMPO_DIVISOR note in constants.ts for why the plan's original divisor made
 * this mechanic inert for every human being.
 */
export function tempoBonus(deltaMs: number): number {
  return clamp(TEMPO_INTERCEPT - deltaMs / TEMPO_DIVISOR, TEMPO_MIN, TEMPO_MAX);
}

export function critChance(combo: number): number {
  return Math.min(CRIT_CHANCE_MAX, CRIT_CHANCE_BASE + CRIT_CHANCE_PER_COMBO * combo);
}

/** Deterministic crit roll — same answer on client and server (see rng.ts). */
export function rollCrit(seed: number, slot: number, wordIndex: number, combo: number): boolean {
  return rollUnit(seed, slot, wordIndex) < critChance(combo);
}

export function ultimateChargeGain(combo: number): number {
  return ULTIMATE_CHARGE_BASE + ULTIMATE_CHARGE_PER_COMBO * combo;
}

export function ultimateDamage(combo: number): number {
  return Math.round(ULTIMATE_DAMAGE_BASE + ULTIMATE_DAMAGE_PER_COMBO * combo);
}

/**
 * Sudden death multiplier.
 *
 * Only engages while BOTH fighters are still healthy — if someone is already
 * losing badly there is no stalemate to break, and doubling damage would just
 * rob them of a comeback.
 */
export function rageMultiplier(elapsedMs: number, hpA: number, hpB: number, maxHp: number): number {
  const threshold = maxHp * RAGE_HP_FRACTION;
  if (hpA <= threshold || hpB <= threshold) return 1;

  if (elapsedMs >= RAGE_SECOND_AT_MS) return RAGE_SECOND_MULTIPLIER;
  if (elapsedMs >= RAGE_FIRST_AT_MS) return RAGE_FIRST_MULTIPLIER;
  return 1;
}

export interface DamageInputs {
  readonly wordLength: number;
  readonly combo: number;
  readonly deltaMs: number | null;
  readonly crit: boolean;
  readonly rageMultiplier: number;
}

/** The full damage pipeline for one landed word. */
export function computeDamage(inputs: DamageInputs): number {
  const tempo = inputs.deltaMs === null ? 1 : tempoBonus(inputs.deltaMs);

  const raw =
    baseDamage(inputs.wordLength) *
    comboMultiplier(inputs.combo) *
    tempo *
    (inputs.crit ? CRIT_MULTIPLIER : 1) *
    inputs.rageMultiplier;

  // At least 1 — a hit that reads as a hit must always take something off.
  return Math.max(1, Math.round(raw));
}

/**
 * Impact weight, 0.5–1.0. Drives hit-stop duration and FX scale.
 *
 * Deliberately separate from damage: a chip hit and a heavy hit can do similar
 * numbers at different combo tiers, but they should not *feel* the same. Weight
 * tracks the word itself, so a long word always lands heavily.
 */
export function impactWeight(wordLength: number, crit: boolean): number {
  const fromLength = clamp((wordLength - BASE_DAMAGE_LENGTH_FLOOR) / BASE_DAMAGE_LENGTH_CAP, 0, 1);
  const weight = WEIGHT_MIN + (WEIGHT_MAX - WEIGHT_MIN) * fromLength;
  return crit ? WEIGHT_MAX : weight;
}

/**
 * Attack flavour, escalating with word length.
 *
 * Cosmetic only — damage is computed above and never consults this. Tiering by
 * length means a long word visibly summons something bigger, so the fight reads
 * correctly with the text hidden (plan §0).
 */
const ATTACK_TIERS: ReadonlyArray<readonly AttackKind[]> = [
  ['punch', 'kick'],
  ['slash', 'arrow'],
  ['fireball', 'magic'],
  ['laser'],
];

export function attackKind(
  wordLength: number,
  seed: number,
  slot: number,
  wordIndex: number,
): AttackKind {
  const tier = wordLength <= 4 ? 0 : wordLength <= 6 ? 1 : wordLength <= 8 ? 2 : 3;
  return pickDeterministic(ATTACK_TIERS[tier]!, seed, slot, wordIndex);
}

/**
 * Accuracy in basis points (0–10000).
 *
 * Integer basis points rather than a float, matching the DB column: they
 * aggregate exactly, and 0.01% is far finer than anything we display.
 */
export function accuracyBpFromCounts(typed: number, missed: number): number {
  const attempted = typed + missed;
  if (attempted === 0) return 0;
  return Math.round((typed / attempted) * 10_000);
}
