import Phaser from 'phaser';
import type { FighterAnimation } from '@wordwars/shared';

/**
 * What the game asks of a fighter.
 *
 * **This interface is the swap point for real art (plan §6.3).** Everything
 * outside this file talks to a fighter only through `play`, `setFacing` and
 * `flash` — so replacing the procedural body below with a spritesheet in phase
 * 5.1 touches one file and no game logic. Keeping that boundary honest now is
 * what makes "fun before pretty" a sequencing choice rather than a rewrite.
 */
export interface FighterView {
  play(animation: FighterAnimation): void;
  flash(color: number): void;
  readonly container: Phaser.GameObjects.Container;
  destroy(): void;
}

export interface FighterOptions {
  readonly scene: Phaser.Scene;
  readonly x: number;
  readonly y: number;
  /** 1 faces right, -1 faces left. Fighters always face each other. */
  readonly facing: 1 | -1;
  readonly color: number;
  readonly accent: number;
}

const BODY = {
  headRadius: 17,
  torsoWidth: 46,
  torsoHeight: 62,
  limbWidth: 13,
  armLength: 40,
  legLength: 46,
};

/**
 * A procedural fighter: layered geometry, no art assets.
 *
 * Deliberately silhouette-and-neon rather than a grey placeholder box. A
 * stylised abstraction reads as an intentional art direction; a stick figure
 * reads as unfinished. The parts are separate game objects specifically so
 * they can be tweened independently — a lunge is the torso moving while the
 * arm rotates, which is what makes it look like a strike rather than a slide.
 */
export class ProceduralFighter implements FighterView {
  readonly container: Phaser.GameObjects.Container;

  private readonly scene: Phaser.Scene;
  private readonly facing: 1 | -1;

  private readonly glow: Phaser.GameObjects.Ellipse;
  private readonly head: Phaser.GameObjects.Arc;
  private readonly torso: Phaser.GameObjects.Polygon;
  private readonly frontArm: Phaser.GameObjects.Rectangle;
  private readonly backArm: Phaser.GameObjects.Rectangle;
  private readonly frontLeg: Phaser.GameObjects.Rectangle;
  private readonly backLeg: Phaser.GameObjects.Rectangle;
  private readonly parts: Phaser.GameObjects.Shape[];

  private idleTween: Phaser.Tweens.Tween | null = null;
  private actionTweens: Phaser.Tweens.Tween[] = [];
  private current: FighterAnimation = 'idle';

  constructor({ scene, x, y, facing, color, accent }: FighterOptions) {
    this.scene = scene;
    this.facing = facing;

    // Additive glow behind the body. Phaser has no cheap blur, but a large,
    // low-alpha additive ellipse reads as bloom at a fraction of the cost.
    this.glow = scene.add
      .ellipse(0, -40, 150, 190, color, 0.16)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.backArm = scene.add
      .rectangle(-8 * facing, -60, BODY.limbWidth, BODY.armLength, darken(color, 0.55))
      .setOrigin(0.5, 0);
    this.backLeg = scene.add
      .rectangle(-9 * facing, -22, BODY.limbWidth, BODY.legLength, darken(color, 0.5))
      .setOrigin(0.5, 0);

    // An angular torso rather than a rectangle: hard diagonals match the UI's
    // clipped panels and read as armour instead of a box.
    this.torso = scene.add.polygon(
      0,
      -58,
      [
        -BODY.torsoWidth / 2,
        -BODY.torsoHeight / 2,
        BODY.torsoWidth / 2 - 6,
        -BODY.torsoHeight / 2 - 4,
        BODY.torsoWidth / 2,
        BODY.torsoHeight / 2 - 8,
        -BODY.torsoWidth / 2 + 5,
        BODY.torsoHeight / 2,
      ],
      color,
    );

    this.frontLeg = scene.add
      .rectangle(9 * facing, -22, BODY.limbWidth, BODY.legLength, color)
      .setOrigin(0.5, 0);
    this.head = scene.add.circle(6 * facing, -104, BODY.headRadius, color);
    this.frontArm = scene.add
      .rectangle(12 * facing, -66, BODY.limbWidth, BODY.armLength, brighten(color, 0.25))
      .setOrigin(0.5, 0);

    // A thin accent stripe: the one detail that stops the silhouette reading
    // as a shadow.
    const visor = scene.add.rectangle(10 * facing, -106, 20, 5, accent).setAlpha(0.95);

    this.parts = [
      this.backArm,
      this.backLeg,
      this.torso,
      this.frontLeg,
      this.head,
      this.frontArm,
      visor,
    ];

    this.container = scene.add.container(x, y, [this.glow, ...this.parts]);
    this.play('idle');
  }

  play(animation: FighterAnimation): void {
    // A KO is final: nothing may animate a fighter back onto its feet.
    if (this.current === 'ko' && animation !== 'victory') return;

    this.stopAction();
    this.current = animation;

    switch (animation) {
      case 'attack':
      case 'combo':
        this.playAttack(animation === 'combo');
        break;
      case 'ultimate':
        this.playUltimate();
        break;
      case 'hit':
        this.playHit();
        break;
      case 'ko':
        this.playKnockout();
        break;
      case 'victory':
        this.playVictory();
        break;
      default:
        this.playIdle();
    }
  }

