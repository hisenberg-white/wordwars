/**
 * Cosmetic content catalogue.
 *
 * HARD RULE (plan §1.1 D5): characters and arenas are cosmetic forever.
 * Nothing in this file may ever carry a stat, modifier, or combat property.
 * If a `damageBonus` field ever appears here, the game has become pay-to-win
 * and the review should reject it.
 */

export const CHARACTER_IDS = [
  'ninja',
  'samurai',
  'knight',
  'mage',
  'robot',
  'pirate',
  'monk',
  'cyber-assassin',
  'boxer',
  'viking',
] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

export const ARENA_IDS = [
  'dojo',
  'cyber-city',
  'temple',
  'volcano',
  'snow-mountain',
  'forest',
  'castle',
  'pirate-ship',
  'shrine',
  'neon-city',
  'space-station',
  'haunted-castle',
  'desert',
  'rooftop',
] as const;

export type ArenaId = (typeof ARENA_IDS)[number];

/** Animation states every character must implement. */
export const FIGHTER_ANIMATIONS = [
  'idle',
  'walk',
  'attack',
  'combo',
  'ultimate',
  'hit',
  'ko',
  'victory',
  'defeat',
] as const;

export type FighterAnimation = (typeof FIGHTER_ANIMATIONS)[number];

export const isCharacterId = (v: string): v is CharacterId =>
  (CHARACTER_IDS as readonly string[]).includes(v);

export const isArenaId = (v: string): v is ArenaId => (ARENA_IDS as readonly string[]).includes(v);
