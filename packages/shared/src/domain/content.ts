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

/**
 * Display metadata.
 *
 * Note what is absent: every entry is a name and a flavour line. There is no
 * `power`, no `speed`, no `difficulty` rating — because there is nothing to
 * rate. Characters differ only in how they look (plan §1.1 D5), and a "stats"
 * column here would be the first step toward that stopping being true.
 */
export interface CharacterMeta {
  readonly name: string;
  readonly blurb: string;
}

export const CHARACTERS: Readonly<Record<CharacterId, CharacterMeta>> = {
  ninja: { name: 'Ninja', blurb: 'Gone before the word lands.' },
  samurai: { name: 'Samurai', blurb: 'One strike, one syllable.' },
  knight: { name: 'Knight', blurb: 'Armoured against your worst typo.' },
  mage: { name: 'Mage', blurb: 'Spells are just very long words.' },
  robot: { name: 'Robot', blurb: 'Never misses. Allegedly.' },
  pirate: { name: 'Pirate', blurb: 'Fights dirty, spells worse.' },
  monk: { name: 'Monk', blurb: 'Calm hands, broken ribs.' },
  'cyber-assassin': { name: 'Cyber Assassin', blurb: 'Latency is the only defence.' },
  boxer: { name: 'Boxer', blurb: 'Combos are the whole personality.' },
  viking: { name: 'Viking', blurb: 'Subtlety not included.' },
};

export interface ArenaMeta {
  readonly name: string;
  readonly theme: string;
}

export const ARENAS: Readonly<Record<ArenaId, ArenaMeta>> = {
  dojo: { name: 'Dojo', theme: 'Lantern light and old wood' },
  'cyber-city': { name: 'Cyber City', theme: 'Rain, neon, bad decisions' },
  temple: { name: 'Temple', theme: 'Stone, incense, silence' },
  volcano: { name: 'Volcano', theme: 'Erupts when you land an Ultimate' },
  'snow-mountain': { name: 'Snow Mountain', theme: 'Whiteout and wind' },
  forest: { name: 'Forest', theme: 'Dappled light, distant birds' },
  castle: { name: 'Castle', theme: 'Torchlit and echoing' },
  'pirate-ship': { name: 'Pirate Ship', theme: 'A deck that will not stay level' },
  shrine: { name: 'Shrine', theme: 'Cherry blossom on perfect streaks' },
  'neon-city': { name: 'Neon City', theme: 'Rooftop signs, endless traffic' },
  'space-station': { name: 'Space Station', theme: 'Earth turning below' },
  'haunted-castle': { name: 'Haunted Castle', theme: 'Something watching' },
  desert: { name: 'Desert', theme: 'Heat haze and ruins' },
  rooftop: { name: 'Rooftop', theme: 'City lights, long drop' },
};