  flash(color: number): void {
    for (const part of this.parts) {
      const original = part.fillColor;
      part.setFillStyle(color);
      this.scene.time.delayedCall(70, () => part.setFillStyle(original));
    }
  }

  // ---- Animations -------------------------------------------------------

  private playIdle(): void {
    this.startIdleBob();

    this.scene.tweens.add({
      targets: this.container,
      x: this.container.x,
      duration: 140,
      ease: 'Quad.easeOut',
    });
  }

  /**
   * A lunge, not a slide.
   *
   * The torso drives forward while the arm swings through — two tweens on
   * different objects with different easings. That difference is the whole
   * reason the body parts are separate objects.
   */
  private playAttack(isCombo: boolean): void {
    this.stopIdleBob();
    const reach = isCombo ? 34 : 24;

    this.actionTweens.push(
      this.scene.tweens.add({
        targets: this.container,
        x: this.container.x + reach * this.facing,
        duration: 90,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => this.play('idle'),
      }),
      this.scene.tweens.add({
        targets: this.frontArm,
        angle: 105 * this.facing,
        duration: 80,
        yoyo: true,
        ease: 'Back.easeOut',
      }),
      this.scene.tweens.add({
        targets: this.torso,
        angle: 10 * this.facing,
        duration: 90,
        yoyo: true,
      }),
    );
  }

  /** Wind up, hold, then commit — the anticipation is what sells the moment. */
  private playUltimate(): void {
    this.stopIdleBob();

    this.actionTweens.push(
      this.scene.tweens.add({
        targets: this.container,
        x: this.container.x - 30 * this.facing,
        scaleX: 1.12,
        scaleY: 1.12,
        duration: 380,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.actionTweens.push(
            this.scene.tweens.add({
              targets: this.container,
              x: this.container.x + 90 * this.facing,
              scaleX: 1,
              scaleY: 1,
              duration: 130,
              yoyo: true,
              ease: 'Expo.easeOut',
              onComplete: () => this.play('idle'),
            }),
          );
        },
      }),
      this.scene.tweens.add({
        targets: this.glow,
        scaleX: 1.7,
        scaleY: 1.7,
        alpha: 0.5,
        duration: 380,
        yoyo: true,
      }),
    );
  }

  private playHit(): void {
    this.stopIdleBob();
    this.flash(0xffffff);

    this.actionTweens.push(
      this.scene.tweens.add({
        targets: this.container,
        x: this.container.x - 16 * this.facing,
        duration: 70,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => this.play('idle'),
      }),
      this.scene.tweens.add({
        targets: this.torso,
        angle: -12 * this.facing,
        duration: 70,
        yoyo: true,
      }),
    );
  }

  private playKnockout(): void {
    this.stopIdleBob();

    this.actionTweens.push(
      this.scene.tweens.add({
        targets: this.container,
        angle: -75 * this.facing,
        y: this.container.y + 34,
        alpha: 0.55,
        duration: 620,
        ease: 'Bounce.easeOut',
      }),
      this.scene.tweens.add({ targets: this.glow, alpha: 0, duration: 400 }),
    );
  }

  private playVictory(): void {
    this.stopIdleBob();

    this.actionTweens.push(
      this.scene.tweens.add({
        targets: this.container,
        y: this.container.y - 22,
        duration: 320,
        yoyo: true,
        repeat: 2,
        ease: 'Quad.easeOut',
      }),
      this.scene.tweens.add({
        targets: this.glow,
        alpha: 0.4,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 500,
        yoyo: true,
        repeat: -1,
      }),
    );
  }

  // ---- Tween bookkeeping ------------------------------------------------

  private startIdleBob(): void {
    if (this.idleTween) return;

    // Breathing. Small enough to be subliminal, but a perfectly still fighter
    // reads as a frozen game.
    this.idleTween = this.scene.tweens.add({
      targets: [this.torso, this.head],
      y: '+=4',
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private stopIdleBob(): void {
    this.idleTween?.stop();
    this.idleTween = null;
  }

  private stopAction(): void {
    for (const tween of this.actionTweens) tween.stop();
    this.actionTweens = [];

    // Reset anything a stopped tween may have left mid-flight, so a rapid
    // sequence of attacks cannot leave an arm stuck at 90 degrees.
    this.frontArm.setAngle(0);
    this.torso.setAngle(0);
  }

  destroy(): void {
    this.stopIdleBob();
    this.stopAction();
    this.container.destroy(true);
  }
}

function darken(color: number, amount: number): number {
  return Phaser.Display.Color.ValueToColor(color).darken(amount * 100).color;
}

function brighten(color: number, amount: number): number {
  return Phaser.Display.Color.ValueToColor(color).brighten(amount * 100).color;
}
