import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { connection } from '@/net/ConnectionManager';
import { matchManager } from '@/net/MatchManager';
import { Button } from '@/ui/Button';
import { Overlay } from '@/ui/Overlay';
import { Panel, PanelLabel } from '@/ui/Panel';
import { useEscapeKey } from '@/ui/useEscapeKey';

/**
 * The way out of a fight.
 *
 * There was none. A player who started a match had to play it to the end or
 * close the tab — no back, no cross, no forfeit, and `match:forfeit` existed on
 * the server with nothing in the product ever calling it. Being unable to leave
 * is the kind of thing that makes somebody close the tab and not come back.
 *
 * Leaving is deliberately a TWO-step action. Escape is the only key this game
 * can bind — every letter is combat input — which means Escape is also the key
 * a flustered player is most likely to hit mid-combo. Quitting instantly on it
 * would forfeit matches nobody meant to forfeit. So Escape opens this, and
 * leaving takes a second, deliberate click.
 */
export function MatchExit({ live }: { live: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
    // Hand the keyboard back to the fight.
    matchManager.setInputPaused(false);
  };

  const show = () => {
    setOpen(true);
    /*
     * Typing must not reach the arena while this is up, or the player attacks
     * blind through the dialog. This is not an exploitable pause: the match
     * clock keeps running on the server and the opponent keeps hitting, so
     * opening it costs the player rather than protecting them.
     */
    matchManager.setInputPaused(true);
  };

  // Escape toggles, going through the same helpers so the keyboard path pauses
  // and resumes input exactly as the button does.
  useEscapeKey(() => (open ? close() : show()));

  const leave = () => {
    connection.socket?.emit('match:forfeit', () => {});
    matchManager.setInputPaused(false);
    void navigate('/');
  };

  return (
    <>
      <button
        type="button"
        onClick={open ? close : show}
        aria-label="Leave match"
        className="pointer-events-auto absolute right-5 top-5 z-30 grid h-9 w-9 place-items-center border border-line/50 bg-void/60 text-ink-faint transition-colors hover:border-line-bright hover:text-ink"
      >
        <span aria-hidden className="text-lg leading-none">
          ×
        </span>
      </button>

      {open && (
        <Overlay onClose={close} label="Leave match">
          <Panel className="w-full max-w-sm p-7 text-center">
            <PanelLabel className="text-p2">Leave the match?</PanelLabel>

            <p className="mt-3 text-sm leading-relaxed text-ink-dim">
              {live
                ? 'The fight is still going. Leaving now counts as a forfeit and your opponent takes the win.'
                : 'This match is over — leaving just returns you to the menu.'}
            </p>

            <div className="mt-6 flex flex-col gap-2">
              <Button variant="secondary" onClick={close}>
                Keep fighting
              </Button>
              <Button variant="ghost" onClick={leave}>
                {live ? 'Forfeit and leave' : 'Leave'}
              </Button>
            </div>

            <p className="mt-4 text-[0.65rem] uppercase tracking-[0.15em] text-ink-faint">
              Esc closes this
            </p>
          </Panel>
        </Overlay>
      )}
    </>
  );
}
