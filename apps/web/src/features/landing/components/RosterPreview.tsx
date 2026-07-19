import { ARENAS, ARENA_IDS, CHARACTERS, CHARACTER_IDS } from '@wordwars/shared';
import { Panel, PanelLabel } from '@/ui/Panel';

/**
 * Roster and arena teasers.
 *
 * Both lists are driven from `@wordwars/shared` rather than hardcoded here, so
 * adding a character is a one-line change in the catalogue and this section
 * picks it up. The copy deliberately reinforces that these are cosmetic —
 * players should never wonder whether picking the Robot is a competitive
 * choice.
 */
export function RosterPreview() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-2">
        <div>
          <PanelLabel className="text-p1">Fighters</PanelLabel>
          <h2 className="mt-3 text-3xl">Pick a look, not an advantage</h2>
          <p className="mt-2 max-w-md text-sm text-ink-dim">
            Every fighter has identical stats. Nothing you unlock will ever make you hit harder —
            only the person typing does that.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {CHARACTER_IDS.map((id) => (
              <Panel key={id} interactive className="p-4">
                <div className="font-display text-sm font-600 uppercase tracking-wide text-ink">
                  {CHARACTERS[id].name}
                </div>
                <div className="mt-1 text-xs leading-snug text-ink-faint">
                  {CHARACTERS[id].blurb}
                </div>
              </Panel>
            ))}
          </div>
        </div>

        <div>
          <PanelLabel className="text-p2">Arenas</PanelLabel>
          <h2 className="mt-3 text-3xl">Stages that react</h2>
          <p className="mt-2 max-w-md text-sm text-ink-dim">
            The volcano erupts when an Ultimate lands. Cherry blossom falls on a perfect streak. The
            stage is watching the fight too.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {ARENA_IDS.slice(0, 8).map((id) => (
              <Panel key={id} interactive side="p2" className="p-4">
                <div className="font-display text-sm font-600 uppercase tracking-wide text-ink">
                  {ARENAS[id].name}
                </div>
                <div className="mt-1 text-xs leading-snug text-ink-faint">{ARENAS[id].theme}</div>
              </Panel>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
