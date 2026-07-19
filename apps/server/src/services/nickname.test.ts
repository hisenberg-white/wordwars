import { describe, expect, it } from 'vitest';
import { NICKNAME_MAX, validateNickname } from '@wordwars/shared';
import { NICKNAME_COMBINATIONS, generateNickname } from './nickname.js';

describe('generateNickname', () => {
  /**
   * A generated name that the server's own validator would reject is a bug
   * that only shows up when a player tries to keep their default name.
   */
  it('always produces a name that passes validation', () => {
    for (let i = 0; i < 500; i += 1) {
      const name = generateNickname();
      expect(validateNickname(name), `rejected: ${name}`).toBeNull();
      expect(name.length).toBeLessThanOrEqual(NICKNAME_MAX);
    }
  });

  it('draws from a large enough pool to feel varied', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) seen.add(generateNickname());

    // Not a uniqueness guarantee (names are deliberately not unique) — just a
    // check that the generator is not collapsing onto a handful of names.
    expect(seen.size).toBeGreaterThan(200);
    expect(NICKNAME_COMBINATIONS).toBeGreaterThan(1000);
  });
});

describe('validateNickname', () => {
  it.each(['RapidWolf', 'ab', 'A_1', 'Silent Fox', 'x'.repeat(NICKNAME_MAX)])(
    'accepts %s',
    (name) => {
      expect(validateNickname(name)).toBeNull();
    },
  );

  it('trims before measuring, so padding cannot smuggle in a short name', () => {
    expect(validateNickname('  a  ')).toBe('too-short');
    expect(validateNickname('  ok  ')).toBeNull();
  });

  it.each([
    ['a', 'too-short'],
    ['', 'too-short'],
    ['x'.repeat(NICKNAME_MAX + 1), 'too-long'],
    ['bad<script>', 'invalid-characters'],
    ['double  space', 'invalid-characters'],
    ['emoji🔥name', 'invalid-characters'],
  ])('rejects %s', (name, expected) => {
    expect(validateNickname(name)).toBe(expected);
  });

  /** Impersonation is the reason the reserved list exists. */
  it.each(['Admin', 'admin', 'ADMIN', 'A_d_m_i_n', 'Mod', 'WordWars', 'system'])(
    'rejects the reserved name %s regardless of casing or separators',
    (name) => {
      expect(validateNickname(name)).toBe('reserved');
    },
  );
});
