import { Panel, PanelLabel } from '@/ui/Panel';

/**
 * The three beats of the combat loop.
 *
 * Written as consequences, not features. "Every word is a strike" tells a
 * player what happens when they act; "real-time typing engine" tells them
 * about our architecture, which they do not care about. This section exists to
 * make someone want to fight, so every line describes an effect on the opponent.
 */
const BEATS = [
  {
    step: '01',
    title: 'Every word is a strike',
    body: 'Finish a word, land a hit. No turns, no waiting, no cooldowns. Longer words hit harder.',
    accent: 'text-p2',
  },
  {
    step: '02',
    title: 'Combos multiply damage',
    body: 'A clean streak scales your damage up to 2.4×. One typo and it resets to nothing — accuracy is the whole game.',
    accent: 'text-p1',
  },
  {
    step: '03',
    title: 'Ultimates end fights',
    body: 'Perfect play charges your Ultimate. The next word turns gold. Time slows, the camera pushes in, and your opponent braces.',
    accent: 'text-ultimate',
  },
] as const;

export function CombatPrimer() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 text-center">
          <PanelLabel className="text-p2">How it plays</PanelLabel>
          <h2 className="mt-3 text-3xl sm:text-4xl">Your keyboard is the weapon</h2>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {BEATS.map(({ step, title, body, accent }) => (
            <Panel key={step} className="flex flex-col gap-3 p-6">
              <span className={`font-display text-3xl font-700 ${accent}`}>{step}</span>
              <h3 className="text-xl">{title}</h3>
              <p className="text-sm leading-relaxed text-ink-dim">{body}</p>
            </Panel>
          ))}
        </div>
      </div>
    </section>
  );
}
