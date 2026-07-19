import type { ArenaId } from '@wordwars/shared';

/**
 * Arena colour identities.
 *
 * Stand-ins for the real backgrounds (phase 5.2), but not throwaway: these
 * gradients define each stage's colour identity, and the eventual art should
 * match them rather than the other way round. A player who picks "Volcano"
 * from a lobby that glows orange should not arrive somewhere blue.
 *
 * Kept in the web app rather than `shared` because this is presentation. The
 * server has no opinion about what a volcano looks like.
 */
export interface ArenaTheme {
  /** Full-bleed background gradient. */
  readonly gradient: string;
  /** Accent used for text and borders over that gradient. */
  readonly accent: string;
}

/**
 * How an arena's parallax silhouettes are shaped.
 *
 * Real backgrounds arrive in 5.2. Until then each stage generates its skyline
 * procedurally from one of these profiles, which is enough for the arenas to
 * be visually distinguishable at a glance — a player should know they are in
 * Cyber City rather than the Dojo without reading a label.
 */
export type SkylineProfile = 'jagged' | 'blocky' | 'smooth' | 'spiky' | 'flat';

export interface ArenaScenery {
  /** Sky colours, top to bottom. */
  readonly sky: readonly [number, number];
  /** Silhouette colours for the three parallax layers, far to near. */
  readonly layers: readonly [number, number, number];
  readonly ground: number;
  /** Accent as a Phaser-friendly integer. */
  readonly accent: number;
  readonly profile: SkylineProfile;
  /** Ambient motes drifting through the scene: snow, embers, blossom, dust. */
  readonly particle: { readonly color: number; readonly rise: boolean } | null;
}

export const ARENA_THEMES: Readonly<Record<ArenaId, ArenaTheme>> = {
  dojo: {
    gradient: 'linear-gradient(160deg, #3a2418 0%, #1a1109 60%, #0b0705 100%)',
    accent: '#e8a355',
  },
  'cyber-city': {
    gradient: 'linear-gradient(160deg, #1a0f3d 0%, #2d1155 45%, #08050f 100%)',
    accent: '#c77dff',
  },
  temple: {
    gradient: 'linear-gradient(160deg, #2a2d33 0%, #16181d 60%, #08090b 100%)',
    accent: '#a8c0d8',
  },
  volcano: {
    gradient: 'linear-gradient(160deg, #4a1207 0%, #2a0a04 55%, #0d0402 100%)',
    accent: '#ff6b2c',
  },
  'snow-mountain': {
    gradient: 'linear-gradient(160deg, #24384f 0%, #14202e 60%, #070c12 100%)',
    accent: '#9fd4ff',
  },
  forest: {
    gradient: 'linear-gradient(160deg, #17301c 0%, #0d1c11 60%, #050b07 100%)',
    accent: '#6fd68a',
  },
  castle: {
    gradient: 'linear-gradient(160deg, #2b2438 0%, #171320 60%, #08060c 100%)',
    accent: '#b9a3e3',
  },
  'pirate-ship': {
    gradient: 'linear-gradient(160deg, #123040 0%, #0a1c26 60%, #040a0e 100%)',
    accent: '#5fc9d6',
  },
  shrine: {
    gradient: 'linear-gradient(160deg, #3d1a2a 0%, #22101a 60%, #0b050a 100%)',
    accent: '#ff9ec4',
  },
  'neon-city': {
    gradient: 'linear-gradient(160deg, #06283d 0%, #041b2b 55%, #01080f 100%)',
    accent: '#00e0ff',
  },
  'space-station': {
    gradient: 'linear-gradient(160deg, #101828 0%, #080d18 60%, #02040a 100%)',
    accent: '#7fa8ff',
  },
  'haunted-castle': {
    gradient: 'linear-gradient(160deg, #1c2418 0%, #10160f 60%, #050805 100%)',
    accent: '#9dd67a',
  },
  desert: {
    gradient: 'linear-gradient(160deg, #4a3418 0%, #2a1d0d 60%, #0d0904 100%)',
    accent: '#ffcb6b',
  },
  rooftop: {
    gradient: 'linear-gradient(160deg, #1a1f33 0%, #0f1220 60%, #05060c 100%)',
    accent: '#8fb8ff',
  },
};

