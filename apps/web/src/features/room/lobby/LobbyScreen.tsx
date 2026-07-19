import type { CharacterId, PlayerId, RoomState, ChatMessage } from '@wordwars/shared';
import { roomManager } from '@/net/RoomManager';
import { Button } from '@/ui/Button';
import { Panel } from '@/ui/Panel';
import { InviteLink } from '../InviteLink';
import { ArenaBanner } from './ArenaBanner';
import { CharacterPicker } from './CharacterPicker';
import { LobbyChat } from './LobbyChat';
import { EmptySlot, PlayerCard } from './PlayerCard';

/**
 * The lobby.
 *
 * Laid out as a versus screen rather than a settings form: arena on top,
 * fighters facing each other, roster below. Someone glancing at this should
 * see a fight about to happen, not a configuration page.
 */
export function LobbyScreen({
  room,
  messages,
  selfId,
  onLeave,
}: {
  room: RoomState;
  messages: readonly ChatMessage[];
  selfId: PlayerId | null;
  onLeave: () => void;
}) {
  const players = room.members.filter((m) => !m.isSpectator);
  const spectators = room.members.filter((m) => m.isSpectator);

  const self = room.members.find((m) => m.playerId === selfId) ?? null;
  const isHost = self?.isHost ?? false;
  const isSpectator = self?.isSpectator ?? false;

  const [left, right] = [players[0] ?? null, players[1] ?? null];

  const everyoneReady = players.length >= 2 && players.every((m) => m.isReady);

  return (
    <div className="w-full max-w-5xl space-y-5">
      <ArenaBanner arenaId={room.settings.arenaId} />

      {/* The standoff */}
      <div className="flex items-stretch gap-3 sm:gap-5">
        {left ? (
          <PlayerCard
            member={left}
            side="p1"
            isYou={left.playerId === selfId}
            canKick={isHost && left.playerId !== selfId}
            onKick={() => roomManager.kick(left.playerId)}
          />
        ) : (
          <EmptySlot side="p1" />
        )}

        <div className="flex shrink-0 items-center">
          <span className="font-display text-2xl font-700 italic text-ink sm:text-4xl">VS</span>
        </div>

        {right ? (
          <PlayerCard
            member={right}
            side="p2"
            isYou={right.playerId === selfId}
            canKick={isHost && right.playerId !== selfId}
            onKick={() => roomManager.kick(right.playerId)}
          />
        ) : (
          <EmptySlot side="p2" />
        )}
      </div>

      {/* Only shown while a seat is empty — once the room is full, the code is
          clutter and the invite is done doing its job. */}
      {players.length < room.settings.maxPlayers && (
        <Panel className="p-6">
          <InviteLink code={room.code} />
        </Panel>
      )}

      <Panel className="p-6">
        <CharacterPicker
          selected={self?.characterId ?? 'ninja'}
          onSelect={(id: CharacterId) => roomManager.selectCharacter(id)}
          disabled={isSpectator || room.phase !== 'lobby'}
        />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Panel className="flex flex-col justify-between gap-5 p-6">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Detail label="Rounds" value={`Best of ${room.settings.roundCount}`} />
            <Detail label="Difficulty" value={room.settings.difficulty} />
            <Detail label="Ultimates" value={room.settings.enableUltimate ? 'On' : 'Off'} />
            <Detail label="Criticals" value={room.settings.enableCrits ? 'On' : 'Off'} />
          </div>

          {spectators.length > 0 && (
            <p className="text-xs text-ink-faint">
              Watching: {spectators.map((s) => s.nickname).join(', ')}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onLeave}>
              Leave
            </Button>

            {!isSpectator && (
              <Button
                variant={self?.isReady ? 'secondary' : 'primary'}
                onClick={() => roomManager.setReady(!self?.isReady)}
              >
                {self?.isReady ? 'Not ready' : 'Ready'}
              </Button>
            )}

            {isHost && (
              <Button
                variant="primary"
                disabled
                title="Starting a match arrives with the countdown in step 2.6"
                className="ml-auto"
              >
                {everyoneReady ? 'Start Match' : 'Waiting for players'}
              </Button>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <LobbyChat
            messages={messages}
            selfId={selfId}
            onSend={(text) => roomManager.sendChat(text)}
          />
        </Panel>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-[0.6rem] uppercase tracking-[0.2em] text-ink-faint">
        {label}
      </div>
      <div className="mt-1 capitalize text-ink">{value}</div>
    </div>
  );
}
