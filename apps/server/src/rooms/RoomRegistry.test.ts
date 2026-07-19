import { describe, expect, it } from 'vitest';
import { asPlayerId, type CharacterId, type PlayerIdentity } from '@wordwars/shared';
import { RoomRegistry } from './RoomRegistry.js';
import { isPlausibleRoomCode, ROOM_CODE_LENGTH, generateRoomCode } from './roomCode.js';

const player = (name: string): PlayerIdentity => ({
  playerId: asPlayerId(name),
  nickname: name,
  isGuest: true,
  level: 1,
  avatarUrl: null,
  countryCode: null,
});

const NINJA = 'ninja' as CharacterId;

describe('room codes', () => {
  it('generates codes of the expected shape', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isPlausibleRoomCode(code)).toBe(true);
    }
  });

  /**
   * The whole point of the restricted alphabet: a code read aloud or copied
   * from a screenshot must not be ambiguous.
   */
  it('never emits a look-alike character', () => {
    const banned = /[ILOS0158]/;
    for (let i = 0; i < 500; i += 1) {
      expect(generateRoomCode()).not.toMatch(banned);
    }
  });
});

describe('RoomRegistry', () => {
  it('creates a room discoverable by id and by code', () => {
    const rooms = new RoomRegistry();
    const room = rooms.create();

    expect(rooms.get(room.id)).toBe(room);
    expect(rooms.getByCode(room.code)).toBe(room);
    expect(rooms.size).toBe(1);
  });

  it('makes the first member the host', () => {
    const rooms = new RoomRegistry();
    const room = rooms.create();

    rooms.addMember(room, player('alice'), NINJA);
    rooms.addMember(room, player('bob'), NINJA);

    expect(room.hostId).toBe(asPlayerId('alice'));

    const state = rooms.toState(room);
    expect(state.members.find((m) => m.isHost)?.nickname).toBe('alice');
    expect(state.members).toHaveLength(2);
  });

  it('transfers host to the longest-present member when the host leaves', () => {
    const rooms = new RoomRegistry();
    const room = rooms.create();

    rooms.addMember(room, player('alice'), NINJA);
    rooms.addMember(room, player('bob'), NINJA);
    rooms.addMember(room, player('carol'), NINJA);

    const remaining = rooms.removeMember(room, asPlayerId('alice'));

    expect(remaining).not.toBeNull();
    expect(remaining?.hostId).toBe(asPlayerId('bob'));
  });

  /** A room nobody is in should not linger and hold its code hostage. */
  it('destroys itself when the last member leaves', () => {
    const rooms = new RoomRegistry();
    const room = rooms.create();
    const { code, id } = room;

    rooms.addMember(room, player('alice'), NINJA);
    const remaining = rooms.removeMember(room, asPlayerId('alice'));

    expect(remaining).toBeNull();
    expect(rooms.get(id)).toBeNull();
    expect(rooms.getByCode(code)).toBeNull();
    expect(rooms.size).toBe(0);
  });

  it('issues distinct codes to concurrent rooms', () => {
    const rooms = new RoomRegistry();
    const codes = new Set<string>();

    for (let i = 0; i < 300; i += 1) codes.add(rooms.create().code);

    expect(codes.size).toBe(300);
  });

  it('reports whether a password is set without exposing the hash', () => {
    const rooms = new RoomRegistry();

    const open = rooms.create();
    const locked = rooms.create({ passwordHash: 'not-the-real-hash' });

    expect(rooms.toState(open).settings.hasPassword).toBe(false);
    expect(rooms.toState(locked).settings.hasPassword).toBe(true);
    expect(JSON.stringify(rooms.toState(locked))).not.toContain('not-the-real-hash');
  });

  it('orders members by join time so the roster does not jump around', () => {
    const rooms = new RoomRegistry();
    const room = rooms.create();

    rooms.addMember(room, player('first'), NINJA);
    rooms.addMember(room, player('second'), NINJA);

    expect(rooms.toState(room).members.map((m) => m.nickname)).toEqual(['first', 'second']);
  });

  it('counts players across all rooms', () => {
    const rooms = new RoomRegistry();
    const a = rooms.create();
    const b = rooms.create();

    rooms.addMember(a, player('alice'), NINJA);
    rooms.addMember(a, player('bob'), NINJA);
    rooms.addMember(b, player('carol'), NINJA);

    expect(rooms.playerCount).toBe(3);
  });
});