/**
 * Per-arena scenery for the Phaser renderer.
 *
 * Kept in the same file as the CSS themes deliberately: the lobby preview and
 * the arena itself must agree, and splitting them across two files is how they
 * quietly drift apart.
 */
export const ARENA_SCENERY: Readonly<Record<ArenaId, ArenaScenery>> = {
  dojo: {
    sky: [0x3a2418, 0x0b0705],
    layers: [0x2a1a12, 0x1c110b, 0x120a06],
    ground: 0x1a1109,
    accent: 0xe8a355,
    profile: 'flat',
    particle: { color: 0xe8a355, rise: true },
  },
  'cyber-city': {
    sky: [0x2d1155, 0x08050f],
    layers: [0x1f0e3d, 0x150927, 0x0c0518],
    ground: 0x0a0614,
    accent: 0xc77dff,
    profile: 'blocky',
    particle: { color: 0xc77dff, rise: false },
  },
  temple: {
    sky: [0x2a2d33, 0x08090b],
    layers: [0x1e2126, 0x15171b, 0x0d0f12],
    ground: 0x111316,
    accent: 0xa8c0d8,
    profile: 'flat',
    particle: null,
  },
  volcano: {
    sky: [0x4a1207, 0x0d0402],
    layers: [0x35100a, 0x220a05, 0x140503],
    ground: 0x1a0603,
    accent: 0xff6b2c,
    profile: 'jagged',
    particle: { color: 0xff6b2c, rise: true },
  },
  'snow-mountain': {
    sky: [0x24384f, 0x070c12],
    layers: [0x1b2a3c, 0x121d29, 0x0a1119],
    ground: 0x18242f,
    accent: 0x9fd4ff,
    profile: 'jagged',
    particle: { color: 0xdfefff, rise: false },
  },
  forest: {
    sky: [0x17301c, 0x050b07],
    layers: [0x112413, 0x0b190d, 0x060f08],
    ground: 0x0c1a0e,
    accent: 0x6fd68a,
    profile: 'spiky',
    particle: { color: 0x9fe8b4, rise: false },
  },
  castle: {
    sky: [0x2b2438, 0x08060c],
    layers: [0x1f1a2a, 0x15111d, 0x0c0a12],
    ground: 0x141020,
    accent: 0xb9a3e3,
    profile: 'blocky',
    particle: null,
  },
  'pirate-ship': {
    sky: [0x123040, 0x040a0e],
    layers: [0x0d2431, 0x081821, 0x050e13],
    ground: 0x0a1c26,
    accent: 0x5fc9d6,
    profile: 'smooth',
    particle: { color: 0x8fdfe8, rise: false },
  },
  shrine: {
    sky: [0x3d1a2a, 0x0b050a],
    layers: [0x2c1420, 0x1e0e17, 0x12080e],
    ground: 0x1a0c14,
    accent: 0xff9ec4,
    profile: 'flat',
    particle: { color: 0xffb8d4, rise: false },
  },
  'neon-city': {
    sky: [0x06283d, 0x01080f],
    layers: [0x052032, 0x031522, 0x020c15],
    ground: 0x03121d,
    accent: 0x00e0ff,
    profile: 'blocky',
    particle: { color: 0x00e0ff, rise: true },
  },
  'space-station': {
    sky: [0x101828, 0x02040a],
    layers: [0x0c1220, 0x080d18, 0x04070f],
    ground: 0x080c16,
    accent: 0x7fa8ff,
    profile: 'smooth',
    particle: { color: 0xffffff, rise: false },
  },
  'haunted-castle': {
    sky: [0x1c2418, 0x050805],
    layers: [0x151c11, 0x0e130c, 0x080b07],
    ground: 0x0d120a,
    accent: 0x9dd67a,
    profile: 'spiky',
    particle: { color: 0x9dd67a, rise: true },
  },
  desert: {
    sky: [0x4a3418, 0x0d0904],
    layers: [0x362512, 0x24190c, 0x150e07],
    ground: 0x2a1d0d,
    accent: 0xffcb6b,
    profile: 'smooth',
    particle: { color: 0xffd98f, rise: false },
  },
  rooftop: {
    sky: [0x1a1f33, 0x05060c],
    layers: [0x141828, 0x0e111c, 0x080a11],
    ground: 0x0c0f1a,
    accent: 0x8fb8ff,
    profile: 'blocky',
    particle: { color: 0x8fb8ff, rise: false },
  },
};
