import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, parseSettings, resolveReducedMotion, type Settings } from './settings';

const STORAGE_KEY = 'wordwars.settings';

/**
 * Where settings live.
 *
 * Outside React, like the rest of the game's state (plan §1.1 D3): the arena
 * scene and the audio engine both need to read these on frames where nothing
 * is re-rendering, and routing that through component state would put React in
 * the middle of the render loop.
 *
 * Also tracks the SYSTEM motion preference live. `ArenaScene` used to sample
 * `matchMedia` once at scene creation and never look again, so a player who
 * turned reduced motion on mid-session kept getting screen shake until they
 * reloaded — the setting appeared not to work.
 */
class SettingsManager {
  private settings: Settings = DEFAULT_SETTINGS;
  private systemReducedMotion = false;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.settings = this.load();
    this.watchSystemPreference();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Settings => this.settings;

  /** Resolved for the renderer: `auto` already decided against the system. */
  get reducedMotion(): boolean {
    return resolveReducedMotion(this.settings, this.systemReducedMotion);
  }

  get current(): Settings {
    return this.settings;
  }

  update(patch: Partial<Settings>): void {
    const next = { ...this.settings, ...patch };

    // useSyncExternalStore compares by reference and loops forever if handed a
    // fresh object for unchanged data.
    const changed = (Object.keys(patch) as Array<keyof Settings>).some(
      (key) => next[key] !== this.settings[key],
    );
    if (!changed) return;

    this.settings = next;
    this.persist();
    this.emit();
  }

  reset(): void {
    this.settings = DEFAULT_SETTINGS;
    this.persist();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private load(): Settings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? parseSettings(JSON.parse(stored)) : DEFAULT_SETTINGS;
    } catch {
      // Private browsing, a quota error, or corrupt JSON. Defaults are a fine
      // outcome; refusing to start over a settings blob is not.
      return DEFAULT_SETTINGS;
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Settings that fail to save still apply for this session.
    }
  }

  private watchSystemPreference(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.systemReducedMotion = query.matches;

    // Only meaningful while `motion` is 'auto', but subscribing unconditionally
    // is simpler than tearing the listener up and down as the preference
    // changes — and the callback is a no-op when an override is set.
    query.addEventListener('change', (event) => {
      this.systemReducedMotion = event.matches;
      if (this.settings.motion === 'auto') this.emit();
    });
  }
}

export const settingsManager = new SettingsManager();

export function useSettings(): Settings {
  return useSyncExternalStore(
    settingsManager.subscribe,
    settingsManager.getSnapshot,
    settingsManager.getSnapshot,
  );
}
