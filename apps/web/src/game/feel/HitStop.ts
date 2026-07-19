import type Phaser from 'phaser';

/**
 * Freezes the scene on impact.
 *
 * Implemented by zeroing the tween and timer time scales rather than pausing
 * the scene, so the render loop keeps running — the frame stays on screen,
 * perfectly still, which is the entire effect. Pausing would stop drawing too.
 *
 * The recovery timer uses `window.setTimeout` deliberately: the scene's own
 * clock is what we just stopped, so scheduling the un-freeze on it would
 * freeze the game permanently.
 */
export class HitStop {
  private timer: number | null = null;
  private frozenUntil = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  freeze(durationMs: number): void {
    if (durationMs <= 0) return;

    const until = Date.now() + durationMs;

    // A stronger freeze already in progress wins. Otherwise a light jab
    // arriving just after a crit would cut the crit's freeze short.
    if (until <= this.frozenUntil) return;
    this.frozenUntil = until;

    this.scene.tweens.timeScale = 0;
    this.scene.time.timeScale = 0;

    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.release(), durationMs);
  }

  private release(): void {
    this.timer = null;
    this.frozenUntil = 0;
    this.scene.tweens.timeScale = 1;
    this.scene.time.timeScale = 1;
  }

  /** Always call on teardown — a pending timer would unfreeze a dead scene. */
  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.scene.tweens.timeScale = 1;
    this.scene.time.timeScale = 1;
  }
}
