import type { FighterResult } from '@wordwars/shared';
import { cn } from '@/ui/cn';

interface Row {
  readonly label: string;
  readonly value: (result: FighterResult) => string;
  readonly better: (a: FighterResult, b: FighterResult) => number;
}

/**
 * The stat lines.
 *
 * **This is the one place WPM and accuracy are allowed to appear** (§0). During
 * combat they would turn the screen into a typing test; afterwards they are
 * exactly what a player wants — the story of how the fight was won.
 *
 * Ordered by what decided the match rather than what is easiest to compute:
 * accuracy first, because it is the thing players under-rate and the thing
 * that actually wins fights.
 */
const ROWS: Row[] = [
  {
    label: 'Accuracy',
    value: (r) => `${r.accuracy.toFixed(1)}%`,
    better: (a, b) => a.accuracy - b.accuracy,
  },
  {
    label: 'Best combo',
    value: (r) => `${r.maxCombo}`,
    better: (a, b) => a.maxCombo - b.maxCombo,
  },
  {
    label: 'Average WPM',
    value: (r) => `${r.avgWpm}`,
    better: (a, b) => a.avgWpm - b.avgWpm,
  },
  {
    label: 'Peak WPM',
    value: (r) => `${r.peakWpm}`,
    better: (a, b) => a.peakWpm - b.peakWpm,
  },
  {
    label: 'Damage dealt',
    value: (r) => `${r.damageDealt}`,
    better: (a, b) => a.damageDealt - b.damageDealt,
  },
  {
    label: 'Words landed',
    value: (r) => `${r.wordsTyped}`,
    better: (a, b) => a.wordsTyped - b.wordsTyped,
  },
  {
    label: 'Words missed',
    // Fewer is better — the only inverted row, so it is explicit.
    value: (r) => `${r.wordsMissed}`,
    better: (a, b) => b.wordsMissed - a.wordsMissed,
  },
  {
    label: 'Ultimates',
    value: (r) => `${r.ultimatesUsed}`,
    better: (a, b) => a.ultimatesUsed - b.ultimatesUsed,
  },
];

export function StatComparison({ left, right }: { left: FighterResult; right: FighterResult }) {
  return (
    <div className="w-full">
      {ROWS.map((row) => {
        const diff = row.better(left, right);

        return (
          <div
            key={row.label}
            className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line/40 py-2.5 last:border-0"
          >
            {/* Highlighting the better value turns a table into a scoreboard —
                the player can see WHERE they lost, not just that they did. */}
            <span
              className={cn(
                'text-right font-display text-lg tabular-nums',
                diff > 0 ? 'text-p1' : 'text-ink-dim',
              )}
            >
              {row.value(left)}
            </span>

            <span className="w-32 text-center font-display text-[0.6rem] uppercase tracking-[0.2em] text-ink-faint">
              {row.label}
            </span>

            <span
              className={cn(
                'font-display text-lg tabular-nums',
                diff < 0 ? 'text-p2' : 'text-ink-dim',
              )}
            >
              {row.value(right)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
