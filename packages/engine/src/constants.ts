/**
 * Combat tuning.
 *
 * **This file is the game design.** Every number here changes how a fight
 * feels, and the 3.11 playtest gate exists to revise them. Keep the rationale
 * attached to each value — a bare number nobody understands is a number nobody
 * dares to change.
 *
 * All values were validated by head-to-head simulation before being written
 * down (see the notes on each). Two of the plan's original §5.2 numbers were
 * WRONG and are corrected here; both corrections are documented below.
 */

/**
 * Starting HP.
 *
 * The plan said 1000. Simulation showed that produced ~19-second fights lasting
 * ~23 words — which meant the combo-35 tier could NEVER be reached, making the
 * top damage multiplier dead content, and the plan's own "60–90 second" target
 * unachievable. 4000 gives ~56s even matches over ~70 words, with peak combos
 * landing around 39 so the top tier is reachable but has to be earned.
 */
export const MAX_HP = 4000;

// ---------------------------------------------------------------------------
// Base damage — longer words hit harder
// ---------------------------------------------------------------------------

export const BASE_DAMAGE_MIN = 18;
export const BASE_DAMAGE_PER_CHAR = 4;
/** Length beyond which extra characters stop adding damage. */
export const BASE_DAMAGE_LENGTH_CAP = 9;
export const BASE_DAMAGE_LENGTH_FLOOR = 3;

// ---------------------------------------------------------------------------
// Combo tiers
//
// Crossing a boundary is a visible, audible moment, so the tiers are wide
// enough apart that a player feels each one arrive.
// ---------------------------------------------------------------------------

export const COMBO_TIERS: ReadonlyArray<{ readonly at: number; readonly multiplier: number }> = [
  { at: 0, multiplier: 1.0 },
  { at: 5, multiplier: 1.25 },
  { at: 10, multiplier: 1.55 },
  { at: 20, multiplier: 1.9 },
  { at: 35, multiplier: 2.4 },
];

// ---------------------------------------------------------------------------
// Tempo — faster typing hits harder
// ---------------------------------------------------------------------------

/**
 * CORRECTED FROM THE PLAN.
 *
 * §5.2 specified `clamp(1.6 - dt/400, 0.85, 1.35)`. That divisor puts the whole
 * useful curve between 100ms and 300ms per word — i.e. 200 to 600 WPM. Every
 * human player, from 40 WPM to 200 WPM, sat permanently on the 0.85 floor: the
 * bonus never rewarded anyone and simply applied a flat 15% damage penalty to
 * the entire player base.
 *
 * 1600 spreads the curve across 50–150 WPM, which is where real players
 * actually live. A 60 WPM typist sits near neutral, 100 WPM earns ~1.23, and
 * 150+ WPM caps at 1.35.
 */
export const TEMPO_INTERCEPT = 1.6;
export const TEMPO_DIVISOR = 1600;
export const TEMPO_MIN = 0.85;
export const TEMPO_MAX = 1.35;

/**
 * Applied to a player's first word, which has no previous word to measure from.
 *
 * Neutral rather than generous: opening on a free damage bonus would reward
 * having a fast connection rather than fast hands.
 */
export const TEMPO_NEUTRAL = 1.0;

// ---------------------------------------------------------------------------
// Critical hits
// ---------------------------------------------------------------------------

export const CRIT_CHANCE_BASE = 0.07;
export const CRIT_CHANCE_PER_COMBO = 0.003;
export const CRIT_CHANCE_MAX = 0.25;
export const CRIT_MULTIPLIER = 1.8;

// ---------------------------------------------------------------------------
// Ultimate
// ---------------------------------------------------------------------------

export const ULTIMATE_MAX_CHARGE = 100;

/**
 * CORRECTED FROM THE PLAN.
 *
 * §5.2 specified `charge += 4 + combo * 0.35`, which simulated to ~6.5
 * Ultimates per match. An Ultimate freezes time, pushes the camera in and is
 * meant to make spectators gasp — at six per match it is neither cinematic nor
 * special, and the interruptions would consume ~20% of the match in cutscenes.
 *
 * These values give ~2 per player per match: rare enough to be an event,
 * common enough that every match has one.
 */
export const ULTIMATE_CHARGE_BASE = 2.5;
export const ULTIMATE_CHARGE_PER_COMBO = 0.18;

/** A miss costs charge as well as combo — sloppiness delays your finisher. */
export const ULTIMATE_MISS_PENALTY = 15;

/**
 * Scaled up alongside MAX_HP so an Ultimate lands at roughly 4–5× a normal hit
 * (~10% of a full health bar). Big enough to change a fight, not big enough to
 * end one from full.
 */
export const ULTIMATE_DAMAGE_BASE = 260;
export const ULTIMATE_DAMAGE_PER_COMBO = 6;

// ---------------------------------------------------------------------------
// Sudden death (plan §5.4)
// ---------------------------------------------------------------------------

/**
 * Sudden death ramp.
 *
 * CORRECTED after balance simulation. The original two-step ramp (1.5× at 90s,
 * 2× at 120s) was calibrated against skilled play, where matches end near 56s
 * and Rage never fires. But two 40 WPM beginners deal a quarter of that damage
 * output, and their matches ran **216 seconds** — a three-and-a-half minute
 * slog inflicted on precisely the players most likely to give up on the game.
 *
 * Four steep tiers, all starting at 60s so skilled matches (which end near 59s
 * or sooner) never see them at all. The ramp is aggressive on purpose: by the
 * time a fight has run a full minute without resolving, ending it is worth more
 * than preserving its pacing.
 */
export const RAGE_TIERS: ReadonlyArray<{ readonly atMs: number; readonly multiplier: number }> = [
  { atMs: 60_000, multiplier: 2.5 },
  { atMs: 80_000, multiplier: 5.0 },
  { atMs: 100_000, multiplier: 9.0 },
  { atMs: 130_000, multiplier: 15.0 },
];

/*
 * REMOVED: the "both fighters must be healthy" gate.
 *
 * It was written for a gentle two-step ramp and actively defeated the
 * mechanic's purpose. Rage would engage at the threshold, then SWITCH OFF the
 * moment either fighter dropped below 40% — which is precisely when a long
 * match most needs to end. Beginner matches barely improved because of it.
 *
 * The gate was also unnecessary. Rage is SYMMETRIC: both fighters deal more
 * damage, so it does not hand the win to whoever is ahead. It compresses the
 * remaining match without changing who is likely to take it — and a trailing
 * player closes a gap faster under Rage, not slower.
 */

// ---------------------------------------------------------------------------
// Presentation hints (cosmetic, but computed here so both ends agree)
// ---------------------------------------------------------------------------

/** Impact weight, used for hit-stop duration and FX scale. */
export const WEIGHT_MIN = 0.5;
export const WEIGHT_MAX = 1.0;
