import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { matchmaking } from '@/net/MatchmakingManager';
import { useIdentity, useMatchmaking, useRoom } from '@/net/useConnection';
import { CountdownOverlay } from '@/features/room/CountdownOverlay';
import { MatchScreen } from '@/features/match/MatchScreen';
import { setAppPhase } from '@/store/appPhase';
import { Button } from '@/ui/Button';
import { Panel } from '@/ui/Panel';
import { TopNav } from '@/features/landing/components/TopNav';
import { SearchingPanel } from './SearchingPanel';
import { OpponentFound } from './OpponentFound';

/**
 * Quick match.
 *
 * Search starts automatically on arrival — the player already expressed intent
 * by clicking "Play Now", and making them press a second button to actually
 * search would be a pointless extra step between them and a fight.
 */
export function PlayScreen() {
  const navigate = useNavigate();
  const { identity } = useIdentity();
  const { status, queuedAt, estimatedWaitMs, opponent, error } = useMatchmaking();
  const { room } = useRoom();

  useEffect(() => {
    setAppPhase('matchmaking');
    return () => setAppPhase('menu');
  }, []);

  // Wait for an identity before queueing: joining as the provisional
  // "Challenger" would show the opponent a name that is about to change.
  useEffect(() => {
    if (identity && status === 'idle') {
      matchmaking.search('1v1', 'ninja');
    }
  }, [identity, status]);

  const cancel = () => {
    matchmaking.cancel();
    navigate('/');
  };

  // Quick match goes straight from the countdown into the arena, with no
  // lobby in between.
  if (room?.phase === 'in-match') return <MatchScreen />;

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />

      {/* Quick match skips the lobby: the server starts the count as soon as
          the "opponent found" reveal has had a beat to land. */}
      {room?.countdownEndsAt != null && <CountdownOverlay endsAt={room.countdownEndsAt} />}

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <Panel className="w-full max-w-2xl px-8 py-14">
          {status === 'found' && identity && opponent ? (
            <OpponentFound self={identity} opponent={opponent} />
          ) : status === 'error' ? (
            <div className="flex flex-col items-center gap-5 text-center">
              <p className="font-display text-2xl text-danger">Matchmaking failed</p>
              <p className="max-w-sm text-sm text-ink-dim">{error}</p>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => matchmaking.reset()}>
                  Try again
                </Button>
                <Button variant="ghost" onClick={() => navigate('/')}>
                  Back
                </Button>
              </div>
            </div>
          ) : queuedAt ? (
            <SearchingPanel
              queuedAt={queuedAt}
              estimatedWaitMs={estimatedWaitMs}
              onCancel={cancel}
            />
          ) : (
            <p className="text-center text-sm text-ink-dim">Connecting…</p>
          )}
        </Panel>
      </main>
    </div>
  );
}
