import { randomInt } from 'node:crypto';
import { NICKNAME_MAX } from '@wordwars/shared';

/**
 * Guest name generation.
 *
 * A guest's generated name is the first thing the game says to them, so the
 * word lists lean fast, sharp and combative rather than cute — a player called
 * `CrimsonPanda` should feel like they were handed a fighter, not a username.
 *
 * Names are NOT globally unique, and deliberately so. Enforcing uniqueness
 * across guests would mean a shared registry on the matchmaking hot path, plus
 * ugly `RapidWolf_4817` fallbacks, to solve a problem that barely exists: two
 * guests only ever see each other inside one match, where the pairing is
 * already unambiguous. Registered usernames DO stay unique — that constraint
 * lives on the User table, where it is cheap.
 */

const ADJECTIVES = [
  'Rapid',
  'Blue',
  'Silent',
  'Crimson',
  'Iron',
  'Swift',
  'Savage',
  'Frozen',
  'Golden',
  'Shadow',
  'Neon',
  'Wild',
  'Storm',
  'Ghost',
  'Rogue',
  'Turbo',
  'Vicious',
  'Lucky',
  'Feral',
  'Prime',
  'Molten',
  'Cobalt',
  'Grim',
  'Hyper',
  'Jade',
  'Onyx',
  'Rebel',
  'Sonic',
  'Toxic',
  'Velvet',
  'Ashen',
  'Brutal',
  'Cyber',
  'Dire',
  'Elder',
  'Fatal',
  'Gilded',
  'Hollow',
  'Ivory',
  'Jagged',
  'Keen',
  'Lunar',
  'Mad',
  'Noble',
  'Obsidian',
  'Pale',
  'Quick',
  'Raging',
  'Scarlet',
  'Thunder',
  'Umbral',
  'Vapor',
  'Wicked',
  'Zephyr',
  'Blazing',
  'Cursed',
  'Drifting',
  'Endless',
  'Fearless',
  'Glacial',
] as const;

const NOUNS = [
  'Wolf',
  'Tiger',
  'Fox',
  'Panda',
  'Falcon',
  'Viper',
  'Raven',
  'Bear',
  'Hawk',
  'Cobra',
  'Lynx',
  'Drake',
  'Shark',
  'Jackal',
  'Owl',
  'Panther',
  'Rhino',
  'Stag',
  'Wasp',
  'Crane',
  'Badger',
  'Bison',
  'Condor',
  'Dingo',
  'Eagle',
  'Ferret',
  'Gecko',
  'Heron',
  'Ibis',
  'Jaguar',
  'Kestrel',
  'Lion',
  'Mantis',
  'Newt',
  'Osprey',
  'Puma',
  'Quail',
  'Ram',
  'Serpent',
  'Toad',
  'Urchin',
  'Vulture',
  'Weasel',
  'Yak',
  'Zebra',
  'Blade',
  'Comet',
  'Dagger',
  'Ember',
  'Fang',
  'Gale',
  'Hammer',
  'Knight',
  'Lance',
  'Monk',
  'Nomad',
  'Oracle',
  'Phantom',
  'Reaper',
  'Saber',
] as const;

/**
 * `randomInt` from node:crypto rather than `Math.random()`.
 *
 * Not for secrecy — a guest name is public. It is that `Math.random()` is
 * seeded per-process, and a fleet of servers restarting together can hand out
 * correlated names. Crypto randomness costs nothing here and removes the
 * question entirely.
 */
function pick<T>(list: readonly T[]): T {
  // Non-null assertion is safe: both lists are non-empty const tuples.
  return list[randomInt(list.length)]!;
}

export function generateNickname(): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${pick(ADJECTIVES)}${pick(NOUNS)}`;
    if (candidate.length <= NICKNAME_MAX) return candidate;
  }

  // Every pairing over the length limit eight times running is vanishingly
  // unlikely, but a guest must always get a name — never an error.
  return `Fighter${randomInt(1000, 9999)}`;
}

export const NICKNAME_COMBINATIONS = ADJECTIVES.length * NOUNS.length;
