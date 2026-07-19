import type { SoundSpec } from './soundFor';
import { VOICES } from './synth';

export interface AudioSettings {
  readonly master: number;
  readonly sfx: number;
  readonly typing: boolean;
}

const DEFAULTS: AudioSettings = { master: 0.7, sfx: 0.8, typing: true };

/**
 * The mixer.
 *
 * Built around one behaviour that matters more than any individual sound:
 * **ducking**. Plan §5.5 — "Audio ducks during ultimates. Silence sells
 * impact." Pulling the floor out from under a big hit makes it land harder
 * than raising its own volume ever could, and it is the difference between a
 * loud game and a game with dynamics.
 *
 * The `AudioContext` is created lazily and resumed on the first user gesture,
 * because every browser blocks audio until then. A match always begins after a
 * click (Ready, or Play Now), so by the time combat starts the context is
 * live — but the guard is there because an autoplay-blocked context throws on
 * every single sound otherwise.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;

  private settings: AudioSettings = DEFAULTS;
  private duckUntil = 0;
  private unlocked = false;

  /** Call from any user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.unlocked) return;

    try {
      const ctx = this.context();
      if (!ctx) return;

      void ctx.resume();
      this.unlocked = ctx.state === 'running';
    } catch {
      // Audio is a nice-to-have. A browser that refuses it must not break the
      // game — the fight is fully playable in silence.
    }
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;

    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    try {
      const ctx = new Ctor();

      const master = ctx.createGain();
      master.gain.value = this.settings.master;
      master.connect(ctx.destination);

      const sfx = ctx.createGain();
      sfx.gain.value = this.settings.sfx;
      sfx.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.sfx = sfx;

      return ctx;
    } catch {
      return null;
    }
  }

  play(spec: SoundSpec): void {
    const ctx = this.context();
    const sfx = this.sfx;
    if (!ctx || !sfx || ctx.state !== 'running') return;

    if (!this.settings.typing && spec.kind.startsWith('keystroke')) return;

    const voice = VOICES[spec.kind];
    if (!voice) return;

    // A sound that requests ducking pulls everything else down for its
    // duration, then releases smoothly rather than snapping back.
    if (spec.duckMs > 0) this.duck(spec.duckMs);

    try {
      voice.render(ctx, sfx, spec.pitch, spec.gain);
    } catch {
      /* A dropped sound is never worth interrupting a match for. */
    }
  }

  private duck(durationMs: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const until = now + durationMs / 1000;

    // A longer duck already in progress wins, so a small hit landing during an
    // Ultimate cannot cut the Ultimate's silence short.
    if (until <= this.duckUntil) return;
    this.duckUntil = until;

    const ducked = this.settings.master * 0.25;

    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(ducked, now + 0.02);
    master.gain.setValueAtTime(ducked, until);
    master.gain.linearRampToValueAtTime(this.settings.master, until + 0.25);
  }

  update(settings: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...settings };

    if (this.master) this.master.gain.value = this.settings.master;
    if (this.sfx) this.sfx.gain.value = this.settings.sfx;
  }

  get current(): AudioSettings {
    return this.settings;
  }
}

export const audio = new AudioEngine();
