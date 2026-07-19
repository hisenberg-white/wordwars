import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feelFor } from '@/game/feel/impact';
import type { CombatEvent, PlayerId } from '@wordwars/shared';
import { DEFAULT_SETTINGS } from './settings';

/**
 * The manager is a module singleton reading localStorage at construction, so
 * each test re-imports it with storage already arranged.
 */
async function freshManager(stored?: unknown) {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem('wordwars.settings', JSON.stringify(stored));

  vi.resetModules();
  return import('./SettingsManager');
}

beforeEach(() => {
  localStorage.clear();
});

describe('persistence', () => {
  it('starts from defaults with nothing stored', async () => {
    const { settingsManager } = await freshManager();
    expect(settingsManager.current).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a change through storage', async () => {
    const first = await freshManager();
    first.settingsManager.update({ master: 0.2, quality: 'low' });

    const second = await freshManager(JSON.parse(localStorage.getItem('wordwars.settings')!));
    expect(second.settingsManager.current.master).toBe(0.2);
    expect(second.settingsManager.current.quality).toBe('low');
  });

  /** Corrupt storage must not stop the game starting. */
  it('survives unparseable storage', async () => {
    localStorage.setItem('wordwars.settings', '{not json');
    vi.resetModules();

    const { settingsManager } = await import('./SettingsManager');
    expect(settingsManager.current).toEqual(DEFAULT_SETTINGS);
  });
});

describe('subscription', () => {
  it('notifies listeners on a real change', async () => {
    const { settingsManager } = await freshManager();
    const listener = vi.fn();
    settingsManager.subscribe(listener);

    settingsManager.update({ master: 0.1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  /** useSyncExternalStore compares by reference and would loop forever. */
  it('stays silent when nothing actually changed', async () => {
    const { settingsManager } = await freshManager();
    const listener = vi.fn();
    settingsManager.subscribe(listener);

    settingsManager.update({ master: settingsManager.current.master });
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns a stable snapshot reference between changes', async () => {
    const { settingsManager } = await freshManager();
    const before = settingsManager.getSnapshot();

    settingsManager.update({ master: before.master });
    expect(settingsManager.getSnapshot()).toBe(before);

    settingsManager.update({ master: 0.33 });
    expect(settingsManager.getSnapshot()).not.toBe(before);
  });

  it('resets to defaults', async () => {
    const { settingsManager } = await freshManager();
    settingsManager.update({ master: 0.1, quality: 'low', motion: 'reduced' });
    settingsManager.reset();

    expect(settingsManager.current).toEqual(DEFAULT_SETTINGS);
  });
});

describe('what reduced motion actually does', () => {
  const heavyHit = (): CombatEvent => ({
    type: 'attack',
    t: 1,
    actor: 'a' as PlayerId,
    target: 'b' as PlayerId,
    damage: 400,
    kind: 'slash',
    combo: 10,
    crit: false,
    weight: 1,
  });

  /**
   * **The accessibility guarantee.**
   *
   * Reduced motion removes the camera shake — the one effect that can make
   * somebody physically unwell. It must NOT remove the feedback that tells a
   * player their attack landed. A player who turns this on should get a calmer
   * fight, not a less legible one; hiding hits would make the setting a
   * penalty for needing it.
   */
  it('removes shake but keeps the hit readable', () => {
    const calm = feelFor(heavyHit(), { reducedMotion: true, maxHp: 4000 });

    expect(calm.shake).toBeNull();
    expect(calm.hitStopMs).toBeGreaterThan(0);
    expect(calm.damageNumber).not.toBeNull();
  });

  it('still shakes when motion is allowed', () => {
    const full = feelFor(heavyHit(), { reducedMotion: false, maxHp: 4000 });
    expect(full.shake).not.toBeNull();
  });

  it('resolves the toggle through the manager', async () => {
    const { settingsManager } = await freshManager();

    settingsManager.update({ motion: 'reduced' });
    expect(settingsManager.reducedMotion).toBe(true);

    settingsManager.update({ motion: 'full' });
    expect(settingsManager.reducedMotion).toBe(false);
  });
});
