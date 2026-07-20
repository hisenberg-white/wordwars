import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { connection } from '@/net/ConnectionManager';
import { useIdentity, useRoom } from '@/net/useConnection';
import { CountdownOverlay } from '@/features/room/CountdownOverlay';
import { MatchScreen } from '@/features/match/MatchScreen';
import { TopNav } from '@/features/landing/components/TopNav';
import { setAppPhase } from '@/store/appPhase';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { cn } from '@/ui/cn';
import { useEscapeKey } from '@/ui/useEscapeKey';
import type { SoloStartPayload } from '@wordwars/shared';

/**
 * Practice against the computer.
 *
 * The answer to the most common state of a young game: nobody else is online.
 * Waiting in an empty queue is not a game, and a player who wants to measure
 * their own speed should not need a second human to volunteer.
 *
 * Deliberately NOT presented as the lesser option. It is the same arena, the
 * same combat and the same results screen — the only difference is who is on
 * the other side, and that is stated plainly rather than hidden.
 */

type DifficultyId = SoloStartPayload['difficulty'];

interface Difficulty {
  /** Typed from the wire contract, so the ladder cannot drift from the server. */
  readonly id: DifficultyId;
  readonly name: string;
  readonly wpm: number;
  readonly blurb: string;
}

/** Mirrors the server's ladder in `BotPlayer.ts`. */
const DIFFICULTIES: readonly Difficulty[] = [
  { id: 'rookie', name: 'Sparring Dummy', wpm: 35, blurb: 'Slow and clumsy. Somewhere to start.' },
  { id: 'fighter', name: 'Club Fighter', wpm: 55, blurb: 'A steady average typist.' },
  { id: 'veteran', name: 'Veteran', wpm: 80, blurb: 'Quick, and rarely slips.' },
  { id: 'champion', name: 'Champion', wpm: 105, blurb: 'You will have to earn this one.' },
];

export function PracticeScreen() {
  const navigate = useNavigate();
  const { identity } = useIdentity();
  const { room } = useRoom();

  // Escape returns to the menu — the only key this game can bind, since every
  // letter is combat input elsewhere in the app.
  useEscapeKey(() => void navigate('/'));

  const [starting, setStarting] = useState<DifficultyId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAppPhase('matchmaking');
    return () => setAppPhase('menu');
  }, []);

  // Same hand-off as quick match: once the room is fighting, the arena owns
  // the screen. `post-match` keeps the results up.
  if (room?.phase === 'in-match' || room?.phase === 'post-match') return <MatchScreen />;

  const start = (difficulty: DifficultyId) => {
    const socket = connection.socket;
    if (!socket || !identity) return;

    setStarting(difficulty);
    setError(null);

    socket
      .timeout(8_000)
      .emit('solo:start', { difficulty, characterId: 'ninja' }, (err, result) => {
        if (err) {
          setStarting(null);
          setError('The server did not respond.');
          return;
        }

        if (!result.ok) {
          setStarting(null);
          setError(result.error.detail ?? 'Could not start a practice match.');
        }
        // On success the room:state and countdown take over, exactly as they do
        // for a matchmade fight.
      });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />

      {room?.countdownEndsAt != null && <CountdownOverlay endsAt={room.countdownEndsAt} />}

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <Panel className="w-full max-w-2xl px-8 py-10">
          <PanelLabel className="text-p2">Practice</PanelLabel>

          <h1 className="mt-3 font-display text-2xl font-700 uppercase tracking-[0.15em] text-ink">
            Pick your opponent
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-ink-dim">
            A full match against the computer — same arena, same combat, same numbers at the end.
            Practice fights are not recorded, so nothing here touches the leaderboards.
          </p>

          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {DIFFICULTIES.map((difficulty) => (
              <button
                key={difficulty.id}
                type="button"
                disabled={starting !== null}
                onClick={() => start(difficulty.id)}
                className={cn(
                  'border px-4 py-4 text-left transition-colors ease-[var(--ease-snap)]',
                  starting === difficulty.id
                    ? 'border-p1/60 bg-p1/10'
                    : 'border-line/50 bg-abyss/40 hover:border-line-bright disabled:opacity-40',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-sm font-600 uppercase tracking-wide text-ink">
                    {difficulty.name}
                  </span>
                  <span className="shrink-0 text-[0.65rem] tabular-nums text-ink-faint">
                    ~{difficulty.wpm} wpm
                  </span>
                </div>
                <p className="mt-1 text-xs leading-snug text-ink-faint">{difficulty.blurb}</p>
              </button>
            ))}
          </div>

          {starting !== null && !error && (
            <p className="mt-5 text-center text-sm text-ink-dim">Preparing the arena…</p>
          )}

          {error && <p className="mt-5 text-center text-sm text-danger">{error}</p>}

          <div className="mt-6 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              Back
            </Button>
          </div>
        </Panel>
      </main>
    </div>
  );
}
