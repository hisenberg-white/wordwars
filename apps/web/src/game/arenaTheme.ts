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
