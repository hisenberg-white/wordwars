import { useEffect, useRef } from 'react';

/**
 * Round score, and the between-rounds card.
 *
 * Two jobs in one component because they share the same data and the same
 * update channel:
 *
 *   - **Always visible** in a best-of-3/5: pips showing the score, so a
 *     spectator can tell it is 1–1 without being told.
 *   - **Between rounds**: a card naming the round that just ended and who
 *     took it. Fighting games make a meal of this moment and they are right
 *     to — it is the only point in a match when both players look up.
 *
 * Like the rest of the HUD it renders once and is driven by direct DOM writes
 * (plan §1.1 D3). In a best-of-1 it renders nothing at all.
 */

export type RoundUpdate = (
  round: number,
  score: readonly [number, number],
  intermission: boolean,
) => void;

interface RoundBannerProps {
  readonly roundCount: 1 | 3 | 5;
  readonly bind: (update: RoundUpdate) => void;
}

export function RoundBanner({ roundCount, bind }: RoundBannerProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const pipsRef = useRef<HTMLDivElement>(null);

  const needed = Math.ceil(roundCount / 2);

  useEffect(() => {
    if (roundCount === 1) return;

    bind((round, score, intermission) => {
      const card = cardRef.current;
      const pips = pipsRef.current;

      if (pips) {
        for (const [slot, node] of [...pips.children].entries()) {
          const won = score[slot < needed ? 0 : 1] ?? 0;
          const index = slot < needed ? slot : slot - needed;
          node.classList.toggle('opacity-100', index < won);
          node.classList.toggle('opacity-20', index >= won);
        }
      }

      if (!card) return;

      if (titleRef.current) titleRef.current.textContent = `Round ${round} complete`;
      if (scoreRef.current) scoreRef.current.textContent = `${score[0]} — ${score[1]}`;

      card.classList.toggle('opacity-0', !intermission);
      card.classList.toggle('scale-95', !intermission);
      card.classList.toggle('opacity-100', intermission);
      card.classList.toggle('scale-100', intermission);
    });
  }, [bind, roundCount, needed]);

  if (roundCount === 1) return null;

  return (
    <>
      {/* Score pips, flanking the VS marker. */}
      <div ref={pipsRef} className="flex items-center gap-1.5">
        {Array.from({ length: needed * 2 }, (_, i) => (
          <span
            key={i}
            className={`h-2 w-2 rotate-45 opacity-20 ${i < needed ? 'bg-p1' : 'bg-p2'}`}
          />
        ))}
      </div>

      {/* The between-rounds card. Never unmounted, only faded. */}
      <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
        <div
          ref={cardRef}
          className="scale-95 border border-line-bright bg-void/90 px-12 py-8 text-center opacity-0 transition-all duration-300 ease-[var(--ease-snap)]"
        >
          <div
            ref={titleRef}
            className="font-display text-sm uppercase tracking-[0.3em] text-ink-dim"
          />
          <div
            ref={scoreRef}
            className="mt-2 font-display text-5xl font-700 tabular-nums text-ink"
          />
          <div className="mt-3 font-display text-xs uppercase tracking-[0.2em] text-ink-faint">
            Next round starting
          </div>
        </div>
      </div>
    </>
  );
}
