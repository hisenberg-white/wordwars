import { Button } from '@/ui/Button';
import { ConnectionBadge } from '@/ui/ConnectionBadge';
import { Panel, PanelLabel } from '@/ui/Panel';
import { Wordmark } from '@/ui/Wordmark';

/**
 * Landing shell.
 *
 * This is the step 1.4 skeleton: it exists to prove the design system reads as
 * a fighting game rather than a web app. The real landing page — live player
 * counts, nickname editing, working matchmaking — lands in step 2.1.
 */
export function LandingScreen() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Wordmark size="sm" />
        <nav className="flex items-center gap-1">
          {['Leaderboard', 'Characters', 'Settings'].map((item) => (
            <Button key={item} variant="ghost" size="sm" disabled>
              {item}
            </Button>
          ))}
          <ConnectionBadge className="ml-3" />
        </nav>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
        <div className="animate-rise">
          <PanelLabel className="text-p2">Competitive Typing Combat</PanelLabel>
        </div>

        <h1 className="animate-rise mt-5" style={{ animationDelay: '60ms' }}>
          <Wordmark size="xl" />
        </h1>

        <p
          className="animate-rise mt-6 max-w-lg text-balance text-lg text-ink-dim"
          style={{ animationDelay: '120ms' }}
        >
          Your keyboard is the weapon. Type clean to land combos, break your opponent&apos;s rhythm,
          and finish them with an Ultimate.
        </p>

        <div
          className="animate-rise mt-10 flex flex-wrap items-center justify-center gap-4"
          style={{ animationDelay: '180ms' }}
        >
          <Button variant="primary" size="lg" disabled>
            Play Now
          </Button>
          <Button variant="secondary" size="lg" disabled>
            Private Room
          </Button>
        </div>

        <p className="mt-5 text-xs uppercase tracking-[0.2em] text-ink-faint">No account needed</p>
      </div>

      {/* Design-system proof: the rivalry palette applied to two fighter cards. */}
      <section className="grid gap-4 pb-16 sm:grid-cols-2">
        {(
          [
            { side: 'p1', label: 'Player One', accent: 'text-p1' },
            { side: 'p2', label: 'Player Two', accent: 'text-p2' },
          ] as const
        ).map(({ side, label, accent }) => (
          <Panel key={side} side={side} className="p-5">
            <PanelLabel>{label}</PanelLabel>
            <div className="mt-3 flex items-baseline gap-3">
              <span className={`font-display text-2xl font-700 ${accent}`}>Awaiting</span>
              <span className="text-sm text-ink-faint">Challenger</span>
            </div>
            <div className="mt-4 h-1.5 w-full overflow-hidden bg-abyss">
              <div
                className={`h-full ${side === 'p1' ? 'bg-p1' : 'bg-p2'}`}
                style={{ width: side === 'p1' ? '100%' : '100%' }}
              />
            </div>
          </Panel>
        ))}
      </section>

      <footer className="border-t border-line py-6 text-center text-xs text-ink-faint">
        WordWars — Phase 1 foundation build
      </footer>
    </main>
  );
}
