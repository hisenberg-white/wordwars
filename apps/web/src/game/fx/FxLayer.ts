import Phaser from 'phaser';
import type { EffectSpec } from './effects';

export interface Anchors {
  readonly actor: { x: number; y: number };
  readonly target: { x: number; y: number };
}

/**
 * Draws effects.
 *
 * Deliberately dumb: it takes an `EffectSpec` and renders it, with no opinion
 * about when or why. Every design decision lives in `effects.ts`, where it can
 * be tested.
 *
 * **Everything is pooled.** Allocating a game object per particle means the GC
 * runs during exactly the moments the game is busiest — a long combo — and a
 * collection pause mid-combo is a dropped frame the player will feel (§6.4).
 * The pools are sized for the worst realistic case and reused forever.
 */
const POOL_PARTICLES = 220;
const POOL_RINGS = 12;
const POOL_BARS = 10;

export class FxLayer {
  private readonly particles: Phaser.GameObjects.Arc[] = [];
  private readonly rings: Phaser.GameObjects.Arc[] = [];
  private readonly bars: Phaser.GameObjects.Rectangle[] = [];

  private particleCursor = 0;
  private ringCursor = 0;
  private barCursor = 0;

  constructor(private readonly scene: Phaser.Scene) {
    for (let i = 0; i < POOL_PARTICLES; i += 1) {
      this.particles.push(
        scene.add
          .circle(0, 0, 3, 0xffffff)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setActive(false)
          .setVisible(false)
          .setDepth(50),
      );
    }

    for (let i = 0; i < POOL_RINGS; i += 1) {
      this.rings.push(
        scene.add
          .circle(0, 0, 40)
          .setStrokeStyle(3, 0xffffff)
          .setFillStyle()
          .setBlendMode(Phaser.BlendModes.ADD)
          .setActive(false)
          .setVisible(false)
          .setDepth(49),
      );
    }

    for (let i = 0; i < POOL_BARS; i += 1) {
      this.bars.push(
        scene.add
          .rectangle(0, 0, 10, 6, 0xffffff)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setActive(false)
          .setVisible(false)
          .setDepth(51),
      );
    }
  }

  play(effects: readonly EffectSpec[], anchors: Anchors): void {
    for (const effect of effects) {
      if (effect.delayMs > 0) {
        this.scene.time.delayedCall(effect.delayMs, () => this.render(effect, anchors));
      } else {
        this.render(effect, anchors);
      }
    }
  }

  private render(effect: EffectSpec, anchors: Anchors): void {
    const at = this.resolve(effect.anchor, anchors);

    switch (effect.kind) {
      case 'impact':
        this.burst(at, effect, 1);
        break;
      case 'debris':
        this.burst(at, effect, 0.45);
        break;
      case 'shockwave':
      case 'aura':
        this.ring(at, effect);
        break;
      case 'projectile':
        this.projectile(anchors, effect);
        break;
      case 'beam':
        this.beam(anchors, effect);
        break;
      case 'slash':
        this.slash(at, effect);
        break;
    }
  }

  private resolve(anchor: EffectSpec['anchor'], anchors: Anchors): { x: number; y: number } {
    if (anchor === 'actor') return anchors.actor;
    if (anchor === 'target') return anchors.target;
    return {
      x: (anchors.actor.x + anchors.target.x) / 2,
      y: (anchors.actor.y + anchors.target.y) / 2,
    };
  }

  /** Radial spray. `gravity` pulls debris down; impacts fly straight. */
  private burst(at: { x: number; y: number }, effect: EffectSpec, gravity: number): void {
    for (let i = 0; i < effect.count; i += 1) {
      const particle = this.nextParticle();
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const speed = Phaser.Math.FloatBetween(40, 140) * effect.scale;

      particle
        .setPosition(at.x, at.y)
        .setRadius(Phaser.Math.FloatBetween(1.5, 4) * effect.scale)
        .setFillStyle(effect.color)
        .setAlpha(1)
        .setActive(true)
        .setVisible(true);

      this.scene.tweens.add({
        targets: particle,
        x: at.x + Math.cos(angle) * speed,
        y: at.y + Math.sin(angle) * speed + gravity * 60,
        alpha: 0,
        duration: effect.durationMs,
        ease: 'Quad.easeOut',
        onComplete: () => particle.setActive(false).setVisible(false),
      });
    }
  }

