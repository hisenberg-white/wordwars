import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MatchFighter, MatchResult } from '@wordwars/shared';
import { connection } from '@/net/ConnectionManager';
import { roomManager } from '@/net/RoomManager';
import { useIdentity, useRoom } from '@/net/useConnection';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { cn } from '@/ui/cn';
import { AuthDialog } from '@/features/auth/AuthDialog';
import { useAuth } from '@/net/useConnection';
import { StatComparison } from './StatComparison';

interface ResultsScreenProps {
  readonly result: MatchResult;
  readonly fighters: readonly MatchFighter[];
}

const REASON_COPY: Record<MatchResult['reason'], string> = {
  knockout: 'by knockout',
  forfeit: 'by forfeit',
  disconnect: 'opponent disconnected',
  aborted: 'match abandoned',
};

/**
 * The payoff.
 *
 * Leads with the verdict at full size, then the numbers — a player wants to
 * know whether they won before they want to know their WPM. The rematch button
 * is the largest control on the screen because the best possible outcome of a
 * results screen is another match starting.
 */
export function ResultsScreen({ result, fighters }: ResultsScreenProps) {
  const navigate = useNavigate();
  const { identity } = useIdentity();
  const { room } = useRoom();
  const auth = useAuth();
  const [requested, setRequested] = useState(false);

  const selfId = identity?.playerId ?? null;
  const won = result.winnerId !== null && result.winnerId === selfId;
  const draw = result.winnerId === null;

  const left = fighters.find((f) => f.side === 'left');
  const right = fighters.find((f) => f.side === 'right');
  const leftResult = result.fighters.find((f) => f.playerId === left?.playerId);
  const rightResult = result.fighters.find((f) => f.playerId === right?.playerId);

  const opponentWantsRematch = room?.members.some(
    (m) => m.playerId !== selfId && !m.isSpectator && m.wantsRematch,
  );
  const opponentPresent = (room?.members.filter((m) => !m.isSpectator).length ?? 0) >= 2;

  // A rematch resets the room to 'lobby' and restarts the countdown, so the
  // room state itself is the signal that it was accepted.
  useEffect(() => {
    if (room?.phase === 'lobby' || room?.phase === 'countdown') setRequested(false);
  }, [room?.phase]);

  const requestRematch = () => {
    setRequested(true);
    connection.socket?.emit('match:rematch', () => {});
  };

  const leave = () => {
    roomManager.leave();
    navigate('/');
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-12">
      <div className="animate-rise text-center">
        <PanelLabel className={won ? 'text-ultimate' : 'text-ink-faint'}>
          {REASON_COPY[result.reason]}
        </PanelLabel>

        <h1
          className={cn(
            'mt-3 font-display text-6xl font-700 italic tracking-tight sm:text-8xl',
            draw ? 'text-ink' : won ? 'text-ultimate' : 'text-ink-dim',
          )}
          style={won ? { textShadow: '0 0 60px rgb(255 197 61 / 0.55)' } : undefined}
        >
          {draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT'}
        </h1>

        <p className="mt-3 text-sm text-ink-faint">{(result.durationMs / 1000).toFixed(1)}s</p>
      </div>

      {left && right && leftResult && rightResult && (
        <Panel className="animate-rise w-full max-w-2xl p-7" style={{ animationDelay: '120ms' }}>
          <div className="mb-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <FighterName
              nickname={left.nickname}
              side="p1"
              isWinner={result.winnerId === left.playerId}
              isSelf={left.playerId === selfId}
            />
            <span className="font-display text-xl font-700 italic text-ink-faint">VS</span>
            <FighterName
              nickname={right.nickname}
              side="p2"
              isWinner={result.winnerId === right.playerId}
              isSelf={right.playerId === selfId}
              alignRight
            />
          </div>

          <StatComparison left={leftResult} right={rightResult} />
        </Panel>
      )}

      <div
        className="animate-rise flex flex-col items-center gap-4"
        style={{ animationDelay: '240ms' }}
      >
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={requestRematch}
            disabled={requested || !opponentPresent}
          >
            {!opponentPresent
              ? 'Opponent left'
              : requested
                ? 'Waiting for opponent…'
                : opponentWantsRematch
                  ? 'Accept rematch'
                  : 'Rematch'}
          </Button>

          <Button variant="secondary" size="lg" onClick={leave}>
            Leave
          </Button>
        </div>

        {/* Their opponent asked first — say so, because "Rematch" and "someone
            is waiting for you" are different levels of urgency. */}
        {opponentWantsRematch && !requested && (
          <p className="text-sm text-ultimate">Your opponent wants to go again.</p>
        )}
      </div>

      {identity?.isGuest && auth.status !== 'signed-in' && <GuestPrompt />}
    </div>
  );
}

function FighterName({
  nickname,
  side,
  isWinner,
  isSelf,
  alignRight = false,
}: {
  nickname: string;
  side: 'p1' | 'p2';
  isWinner: boolean;
  isSelf: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', alignRight ? 'items-end' : 'items-start')}>
      <span
        className={cn(
          'font-display text-xl font-700',
          side === 'p1' ? 'text-p1' : 'text-p2',
          !isWinner && 'opacity-60',
        )}
      >
        {nickname}
      </span>
      <span className="font-display text-[0.55rem] uppercase tracking-[0.2em] text-ink-faint">
        {isWinner ? 'Winner' : isSelf ? 'You' : ''}
      </span>
    </div>
  );
}

/**
 * The account prompt.
 *
 * Shown only AFTER a match, never before or during — the promise is that
 * gameplay is never blocked behind a login (plan §"NO ACCOUNT REQUIRED"). It
 * is also deliberately small and dismissible-by-ignoring: a modal here would
 * stand between the player and the rematch button, which is the one thing we
 * most want them to press.
 */
function GuestPrompt() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <p className="animate-rise max-w-sm text-center text-xs leading-relaxed text-ink-faint">
        Playing as a guest — your stats vanish when you close the tab.{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-p2 underline underline-offset-2 transition-colors hover:text-p2-bright"
        >
          Create a free account
        </button>{' '}
        to keep them.
      </p>

      {open && <AuthDialog onClose={() => setOpen(false)} />}
    </>
  );
}
