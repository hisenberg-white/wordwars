/**
 * The typing controller.
 *
 * This is the gamepad. Everything about it is shaped by that framing rather
 * than by "text entry" (plan §4):
 *
 *   - **No `<input>`, no `<textarea>`, no `contentEditable`.** A real form
 *     field brings mobile autocorrect, browser autofill, spellcheck underlines
 *     and IME composition — every one of which would either mangle a word or
 *     insert characters the player did not type. A fighting game does not read
 *     your inputs through a text box.
 *   - **Keystrokes are timestamped before anything else happens**, so latency
 *     in our own processing never pollutes the timing data the server uses for
 *     the tempo bonus and cheat heuristics.
 *   - **It lives outside React** (plan §1.1 D3). A keystroke must never cause a
 *     re-render; subscribers get told what changed and update the DOM directly.
 */

export interface WordCommit {
  readonly wordIndex: number;
  readonly word: string;
  /** True if the player mistyped anywhere in this word, even if they fixed it. */
  readonly dirty: boolean;
  /** Inter-key deltas in ms. Relative, never absolute — see §4.3. */
  readonly timings: readonly number[];
  /** Match-relative ms at which the word was committed. */
  readonly atMs: number;
}

export interface TypingProgress {
  readonly wordIndex: number;
  readonly expected: string;
  readonly typed: string;
  /** Characters matching the expected word from the start. */
  readonly correctChars: number;
  /** True once a mistake has been made — sticky until the word is committed. */
  readonly dirty: boolean;
  /** True if what is on screen right now is a valid prefix of the word. */
  readonly valid: boolean;
}

export interface InputEngineOptions {
  /** Injected so tests can drive time; defaults to the high-resolution clock. */
  readonly now?: () => number;
  /** Cap matching the server's payload schema (64). */
  readonly maxTimings?: number;
}

type CommitListener = (commit: WordCommit) => void;
type ProgressListener = (progress: TypingProgress) => void;
type ExhaustedListener = () => void;

const MAX_TIMINGS = 64;

export class InputEngine {
  private words: string[] = [];
  private wordIndex = 0;
  private typed = '';
  /** Sticky: a repair fixes the text but not the record (plan §4.2). */
  private dirty = false;
  private keyTimes: number[] = [];

  private attached = false;
  private startedAtMs = 0;
  private detachFn: (() => void) | null = null;

  private readonly now: () => number;
  private readonly maxTimings: number;

  private readonly commitListeners = new Set<CommitListener>();
  private readonly progressListeners = new Set<ProgressListener>();
  private readonly exhaustedListeners = new Set<ExhaustedListener>();

  constructor(options: InputEngineOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.maxTimings = options.maxTimings ?? MAX_TIMINGS;
  }

  // ---- Lifecycle --------------------------------------------------------

  /**
   * Starts listening. Only ever called for the duration of combat — outside a
   * match the game must not be swallowing the player's spacebar.
   */
  attach(target: EventTarget = document, startedAtMs = this.now()): void {
    if (this.attached) return;
    this.attached = true;
    this.startedAtMs = startedAtMs;
    target.addEventListener('keydown', this.handleKeyDown as EventListener);
    this.detachFn = () =>
      target.removeEventListener('keydown', this.handleKeyDown as EventListener);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.detachFn?.();
    this.detachFn = null;
  }

  reset(): void {
    this.words = [];
    this.wordIndex = 0;
    this.typed = '';
    this.dirty = false;
    this.keyTimes = [];
  }

  // ---- Text -------------------------------------------------------------

  /**
   * Appends a streamed sentence.
   *
   * Words are held in one flat list with global indices, so a sentence
   * boundary is invisible to the player — there is no pause, no "round
   * complete", and the combat never stops (plan §4.2).
   */
  pushSentence(words: readonly string[]): void {
    this.words.push(...words);
    this.emitProgress();
  }

  get remainingWords(): number {
    return this.words.length - this.wordIndex;
  }

  get currentWord(): string | null {
    return this.words[this.wordIndex] ?? null;
  }

  /**
   * Jumps the cursor to a word index.
   *
   * Used only on reconnect: the server is authoritative about how far a player
   * got, and a returning client must resume from THERE rather than from the
   * start of the text it was just re-sent.
   */
  seek(wordIndex: number): void {
    this.wordIndex = Math.max(0, Math.min(wordIndex, this.words.length));
    this.typed = '';
    this.dirty = false;
    this.keyTimes = [];
    this.emitProgress();
  }

