import { describe, expect, it, vi, afterEach } from 'vitest';
import { asPlayerId } from '@wordwars/shared';
import { issueGuestToken, verifyGuestToken } from './guestToken.js';

afterEach(() => vi.useRealTimers());

describe('guest tokens', () => {
  it('round-trips an issued token', () => {
    const { token, payload } = issueGuestToken('RapidWolf');
    const verified = verifyGuestToken(token);

    expect(verified).not.toBeNull();
    expect(verified?.nickname).toBe('RapidWolf');
    expect(verified?.playerId).toBe(payload.playerId);
  });

  it('preserves the player id across a reissue, so a rename is not a new player', () => {
    const first = issueGuestToken('RapidWolf');
    const second = issueGuestToken('SilentFox', first.payload.playerId);

    expect(second.payload.playerId).toBe(first.payload.playerId);
    expect(verifyGuestToken(second.token)?.nickname).toBe('SilentFox');
  });

  it('issues distinct ids to distinct guests', () => {
    const a = issueGuestToken('A_One');
    const b = issueGuestToken('B_Two');

    expect(a.payload.playerId).not.toBe(b.payload.playerId);
  });

  /**
   * The attack this whole design exists to stop: editing localStorage to
   * become someone else, or to claim a name the server would refuse.
   */
  it('rejects a payload tampered with after signing', () => {
    const { token } = issueGuestToken('RapidWolf');
    const [, signature] = token.split('.');

    const forged = Buffer.from(
      JSON.stringify({
        playerId: asPlayerId('victim-player-id'),
        nickname: 'Admin',
        expiresAt: Date.now() + 60_000,
      }),
      'utf8',
    ).toString('base64url');

    expect(verifyGuestToken(`${forged}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    // A signature of the right shape but wrong provenance.
    const { token } = issueGuestToken('RapidWolf');
    const [body] = token.split('.');
    const wrongSignature = Buffer.from('x'.repeat(43), 'utf8').toString('base64url');

    expect(verifyGuestToken(`${body}.${wrongSignature}`)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['no separator', 'abcdef'],
    ['too many parts', 'a.b.c'],
    ['empty signature', 'abc.'],
    ['non-base64 body', '!!!.###'],
  ])('rejects a malformed token (%s)', (_label, token) => {
    expect(verifyGuestToken(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const { token } = issueGuestToken('RapidWolf');
    expect(verifyGuestToken(token)).not.toBeNull();

    // Two years on — comfortably past any configured TTL.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);

    expect(verifyGuestToken(token)).toBeNull();
  });
});
