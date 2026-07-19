import { z } from 'zod';
import { ARENA_IDS, CHARACTER_IDS } from '../domain/content.js';
import { DIFFICULTIES, GAME_MODES } from '../domain/match.js';
import { NICKNAME_MAX, NICKNAME_MIN, NICKNAME_PATTERN } from '../domain/player.js';

/**
 * Inbound payload schemas.
 *
 * Every client→server payload is parsed through one of these before a handler
 * touches it. The server treats anything arriving on a socket as hostile until
 * it has passed through here — this file is the trust boundary.
 *
 * Types are derived from the schemas rather than declared alongside them, so
 * the runtime check and the compile-time type can never drift apart.
 */

const nickname = z
  .string()
  .trim()
  .min(NICKNAME_MIN)
  .max(NICKNAME_MAX)
  .regex(NICKNAME_PATTERN, 'Letters, numbers and underscores only');

const characterId = z.enum(CHARACTER_IDS);
const arenaId = z.enum(ARENA_IDS);
const difficulty = z.enum(DIFFICULTIES);
const gameMode = z.enum(GAME_MODES);
const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, 'Room codes are 6 characters');

export const guestInitSchema = z.object({
  nickname: nickname.optional(),
  /** Reclaim a previous identity after a refresh. */
  token: z.string().max(512).optional(),
  /**
   * An account session token, when the player is signed in.
   *
   * Identity is established through ONE event whether or not somebody has an
   * account, so there is a single path to get right rather than two that can
   * disagree about who this socket is.
   */
  accountToken: z.string().max(512).optional(),
});

export const matchmakingJoinSchema = z.object({
  mode: gameMode,
  characterId,
});

export const roomCreateSchema = z.object({
  settings: z.object({
    mode: gameMode,
    arenaId,
    randomArena: z.boolean(),
    randomCharacter: z.boolean(),
    difficulty,
    language: z.string().min(2).max(8),
    roundCount: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    enableUltimate: z.boolean(),
    enableCrits: z.boolean(),
    isPublic: z.boolean(),
    maxPlayers: z.number().int().min(2).max(8),
    allowSpectators: z.boolean(),
  }),
  password: z.string().min(1).max(64).optional(),
});

export const roomJoinSchema = z.object({
  code: roomCode,
  password: z.string().max(64).optional(),
  asSpectator: z.boolean().optional(),
});

export const roomUpdateSchema = z.object({
  settings: roomCreateSchema.shape.settings.partial(),
  password: z.string().max(64).nullable().optional(),
});

export const roomSelectCharacterSchema = z.object({ characterId });

export const roomReadySchema = z.object({ ready: z.boolean() });

export const roomChatSchema = z.object({
  text: z.string().trim().min(1).max(200),
});

export const roomKickSchema = z.object({
  playerId: z.string().min(1).max(64),
});

/**
 * A committed word. The heart of the protocol.
 *
 * `timings` are inter-key deltas in ms, not absolute timestamps — absolute
 * client clocks are meaningless to us and leak nothing useful. The server uses
 * them only for the tempo bonus (clamped) and for cheat heuristics (plan §4.3).
 *
 * The array is capped because a malicious client could otherwise send a
 * multi-megabyte timing array and make us do the work of parsing it.
 */
export const matchWordSchema = z.object({
  matchId: z.string().min(1).max(64),
  wordIndex: z.number().int().nonnegative().max(100_000),
  /** True if the player mistyped anywhere in this word, even if repaired. */
  dirty: z.boolean(),
  timings: z.array(z.number().nonnegative().max(60_000)).max(64),
});

export const matchHeartbeatSchema = z.object({
  clientTime: z.number(),
});

export type GuestInitPayload = z.infer<typeof guestInitSchema>;
export type MatchmakingJoinPayload = z.infer<typeof matchmakingJoinSchema>;
export type RoomCreatePayload = z.infer<typeof roomCreateSchema>;
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;
export type RoomUpdatePayload = z.infer<typeof roomUpdateSchema>;
export type RoomSelectCharacterPayload = z.infer<typeof roomSelectCharacterSchema>;
export type RoomReadyPayload = z.infer<typeof roomReadySchema>;
export type RoomChatPayload = z.infer<typeof roomChatSchema>;
export type RoomKickPayload = z.infer<typeof roomKickSchema>;
export type MatchWordPayload = z.infer<typeof matchWordSchema>;
export type MatchHeartbeatPayload = z.infer<typeof matchHeartbeatSchema>;