  private ring(at: { x: number; y: number }, effect: EffectSpec): void {
    const ring = this.nextRing();

    ring
      .setPosition(at.x, at.y - 60)
      .setStrokeStyle(3, effect.color)
      .setScale(0.2)
      .setAlpha(0.9)
      .setActive(true)
      .setVisible(true);

    this.scene.tweens.add({
      targets: ring,
      scale: effect.scale,
      alpha: 0,
      duration: effect.durationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.setActive(false).setVisible(false),
    });
  }

  /** A travelling shot. Its arrival is what the delayed impact is timed to. */
  private projectile(anchors: Anchors, effect: EffectSpec): void {
    const particle = this.nextParticle();
    const from = anchors.actor;
    const to = anchors.target;

    particle
      .setPosition(from.x, from.y - 60)
      .setRadius(5 * effect.scale)
      .setFillStyle(effect.color)
      .setAlpha(1)
      .setActive(true)
      .setVisible(true);

    this.scene.tweens.add({
      targets: particle,
      x: to.x,
      y: to.y - 60,
      duration: effect.durationMs,
      ease: 'Quad.easeIn',
      onComplete: () => particle.setActive(false).setVisible(false),
    });
  }

  private beam(anchors: Anchors, effect: EffectSpec): void {
    const bar = this.nextBar();
    const from = anchors.actor;
    const to = anchors.target;

    const midX = (from.x + to.x) / 2;
    const length = Math.abs(to.x - from.x);

    bar
      .setPosition(midX, from.y - 60)
      .setSize(length, 6 * effect.scale)
      .setFillStyle(effect.color)
      .setAlpha(0)
      .setScale(1, 0.2)
      .setActive(true)
      .setVisible(true);

    this.scene.tweens.add({
      targets: bar,
      alpha: 1,
      scaleY: 1,
      duration: effect.durationMs * 0.3,
      yoyo: true,
      hold: effect.durationMs * 0.4,
      onComplete: () => bar.setActive(false).setVisible(false),
    });
  }

  private slash(at: { x: number; y: number }, effect: EffectSpec): void {
    const bar = this.nextBar();

    bar
      .setPosition(at.x, at.y - 60)
      .setSize(90 * effect.scale, 5)
      .setFillStyle(effect.color)
      .setAngle(Phaser.Math.Between(-60, -30))
      .setAlpha(1)
      .setScale(0.2, 1)
      .setActive(true)
      .setVisible(true);

    this.scene.tweens.add({
      targets: bar,
      scaleX: 1.2,
      alpha: 0,
      duration: effect.durationMs,
      ease: 'Expo.easeOut',
      onComplete: () => bar.setActive(false).setVisible(false),
    });
  }

  // ---- Pool cursors -----------------------------------------------------
  //
  // Round-robin rather than "find a free one". At worst the oldest still-live
  // particle is recycled early, which is invisible; scanning for a free slot
  // every spawn would not be.

  private nextParticle(): Phaser.GameObjects.Arc {
    const particle = this.particles[this.particleCursor]!;
    this.particleCursor = (this.particleCursor + 1) % this.particles.length;
    return particle;
  }

  private nextRing(): Phaser.GameObjects.Arc {
    const ring = this.rings[this.ringCursor]!;
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    return ring;
  }

  private nextBar(): Phaser.GameObjects.Rectangle {
    const bar = this.bars[this.barCursor]!;
    this.barCursor = (this.barCursor + 1) % this.bars.length;
    return bar;
  }

  destroy(): void {
    for (const object of [...this.particles, ...this.rings, ...this.bars]) object.destroy();
  }
}
