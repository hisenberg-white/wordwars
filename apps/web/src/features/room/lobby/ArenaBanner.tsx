import { ARENAS, type ArenaId } from '@wordwars/shared';
import { ARENA_THEMES } from '@/game/arenaTheme';

/**
 * The arena, shown as a wide banner behind the room header.
 *
 * A lobby that shows *where* you are about to fight is doing the job of a
 * character-select screen; a lobby that shows a list of settings is doing the
 * job of a form. The stage is part of the anticipation.
 */
export function ArenaBanner({
  arenaId,
  children,
}: {
  arenaId: ArenaId;
  children?: React.ReactNode;
}) {
  const theme = ARENA_THEMES[arenaId];
  const arena = ARENAS[arenaId];

  return (
    <div
      className="clip-panel relative overflow-hidden border border-line"
      style={{ background: theme.gradient }}
    >
      {/* Horizon line and ground haze — enough to read as a place rather than
          a colour swatch, at effectively no cost. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{ background: `linear-gradient(to top, ${theme.accent}22, transparent)` }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-px opacity-40"
        style={{ background: theme.accent }}
      />
      <div className="bg-scanlines absolute inset-0 opacity-40" aria-hidden />

      <div className="relative flex flex-col gap-1 px-7 py-6">
        <span
          className="font-display text-[0.6rem] font-600 uppercase tracking-[0.3em]"
          style={{ color: theme.accent }}
        >
          Arena
        </span>
        <h2 className="text-2xl">{arena.name}</h2>
        <p className="text-sm text-ink-dim">{arena.theme}</p>
        {children}
      </div>
    </div>
  );
}
