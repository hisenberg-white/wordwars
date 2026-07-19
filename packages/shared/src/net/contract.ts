import type { MatchId, PlayerId } from '../ids.js';
import type { PlayerIdentity, SessionToken } from '../domain/player.js';
import type { RoomState } from '../domain/room.js';
import type {
  MatchConfig,
  MatchEventBatch,
  MatchFighter,
  MatchResult,
  MatchSnapshot,
  Sentence,
} from '../domain/match.js';
import type { ChatMessage } from '../domain/room.js';
import type { Ack, SocketError } from './errors.js';
import type {
  GuestInitPayload,
  MatchHeartbeatPayload,
  FriendChallengePayload,
  MatchWordPayload,
  MatchmakingJoinPayload,
  RoomChatPayload,
  RoomCreatePayload,
  RoomJoinPayload,
  RoomKickPayload,
  RoomReadyPayload,
  RoomSelectCharacterPayload,
  RoomUpdatePayload,
} from './payloads.js';

/**
 * The socket contract.
 *
 * Both `socket.io` and `socket.io-client` are generic over these two maps, so
 * emitting an unknown event or a wrong payload is a compile error on BOTH
 * ends. This is the single highest-leverage type in the project: a mismatch
 * here would otherwise surface as a silent no-op in production.
 */

export interface ClientToServerEvents {
  'guest:init': (p: GuestInitPayload, ack: (r: Ack<GuestInitResult>) => void) => void;

  'mm:join': (p: MatchmakingJoinPayload, ack: (r: Ack<{ queuedAt: number }>) => void) => void;
  'mm:leave': (ack: (r: Ack) => void) => void;

  'room:create': (p: RoomCreatePayload, ack: (r: Ack<RoomState>) => void) => void;
  'room:join': (p: RoomJoinPayload, ack: (r: Ack<RoomState>) => void) => void;
  'room:leave': (ack: (r: Ack) => void) => void;
  'room:update': (p: RoomUpdatePayload, ack: (r: Ack<RoomState>) => void) => void;
  'room:character': (p: RoomSelectCharacterPayload, ack: (r: Ack<RoomState>) => void) => void;
  'room:ready': (p: RoomReadyPayload, ack: (r: Ack<RoomState>) => void) => void;
  'room:chat': (p: RoomChatPayload, ack: (r: Ack) => void) => void;
  'room:kick': (p: RoomKickPayload, ack: (r: Ack<RoomState>) => void) => void;
  'room:start': (ack: (r: Ack) => void) => void;

  'match:word': (p: MatchWordPayload) => void;
  'match:heartbeat': (
    p: MatchHeartbeatPayload,
    ack: (r: Ack<{ serverTime: number }>) => void,
  ) => void;
  /**
   * Challenges a friend to a private match.
   *
   * The whole reason a friends list exists in a fighting game. The server
   * creates the room and pushes an invite to every tab the friend has open —
   * asking them to copy a code out of a chat window would be a worse product.
   */
  'friend:challenge': (
    p: FriendChallengePayload,
    ack: (r: Ack<{ roomId: string; code: string }>) => void,
  ) => void;

  'match:rematch': (ack: (r: Ack) => void) => void;
  'match:forfeit': (ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'session:issued': (p: { identity: PlayerIdentity; token: SessionToken }) => void;

  'mm:searching': (p: { queuedAt: number; estimatedWaitMs: number }) => void;
  'mm:found': (p: { roomId: string; opponent: PlayerIdentity }) => void;
  'mm:cancelled': () => void;

  'room:state': (p: RoomState) => void;
  'room:chat': (p: ChatMessage) => void;
  'room:closed': (p: { reason: string }) => void;

  'match:start': (p: MatchStartPayload) => void;
  'match:sentence': (p: Sentence) => void;
  'match:events': (p: MatchEventBatch) => void;
  'match:state': (p: MatchSnapshot) => void;
  'match:end': (p: MatchResult) => void;

  /** A friend wants to fight. Carries the code so accepting is one click. */
  'friend:challenged': (p: {
    from: PlayerIdentity;
    roomId: string;
    code: string;
    expiresAt: number;
  }) => void;

  /** A player dropped; the match is paused pending their return (plan §7.3). */
  'match:paused': (p: { playerId: PlayerId; nickname: string; resumeDeadline: number }) => void;
  /**
   * Play continues.
   *
   * Carries EVERY sentence issued so far, not just the current one: a
   * reconnecting client has an empty input engine and needs the whole text to
   * rebuild its word indices. The sentences are regenerated from the match
   * seed, so the server stores none of it (see 3.3).
   */
  'match:resumed': (p: { snapshot: MatchSnapshot; sentences: readonly Sentence[] }) => void;

  error: (p: SocketError) => void;
}

/** Server-side per-socket data. Not transmitted; typed here so both ends agree. */
export interface SocketData {
  playerId: PlayerId;
  identity: PlayerIdentity;
  roomId: string | null;
  matchId: MatchId | null;
  /**
   * The signed-in account, if there is one.
   *
   * Null for guests, who remain first-class players — this only decides
   * whether a match result is ATTRIBUTED to durable stats, never whether it
   * can be played.
   */
  userId: string | null;
  /**
   * Last measured round-trip time, refreshed by `match:heartbeat`. Held server
   * side so the lobby can show every player's ping, not just your own — seeing
   * that your opponent is on 200ms explains a lot about how a match felt.
   */
  ping: number | null;
}

export interface GuestInitResult {
  readonly identity: PlayerIdentity;
  readonly token: SessionToken;
}

export interface MatchStartPayload {
  readonly config: MatchConfig;
  readonly fighters: readonly MatchFighter[];
  readonly firstSentence: Sentence;
  /** Server timestamp the countdown began, for clock-skew-tolerant sync. */
  readonly startsAt: number;
}

/** Inter-server events (Redis adapter). Empty for now; typed for symmetry. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}
