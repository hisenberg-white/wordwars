import type { SkylineProfile } from './arenaTheme';

export type Point = readonly [number, number];

/**
 * Procedural skyline geometry.
 *
 * Extracted from the renderer so it can be tested without a canvas. A skyline
 * that generates points outside its bounds, or too few to read as a shape,
 * fails silently — it just looks slightly wrong, forever, and nobody can say
 * why. Pure geometry is exactly the kind of thing worth pinning down.
 *
 * Deterministic: the same profile and layer always produce the same ridge, so
 * an arena looks the same every time you fight there.
 */
export function silhouette(
  profile: SkylineProfile,
  width: number,
  height: number,
  layer: number,
): Point[] {
  const points: Point[] = [];
  // Seeded per layer so the three parallax layers differ from one another
  // rather than looking like the same ridge drawn three times.
  const rng = mulberry(1337 + layer * 977);

  switch (profile) {
    case 'blocky': {
      // Rooflines: flat tops at varying heights, with the occasional mast.
      let x = 0;
      while (x < width) {
        const w = 24 + rng() * 60;
        const h = height * (0.25 + rng() * 0.7);
        points.push([x, height - h], [Math.min(x + w, width), height - h]);

        if (rng() > 0.82) {
          const mast = height * 0.2 * rng();
          points.push(
            [Math.min(x + w / 2, width), height - h - mast],
            [Math.min(x + w, width), height - h],
          );
        }
        x += w;
      }
      break;
    }

    case 'jagged': {
      // Mountain peaks.
      let x = 0;
      while (x < width) {
        const w = 60 + rng() * 130;
        points.push(
          [Math.min(x + w / 2, width), height - height * (0.35 + rng() * 0.6)],
          [Math.min(x + w, width), height * 0.9],
        );
        x += w;
      }
      break;
    }

    case 'spiky': {
      // Conifers.
      let x = 0;
      while (x < width) {
        const w = 16 + rng() * 26;
        points.push(
          [Math.min(x, width), height],
          [Math.min(x + w / 2, width), height - height * (0.4 + rng() * 0.55)],
          [Math.min(x + w, width), height],
        );
        x += w;
      }
      break;
    }

    case 'smooth': {
      // Dunes and swells — layered sine waves rather than noise, so the
      // horizon reads as rolling rather than random.
      for (let x = 0; x <= width; x += 12) {
        const y =
          height -
          height * (0.35 + 0.22 * Math.sin(x / 140 + layer) + 0.12 * Math.sin(x / 47 + layer * 2));
        points.push([Math.min(x, width), y]);
      }
      break;
    }

    default: {
      // 'flat' — a calm low ridge with the occasional structure.
      for (let x = 0; x <= width; x += 40) {
        const bump = rng() > 0.8 ? height * 0.35 : 0;
        points.push(
          [Math.min(x, width), height - height * 0.18 - bump],
          [Math.min(x + 40, width), height - height * 0.18],
        );
      }
    }
  }

  return points;
}

/** Small, fast, seedable PRNG. */
export function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
