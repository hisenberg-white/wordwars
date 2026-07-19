import Phaser from 'phaser';
import type { ArenaId, CombatEvent, PlayerId } from '@wordwars/shared';
import { ARENA_SCENERY } from '../arenaTheme';
import { gameBus } from '../bus';
import { Backdrop } from '../entities/Backdrop';
import { ProceduralFighter, type FighterView } from '../entities/Fighter';

/** Matches the CSS rivalry palette exactly — P1 crimson, P2 cyan. */
const P1_COLOR = 0xff2f57;
const P2_COLOR = 0x00e0ff;

export const ARENA_WIDTH = 1280;
export const ARENA_HEIGHT = 720;

/**
 * The fight, rendered.
 *
 * Subscribes to the game bus and animates. It has no idea the network exists,
 * cannot tell a predicted event from a confirmed one, and never asks React for
 * anything — the whole scene is driven by `combat:events` (plan §6.1).
 */
export class ArenaScene extends Phaser.Scene {
  static readonly KEY = 'arena';

  private backdrop: Backdrop | null = null;
  private readonly fighters = new Map<PlayerId, FighterView>();
  private readonly unsubscribes: Array<() => void> = [];

  constructor() {
    super(ArenaScene.KEY);
  }

  create(): void {
    this.unsubscribes.push(
      gameBus.on('match:begin', ({ config, fighters }) => {
        this.buildStage(config.arenaId);

        for (const fighter of fighters) {
          const isLeft = fighter.side === 'left';

          this.fighters.set(
            fighter.playerId,
            new ProceduralFighter({
              scene: this,
              x: isLeft ? ARENA_WIDTH * 0.28 : ARENA_WIDTH * 0.72,
              y: ARENA_HEIGHT * 0.78,
              facing: isLeft ? 1 : -1,
              color: isLeft ? P1_COLOR : P2_COLOR,
              accent: 0xffffff,
            }),
          );
        }
      }),

      gameBus.on('combat:events', ({ events }) => {
        for (const event of events) this.handleCombatEvent(event);
      }),

      gameBus.on('match:over', (result) => {
        for (const [playerId, fighter] of this.fighters) {
          fighter.play(playerId === result.winnerId ? 'victory' : 'defeat');
        }
      }),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  private buildStage(arenaId: ArenaId): void {
    this.backdrop?.destroy();
    this.backdrop = new Backdrop(this, ARENA_SCENERY[arenaId], ARENA_WIDTH, ARENA_HEIGHT);
  }

  /**
   * Translates one combat event into motion.
   *
   * Note there is no `hp` handling here. HP belongs to the HUD (3.6); this
   * scene's only job is to make the fighters behave like they are in a fight.
   */
  private handleCombatEvent(event: CombatEvent): void {
    switch (event.type) {
      case 'attack': {
        this.fighters.get(event.actor)?.play(event.combo >= 10 ? 'combo' : 'attack');
        // Delayed so the reaction lands when the strike would connect, rather
        // than simultaneously — simultaneity reads as two unrelated animations.
        this.time.delayedCall(70, () => this.fighters.get(event.target)?.play('hit'));
        break;
      }
      case 'ultimate': {
        this.fighters.get(event.actor)?.play('ultimate');
        this.time.delayedCall(420, () => this.fighters.get(event.target)?.play('hit'));
        break;
      }
      case 'miss': {
        // A whiff still animates. Silence on a mistake would read as dropped
        // input rather than a missed swing.
        this.fighters.get(event.actor)?.play('walk');
        break;
      }
      case 'knockout': {
        this.fighters.get(event.loser)?.play('ko');
        this.fighters.get(event.winner)?.play('victory');
        break;
      }
      default:
        break;
    }
  }

  override update(_time: number, delta: number): void {
    this.backdrop?.update(delta);
  }

  private teardown(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;

    for (const fighter of this.fighters.values()) fighter.destroy();
    this.fighters.clear();

    this.backdrop?.destroy();
    this.backdrop = null;
  }
}
