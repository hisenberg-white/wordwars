import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ARENAS, type RoomState } from '@wordwars/shared';
import { roomManager } from '@/net/RoomManager';
import { useIdentity, useRoom } from '@/net/useConnection';
import { setAppPhase } from '@/store/appPhase';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { TopNav } from '@/features/landing/components/TopNav';
import { CountdownOverlay } from './CountdownOverlay';
import { LobbyScreen } from './lobby/LobbyScreen';

/**
 * A private room, reached directly by its shareable URL.
 *
 * The full lobby — character select, ready-up, chat, host settings — lands in
 * 2.5/2.6. What exists here is the part that makes the room usable at all:
 * arriving via a link, seeing who else is here, and being able to leave.
 */
export function RoomScreen() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { identity } = useIdentity();
  const { room, status, error, needsPassword, messages } = useRoom();

  const [password, setPassword] = useState('');
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    setAppPhase('lobby');
    return () => setAppPhase('menu');
  }, []);

  /**
   * Join on arrival.
   *
   * Waits for an identity first, so the roster never briefly shows the
   * provisional "Challenger" name. Guarded by a ref because React 19 StrictMode
   * runs effects twice in development, and a double join would be a wasted
   * round trip on every navigation.
   */
  useEffect(() => {
    if (!code || !identity) return;
    if (room?.code === code) return;
    if (attemptedRef.current === code) return;

    attemptedRef.current = code;
    void roomManager.join(code);
  }, [code, identity, room?.code]);

  const submitPassword = async () => {
    if (!code) return;
    const joined = await roomManager.join(code, password);
    if (!joined) setPassword('');
  };

  const leave = () => {
    roomManager.leave();
    navigate('/');
  };

  if (needsPassword) {
    return (
      <Shell>
        <Panel className="w-full max-w-md p-7 text-center">
          <PanelLabel className="text-ultimate">This room is locked</PanelLabel>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitPassword();
            }}
            placeholder="Room password"
            aria-label="Room password"
            className="mt-5 w-full border border-line bg-abyss px-4 py-3 text-center text-ink outline-none focus:border-p2"
          />
          <div className="mt-5 flex justify-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/room')}>
              Back
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submitPassword()}>
              Join
            </Button>
          </div>
        </Panel>
      </Shell>
    );
  }

  if (status === 'error' && !room) {
    return (
      <Shell>
        <Panel className="w-full max-w-md p-8 text-center">
          <p className="font-display text-2xl text-danger">Could not join</p>
          <p className="mt-3 text-sm text-ink-dim">
            {error === 'ROOM_NOT_FOUND'
              ? `No room with the code ${code}. It may have closed.`
              : 'Something went wrong joining that room.'}
          </p>
          <Button variant="secondary" className="mt-6" onClick={() => navigate('/room')}>
            Back to rooms
          </Button>
        </Panel>
      </Shell>
    );
  }

  if (!room) {
    return (
      <Shell>
        <p className="text-sm text-ink-dim">Joining room {code}…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      {room.countdownEndsAt !== null && <CountdownOverlay endsAt={room.countdownEndsAt} />}

      {room.phase === 'in-match' ? (
        <MatchPending room={room} />
      ) : (
        <LobbyScreen
          room={room}
          messages={messages}
          selfId={identity?.playerId ?? null}
          onLeave={leave}
        />
      )}
    </Shell>
  );
}

/**
 * Placeholder for the fight itself.
 *
 * The countdown reaches zero and the room legitimately enters `in-match` — the
 * server-side seam (`RealtimeContext.onMatchBegin`) is already firing. Step 3.3
 * replaces this screen with the actual arena.
 */
function MatchPending({ room }: { room: RoomState }) {
  return (
    <Panel className="max-w-lg p-8 text-center">
      <PanelLabel className="text-ultimate">Step 3 · Not built yet</PanelLabel>
      <h1 className="mt-4 text-3xl">The fight would start here</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-dim">
        Both fighters are in, the arena is {ARENAS[room.settings.arenaId].name}, and the countdown
        finished. The combat engine, typing input and arena render arrive in phase 3.
      </p>
    </Panel>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex flex-1 items-center justify-center px-6 py-16">{children}</main>
    </div>
  );
}
