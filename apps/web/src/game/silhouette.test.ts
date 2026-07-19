import { describe, expect, it } from 'vitest';
import { mulberry, silhouette } from './silhouette';
import type { SkylineProfile } from './arenaTheme';

const PROFILES: SkylineProfile[] = ['jagged', 'blocky', 'smooth', 'spiky', 'flat'];
const W = 1280;
const H = 200;

describe('silhouette', () => {
  it.each(PROFILES)('%s produces enough points to read as a shape', (profile) => {
    const points = silhouette(profile, W, H, 0);
    expect(points.length).toBeGreaterThan(8);
  });

  /**
   * Points outside the canvas are not a crash — they are a ridge that quietly
   * clips off the edge or floats above the sky, forever, with nobody able to
   * say why the arena looks slightly wrong.
   */
  it.each(PROFILES)('%s stays inside the canvas bounds', (profile) => {
    for (let layer = 0; layer < 3; layer += 1) {
      for (const [x, y] of silhouette(profile, W, H, layer)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(W);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(H);
      }
    }
  });

  it.each(PROFILES)('%s spans the full width, leaving no gap', (profile) => {
    const points = silhouette(profile, W, H, 0);
    const maxX = Math.max(...points.map(([x]) => x));

    // Must reach far enough right that the filled polygon covers the strip.
    expect(maxX).toBeGreaterThan(W * 0.95);
  });

  it.each(PROFILES)('%s is deterministic', (profile) => {
    expect(silhouette(profile, W, H, 1)).toEqual(silhouette(profile, W, H, 1));
  });

  /** Three identical ridges would defeat the point of parallax. */
  it.each(PROFILES)('%s differs between parallax layers', (profile) => {
    const a = silhouette(profile, W, H, 0);
    const b = silhouette(profile, W, H, 1);

    expect(a).not.toEqual(b);
  });

  it('gives each profile a distinct shape', () => {
    const signatures = PROFILES.map((p) =>
      silhouette(p, W, H, 0)
        .slice(0, 12)
        .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)
        .join('|'),
    );

    expect(new Set(signatures).size).toBe(PROFILES.length);
  });

  it.each(PROFILES)('%s has real vertical relief rather than a flat line', (profile) => {
    const ys = silhouette(profile, W, H, 0).map(([, y]) => y);
    const spread = Math.max(...ys) - Math.min(...ys);

    expect(spread).toBeGreaterThan(H * 0.1);
  });

  it('handles a narrow canvas without looping forever', () => {
    for (const profile of PROFILES) {
      expect(silhouette(profile, 40, 30, 0).length).toBeGreaterThan(0);
    }
  });
});

describe('mulberry', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry(7);
    const b = mulberry(7);

    for (let i = 0; i < 20; i += 1) expect(a()).toBe(b());
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry(99);
    for (let i = 0; i < 5_000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(mulberry(1)()).not.toBe(mulberry(2)());
  });
});
