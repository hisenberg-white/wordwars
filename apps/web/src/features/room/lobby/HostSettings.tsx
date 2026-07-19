import { useState } from 'react';
import {
  ARENAS,
  ARENA_IDS,
  DIFFICULTIES,
  type ArenaId,
  type Difficulty,
  type RoomSettings,
} from '@wordwars/shared';
import { roomManager } from '@/net/RoomManager';
import { ARENA_THEMES } from '@/game/arenaTheme';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { cn } from '@/ui/cn';

const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  easy: 'Short, common words',
  normal: 'Everyday language',
  hard: 'Long words and punctuation',
  code: 'Symbols, brackets, camelCase',
};

/**
 * Host-only room configuration.
 *
 * Every change is applied immediately and un-readies the room (see the server
 * handler). That is deliberate — a settings panel with a Save button invites
 * the host to change five things and start before anyone notices, and "ready"
 * has to mean "ready for these rules" to mean anything at all.
 */
export function HostSettings({
  settings,
  onClose,
}: {
  settings: RoomSettings;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'arena' | 'rules'>('arena');

  const update = (patch: Partial<RoomSettings>) => roomManager.update(patch);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Room settings"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-void/85 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <Panel className="w-full max-w-3xl p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <PanelLabel className="text-p1">Room settings</PanelLabel>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="px-2 text-ink-faint transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex gap-1">
          {(['arena', 'rules'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'clip-tab px-5 py-2 font-display text-xs font-600 uppercase tracking-[0.15em] transition-colors',
                tab === t ? 'bg-raised text-ink' : 'text-ink-dim hover:text-ink',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'arena' ? (
          <div className="mt-5">
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-ink-dim">
              <input
                type="checkbox"
                checked={settings.randomArena}
                onChange={(e) => update({ randomArena: e.target.checked })}
                className="accent-p1"
              />
              Surprise us — pick a random arena at the countdown
            </label>

            <div
              className={cn(
                'grid grid-cols-2 gap-2 sm:grid-cols-4',
                settings.randomArena && 'pointer-events-none opacity-40',
              )}
            >
              {ARENA_IDS.map((id: ArenaId) => {
                const selected = settings.arenaId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => update({ arenaId: id })}
                    aria-pressed={selected}
                    className={cn(
                      'clip-notch relative overflow-hidden border p-3 text-left transition-all',
                      selected ? 'border-p1' : 'border-line hover:border-line-bright',
                    )}
                    style={{ background: ARENA_THEMES[id].gradient }}
                  >
                    <span
                      className="font-display text-xs font-600 uppercase tracking-wide"
                      style={{ color: ARENA_THEMES[id].accent }}
                    >
                      {ARENAS[id].name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-6">
            <Field label="Match length">
              <div className="flex gap-2">
                {([1, 3, 5] as const).map((n) => (
                  <Choice
                    key={n}
                    selected={settings.roundCount === n}
                    onClick={() => update({ roundCount: n })}
                  >
                    Best of {n}
                  </Choice>
                ))}
              </div>
            </Field>

            <Field label="Text difficulty">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DIFFICULTIES.map((d) => (
                  <Choice
                    key={d}
                    selected={settings.difficulty === d}
                    onClick={() => update({ difficulty: d })}
                  >
                    <span className="capitalize">{d}</span>
                    <span className="mt-1 block text-[0.65rem] normal-case tracking-normal text-ink-faint">
                      {DIFFICULTY_BLURB[d]}
                    </span>
                  </Choice>
                ))}
              </div>
            </Field>

            <Field label="Combat">
              <div className="space-y-2">
                <Toggle
                  checked={settings.enableUltimate}
                  onChange={(v) => update({ enableUltimate: v })}
                  label="Ultimates"
                  hint="Perfect streaks charge a finisher"
                />
                <Toggle
                  checked={settings.enableCrits}
                  onChange={(v) => update({ enableCrits: v })}
                  label="Critical hits"
                  hint="Occasional bonus damage — adds swing"
                />
              </div>
            </Field>

            <Field label="Room">
              <div className="space-y-2">
                <Toggle
                  checked={settings.allowSpectators}
                  onChange={(v) => update({ allowSpectators: v })}
                  label="Allow spectators"
                  hint="Friends can watch without taking a slot"
                />
                <Toggle
                  checked={settings.randomCharacter}
                  onChange={(v) => update({ randomCharacter: v })}
                  label="Random fighters"
                  hint="Assign everyone a random look"
                />
              </div>
            </Field>
          </div>
        )}

        <div className="mt-7 flex items-center justify-between gap-4">
          <p className="text-xs text-ink-faint">
            Changing a setting un-readies everyone — they agreed to the old rules.
          </p>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'clip-notch flex-1 border px-4 py-2.5 text-left font-display text-xs font-600 uppercase tracking-wide transition-colors',
        selected
          ? 'border-p1 bg-p1/12 text-p1'
          : 'border-line bg-surface/60 text-ink-dim hover:border-line-bright hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border border-line/60 bg-abyss/40 px-4 py-3 transition-colors hover:border-line-bright">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-p1"
      />
      <span>
        <span className="block font-display text-xs font-600 uppercase tracking-wide text-ink">
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-ink-faint">{hint}</span>
      </span>
    </label>
  );
}
