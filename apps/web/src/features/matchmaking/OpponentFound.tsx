import type { PlayerIdentity } from '@wordwars/shared';
import { cn } from '@/ui/cn';

function FighterCard({ identity, side }: { identity: PlayerIdentity; side: 'p1' | 'p2' }) {
  const isP1 = side === 'p1';

  return (
    <div
      className={cn(
        'clip-panel flex w-44 flex-col items-center gap-2 border p-5 sm:w-56',
        isP1 ? 'border-p1/50' : 'border-p2/50',
      )}
      style={{
        background: isP1
          ? 'linear-gradient(160deg, rgb(255 47 87 / 0.16), transparent 70%)'
          : 'linear-gradient(200deg, rgb(0 224 255 / 0.14), transparent 70%)',
        animation: `rise 0.5s var(--ease-out-quint) both`,
        animationDelay: isP1 ? '0ms' : '120ms',
      }}
    >
      <span className={cn('font-display text-lg font-700', isP1 ? 'text-p1' : 'text-p2')}>
        {identity.nickname}
      </span>
      <span className="font-display text-[0.6rem] uppercase tracking-[0.2em] text-ink-faint">
        {identity.isGuest ? 'Guest' : `Level ${identity.level}`}
      </span>
    </div>
  );
}

/**
 * The payoff moment.
 *
 * Deliberately theatrical and deliberately brief. Naming the opponent turns an
 * anonymous queue into a person to beat — the difference between "a match
 * started" and "SilentFox is here". Fighting games have spent forty years
 * proving this two-second beat is worth the wait it costs.
 */
export function OpponentFound({
  self,
  opponent,
}: {
  self: PlayerIdentity;
  opponent: PlayerIdentity;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="animate-rise font-display text-[0.7rem] font-600 uppercase tracking-[0.35em] text-ultimate">
        Opponent found
      </span>

      <div className="mt-10 flex items-center gap-6 sm:gap-10">
        <FighterCard identity={self} side="p1" />

        <span
          className="font-display text-4xl font-700 italic text-ink sm:text-5xl"
          style={{ animation: 'rise 0.4s var(--ease-out-quint) both', animationDelay: '240ms' }}
        >
          VS
        </span>

        <FighterCard identity={opponent} side="p2" />
      </div>

      <p
        className="mt-10 font-display text-xs uppercase tracking-[0.25em] text-ink-dim"
        style={{ animation: 'rise 0.4s var(--ease-out-quint) both', animationDelay: '400ms' }}
      >
        Preparing the arena…
      </p>
    </div>
  );
}
