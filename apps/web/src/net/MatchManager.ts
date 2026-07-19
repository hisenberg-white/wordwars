import { applyWordAttempt, createMatchState, type EngineMatchState } from '@wordwars/engine';
import type {
  CombatEvent,
  MatchConfig,
  MatchFighter,
  MatchResult,
  MatchSnapshot,
  PlayerId,
} from '@wordwars/shared';
import { connection } from './ConnectionManager';
import { InputEngine, type WordCommit } from '@/input/InputEngine';

export type MatchStatus = 'idle' | 'live' | 'ended';

/**
 * Coarse state React is allowed to see.
 *
 * Deliberately small. HP, combo and the event stream change many times a
 * second and belong to the renderer, not to React (plan §1.1 D3) — they are
 * delivered through `onEvent` / `onSnapshot` callbacks straight to Phaser and
 * to HUD elements that write the DOM directly.
 */
export interface MatchSnapshotView {
  readonly status: MatchStatus;
  readonly config: MatchConfig | null;
  readonly fighters: readonly MatchFighter[];
  readonly result: MatchResult | null;
}

const IDLE: MatchSnapshotView = { status: 'idle', config: null, fighters: [], result: null };

type EventListener = (events: readonly CombatEvent[], predicted: boolean) => void;
type StateListener = (snapshot: MatchSnapshot) => void;

/**
 * Client-side match orchestration.
 *
 * Owns the local copy of the combat engine used for prediction. When the
 * player commits a word, the attack resolves LOCALLY and immediately so the
 * animation fires on the same frame as the keystroke; the server's
 * authoritative events arrive milliseconds later and correct anything that
 * differs (plan §1.1 D1).
 *
 * Prediction is deliberately limited to *our own* attacks. The opponent's
 * words are never guessed — we have no idea what they are typing, so there is
 * nothing to predict and everything to get wrong.
 */
class MatchManager {
  readonly input = new InputEngine();

  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly stateListeners = new Set<StateListener>();

  private view: MatchSnapshotView = IDLE;
  private local: EngineMatchState | null = null;
  private selfId: PlayerId | null = null;
  private bound = false;

  bind(selfId: PlayerId): void {
    this.selfId = selfId;

    const socket = connection.socket;
    if (!socket || this.bound) return;
    this.bound = true;

    socket.on('match:start', ({ config, fighters, firstSentence }) => {
      this.local = createMatchState({
        matchId: config.matchId,
        seed: config.seed,
        players: [fighters[0]!.playerId, fighters[1]!.playerId],
        maxHp: config.maxHp,
        enableUltimate: config.enableUltimate,
        enableCrits: config.enableCrits,
      });

      this.input.reset();
      this.input.pushSentence(firstSentence.words);
      this.input.attach(document, performance.now());

      this.publish({ status: 'live', config, fighters, result: null });
    });

    socket.on('match:sentence', (sentence) => this.input.pushSentence(sentence.words));

    socket.on('match:events', ({ events }) => {
      for (const listener of this.eventListeners) listener(events, false);
    });

    socket.on('match:state', (snapshot) => {
      for (const listener of this.stateListeners) listener(snapshot);
    });

    socket.on('match:end', (result) => {
      this.input.detach();
      this.publish({ status: 'ended', result });
    });

    // A committed word fires locally first, then goes to the server.
    this.input.onCommit((commit) => this.handleCommit(commit));
  }

  private handleCommit(commit: WordCommit): void {
    const socket = connection.socket;
    const config = this.view.config;
    if (!config || !this.selfId) return;

    // Predict: resolve against the local engine so the attack animation can
    // start on this frame rather than after a round trip.
    if (this.local) {
      const delta = applyWordAttempt(this.local, {
        playerId: this.selfId,
        wordIndex: commit.wordIndex,
        wordLength: commit.word.length,
        dirty: commit.dirty,
        atMs: commit.atMs,
      });

      if (delta.events.length > 0) {
        for (const listener of this.eventListeners) listener(delta.events, true);
      }
    }

    socket?.emit('match:word', {
      matchId: config.matchId,
      wordIndex: commit.wordIndex,
      dirty: commit.dirty,
      timings: [...commit.timings],
    });
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onSnapshot(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  leave(): void {
    this.input.detach();
    this.input.reset();
    this.publish(IDLE);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MatchSnapshotView => this.view;

  private publish(patch: Partial<MatchSnapshotView>): void {
    const next = { ...this.view, ...patch };

    const unchanged = (Object.keys(next) as Array<keyof MatchSnapshotView>).every(
      (k) => next[k] === this.view[k],
    );
    if (unchanged) return;

    this.view = next;
    for (const listener of this.listeners) listener();
  }
}

export const matchManager = new MatchManager();
