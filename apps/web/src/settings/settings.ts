/**
 * Player settings.
 *
 * Pure: defaults, validation and the derived knobs the game actually reads.
 * Storage and React live next door in `SettingsManager`. Keeping the rules here
 * means the interesting decisions — what "reduced motion" actually turns off,
 * what a quality tier costs — are testable without a browser or a canvas.
 */

export type MotionPreference = 'auto' | 'full' | 'reduced';
export type QualityTier = 'low' | 'medium' | 'high';

export interface Settings {
  /** 0–1. */
  readonly master: number;
  readonly sfx: number;
  readonly music: number;
  readonly typingSounds: boolean;
  readonly muted: boolean;
  readonly motion: MotionPreference;
  readonly quality: QualityTier;
}

/**
 * `motion: 'auto'` is the default, and it means "believe the operating system".
 *
 * A player who has asked their OS to reduce motion has already answered this
 * question, and making them answer it again — in a menu they have to find,
 * after the first screen shake has already hit them — is not a real choice.
 * But `auto` is a DEFAULT, not a verdict: `full` and `reduced` are explicit
 * overrides, because someone may want the full spectacle here and calmer
 * animations everywhere else. An inferred preference should never outrank a
 * stated one.
 */
export const DEFAULT_SETTINGS: Settings = {
  master: 0.7,
  sfx: 0.8,
  music: 0.5,
  typingSounds: true,
  muted: false,
  motion: 'auto',
  quality: 'high',
};

const MOTIONS: readonly MotionPreference[] = ['auto', 'full', 'reduced'];
const QUALITIES: readonly QualityTier[] = ['low', 'medium', 'high'];

const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/**
 * Rebuilds settings from whatever was in storage.
 *
 * Every field is validated individually rather than trusting the blob: this
 * data survives across deploys, so it WILL eventually be an older shape, and a
 * settings screen that throws on load would lock a player out of the fix.
 * Anything unrecognised quietly falls back to its default.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;

  const input = raw as Record<string, unknown>;
  const motion = input['motion'];
  const quality = input['quality'];

  return {
    master: clamp01(input['master'], DEFAULT_SETTINGS.master),
    sfx: clamp01(input['sfx'], DEFAULT_SETTINGS.sfx),
    music: clamp01(input['music'], DEFAULT_SETTINGS.music),
    typingSounds: bool(input['typingSounds'], DEFAULT_SETTINGS.typingSounds),
    muted: bool(input['muted'], DEFAULT_SETTINGS.muted),
    motion: MOTIONS.includes(motion as MotionPreference)
      ? (motion as MotionPreference)
      : DEFAULT_SETTINGS.motion,
    quality: QUALITIES.includes(quality as QualityTier)
      ? (quality as QualityTier)
      : DEFAULT_SETTINGS.quality,
  };
}

/**
 * Resolves `auto` against what the system asked for.
 *
 * Separate from the stored value so the stored value keeps meaning "auto" — a
 * player who plugs in a different machine, or changes their OS preference,
 * should get the new answer rather than a snapshot of the old one.
 */
export function resolveReducedMotion(settings: Settings, systemPrefersReduced: boolean): boolean {
  if (settings.motion === 'reduced') return true;
  if (settings.motion === 'full') return false;
  return systemPrefersReduced;
}

/**
 * Particle multiplier for a quality tier.
 *
 * Scales how MANY particles spawn, never how hard a hit reads. A low-end
 * machine should render a lighter version of the same fight, not a different
 * one — if `low` changed which hits felt big, quality would be a gameplay
 * setting wearing a performance setting's clothes.
 */
export function particleScale(quality: QualityTier): number {
  if (quality === 'low') return 0.35;
  if (quality === 'medium') return 0.7;
  return 1;
}

/**
 * The gain actually sent to the audio bus.
 *
 * Mute is folded into the master value rather than living beside it, because
 * the engine's ducking ramps toward `master` and would otherwise ramp a muted
 * game back up mid-duck. One number, one source of truth.
 */
export function effectiveMaster(settings: Settings): number {
  return settings.muted ? 0 : settings.master;
}

/** What the audio engine needs, and nothing else. */
export function audioSettingsOf(settings: Settings): {
  master: number;
  sfx: number;
  typing: boolean;
} {
  return {
    master: effectiveMaster(settings),
    sfx: settings.sfx,
    typing: settings.typingSounds,
  };
}
