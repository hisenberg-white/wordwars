import { useEffect, useState } from 'react';
import { connection } from '@/net/ConnectionManager';
import { PanelLabel } from '@/ui/Panel';

/**
 * Shown while an opponent is disconnected.
 *
 * The countdown is the point. Without it the surviving player is staring at a
 * frozen fight with no idea whether to wait or leave — and a player who does
 * not know what is happening leaves. Showing exactly how long the game will
 * wait turns dead air into suspense.
 *
 * Driven by `serverNow()` for the same reason the match countdown is (1.5):
 * the deadline is a server timestamp, and each client's wall clock disagrees
 * with it by seconds.
 */
export function PausedOverlay({
  nickname,
  resumeDeadline,
}: {
  nickname: string;
  resumeDeadline: number;
}) {
  const [remainingMs, setRemainingMs] = useState(() => resumeDeadline - connection.serverNow());

  useEffect(() => {
    const id = setInterval(() => setRemainingMs(resumeDeadline - connection.serverNow()), 200);
    return () => clearInterval(id);
  }, [resumeDeadline]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-void/85 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 text-center">
        <PanelLabel className="text-ultimate">Match paused</PanelLabel>

        <p className="font-display text-3xl font-700 text-ink sm:text-4xl">
          {nickname} lost connection
        </p>

        <div className="flex items-baseline gap-2">
          <span className="font-display text-6xl font-700 tabular-nums text-ultimate">
            {seconds}
          </span>
          <span className="font-display text-xs uppercase tracking-[0.25em] text-ink-faint">
            seconds to return
          </span>
        </div>

        <p className="max-w-xs text-sm text-ink-dim">
          {seconds > 0
            ? 'Your fight resumes the moment they are back.'
            : 'They did not make it back — awarding the match.'}
        </p>
      </div>
    </div>
  );
}
