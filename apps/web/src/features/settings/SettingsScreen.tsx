import { useNavigate } from 'react-router-dom';
import { TopNav } from '@/features/landing/components/TopNav';
import { Panel, PanelLabel } from '@/ui/Panel';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { useEscapeKey } from '@/ui/useEscapeKey';
import { settingsManager, useSettings } from '@/settings/SettingsManager';
import type { MotionPreference, QualityTier } from '@/settings/settings';

/**
 * Settings.
 *
 * Everything here applies the moment it changes — no Save button, no "restart
 * to apply". A volume slider you cannot hear while dragging is not tunable, and
 * a motion toggle that waits for the next match has already failed the person
 * who needed it.
 */
export function SettingsScreen() {
  const navigate = useNavigate();
  const settings = useSettings();

  // Escape returns to the menu — the only key this game can bind, since every
  // letter is combat input elsewhere in the app.
  useEscapeKey(() => void navigate('/'));
  const set = (patch: Parameters<typeof settingsManager.update>[0]) =>
    settingsManager.update(patch);

  return (
    <Shell>
      <div className="w-full max-w-2xl space-y-6">
        <h1 className="font-display text-3xl font-700 uppercase tracking-[0.2em] text-ink">
          Settings
        </h1>

        <Panel className="p-6">
          <div className="flex items-center justify-between">
            <PanelLabel>Audio</PanelLabel>
            <button
              type="button"
              onClick={() => set({ muted: !settings.muted })}
              className={cn(
                'font-display text-[0.65rem] uppercase tracking-[0.15em]',
                settings.muted ? 'text-danger' : 'text-ink-faint hover:text-ink-dim',
              )}
            >
              {settings.muted ? 'Muted' : 'Mute all'}
            </button>
          </div>

          <div className={cn('mt-4 space-y-4', settings.muted && 'opacity-40')}>
            <Slider label="Master" value={settings.master} onChange={(master) => set({ master })} />
            <Slider label="Effects" value={settings.sfx} onChange={(sfx) => set({ sfx })} />
            <Slider label="Music" value={settings.music} onChange={(music) => set({ music })} />
          </div>

          <Toggle
            className="mt-5"
            label="Typing sounds"
            hint="A click per keystroke. Some people find it focusing, others maddening."
            on={settings.typingSounds}
            onChange={(typingSounds) => set({ typingSounds })}
          />
        </Panel>

        <Panel className="p-6">
          <PanelLabel>Motion</PanelLabel>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            Reduced motion removes screen shake. Hits still freeze the frame and still land visibly
            — the fight stays readable, it just stops moving the camera.
          </p>

          <Choice<MotionPreference>
            className="mt-4"
            value={settings.motion}
            onChange={(motion) => set({ motion })}
            options={[
              { value: 'auto', label: 'System', hint: 'Follow your device setting' },
              { value: 'full', label: 'Full', hint: 'Everything moves' },
              { value: 'reduced', label: 'Reduced', hint: 'No screen shake' },
            ]}
          />

          {settings.motion === 'auto' && (
            <p className="mt-3 text-[0.65rem] text-ink-faint">
              Currently {settingsManager.reducedMotion ? 'reduced' : 'full'}, following your device.
            </p>
          )}
        </Panel>

        <Panel className="p-6">
          <PanelLabel>Graphics</PanelLabel>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            Lower quality spawns fewer particles. Hits keep the same weight — a slower machine
            renders a lighter version of the same fight, not an easier one.
          </p>

          <Choice<QualityTier>
            className="mt-4"
            value={settings.quality}
            onChange={(quality) => set({ quality })}
            options={[
              { value: 'low', label: 'Low', hint: 'Fewest effects' },
              { value: 'medium', label: 'Medium', hint: 'Balanced' },
              { value: 'high', label: 'High', hint: 'Everything' },
            ]}
          />
        </Panel>

        <Panel className="p-6">
          <PanelLabel>Keyboard</PanelLabel>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            Only Escape is bound. Every letter, digit and space is combat input, so a shortcut on
            any of them would fire while you were simply playing.
          </p>

          <dl className="mt-4 space-y-2">
            <Shortcut keys="Esc" what="Close a dialog, or go back to the menu" />
            <Shortcut keys="Esc" what="In a match: open the leave menu" />
            <Shortcut keys="Backspace" what="Repair the current word — the miss still counts" />
          </dl>
        </Panel>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => settingsManager.reset()}>
            Reset to defaults
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function Shortcut({ keys, what }: { keys: string; what: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="w-24 shrink-0">
        <kbd className="border border-line/60 bg-abyss px-2 py-0.5 font-display text-[0.65rem] uppercase tracking-wider text-ink-dim">
          {keys}
        </kbd>
      </dt>
      <dd className="text-xs leading-snug text-ink-faint">{what}</dd>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-4">
      <span className="w-20 shrink-0 font-display text-[0.65rem] uppercase tracking-[0.15em] text-ink-dim">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none bg-abyss accent-p1"
      />
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-faint">
        {Math.round(value * 100)}
      </span>
    </label>
  );
}

function Toggle({
  label,
  hint,
  on,
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-6', className)}>
      <div className="min-w-0">
        <div className="font-display text-[0.65rem] uppercase tracking-[0.15em] text-ink-dim">
          {label}
        </div>
        {hint && <p className="mt-1 text-xs leading-snug text-ink-faint">{hint}</p>}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={cn(
          'mt-0.5 h-5 w-10 shrink-0 border transition-colors ease-[var(--ease-snap)]',
          on ? 'border-p1/60 bg-p1/25' : 'border-line/60 bg-abyss',
        )}
      >
        <span
          className={cn(
            'block h-3 w-3 translate-y-[3px] transition-transform ease-[var(--ease-snap)]',
            on ? 'translate-x-[26px] bg-p1' : 'translate-x-[3px] bg-ink-faint',
          )}
        />
      </button>
    </div>
  );
}

function Choice<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; hint: string }>;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-2 sm:grid-cols-3', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'border px-3 py-3 text-left transition-colors ease-[var(--ease-snap)]',
            value === option.value
              ? 'border-p1/60 bg-p1/10'
              : 'border-line/50 bg-abyss/40 hover:border-line-bright',
          )}
        >
          <div
            className={cn(
              'font-display text-[0.7rem] uppercase tracking-[0.15em]',
              value === option.value ? 'text-p1' : 'text-ink-dim',
            )}
          >
            {option.label}
          </div>
          <div className="mt-0.5 text-[0.65rem] leading-snug text-ink-faint">{option.hint}</div>
        </button>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex flex-1 items-start justify-center px-6 py-12">{children}</main>
    </div>
  );
}
