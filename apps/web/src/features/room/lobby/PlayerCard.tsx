import { CHARACTERS, type RoomMember } from '@wordwars/shared';
import { cn } from '@/ui/cn';

interface PlayerCardProps {
  readonly member: RoomMember;
  readonly side: 'p1' | 'p2';
  readonly isYou: boolean;
  readonly canKick: boolean;
  readonly onKick: () => void;
}

function pingTone(ping: number | null): string {
  if (ping === null) return 'text-ink-faint';
  if (ping < 60) return 'text-success';
  if (ping < 150) return 'text-ultimate';
  return 'text-danger';
}

export function PlayerCard({ member, side, isYou, canKick, onKick }: PlayerCardProps) {
  const isP1 = side === 'p1';

  return (
    <div
      className={cn(
        'clip-panel relative flex flex-1 flex-col gap-3 border p-5 transition-colors',
        isP1 ? 'border-p1/40' : 'border-p2/40',
        // Ready state is the single most scanned thing in a lobby, so it is
        // carried by the whole card rather than a small badge.
        member.isReady && (isP1 ? 'bg-p1/10' : 'bg-p2/10'),
      )}
      style={{
        background: member.isReady
          ? undefined
          : isP1
            ? 'linear-gradient(160deg, rgb(255 47 87 / 0.07), transparent 70%)'
            : 'linear-gradient(200deg, rgb(0 224 255 / 0.06), transparent 70%)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'font-display text-lg font-700 leading-tight',
            isP1 ? 'text-p1' : 'text-p2',
          )}
        >
          {member.nickname}
        </span>
        {isYou && (
          <span className="font-display text-[0.55rem] uppercase tracking-[0.2em] text-ink-faint">
            You
          </span>
        )}
        {member.isHost && (
          <span className="font-display text-[0.55rem] uppercase tracking-[0.2em] text-ultimate">
            Host
          </span>
        )}
      </div>

      <div className="text-sm text-ink-dim">{CHARACTERS[member.characterId].name}</div>

      <div className="mt-auto flex items-center justify-between pt-2">
        <span
          className={cn(
            'font-display text-[0.65rem] font-600 uppercase tracking-[0.15em]',
            member.isReady ? 'text-success' : 'text-ink-faint',
          )}
        >
          {member.isReady ? '● Ready' : '○ Not ready'}
        </span>

        <span className={cn('text-xs tabular-nums', pingTone(member.ping))}>
          {member.ping !== null ? `${member.ping} ms` : '—'}
        </span>
      </div>

      {canKick && (
        <button
          type="button"
          onClick={onKick}
          title={`Remove ${member.nickname}`}
          className="absolute right-3 top-3 px-2 text-xs text-ink-faint transition-colors hover:text-danger"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Placeholder for a seat nobody has taken yet. */
export function EmptySlot({ side }: { side: 'p1' | 'p2' }) {
  return (
    <div
      className={cn(
        'clip-panel flex flex-1 flex-col items-center justify-center gap-2 border border-dashed p-5 text-center',
        side === 'p1' ? 'border-p1/25' : 'border-p2/25',
      )}
    >
      <span className="font-display text-sm uppercase tracking-[0.2em] text-ink-faint">
        Waiting for a challenger
      </span>
      <span className="text-xs text-ink-faint/70">Share the room code</span>
    </div>
  );
}
