import { Link } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { TopNav } from '@/features/landing/components/TopNav';

interface ComingSoonProps {
  readonly title: string;
  /** The plan step that will replace this screen, e.g. "2.3". */
  readonly step: string;
  readonly description: string;
}

/**
 * An honest placeholder.
 *
 * The landing page links to routes that do not exist yet. Rather than disable
 * those buttons — which makes a front page feel dead — the destinations exist
 * and say plainly what is coming and when. Naming the plan step keeps this
 * screen from quietly becoming permanent: an unreplaced placeholder is
 * self-documenting technical debt.
 */
export function ComingSoonScreen({ title, step, description }: ComingSoonProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />

      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <Panel className="max-w-lg p-8 text-center">
          <PanelLabel className="text-ultimate">Not built yet · Step {step}</PanelLabel>
          <h1 className="mt-4 text-3xl">{title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">{description}</p>

          <Link to="/" className="mt-8 inline-block">
            <Button variant="secondary">Back to the arena</Button>
          </Link>
        </Panel>
      </main>
    </div>
  );
}
