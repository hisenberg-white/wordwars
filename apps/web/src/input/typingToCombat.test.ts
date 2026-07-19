import { beforeEach, describe, expect, it } from 'vitest';
import type { CombatEvent, PlayerId } from '@wordwars/shared';
import {
  applyWordAttempt,
  createMatchState,
  isTerminal,
  type EngineMatchState,
} from '@wordwars/engine';
import { InputEngine } from './InputEngine';

/**
 * The premise of the entire game, tested end to end: **typing is the
 * controller**.
 *
 * 3.1 built the combat rules and 3.2 built the input layer. Neither proves the
 * thing that matters on its own — that a player pressing keys produces a fight.
 * This wires the real InputEngine to the real combat engine, exactly as the
 * client will for local prediction (plan §1.1 D1), and drives it with
 * synthetic keystrokes.
 */

const ME = 'me' as PlayerId;
const THEM = 'them' as PlayerId;

let clock: number;
let target: EventTarget;
let input: InputEngine;
let match: EngineMatchState;
let events: CombatEvent[];

const advance = (ms: number) => {
  clock += ms;
};

beforeEach(() => {
  clock = 0;
  target = new EventTarget();
  events = [];

  match = createMatchState({ matchId: 'm', seed: 4242, players: [ME, THEM] });
  input = new InputEngine({ now: () => clock });

  // The wiring the real client uses: a committed word is immediately resolved
  // against the local copy of the combat engine, so the attack animation can
  // fire without waiting for the server.
  input.onCommit((commit) => {
    const delta = applyWordAttempt(match, {
      playerId: ME,
      wordIndex: commit.wordIndex,
      wordLength: commit.word.length,
      dirty: commit.dirty,
      atMs: commit.atMs,
    });
    events.push(...delta.events);
  });

  input.attach(target, 0);
});

function press(key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
}

/** Types a word at a given pace and commits it. */
function typeWord(word: string, msPerKey = 100, mistake = false): void {
  const text = mistake ? `x${word.slice(1)}` : word;
  for (const char of text) {
    advance(msPerKey);
    press(char);
  }
  press(' ');
}

const opponent = () => match.fighters.find((f) => f.playerId === THEM)!;
const self = () => match.fighters.find((f) => f.playerId === ME)!;

describe('typing controls combat', () => {
  it('turns a typed word into an attack that damages the opponent', () => {
    input.pushSentence(['strike']);

    const hpBefore = opponent().hp;
    typeWord('strike');

    expect(events.some((e) => e.type === 'attack')).toBe(true);
    expect(opponent().hp).toBeLessThan(hpBefore);
  });

  it('builds a combo across clean words', () => {
    input.pushSentence(['one', 'two', 'three', 'four', 'five', 'six']);
    for (const word of ['one', 'two', 'three', 'four', 'five', 'six']) typeWord(word);

    expect(self().combo).toBe(6);
    expect(events.some((e) => e.type === 'combo-tier')).toBe(true);
  });

  it('breaks the combo on a typo and deals no damage for that word', () => {
    input.pushSentence(['alpha', 'bravo', 'charlie']);

    typeWord('alpha');
    typeWord('bravo');
    const hpBefore = opponent().hp;

    typeWord('charlie', 100, true);

    expect(self().combo).toBe(0);
    expect(opponent().hp).toBe(hpBefore);
    expect(self().hp).toBe(match.maxHp); // Plan §5.3 — a typo never self-damages.
  });

  /** A repaired word still costs the combo — the whole point of §4.2. */
  it('still breaks the combo when a mistake is repaired before space', () => {
    input.pushSentence(['alpha', 'bravo']);
    typeWord('alpha');

    advance(100);
    press('b');
    advance(100);
    press('x');
    press('Backspace');
    for (const char of 'ravo') {
      advance(100);
      press(char);
    }
    press(' ');

    expect(self().combo).toBe(0);
  });

  it('rewards faster typing with more damage', () => {
    const damageAt = (msPerKey: number) => {
      const state = createMatchState({ matchId: 'm', seed: 1, players: [ME, THEM] });
      const engine = new InputEngine({ now: () => clock });
      const local: CombatEvent[] = [];

      engine.onCommit((commit) => {
        local.push(
          ...applyWordAttempt(state, {
            playerId: ME,
            wordIndex: commit.wordIndex,
            wordLength: commit.word.length,
            dirty: commit.dirty,
            atMs: commit.atMs,
          }).events,
        );
      });

      const localTarget = new EventTarget();
      engine.attach(localTarget, 0);
      engine.pushSentence(['alpha', 'bravo']);

      for (const word of ['alpha', 'bravo']) {
        for (const char of word) {
          advance(msPerKey);
          localTarget.dispatchEvent(new KeyboardEvent('keydown', { key: char, cancelable: true }));
        }
        localTarget.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }));
      }

      engine.detach();
      // Second word only — the first has no previous word to measure tempo from.
      const attacks = local.filter((e) => e.type === 'attack');
      return attacks[1]!.damage;
    };

    clock = 0;
    const fast = damageAt(60);
    clock = 0;
    const slow = damageAt(400);

    expect(fast).toBeGreaterThan(slow);
  });

  it('rewards longer words with more damage', () => {
    input.pushSentence(['at', 'extraordinary']);

    typeWord('at');
    typeWord('extraordinary');

    const attacks = events.filter((e) => e.type === 'attack');
    expect(attacks[1]!.damage).toBeGreaterThan(attacks[0]!.damage);
  });

  it('charges and fires an Ultimate through pure typing', () => {
    const words = Array.from({ length: 40 }, () => 'combat');
    input.pushSentence(words);

    for (const word of words) {
      if (isTerminal(match)) break;
      typeWord(word, 80);
    }

    expect(events.some((e) => e.type === 'ultimate-ready')).toBe(true);
    expect(events.some((e) => e.type === 'ultimate')).toBe(true);
    expect(self().ultimatesUsed).toBeGreaterThan(0);
  });

  it('reaches a knockout by typing alone', () => {
    const words = Array.from({ length: 200 }, () => 'devastating');
    input.pushSentence(words);

    for (const word of words) {
      if (isTerminal(match)) break;
      typeWord(word, 70);
    }

    expect(isTerminal(match)).toBe(true);
    expect(match.winnerId).toBe(ME);
    expect(opponent().hp).toBe(0);
    expect(events.some((e) => e.type === 'knockout')).toBe(true);
  });

  /**
   * Guards the §0 acceptance test: a spectator who cannot see the text must be
   * able to follow the fight. That only works if the event stream is rich —
   * if a match produced nothing but undifferentiated 'attack' events there
   * would be nothing to watch.
   */
  it('produces a varied event stream, not just undifferentiated hits', () => {
    const words = ['go', 'strike', 'devastating', 'hit', 'combination', 'blow', 'overwhelming'];
    input.pushSentence([...words, ...words, ...words, ...words]);

    for (const word of [...words, ...words, ...words, ...words]) {
      if (isTerminal(match)) break;
      typeWord(word, 90);
    }

    const kinds = new Set(events.map((e) => e.type));
    expect(kinds.has('attack')).toBe(true);
    expect(kinds.has('combo-tier')).toBe(true);

    const attackKinds = new Set(
      events.filter((e) => e.type === 'attack').map((e) => (e as { kind: string }).kind),
    );
    // Short words punch, long words summon something bigger.
    expect(attackKinds.size).toBeGreaterThan(1);
  });
});
