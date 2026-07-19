import type { PlayerId, RoomCode, RoomId } from '../ids.js';
import type { ArenaId, CharacterId } from './content.js';
import type { Difficulty, GameMode } from './match.js';

export const ROOM_PHASES = ['lobby', 'countdown', 'in-match', 'post-match'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

/** Host-controlled room settings (plan §"PRIVATE ROOM SETTINGS"). */
export interface RoomSettings {
  readonly mode: GameMode;
  readonly arenaId: ArenaId;
  readonly randomArena: boolean;
  readonly randomCharacter: boolean;
  readonly difficulty: Difficulty;
  readonly language: string;
  readonly roundCount: 1 | 3 | 5;
  readonly enableUltimate: boolean;
  readonly enableCrits: boolean;
  readonly isPublic: boolean;
  readonly hasPassword: boolean;
  readonly maxPlayers: number;
  readonly allowSpectators: boolean;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  mode: '1v1',
  arenaId: 'dojo',
  randomArena: false,
  randomCharacter: false,
  difficulty: 'normal',
  language: 'en',
  roundCount: 3,
  enableUltimate: true,
  enableCrits: true,
  isPublic: false,
  hasPassword: false,
  maxPlayers: 2,
  allowSpectators: true,
};

/** A player as the lobby sees them. */
export interface RoomMember {
  readonly playerId: PlayerId;
  readonly nickname: string;
  readonly characterId: CharacterId;
  readonly isGuest: boolean;
  readonly isHost: boolean;
  readonly isReady: boolean;
  readonly isSpectator: boolean;
  readonly level: number;
  /** Round-trip time in ms, refreshed periodically. Null until first sample. */
  readonly ping: number | null;
  readonly connected: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly playerId: PlayerId | null;
  readonly nickname: string;
  readonly text: string;
  readonly at: number;
  /** System messages ("X joined") render differently and have no author. */
  readonly system: boolean;
}

/** Full room snapshot. The server sends this whole object on any change. */
export interface RoomState {
  readonly roomId: RoomId;
  readonly code: RoomCode;
  readonly phase: RoomPhase;
  readonly hostId: PlayerId;
  readonly settings: RoomSettings;
  readonly members: readonly RoomMember[];
  readonly createdAt: number;
  /** Populated only during 'countdown'. Seconds remaining. */
  readonly countdown: number | null;
}
