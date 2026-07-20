import { useEffect, useSyncExternalStore } from 'react';
import { GameCanvas } from '@/game/GameCanvas';
import { MatchExit } from './MatchExit';
import { matchManager } from '@/net/MatchManager';
import { useIdentity } from '@/net/useConnection';
import { setAppPhase } from '@/store/appPhase';
import { MatchHud } from './hud/MatchHud';
import { PausedOverlay } from './PausedOverlay';
import { ResultsScreen } from './results/ResultsScreen';

/**
 * The fight.
 *
 * Structurally minimal on purpose: a full-bleed canvas with the HUD layered
 * over it (plan §6.1). The HP bars, combo counter, ultimate meter and typing
 * band all arrive in 3.6 — and when they do they will write the DOM directly
 * rather than becoming React state, for the same reason this component reads
 * only `status`.
 */
export function MatchScreen() {
  const { identity } = useIdentity();

  const view = useSyncExternalStore(
    matchManager.subscribe,
    matchManager.getSnapshot,
    matchManager.getSnapshot,
  );

  useEffect(() => {
    setAppPhase('combat');
    return () => setAppPhase('menu');
  }, []);

  useEffect(() => {
    if (identity) matchManager.bind(identity.playerId);
  }, [identity]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-void">
      {/* z-0: the arena. Mounted once, never re-rendered. */}
      <GameCanvas className="absolute inset-0 grid place-items-center" />

      {/* Always reachable: a fight you cannot leave is a trap. */}
      <MatchExit live={view.status === 'live'} />

      {/* z-30: the opponent dropped. Sits above the HUD but below results,
          since a match that ends during a pause should show the verdict. */}
      {view.pausedBy && view.status === 'live' && (
        <PausedOverlay
          nickname={view.pausedBy.nickname}
          resumeDeadline={view.pausedBy.resumeDeadline}
        />
      )}

      {/* z-20: results. Deliberately layered OVER the still-running arena
          rather than replacing it, so the KO animation and the victory pose
          stay visible behind the numbers. */}
      {view.status === 'ended' && view.result && (
        <div className="absolute inset-0 z-20 overflow-y-auto bg-void/85 backdrop-blur-sm">
          <ResultsScreen result={view.result} fighters={view.fighters} />
        </div>
      )}

      {/* z-10: the HUD. Renders once; every update after that is a direct DOM
          write from the game bus, never a re-render. */}
      {view.config && view.fighters.length === 2 ? (
        <MatchHud
          fighters={view.fighters}
          maxHp={view.config.maxHp}
          roundCount={view.config.roundCount}
        />
      ) : (
        <p className="absolute inset-x-0 top-1/2 text-center text-sm text-ink-dim">
          Waiting for the match to begin…
        </p>
      )}
    </div>
  );
}
