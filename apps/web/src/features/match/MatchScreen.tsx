import { useEffect, useSyncExternalStore } from 'react';
import { GameCanvas } from '@/game/GameCanvas';
import { matchManager } from '@/net/MatchManager';
import { useIdentity } from '@/net/useConnection';
import { setAppPhase } from '@/store/appPhase';
import { MatchHud } from './hud/MatchHud';

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

      {/* z-10: the HUD. Renders once; every update after that is a direct DOM
          write from the game bus, never a re-render. */}
      {view.config && view.fighters.length === 2 ? (
        <MatchHud fighters={view.fighters} maxHp={view.config.maxHp} />
      ) : (
        <p className="absolute inset-x-0 top-1/2 text-center text-sm text-ink-dim">
          Waiting for the match to begin…
        </p>
      )}
    </div>
  );
}
