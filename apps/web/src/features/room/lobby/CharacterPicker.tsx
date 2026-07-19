import { CHARACTERS, CHARACTER_IDS, type CharacterId } from '@wordwars/shared';
import { PanelLabel } from '@/ui/Panel';
import { cn } from '@/ui/cn';

/**
 * Character select.
 *
 * The blurb under each name is the only thing distinguishing them, and that is
 * the point — there is no stat line to compare because there are no stats
 * (plan §1.1 D5). Showing personality instead of numbers is how the UI keeps
 * that promise legible.
 */
export function CharacterPicker({
  selected,
  onSelect,
  disabled = false,
}: {
  selected: CharacterId;
  onSelect: (id: CharacterId) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <PanelLabel>Choose your fighter</PanelLabel>
        <span className="text-[0.65rem] text-ink-faint">Cosmetic only — no stat differences</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {CHARACTER_IDS.map((id) => {
          const isSelected = id === selected;

          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(id)}
              aria-pressed={isSelected}
              className={cn(
                'clip-notch border p-3 text-left transition-all duration-150',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isSelected
                  ? 'border-p1 bg-p1/12'
                  : 'border-line bg-surface/60 hover:border-line-bright hover:bg-raised/70',
              )}
            >
              <div
                className={cn(
                  'font-display text-xs font-600 uppercase tracking-wide',
                  isSelected ? 'text-p1' : 'text-ink',
                )}
              >
                {CHARACTERS[id].name}
              </div>
              <div className="mt-1 text-[0.7rem] leading-snug text-ink-faint">
                {CHARACTERS[id].blurb}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
