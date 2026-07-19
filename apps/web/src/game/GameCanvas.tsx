import { useEffect, useRef, useState } from 'react';

/**
 * Mounts the Phaser canvas.
 *
 * The ONLY React component that touches the game engine, and it renders
 * exactly once. Everything the fight does afterwards flows through the game
 * bus, not through props — a component that re-rendered on combat events would
 * tear down and rebuild the canvas mid-match (plan §1.1 D3).
 *
 * Phaser is imported dynamically so its ~1MB never lands in the landing-page
 * bundle.
 */
export function GameCanvas({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean) => void } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { createGame } = await import('./createGame');
        if (cancelled || !hostRef.current) return;

        gameRef.current = createGame(hostRef.current);
      } catch (error) {
        console.error('[GameCanvas] failed to start the renderer', error);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  if (failed) {
    return (
      <div className={className}>
        <p className="p-8 text-center text-sm text-ink-dim">
          The arena could not be rendered on this device.
        </p>
      </div>
    );
  }

  return <div ref={hostRef} className={className} aria-hidden />;
}
