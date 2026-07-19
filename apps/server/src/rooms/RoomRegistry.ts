import {
  DEFAULT_ROOM_SETTINGS,
  type CharacterId,
  type PlayerId,
  type PlayerIdentity,
  type RoomCode,
  type RoomId,
  type RoomMember,
  type RoomPhase,
  type RoomSettings,
  type RoomState,
  asRoomId,
} from '@wordwars/shared';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';
import { generateRoomCode } from './roomCode.js';

/**
 * A live room.
 *
 * Mutable server-side state. `toState()` produces the immutable snapshot the
 * client sees — the wire type and the internal type are deliberately different
 * so internals (password hashes, timers) can never leak by being added to a
 * shared interface.
 */
export interface LiveRoom {
  readonly id: RoomId;
  readonly code: RoomCode;
  readonly createdAt: number;
  phase: RoomPhase;
  hostId: PlayerId;
  settings: RoomSettings;
  members: Map<PlayerId, RoomMemberRecord>;
  passwordHash: string | null;
  /** Absolute server time the fight begins; null unless counting down. */
  countdownEndsAt: number | null;
  /** Held so a countdown can be aborted if the room stops being startable. */
  countdownTimer: ReturnType<typeof setTimeout> | null;
  /** Matchmade rooms are transient and skip the lobby entirely. */
  readonly isQuickMatch: boolean;
}

export interface RoomMemberRecord {
  identity: PlayerIdentity;
  characterId: CharacterId;
  isReady: boolean;
  isSpectator: boolean;
  connected: boolean;
  ping: number | null;
  joinedAt: number;
}

/** Ping must move by at least this much before it is worth a broadcast. */
const PING_BROADCAST_THRESHOLD_MS = 25;

export interface CreateRoomOptions {
  readonly settings?: Partial<RoomSettings>;
  readonly passwordHash?: string | null;
  readonly isQuickMatch?: boolean;
}

/**
 * In-memory room registry.
 *
 * SCALING SEAM: rooms live in this process, which is correct for match state
 * (plan §1.1 D2) but means a room is only discoverable on the process that owns
 * it. Going multi-process requires a Redis index of code → owning process, with
 * the socket adapter routing joins. That is a change behind this class, not
 * across the codebase — every caller goes through `RoomRegistry`, so the
 * migration has exactly one surface. Deliberately not built yet: it is
 * unnecessary below several thousand concurrent players and would be
 * speculative complexity today.
 */
export class RoomRegistry {
  private readonly rooms = new Map<RoomId, LiveRoom>();
  private readonly byCode = new Map<RoomCode, RoomId>();

  create(options: CreateRoomOptions = {}): LiveRoom {
    const id = asRoomId(randomUUID());
    const code = this.uniqueCode();

    const room: LiveRoom = {
      id,
      code,
      createdAt: Date.now(),
      phase: 'lobby',
      // Reassigned as soon as the first member joins; a room is never hostless
      // for longer than that.
      hostId: '' as PlayerId,
      settings: { ...DEFAULT_ROOM_SETTINGS, ...options.settings },
      members: new Map(),
      passwordHash: options.passwordHash ?? null,
      countdownEndsAt: null,
      countdownTimer: null,
      isQuickMatch: options.isQuickMatch ?? false,
    };

    this.rooms.set(id, room);
    this.byCode.set(code, id);

    return room;
  }

