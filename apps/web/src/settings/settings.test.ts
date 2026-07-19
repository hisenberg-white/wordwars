import { describe, expect, it } from 'vitest';
import {
  audioSettingsOf,
  DEFAULT_SETTINGS,
  effectiveMaster,
  parseSettings,
  particleScale,
  resolveReducedMotion,
  type Settings,
} from './settings';

const withSettings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe('loading what was stored', () => {
  /**
   * Settings outlive deploys, so this data WILL eventually be an older shape.
   * A settings screen that throws on load would lock a player out of the very
   * screen they need to fix it.
   */
  it('falls back to defaults for anything unrecognised', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ motion: 'sideways', quality: 'ultra' })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the fields it does recognise', () => {
    const parsed = parseSettings({ master: 0.25, motion: 'reduced', quality: 'low', muted: true });

    expect(parsed.master).toBe(0.25);
    expect(parsed.motion).toBe('reduced');
    expect(parsed.quality).toBe('low');
    expect(parsed.muted).toBe(true);
    expect(parsed.sfx).toBe(DEFAULT_SETTINGS.sfx); // untouched
  });

  it('clamps volumes into range', () => {
    expect(parseSettings({ master: 4 }).master).toBe(1);
    expect(parseSettings({ master: -2 }).master).toBe(0);
    expect(parseSettings({ master: Number.NaN }).master).toBe(DEFAULT_SETTINGS.master);
  });
});

describe('motion preference', () => {
  /**
   * Someone who asked their OS to reduce motion has already answered this
   * question. Making them answer it again — in a menu they have to find, after
   * the first screen shake has already hit them — is not a real choice.
   */
  it('follows the system by default', () => {
    expect(resolveReducedMotion(DEFAULT_SETTINGS, true)).toBe(true);
    expect(resolveReducedMotion(DEFAULT_SETTINGS, false)).toBe(false);
  });

  /** A stated preference outranks an inferred one, in both directions. */
  it('lets an explicit choice override the system', () => {
    expect(resolveReducedMotion(withSettings({ motion: 'full' }), true)).toBe(false);
    expect(resolveReducedMotion(withSettings({ motion: 'reduced' }), false)).toBe(true);
  });

  /**
   * Stored as 'auto', resolved on read — so changing the OS preference, or
   * signing in on another machine, gives the new answer rather than a snapshot
   * of the old one.
   */
  it('keeps auto as auto rather than resolving it into storage', () => {
    expect(parseSettings({ motion: 'auto' }).motion).toBe('auto');
  });
});

describe('quality', () => {
  it('spawns fewer particles at lower tiers', () => {
    expect(particleScale('low')).toBeLessThan(particleScale('medium'));
    expect(particleScale('medium')).toBeLessThan(particleScale('high'));
    expect(particleScale('high')).toBe(1);
  });

  /** Low is lighter, not empty — an invisible hit reads as a dropped input. */
  it('never scales all the way to nothing', () => {
    expect(particleScale('low')).toBeGreaterThan(0);
  });
});

describe('mute', () => {
  /**
   * Folded into the master value rather than living beside it: the audio
   * engine's ducking ramps back toward `master`, so a mute held separately
   * would be undone mid-duck and the game would start talking again on its own.
   */
  it('is expressed as zero master gain', () => {
    expect(effectiveMaster(withSettings({ muted: true, master: 0.9 }))).toBe(0);
    expect(audioSettingsOf(withSettings({ muted: true, master: 0.9 })).master).toBe(0);
  });

  it('restores the previous volume when lifted', () => {
    const settings = withSettings({ muted: false, master: 0.9 });
    expect(effectiveMaster(settings)).toBe(0.9);
  });

  it('passes the other buses through untouched', () => {
    const audio = audioSettingsOf(withSettings({ sfx: 0.3, typingSounds: false }));
    expect(audio.sfx).toBe(0.3);
    expect(audio.typing).toBe(false);
  });
});
