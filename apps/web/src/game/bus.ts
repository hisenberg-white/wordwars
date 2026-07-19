import type {
  CombatEvent,
  MatchConfig,
  MatchFighter,
  MatchResult,
  MatchSnapshot,
} from '@wordwars/shared';
import type { TypingProgress } from '@/input/InputEngine';

/**
 * The React ↔ Phaser boundary.
 *
 * Everything that happens during a fight crosses here, and nothing crosses any
 * other way (plan §6.1). Phaser never imports React; React never reaches into a
 * scene. That separation is what makes the D3 promise enforceable — combat
 * events reach the renderer at 30Hz without a single component re-rendering.
 *
 * A hand-written 25-line emitter rather than a dependency: the whole surface is
 * `on`/`emit`, and a typed event map catches a wrong payload at compile time,
 * which is the only thing a library would have added.
 */
export interface GameEvents {
  'match:begin': { config: MatchConfig; fighters: readonly MatchFighter[]; selfId: string };
  /** `predicted` is true for locally-resolved attacks (plan §1.1 D1). */
  'combat:events': { events: readonly CombatEvent[]; predicted: boolean };
  'match:snapshot': MatchSnapshot;
  'match:over': MatchResult;
  /** Per-keystroke; consumed by the typing band, never by React state. */
  'typing:progress': TypingProgress;
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

class GameBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }

    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;

    for (const handler of set) {
      // One misbehaving listener must not stop the rest of the frame's work —
      // a thrown error in an FX handler should not also freeze the HUD.
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        console.error(`[gameBus] handler for ${String(event)} threw`, error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const gameBus = new GameBus();
