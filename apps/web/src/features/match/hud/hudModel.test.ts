import { describe, expect, it } from 'vitest';
import type { CombatEvent, MatchSnapshot, PlayerId } from '@wordwars/shared';
import {
  applyEvent,
  createHudState,
  hpFraction,
  isCritical,
  reconcile,
  type HudState,
} from './hudModel';

const ME = 'me' as PlayerId;
const THEM = 'them' as PlayerId;
const MAX_HP = 4000;

const fresh = () => createHudState([ME, THEM], MAX_HP);
const of = (state: HudState, id: PlayerId) => state.fighters.find((f) => f.playerId === id)!;

const attack = (
  overrides: Partial<Extract<CombatEvent, { type: 'attack' }>> = {},
): CombatEvent => ({
  type: 'attack',
  t: 1,
  actor: ME,
  target: THEM,
  damage: 100,
  kind: 'punch',
  combo: 0,
  crit: false,
  weight: 0.6,
  ...overrides,
});

describe('starting state', () => {
  it('begins even and full', () => {
    const state = fresh();

    expect(state.fighters).toHaveLength(2);
    expect(state.fighters.every((f) => f.hp === MAX_HP)).toBe(true);
    expect(state.fighters.every((f) => f.combo === 0)).toBe(true);
    expect(state.rageMultiplier).toBe(1);
  });
});

describe('attacks', () => {
  it('damages the target and leaves the attacker alone', () => {
    const state = applyEvent(fresh(), attack({ damage: 250 }));

    expect(of(state, THEM).hp).toBe(MAX_HP - 250);
    expect(of(state, ME).hp).toBe(MAX_HP);
  });

  /**
   * The event reports the combo the word was SCORED at; the counter should
   * show what the player now has. Off by one here means the HUD and the
   * damage disagree all match.
   */
  it('shows the combo the player now holds, not the one they struck at', () => {
    const state = applyEvent(fresh(), attack({ combo: 7 }));
    expect(of(state, ME).combo).toBe(8);
  });

  it('never drives HP below zero', () => {
    const state = applyEvent(fresh(), attack({ damage: 999_999 }));
    expect(of(state, THEM).hp).toBe(0);
  });
});

describe('misses', () => {
  it('resets only the offender’s combo', () => {
    let state = applyEvent(fresh(), attack({ combo: 12 }));
    state = applyEvent(state, attack({ actor: THEM, target: ME, combo: 5 }));

    state = applyEvent(state, { type: 'miss', t: 2, actor: ME, comboLost: 13 });

    expect(of(state, ME).combo).toBe(0);
    expect(of(state, THEM).combo).toBe(6);
  });

  it('does no damage to anyone', () => {
    const state = applyEvent(fresh(), { type: 'miss', t: 1, actor: ME, comboLost: 4 });
    expect(state.fighters.every((f) => f.hp === MAX_HP)).toBe(true);
  });
});

describe('ultimate', () => {
  it('empties the meter when it fires', () => {
    let state = applyEvent(fresh(), { type: 'ultimate-ready', t: 1, actor: ME });
    expect(of(state, ME).ultimateReady).toBe(true);

    state = applyEvent(state, { type: 'ultimate', t: 2, actor: ME, target: THEM, damage: 400 });

    expect(of(state, ME).ultimateReady).toBe(false);
    expect(of(state, ME).ultimateCharge).toBe(0);
    expect(of(state, THEM).hp).toBe(MAX_HP - 400);
  });

  it('fills the meter when announced', () => {
    const state = applyEvent(fresh(), { type: 'ultimate-ready', t: 1, actor: ME });
    expect(of(state, ME).ultimateCharge).toBe(100);
  });
});

describe('knockout and rage', () => {
  it('empties the loser’s bar', () => {
    const state = applyEvent(fresh(), { type: 'knockout', t: 1, winner: ME, loser: THEM });

    expect(of(state, THEM).hp).toBe(0);
    expect(of(state, ME).hp).toBe(MAX_HP);
  });

  it('records the rage multiplier', () => {
    const state = applyEvent(fresh(), { type: 'rage', t: 1, multiplier: 1.5 });
    expect(state.rageMultiplier).toBe(1.5);
  });
});

describe('reconciliation', () => {
  const snapshot = (hpMe: number, hpThem: number): MatchSnapshot => ({
    tick: 10,
    phase: 'combat',
    rageMultiplier: 2,
    elapsedMs: 1000,
    fighters: [
      {
        playerId: ME,
        hp: hpMe,
        maxHp: MAX_HP,
        combo: 3,
        maxCombo: 9,
        ultimateCharge: 44,
        ultimateReady: false,
        wordIndex: 12,
      },
      {
        playerId: THEM,
        hp: hpThem,
        maxHp: MAX_HP,
        combo: 0,
        maxCombo: 4,
        ultimateCharge: 10,
        ultimateReady: false,
        wordIndex: 8,
      },
    ],
  });

  /**
   * Prediction exists to remove latency from the FEEL, never to argue with the
   * result. Wherever the two disagree, the server wins — a HUD that drifts is
   * a player who thinks they won.
   */
  it('overrides optimistic local values with the server’s', () => {
    let state = fresh();
    // Predict far more damage than actually landed.
    for (let i = 0; i < 10; i += 1) state = applyEvent(state, attack({ damage: 300 }));
    expect(of(state, THEM).hp).toBeLessThan(1500);

    state = reconcile(state, snapshot(MAX_HP, 3800));

    expect(of(state, THEM).hp).toBe(3800);
    expect(of(state, ME).combo).toBe(3);
    expect(state.rageMultiplier).toBe(2);
  });

  it('corrects upward as readily as downward', () => {
    let state = applyEvent(fresh(), attack({ damage: 1000 }));
    state = reconcile(state, snapshot(MAX_HP, MAX_HP));

    expect(of(state, THEM).hp).toBe(MAX_HP);
  });

  it('keeps predicting normally after a correction', () => {
    let state = reconcile(fresh(), snapshot(2000, 2000));
    state = applyEvent(state, attack({ damage: 200 }));

    expect(of(state, THEM).hp).toBe(1800);
  });

  it('ignores a snapshot naming an unknown fighter', () => {
    const state = reconcile(fresh(), {
      ...snapshot(1, 1),
      fighters: [
        {
          playerId: 'stranger' as PlayerId,
          hp: 5,
          maxHp: MAX_HP,
          combo: 0,
          maxCombo: 0,
          ultimateCharge: 0,
          ultimateReady: false,
          wordIndex: 0,
        },
      ],
    });

    expect(state.fighters.every((f) => f.hp === MAX_HP)).toBe(true);
  });
});

describe('display helpers', () => {
  it('reports HP as a fraction', () => {
    const state = applyEvent(fresh(), attack({ damage: MAX_HP / 4 }));
    expect(hpFraction(of(state, THEM))).toBeCloseTo(0.75, 5);
  });

  it('clamps the fraction to [0, 1]', () => {
    const dead = applyEvent(fresh(), attack({ damage: MAX_HP * 3 }));
    expect(hpFraction(of(dead, THEM))).toBe(0);
  });

  it('flags danger only in the last quarter', () => {
    let state = applyEvent(fresh(), attack({ damage: MAX_HP * 0.7 }));
    expect(isCritical(of(state, THEM))).toBe(false);

    state = applyEvent(state, attack({ damage: MAX_HP * 0.1 }));
    expect(isCritical(of(state, THEM))).toBe(true);
  });
});
