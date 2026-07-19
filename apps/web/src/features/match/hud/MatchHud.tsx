import { useCallback, useEffect, useRef } from 'react';
import type { MatchFighter, PlayerId } from '@wordwars/shared';
import { comboTier } from '@wordwars/engine';
import { gameBus } from '@/game/bus';
import { ComboCounter } from './ComboCounter';
import { HpBar } from './HpBar';
import { TypingBand } from './TypingBand';
import { UltimateMeter } from './UltimateMeter';
import { RoundBanner, type RoundUpdate } from './RoundBanner';
import {
  applyEvent,
  createHudState,
  hpFraction,
  isCritical,
  reconcile,
  type HudState,
} from './hudModel';

interface MatchHudProps {
  readonly fighters: readonly MatchFighter[];
  readonly maxHp: number;
  /** Best-of-N. A best-of-1 renders no round furniture at all. */
  readonly roundCount: 1 | 3 | 5;
}

type BarUpdate = (fraction: number, critical: boolean) => void;
type ComboUpdate = (combo: number, tier: number) => void;
type UltimateUpdate = (charge: number, ready: boolean) => void;

/**
 * The combat overlay.
 *
 * Renders its structure ONCE. Every subsequent change — HP, combo, ultimate
 * charge — is pushed into the children through callbacks they registered, and
 * each child writes its own DOM directly. This component does not re-render
 * during a match at all (plan §1.1 D3).
 *
 * Note what is deliberately absent (§0): no WPM, no accuracy percentage, no
 * progress bar, no match timer. Every one of those would turn the screen into
 * a typing test. Progress is the opponent's HP going down.
 */
export function MatchHud({ fighters, maxHp, roundCount }: MatchHudProps) {
  const stateRef = useRef<HudState | null>(null);

  const bars = useRef(new Map<PlayerId, BarUpdate>());
  const combos = useRef(new Map<PlayerId, ComboUpdate>());
  const ultimates = useRef(new Map<PlayerId, UltimateUpdate>());
  const rounds = useRef<RoundUpdate | null>(null);

  const left = fighters.find((f) => f.side === 'left');
  const right = fighters.find((f) => f.side === 'right');

  useEffect(() => {
    if (!left || !right) return;

    stateRef.current = createHudState([left.playerId, right.playerId], maxHp);
    push(stateRef.current);

    const offEvents = gameBus.on('combat:events', ({ events }) => {
      let next = stateRef.current;
      if (!next) return;

      for (const event of events) next = applyEvent(next, event);

      stateRef.current = next;
      push(next);
    });

    // The server corrects any prediction drift ten times a second.
    const offSnapshot = gameBus.on('match:snapshot', (snapshot) => {
      if (!stateRef.current) return;

      stateRef.current = reconcile(stateRef.current, snapshot);
      push(stateRef.current);
    });

    function push(state: HudState): void {
      for (const fighter of state.fighters) {
        bars.current.get(fighter.playerId)?.(hpFraction(fighter), isCritical(fighter));
        combos.current.get(fighter.playerId)?.(fighter.combo, comboTier(fighter.combo));
        ultimates.current.get(fighter.playerId)?.(fighter.ultimateCharge, fighter.ultimateReady);
      }

      rounds.current?.(state.round, state.score, state.intermission);
    }

    return () => {
      offEvents();
      offSnapshot();
    };
  }, [left, right, maxHp]);

  const bindBar = useCallback(
    (playerId: PlayerId) => (update: BarUpdate) => bars.current.set(playerId, update),
    [],
  );
  const bindCombo = useCallback(
    (playerId: PlayerId) => (update: ComboUpdate) => combos.current.set(playerId, update),
    [],
  );
  const bindUltimate = useCallback(
    (playerId: PlayerId) => (update: UltimateUpdate) => ultimates.current.set(playerId, update),
    [],
  );
  const bindRounds = useCallback((update: RoundUpdate) => {
    rounds.current = update;
  }, []);

  if (!left || !right) return null;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
      {/* Top: the two fighters, facing each other across the screen. */}
      <div className="flex items-start justify-between gap-8 px-8 pt-6">
        <div className="flex w-[38%] flex-col gap-2">
          <HpBar side="p1" nickname={left.nickname} bind={bindBar(left.playerId)} />
          <UltimateMeter side="p1" bind={bindUltimate(left.playerId)} />
        </div>

        <div className="mt-2 flex flex-col items-center gap-2">
          <span className="font-display text-2xl font-700 italic text-ink-faint">VS</span>
          <RoundBanner roundCount={roundCount} bind={bindRounds} />
        </div>

        <div className="flex w-[38%] flex-col items-end gap-2">
          <HpBar side="p2" nickname={right.nickname} bind={bindBar(right.playerId)} />
          <UltimateMeter side="p2" bind={bindUltimate(right.playerId)} />
        </div>
      </div>

      {/* Middle: combo counters, out by the fighters they belong to. */}
      <div className="flex items-center justify-between px-12">
        <ComboCounter side="p1" bind={bindCombo(left.playerId)} />
        <ComboCounter side="p2" bind={bindCombo(right.playerId)} />
      </div>

      {/* Bottom: the text. A thin band, low, so the fighters own the frame. */}
      <div className="pb-10">
        <TypingBand />
      </div>
    </div>
  );
}