  private uniqueCode(): RoomCode {
    // Collisions are astronomically unlikely, but "astronomically unlikely"
    // becomes "happens daily" at scale, and a duplicate code would silently
    // send someone into a stranger's room.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = generateRoomCode();
      if (!this.byCode.has(code)) return code;
    }
    throw new Error('Exhausted room code attempts');
  }

  get(id: RoomId): LiveRoom | null {
    return this.rooms.get(id) ?? null;
  }

  getByCode(code: RoomCode): LiveRoom | null {
    const id = this.byCode.get(code);
    return id ? (this.rooms.get(id) ?? null) : null;
  }

  addMember(
    room: LiveRoom,
    identity: PlayerIdentity,
    characterId: CharacterId,
    isSpectator = false,
  ): void {
    room.members.set(identity.playerId, {
      identity,
      characterId,
      isReady: false,
      isSpectator,
      connected: true,
      ping: null,
      joinedAt: Date.now(),
    });

    if (!room.hostId || !room.members.has(room.hostId)) {
      room.hostId = identity.playerId;
    }
  }

  /**
   * Removes a member, transferring host and destroying the room if it empties.
   *
   * Returns the room if it still exists, so callers can broadcast the update
   * without re-fetching and without risking a broadcast to a destroyed room.
   */
  removeMember(room: LiveRoom, playerId: PlayerId): LiveRoom | null {
    room.members.delete(playerId);

    if (room.members.size === 0) {
      this.destroy(room);
      return null;
    }

    // Host left: hand it to whoever has been here longest. Arbitrary but
    // stable — everyone sees the same new host without a negotiation round.
    if (room.hostId === playerId) {
      const next = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) room.hostId = next.identity.playerId;
    }

    return room;
  }

  setCharacter(room: LiveRoom, playerId: PlayerId, characterId: CharacterId): boolean {
    const member = room.members.get(playerId);
    if (!member || member.characterId === characterId) return false;

    member.characterId = characterId;
    return true;
  }

  setReady(room: LiveRoom, playerId: PlayerId, ready: boolean): boolean {
    const member = room.members.get(playerId);
    // Spectators have nothing to be ready for, and letting them toggle it
    // would block a start that is otherwise good to go.
    if (!member || member.isSpectator || member.isReady === ready) return false;

    member.isReady = ready;
    return true;
  }

  /**
   * Records a ping sample.
   *
   * Returns true only when the change is large enough to be worth telling
   * everyone about. Pings jitter by a few ms constantly; broadcasting every
   * sample would push a full room snapshot to every client several times a
   * second to move a number nobody is watching that closely.
   */
  setPing(room: LiveRoom, playerId: PlayerId, ping: number): boolean {
    const member = room.members.get(playerId);
    if (!member) return false;

    const previous = member.ping;
    member.ping = ping;

    return previous === null || Math.abs(previous - ping) >= PING_BROADCAST_THRESHOLD_MS;
  }

  /** True when the room could legally start a match right now. */
  canStart(room: LiveRoom): boolean {
    const players = [...room.members.values()].filter((m) => !m.isSpectator);
    return players.length >= 2 && players.every((m) => m.isReady && m.connected);
  }

  destroy(room: LiveRoom): void {
    // A pending timer would fire against a room nobody is in and keep the
    // object alive until it did.
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    room.countdownTimer = null;

    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    logger.debug({ roomId: room.id, code: room.code }, 'Room destroyed');
  }

  /** Snapshot for the wire. */
  toState(room: LiveRoom): RoomState {
    const members: RoomMember[] = [...room.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({
        playerId: m.identity.playerId,
        nickname: m.identity.nickname,
        characterId: m.characterId,
        isGuest: m.identity.isGuest,
        isHost: m.identity.playerId === room.hostId,
        isReady: m.isReady,
        isSpectator: m.isSpectator,
        level: m.identity.level,
        ping: m.ping,
        connected: m.connected,
      }));

    return {
      roomId: room.id,
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      settings: { ...room.settings, hasPassword: room.passwordHash !== null },
      members,
      createdAt: room.createdAt,
      countdownEndsAt: room.countdownEndsAt,
    };
  }

  /**
   * Stops a countdown and returns the room to the lobby.
   *
   * Called whenever the room stops being startable mid-countdown — someone
   * leaves, disconnects, or un-readies. Starting a fight against an opponent
   * who walked away three seconds ago would be worse than the interruption.
   */
  abortCountdown(room: LiveRoom): boolean {
    if (room.phase !== 'countdown') return false;

    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
    room.countdownEndsAt = null;
    room.phase = 'lobby';
    return true;
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Active players across all rooms — surfaced on the landing page. */
  get playerCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.members.size;
    return total;
  }
}
