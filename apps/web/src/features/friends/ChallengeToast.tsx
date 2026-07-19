import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { Panel } from '@/ui/Panel';
import { connection } from '@/net/ConnectionManager';

/**
 * "X wants to fight."
 *
 * Rendered app-wide rather than on the friends screen, because a challenge is
 * worthless if it only arrives when you happen to be looking at the right page.
 * This is the half of the feature that makes a friends list more than an
 * address book.
 */

interface Challenge {
  from: { nickname: string };
  code: string;
  expiresAt: number;
}

export function ChallengeToast() {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const socket = connection.socket;
    if (!socket) return;

    const onChallenged = (invite: Challenge) => setChallenge(invite);
    socket.on('friend:challenged', onChallenged);
    return () => {
      socket.off('friend:challenged', onChallenged);
    };
  }, []);

  /*
   * A challenge expires on its own.
   *
   * An invite that sits on screen indefinitely eventually drops you into a room
   * the challenger abandoned ten minutes ago — worse than never having seen it.
   */
  useEffect(() => {
    if (!challenge) return;

    const remaining = challenge.expiresAt - Date.now();
    if (remaining <= 0) {
      setChallenge(null);
      return;
    }

    const timer = setTimeout(() => setChallenge(null), remaining);
    return () => clearTimeout(timer);
  }, [challenge]);

  if (!challenge) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <Panel className="pointer-events-auto flex items-center gap-4 px-5 py-4 shadow-lg">
        <div className="min-w-0">
          <p className="font-display text-sm font-600 uppercase tracking-wide text-ink">
            {challenge.from.nickname} wants to fight
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">Room {challenge.code}</p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setChallenge(null);
              void navigate(`/room/${challenge.code}`);
            }}
          >
            Accept
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChallenge(null)}>
            Decline
          </Button>
        </div>
      </Panel>
    </div>
  );
}
