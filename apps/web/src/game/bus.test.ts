import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARENA_IDS } from '@wordwars/shared';
import { gameBus } from './bus';
import { ARENA_SCENERY, ARENA_THEMES } from './arenaTheme';

afterEach(() => gameBus.clear());

describe('gameBus', () => {
  it('delivers a payload to every listener', () => {
    const a = vi.fn();
    const b = vi.fn();

    gameBus.on('combat:events', a);
    gameBus.on('combat:events', b);
    gameBus.emit('combat:events', { events: [], predicted: true });

    expect(a).toHaveBeenCalledWith({ events: [], predicted: true });
    expect(b).toHaveBeenCalledOnce();
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const off = gameBus.on('match:snapshot', listener);

    off();
    gameBus.emit('combat:events', { events: [], predicted: false });

    expect(listener).not.toHaveBeenCalled();
  });

  it('is a no-op when nobody is listening', () => {
    expect(() => gameBus.emit('combat:events', { events: [], predicted: false })).not.toThrow();
  });

  /**
   * One broken FX handler must not take the HUD down with it. Mid-fight, a
   * partially rendered frame beats a frozen screen.
   */
  it('isolates a throwing listener from the others', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const healthy = vi.fn();

    gameBus.on('combat:events', () => {
      throw new Error('boom');
    });
    gameBus.on('combat:events', healthy);

    expect(() => gameBus.emit('combat:events', { events: [], predicted: false })).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();

    errorSpy.mockRestore();
  });

  it('keeps event channels separate', () => {
    const combat = vi.fn();
    gameBus.on('combat:events', combat);

    gameBus.emit('match:snapshot', {
      tick: 0,
      phase: 'combat',
      fighters: [],
      rageMultiplier: 1,
      elapsedMs: 0,
      round: 1,
      score: [0, 0],
    });

    expect(combat).not.toHaveBeenCalled();
  });
});

/**
 * A missing entry here is a crash the moment somebody picks that stage — and
 * only that stage. Exactly the sort of gap that ships.
 */
describe('arena content coverage', () => {
  it.each(ARENA_IDS)('%s has both a CSS theme and Phaser scenery', (id) => {
    expect(ARENA_THEMES[id]).toBeDefined();
    expect(ARENA_SCENERY[id]).toBeDefined();
  });

  it.each(ARENA_IDS)('%s scenery is structurally complete', (id) => {
    const scenery = ARENA_SCENERY[id];

    expect(scenery.sky).toHaveLength(2);
    expect(scenery.layers).toHaveLength(3);
    expect(scenery.accent).toBeGreaterThan(0);
    expect(['jagged', 'blocky', 'smooth', 'spiky', 'flat']).toContain(scenery.profile);
  });

  /** The lobby preview and the arena must not disagree about the stage. */
  it.each(ARENA_IDS)('%s accent matches between the CSS theme and the renderer', (id) => {
    const css = ARENA_THEMES[id].accent.replace('#', '').toLowerCase();
    const phaser = ARENA_SCENERY[id].accent.toString(16).padStart(6, '0');

    expect(phaser).toBe(css);
  });

  it('gives the arenas visually distinct skies', () => {
    const skies = ARENA_IDS.map((id) => ARENA_SCENERY[id].sky.join(','));
    expect(new Set(skies).size).toBe(ARENA_IDS.length);
  });
});