  /**
   * The slice of text around the cursor, for the on-screen band.
   *
   * A window rather than the whole list: the player can only read a line or
   * two, and handing the renderer thousands of streamed words would mean
   * rebuilding them all every time the cursor moves.
   */
  window(before: number, after: number): { words: string[]; activeIndex: number } {
    const start = Math.max(0, this.wordIndex - before);
    const end = Math.min(this.words.length, this.wordIndex + after + 1);

    return {
      words: this.words.slice(start, end),
      activeIndex: this.wordIndex - start,
    };
  }

  // ---- Subscription -----------------------------------------------------

  onCommit(listener: CommitListener): () => void {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  /** Fires when the player has caught up to the end of the streamed text. */
  onExhausted(listener: ExhaustedListener): () => void {
    this.exhaustedListeners.add(listener);
    return () => this.exhaustedListeners.delete(listener);
  }

  // ---- Input ------------------------------------------------------------

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // FIRST statement in the handler, before any branching: this timestamp is
    // what the server uses to judge tempo, and it must measure the player's
    // hands rather than our own dispatch cost.
    const at = this.now();

    // Mid-composition keystrokes are not real characters yet; acting on them
    // double-types on IME keyboards.
    if (event.isComposing) return;

    // Let genuine shortcuts through — Ctrl+R to reload, Cmd+Tab to switch
    // away. Swallowing those would trap the player in the page.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Backspace') {
      event.preventDefault();
      this.handleBackspace();
      return;
    }

    if (event.key === ' ' || event.code === 'Space') {
      // Without this the page scrolls under the player on every single word.
      event.preventDefault();
      this.commit(at);
      return;
    }

    // Printable characters only. `key.length === 1` excludes Shift, Tab,
    // arrows, F-keys and friends without needing a list of them.
    if (event.key.length !== 1) return;

    event.preventDefault();
    this.handleCharacter(event.key, at);
  };

  private handleCharacter(char: string, at: number): void {
    const expected = this.currentWord;
    if (expected === null) return; // Waiting on the next sentence.

    this.typed += char;

    if (this.keyTimes.length < this.maxTimings) this.keyTimes.push(at);

    // Sticky. The player may repair the text, but the mistake is already
    // recorded — accuracy is what breaks the combo, not what is on screen.
    if (!expected.startsWith(this.typed)) this.dirty = true;

    this.emitProgress();
  }

  private handleBackspace(): void {
    if (this.typed.length === 0) return;
    this.typed = this.typed.slice(0, -1);
    this.emitProgress();
  }

  private commit(at: number): void {
    const expected = this.currentWord;
    if (expected === null) return;

    /*
     * An empty commit is ignored rather than counted as a miss.
     *
     * Otherwise holding space would march through the text at the key-repeat
     * rate, burning every word as a miss and destroying the match without the
     * player typing a character. Leading spaces are simply not input.
     */
    if (this.typed.length === 0) return;

    const dirty = this.dirty || this.typed !== expected;

    this.emitCommit({
      wordIndex: this.wordIndex,
      word: expected,
      dirty,
      timings: toDeltas(this.keyTimes),
      atMs: at - this.startedAtMs,
    });

    this.wordIndex += 1;
    this.typed = '';
    this.dirty = false;
    this.keyTimes = [];

    if (this.remainingWords === 0) {
      for (const listener of this.exhaustedListeners) listener();
    }

    this.emitProgress();
  }

  // ---- Emission ---------------------------------------------------------

  private emitCommit(commit: WordCommit): void {
    for (const listener of this.commitListeners) listener(commit);
  }

  private emitProgress(): void {
    if (this.progressListeners.size === 0) return;

    const expected = this.currentWord ?? '';
    const progress: TypingProgress = {
      wordIndex: this.wordIndex,
      expected,
      typed: this.typed,
      correctChars: countMatching(expected, this.typed),
      dirty: this.dirty,
      valid: expected.startsWith(this.typed),
    };

    for (const listener of this.progressListeners) listener(progress);
  }
}

/**
 * Absolute timestamps to inter-key deltas.
 *
 * Deltas rather than absolute times because the server has no use for the
 * player's wall clock and we have no business collecting it. The gap between
 * keystrokes is the only part that carries signal.
 */
function toDeltas(times: readonly number[]): number[] {
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    deltas.push(Math.max(0, Math.round(times[i]! - times[i - 1]!)));
  }
  return deltas;
}

function countMatching(expected: string, typed: string): number {
  let matched = 0;
  const limit = Math.min(expected.length, typed.length);
  while (matched < limit && expected[matched] === typed[matched]) matched += 1;
  return matched;
}
