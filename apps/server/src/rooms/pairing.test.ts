import { describe, expect, it } from 'vitest';
import { RoomRegistry } from './RoomRegistry.js';
import type { PlayerIdentity } from '@wordwars/shared';
import { asPlayerId } from '@wordwars/shared';

/**
 * The two predicates that decide whether a quick match can proceed.
 *
 * Both were involved in a bug that lost real players their match: one client
 * re-queued during the "opponent found" reveal, the server obeyed it, and the
 * opponent was left alone in a fight while the re-queuer searched forever.
 */

const identity = (name: string): PlayerIdentity => ({
  playerId: asPlayerId(name),
  nickname: name,
  isGuest: true,
  level: 1,
  avatarUrl: null,
  countryCode: null,
});

function quickMatchRoom() {
  const rooms = new RoomRegistry();
  const room = rooms.create({ isQuickMatch: true, settings: { mode: '1v1', isPublic: true } });

  rooms.addMember(room, identity('a'), 'ninja');
  rooms.addMember(room, identity('b'), 'samurai');

  return { rooms, room };
}

describe('hasOpponent vs canStart', () => {
  /**
   * **This distinction is why quick match works at all.**
   *
   * `canStart` also requires everyone to have pressed ready, and quick match
   * skips ready-up entirely — both players committed by pressing Play Now. So
   * `canStart` is permanently false for a paired room, and gating the
   * countdown on it means no quick match ever begins. A fix using the wrong
   * one of these looked correct and silently broke every quick match.
   */
  it('reports an opponent even though nobody pressed ready', () => {
    const { rooms, room } = quickMatchRoom();

    expect(rooms.canStart(room)).toBe(false);
    expect(rooms.hasOpponent(room)).toBe(true);
  });

  it('reports no opponent once a player leaves', () => {
    const { rooms, room } = quickMatchRoom();
    const remaining = rooms.removeMember(room, asPlayerId('b'));

    expect(remaining).not.toBeNull();
    expect(rooms.hasOpponent(remaining!)).toBe(false);
  });

  /** A disconnected player cannot fight, even though their seat remains. */
  it('reports no opponent while one is disconnected', () => {
    const { rooms, room } = quickMatchRoom();
    rooms.setConnected(room, asPlayerId('b'), false);

    expect(rooms.hasOpponent(room)).toBe(false);
  });

  it('still requires two fighters', () => {
    const rooms = new RoomRegistry();
    const room = rooms.create({ isQuickMatch: true, settings: { mode: '1v1', isPublic: true } });
    rooms.addMember(room, identity('a'), 'ninja');

    expect(rooms.hasOpponent(room)).toBe(false);
  });
});
