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
import { gameBus } from '@/game/bus';
import { filterPredicted, filterServer } from './eventReconciler';
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
  /** Set while an opponent is disconnected and the fight is on hold (§7.3). */
  readonly pausedBy: { nickname: string; resumeDeadline: number } | null;
}

const IDLE: MatchSnapshotView = {
  status: 'idle',
  config: null,
  fighters: [],
  result: null,
  pausedBy: null,
};

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

    // Everything the renderer needs crosses the game bus, never React props.
    this.onEvent((events, predicted) => gameBus.emit('combat:events', { events, predicted }));
    this.onSnapshot((snapshot) => gameBus.emit('match:snapshot', snapshot));
    this.input.onProgress((progress) => gameBus.emit('typing:progress', progress));

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

      gameBus.emit('match:begin', { config, fighters, selfId: this.selfId ?? '' });
      this.publish({ status: 'live', config, fighters, result: null });
    });

    socket.on('match:sentence', (sentence) => this.input.pushSentence(sentence.words));

    socket.on('match:events', ({ events }) => {
      // Drop the server's copy of anything we already predicted, or the
      // damage lands twice. See eventReconciler.
      const rendered = filterServer(events, this.selfId);
      if (rendered.length > 0) {
        for (const listener of this.eventListeners) listener(rendered, false);
      }
    });

    socket.on('match:state', (snapshot) => {
      for (const listener of this.stateListeners) listener(snapshot);
    });

    socket.on('match:paused', ({ nickname, resumeDeadline }) => {
      // Input is detached, not merely ignored: leaving it live would let the
      // player build a buffer of words that all land the instant play resumes.
      this.input.detach();
      this.publish({ pausedBy: { nickname, resumeDeadline } });
    });

    socket.on('match:resumed', ({ snapshot, sentences }) => {
      this.input.reset();
      for (const sentence of sentences) this.input.pushSentence(sentence.words);

      // Resume from where the SERVER says we got to, not from the start of the
      // text we were just re-sent.
      const self = snapshot.fighters.find((f) => f.playerId === this.selfId);
      if (self) this.input.seek(self.wordIndex);

      this.input.attach(document, performance.now());
      gameBus.emit('match:snapshot', snapshot);
      this.publish({ pausedBy: null });
    });

    socket.on('match:end', (result) => {
      this.input.detach();
      gameBus.emit('match:over', result);
      this.publish({ status: 'ended', result, pausedBy: null });
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

      const predicted = filterPredicted(delta.events);
      if (predicted.length > 0) {
        for (const listener of this.eventListeners) listener(predicted, true);
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
