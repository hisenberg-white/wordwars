import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_ROOM_SETTINGS } from '@wordwars/shared';
import { roomManager } from '@/net/RoomManager';
import { useRoom } from '@/net/useConnection';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { TopNav } from '@/features/landing/components/TopNav';

const ERROR_COPY: Record<string, string> = {
  ROOM_NOT_FOUND: 'No room with that code. Check it and try again.',
  ROOM_FULL: 'That room is full.',
  ROOM_IN_PROGRESS: 'That match has already started.',
  WRONG_PASSWORD: 'Wrong password.',
  INTERNAL: 'Could not reach the server.',
};

/**
 * The private-room entry point: create one, or join with a code.
 *
 * Both options sit side by side rather than behind a toggle. A player arriving
 * here is in one of two completely different situations — hosting or invited —
 * and making either of them click a tab first is a step that buys nothing.
 */
export function RoomEntryScreen() {
  const navigate = useNavigate();
  const { status, error } = useRoom();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const room = await roomManager.create(DEFAULT_ROOM_SETTINGS);
    setBusy(false);
    if (room) navigate(`/room/${room.code}`);
  };

  const join = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) return;

    setBusy(true);
    const room = await roomManager.join(trimmed);
    setBusy(false);
    if (room) navigate(`/room/${room.code}`);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="grid w-full max-w-3xl gap-5 md:grid-cols-2">
          <Panel side="p1" className="flex flex-col p-7">
            <PanelLabel className="text-p1">Host</PanelLabel>
            <h2 className="mt-3 text-2xl">Create a room</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-dim">
              You pick the arena, the rules and the round count. Share the code and fight whoever
              shows up.
            </p>
            <Button
              variant="primary"
              onClick={() => void create()}
              disabled={busy}
              fullWidth
              className="mt-6"
            >
              {busy && status === 'joining' ? 'Creating…' : 'Create Room'}
            </Button>
          </Panel>

          <Panel side="p2" className="flex flex-col p-7">
            <PanelLabel className="text-p2">Invited</PanelLabel>
            <h2 className="mt-3 text-2xl">Join a room</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Enter the six-character code your friend sent you.
            </p>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void join();
              }}
              placeholder="ABC234"
              maxLength={6}
              aria-label="Room code"
              className="mt-5 w-full border border-line bg-abyss px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-ink outline-none transition-colors placeholder:text-ink-faint/50 focus:border-p2"
            />

            <span className="mt-2 h-5 text-xs text-danger">
              {error ? (ERROR_COPY[error] ?? 'Could not join that room.') : ''}
            </span>

            <Button
              variant="secondary"
              onClick={() => void join()}
              disabled={busy || code.trim().length !== 6}
              fullWidth
              className="mt-auto"
            >
              Join Room
            </Button>
          </Panel>
        </div>
      </main>
    </div>
  );
}
