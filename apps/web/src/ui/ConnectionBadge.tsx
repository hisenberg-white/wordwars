import { useConnection } from '@/net/useConnection';
import { cn } from './cn';

const STATUS_LABEL = {
  idle: 'Offline',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  offline: 'No connection',
} as const;

/**
 * Ping quality thresholds.
 *
 * Chosen for a game where a word commit must feel instant: under 60ms is
 * imperceptible, under 150ms is playable, above that the player should know
 * before they queue rather than discover it mid-fight.
 */
function pingTone(ping: number): { color: string; label: string } {
  if (ping < 60) return { color: 'text-success', label: 'Excellent' };
  if (ping < 150) return { color: 'text-ultimate', label: 'Fair' };
  return { color: 'text-danger', label: 'Poor' };
}

export function ConnectionBadge({ className }: { className?: string }) {
  const { status, ping } = useConnection();

  const connected = status === 'connected';
  const tone = ping !== null ? pingTone(ping) : null;

  const dotColor = connected
    ? (tone?.color ?? 'text-success')
    : status === 'reconnecting' || status === 'connecting'
      ? 'text-ultimate'
      : 'text-ink-faint';

  return (
    <div
      className={cn(
        'flex items-center gap-2 font-display text-[0.65rem] font-600 uppercase tracking-[0.15em]',
        className,
      )}
      title={tone ? `${tone.label} connection` : STATUS_LABEL[status]}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-current',
          dotColor,
          !connected && 'animate-pulse-glow',
        )}
      />
      {connected && ping !== null ? (
        <span className={tone?.color}>{ping} ms</span>
      ) : (
        <span className="text-ink-faint">{STATUS_LABEL[status]}</span>
      )}
    </div>
  );
}
