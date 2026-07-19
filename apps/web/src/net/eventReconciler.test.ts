import { describe, expect, it } from 'vitest';
import type { CombatEvent, PlayerId } from '@wordwars/shared';
import { filterPredicted, filterServer } from './eventReconciler';

const ME = 'me' as PlayerId;
const THEM = 'them' as PlayerId;

const attack = (actor: PlayerId, target: PlayerId): CombatEvent => ({
  type: 'attack',
  t: 1,
  actor,
  target,
  damage: 50,
  kind: 'punch',
  combo: 0,
  crit: false,
  weight: 0.6,
});

const miss = (actor: PlayerId): CombatEvent => ({ type: 'miss', t: 1, actor, comboLost: 3 });
const knockout: CombatEvent = { type: 'knockout', t: 9, winner: ME, loser: THEM };
const rage: CombatEvent = { type: 'rage', t: 5, multiplier: 1.5 };

describe('server events', () => {
  /**
   * The bug this exists to prevent: the client resolves its own word locally
   * for instant feedback, then the server sends its authoritative copy of the
   * SAME attack. Rendering both applies the damage twice — the HP bar visibly
   * double-drops and snaps back, and the player eats two hit-stops and two
   * damage numbers for one word.
   */
  it('drops our own attack, because we already predicted it', () => {
    expect(filterServer([attack(ME, THEM)], ME)).toHaveLength(0);
  });

  it('keeps the opponent’s attack, which we never predict', () => {
    expect(filterServer([attack(THEM, ME)], ME)).toHaveLength(1);
  });

  it.each<[string, CombatEvent]>([
    ['attack', attack(ME, THEM)],
    ['miss', miss(ME)],
    ['ultimate', { type: 'ultimate', t: 1, actor: ME, target: THEM, damage: 300 }],
    ['combo-tier', { type: 'combo-tier', t: 1, actor: ME, tier: 2, combo: 10 }],
    ['ultimate-ready', { type: 'ultimate-ready', t: 1, actor: ME }],
  ])('drops our own %s', (_label, event) => {
    expect(filterServer([event], ME)).toHaveLength(0);
  });

  /** Deciding a match is not the client's business, whoever caused it. */
  it('always keeps a knockout, even one we caused', () => {
    expect(filterServer([knockout], ME)).toHaveLength(1);
  });

  it('always keeps rage, which nobody owns', () => {
    expect(filterServer([rage], ME)).toHaveLength(1);
  });

  it('filters a mixed batch correctly', () => {
    const batch = [attack(ME, THEM), attack(THEM, ME), miss(ME), miss(THEM), knockout];
    const rendered = filterServer(batch, ME);

    expect(rendered).toEqual([attack(THEM, ME), miss(THEM), knockout]);
  });

  it('keeps everything before an identity is known', () => {
    expect(filterServer([attack(ME, THEM), attack(THEM, ME)], null)).toHaveLength(2);
  });
});

describe('predicted events', () => {
  it('keeps our own actions', () => {
    expect(filterPredicted([attack(ME, THEM), miss(ME)])).toHaveLength(2);
  });

  /**
   * If the local engine and the server disagree by a single point of damage,
   * a predicted knockout would end the fight on screen for a match that is
   * still being played.
   */
  it('withholds a knockout, which is the server’s call alone', () => {
    expect(filterPredicted([attack(ME, THEM), knockout])).toEqual([attack(ME, THEM)]);
  });
});

describe('the two halves together', () => {
  /**
   * The invariant that matters: across prediction and authority combined, each
   * action is rendered exactly once.
   */
  it('renders every action exactly once', () => {
    const myWord = [
      attack(ME, THEM),
      { type: 'combo-tier', t: 1, actor: ME, tier: 2, combo: 10 } as CombatEvent,
    ];
    const theirWord = [attack(THEM, ME)];

    const shown = [
      ...filterPredicted(myWord), // rendered locally, instantly
      ...filterServer([...myWord, ...theirWord], ME), // server's batch
    ];

    expect(shown.filter((e) => e.type === 'attack' && e.actor === ME)).toHaveLength(1);
    expect(shown.filter((e) => e.type === 'attack' && e.actor === THEM)).toHaveLength(1);
    expect(shown.filter((e) => e.type === 'combo-tier')).toHaveLength(1);
  });

  it('renders a knockout once, from the server only', () => {
    const shown = [...filterPredicted([knockout]), ...filterServer([knockout], ME)];
    expect(shown).toHaveLength(1);
  });
});
