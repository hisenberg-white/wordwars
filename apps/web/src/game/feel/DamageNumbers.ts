import Phaser from 'phaser';
import type { ImpactFeel } from './impact';

const POOL_SIZE = 24;

const COLOR_NORMAL = '#ecedf7';
const COLOR_CRIT = '#ff8a1f';
const COLOR_ULTIMATE = '#ffc53d';

/**
 * Floating damage numbers.
 *
 * They pop, arc and fade rather than simply rising: a number that travels in a
 * straight line reads as UI, while one thrown out on an arc reads as debris
 * from the hit. Small difference, and it is most of why fighting games do it
 * that way.
 *
 * Pooled like everything else in the hot path (§6.4) — a long combo would
 * otherwise allocate a Text object per hit, and Text is among the more
 * expensive objects Phaser can create.
 */
export class DamageNumbers {
  private readonly pool: Phaser.GameObjects.Text[] = [];
  private cursor = 0;

  constructor(private readonly scene: Phaser.Scene) {
    for (let i = 0; i < POOL_SIZE; i += 1) {
      this.pool.push(
        scene.add
          .text(0, 0, '', {
            fontFamily: 'Chakra Petch, sans-serif',
            fontSize: '34px',
            fontStyle: '700',
            color: COLOR_NORMAL,
            stroke: '#06060b',
            strokeThickness: 5,
          })
          .setOrigin(0.5)
          .setDepth(80)
          .setActive(false)
          .setVisible(false),
      );
    }
  }

  show(at: { x: number; y: number }, number: NonNullable<ImpactFeel['damageNumber']>): void {
    const text = this.next();

    const color = number.ultimate ? COLOR_ULTIMATE : number.crit ? COLOR_CRIT : COLOR_NORMAL;

    text
      .setText(number.ultimate || number.crit ? `${number.value}!` : String(number.value))
      .setColor(color)
      .setPosition(at.x + Phaser.Math.Between(-26, 26), at.y - 110)
      .setScale(number.scale * 0.6)
      .setAlpha(1)
      .setAngle(Phaser.Math.Between(-8, 8))
      .setActive(true)
      .setVisible(true);

    // Overshoot then settle — the pop that makes it feel thrown rather than
    // drawn.
    this.scene.tweens.add({
      targets: text,
      scale: number.scale,
      duration: 110,
      ease: 'Back.easeOut',
    });

    this.scene.tweens.add({
      targets: text,
      x: text.x + Phaser.Math.Between(-40, 40),
      y: text.y - Phaser.Math.Between(60, 100),
      alpha: 0,
      duration: number.ultimate ? 1100 : 750,
      delay: 90,
      ease: 'Quad.easeOut',
      onComplete: () => text.setActive(false).setVisible(false),
    });
  }

  private next(): Phaser.GameObjects.Text {
    const text = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.pool.length;
    return text;
  }

  destroy(): void {
    for (const text of this.pool) text.destroy();
  }
}
