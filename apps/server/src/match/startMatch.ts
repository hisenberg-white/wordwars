import { asRoomId, type PlayerId, type UserId } from '@wordwars/shared';
import { logger } from '../logger.js';
import type { LiveRoom } from '../rooms/RoomRegistry.js';
import type { RealtimeContext } from '../realtime/context.js';
import type { GameServer } from '../realtime/gateway.js';
import { ServerMatch, type MatchParticipant, type MatchSink } from './ServerMatch.js';
import { recordMatchResult } from './recordResult.js';
import { bots, findProfile } from './BotPlayer.js';

/**
 * Turns a room whose countdown has finished into a live match.
 *
 * This is the body of the `onMatchBegin` seam left open in step 2.6 — every
 * piece before it (pairing, lobby, settings, countdown) already worked and
 * needed no changes to support this.
 */
export function startMatchForRoom(
  io: GameServer,
  ctx: RealtimeContext,
  room: LiveRoom,
): ServerMatch | null {
  const players = [...room.members.values()].filter((m) => !m.isSpectator);

  if (players.length < 2) {
    logger.warn({ roomId: room.id }, 'Countdown finished without two players');
    return null;
  }

  const [a, b] = players as [(typeof players)[number], (typeof players)[number]];

  const participants: [MatchParticipant, MatchParticipant] = [toParticipant(a), toParticipant(b)];

  /**
   * Everything the match emits goes to the socket room, which already contains
   * both fighters and any spectators. The match itself never learns what a
   * socket is.
   */
  const sink: MatchSink = {
    events: (_matchId, batch) => io.to(room.id).emit('match:events', batch),
    snapshot: (_matchId, snapshot) => io.to(room.id).emit('match:state', snapshot),
    sentence: (_matchId, sentence) => io.to(room.id).emit('match:sentence', sentence),
    ended: (_matchId, result) => {
      // Broadcast FIRST. The results screen must appear the instant the fight
      // ends — nobody should wait on a database write to see who won.
      io.to(room.id).emit('match:end', result);

      void recordMatchResult(ctx.repos, result, accountsOf(io, room.id), nicknamesOf(participants));

      room.phase = 'post-match';
      io.to(room.id).emit('room:state', ctx.rooms.toState(room));

      const finished = ctx.matches.get(result.matchId);
      if (finished) ctx.matches.remove(finished);
    },
  };

  const match = new ServerMatch(
    {
      roomId: room.id,
      participants,
      arenaId: room.settings.arenaId,
      difficulty: room.settings.difficulty,
      language: room.settings.language,
      roundCount: room.settings.roundCount,
      enableUltimate: room.settings.enableUltimate,
      enableCrits: room.settings.enableCrits,
      isRanked: false,
    },
    sink,
  );

  ctx.matches.add(match, [a.identity.playerId, b.identity.playerId]);

  const { config, fighters, firstSentence } = match.start();

  // A practice room names its opponent; start driving it now that the fight
  // exists. Every other path is untouched.
  if (room.bot) {
    const profile = findProfile(room.bot.difficulty);
    if (profile) bots.add(match, room.bot.playerId, profile);
  }

  // Tag each socket with the match it belongs to, so `match:word` can find it
  // without a lookup by player.
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomId === room.id) socket.data.matchId = config.matchId;
  }

  io.to(room.id).emit('match:start', {
    config,
    fighters,
    firstSentence,
    startsAt: Date.now(),
  });

  return match;
}

/** playerId → userId for whoever in this room is signed in. */
function accountsOf(io: GameServer, roomId: string): Map<PlayerId, UserId> {
  const accounts = new Map<PlayerId, UserId>();

  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomId !== roomId || !socket.data.userId) continue;
    accounts.set(socket.data.playerId, socket.data.userId as UserId);
  }

  return accounts;
}

/** Names are copied in so history reads correctly after a rename. */
function nicknamesOf(participants: readonly MatchParticipant[]): Map<PlayerId, string> {
  return new Map(participants.map((p) => [p.playerId, p.nickname]));
}

function toParticipant(member: {
  identity: { playerId: string; nickname: string; isGuest: boolean; level: number };
  characterId: string;
}): MatchParticipant {
  return {
    playerId: member.identity.playerId as MatchParticipant['playerId'],
    nickname: member.identity.nickname,
    characterId: member.characterId,
    isGuest: member.identity.isGuest,
    level: member.identity.level,
  };
}

/** Cleans up if a room is destroyed while a match is running. */
export function stopMatchForRoom(ctx: RealtimeContext, roomId: string): void {
  const room = ctx.rooms.get(asRoomId(roomId));
  if (!room) return;

  for (const member of room.members.values()) {
    const match = ctx.matches.forPlayer(member.identity.playerId);
    if (match) ctx.matches.remove(match);
  }
}
