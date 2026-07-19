import Phaser from 'phaser';
import type { ArenaScenery } from '../arenaTheme';
import { silhouette } from '../silhouette';

/**
 * The stage.
 *
 * Three procedurally generated silhouette layers over a gradient sky, drifting
 * at different speeds. No art assets — the skyline is generated from the
 * arena's `profile`, so a volcano gets jagged peaks and Cyber City gets
 * rooflines, and the two are distinguishable at a glance without a label.
 *
 * Everything here is drawn ONCE into textures rather than re-rendered per
 * frame. A backdrop that costs frame budget is a backdrop stealing it from the
 * fight (plan §6.4).
 */
export class Backdrop {
  private readonly layers: Phaser.GameObjects.TileSprite[] = [];
  private readonly motes: Phaser.GameObjects.Group | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly scenery: ArenaScenery,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.drawSky();
    this.drawSkylines();
    this.drawGround();
    if (scenery.particle) this.motes = this.createMotes();
  }

  private drawSky(): void {
    const g = this.scene.add.graphics();
    const [top, bottom] = this.scenery.sky;

    // Banded vertical gradient. 48 bands is past the point the eye can
    // separate them, and far cheaper than a per-pixel fill.
    const bands = 48;
    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1);
      g.fillStyle(mix(top, bottom, t), 1);
      g.fillRect(0, (this.height / bands) * i, this.width, this.height / bands + 1);
    }

    g.setScrollFactor(0).setDepth(-100);
  }

  private drawSkylines(): void {
    const horizon = this.height * 0.62;
    const depths = [0.06, 0.14, 0.26];
    const heights = [0.3, 0.22, 0.14];

    this.scenery.layers.forEach((color, index) => {
      const key = `skyline-${index}-${color}-${this.scenery.profile}`;
      if (!this.scene.textures.exists(key)) {
        this.renderSkylineTexture(key, color, this.height * heights[index]!, index);
      }

      const layer = this.scene.add
        .tileSprite(0, horizon, this.width * 2, this.height * heights[index]!, key)
        .setOrigin(0, 1)
        .setScrollFactor(0)
        .setDepth(-90 + index);

      layer.setData('speed', depths[index]);
      this.layers.push(layer);
    });
  }

  /** Renders one skyline strip into a reusable texture. */
  private renderSkylineTexture(
    key: string,
    color: number,
    height: number,
    layerIndex: number,
  ): void {
    const w = Math.ceil(this.width);
    const h = Math.ceil(height);
    const texture = this.scene.textures.createCanvas(key, w, h);
    if (!texture) return;

    const ctx = texture.getContext();
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;

    const points = silhouette(this.scenery.profile, w, h, layerIndex);

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    texture.refresh();
  }

  private drawGround(): void {
    const horizon = this.height * 0.62;

    this.scene.add
      .rectangle(0, horizon, this.width, this.height - horizon, this.scenery.ground)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-80);

    // A lit line along the horizon. Cheap, and it gives the fighters a floor
    // to stand on rather than floating in a colour field.
    this.scene.add
      .rectangle(0, horizon, this.width, 2, this.scenery.accent, 0.35)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-79);
  }

  /** Ambient motes: embers rise, snow and blossom fall. */
  private createMotes(): Phaser.GameObjects.Group {
    const particle = this.scenery.particle!;
    const group = this.scene.add.group();

    for (let i = 0; i < 26; i += 1) {
      const mote = this.scene.add
        .circle(
          Phaser.Math.Between(0, this.width),
          Phaser.Math.Between(0, this.height),
          Phaser.Math.FloatBetween(1, 2.6),
          particle.color,
          Phaser.Math.FloatBetween(0.2, 0.6),
        )
        .setScrollFactor(0)
        .setDepth(-70);

      this.scene.tweens.add({
        targets: mote,
        y: particle.rise ? -20 : this.height + 20,
        x: `+=${Phaser.Math.Between(-60, 60)}`,
        duration: Phaser.Math.Between(7000, 16000),
        repeat: -1,
        delay: Phaser.Math.Between(0, 6000),
        onRepeat: () => {
          mote.y = particle.rise ? this.height + 20 : -20;
          mote.x = Phaser.Math.Between(0, this.width);
        },
      });

      group.add(mote);
    }

    return group;
  }

  /** Called each frame; drifts the parallax layers. */
  update(delta: number): void {
    for (const layer of this.layers) {
      layer.tilePositionX += (layer.getData('speed') as number) * delta * 0.03;
    }
  }

  destroy(): void {
    for (const layer of this.layers) layer.destroy();
    this.motes?.destroy(true);
  }
}

function mix(from: number, to: number, t: number): number {
  const a = Phaser.Display.Color.ValueToColor(from);
  const b = Phaser.Display.Color.ValueToColor(to);

  return Phaser.Display.Color.GetColor(
    Math.round(a.red + (b.red - a.red) * t),
    Math.round(a.green + (b.green - a.green) * t),
    Math.round(a.blue + (b.blue - a.blue) * t),
  );
}
