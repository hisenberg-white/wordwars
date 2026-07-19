import Phaser from 'phaser';
import type { ArenaId, CombatEvent, PlayerId } from '@wordwars/shared';
import { ARENA_SCENERY } from '../arenaTheme';
import { gameBus } from '../bus';
import { Backdrop } from '../entities/Backdrop';
import { ProceduralFighter, type FighterView } from '../entities/Fighter';
import { choreographyFor } from '../fx/choreography';
import { effectsFor } from '../fx/effects';
import { FxLayer } from '../fx/FxLayer';

/** Matches the CSS rivalry palette exactly — P1 crimson, P2 cyan. */
const P1_COLOR = 0xff2f57;
const P2_COLOR = 0x00e0ff;

export const ARENA_WIDTH = 1280;
export const ARENA_HEIGHT = 720;

const FLOOR_Y = ARENA_HEIGHT * 0.78;

/**
 * The fight, rendered.
 *
 * Deliberately thin. Every decision it makes — which animation plays, what an
 * effect looks like — is delegated to the pure modules in `fx/`, so this class
 * is only plumbing: resolve who is where, and hand the work to the layers.
 *
 * It has no idea the network exists, cannot tell a predicted event from a
 * confirmed one, and never asks React for anything (plan §6.1).
 */
export class ArenaScene extends Phaser.Scene {
  static readonly KEY = 'arena';

  private backdrop: Backdrop | null = null;
  private fx: FxLayer | null = null;
  private readonly fighters = new Map<PlayerId, FighterView>();
  private readonly positions = new Map<PlayerId, { x: number; y: number }>();
  private readonly colors = new Map<PlayerId, number>();
  private readonly unsubscribes: Array<() => void> = [];
  private arenaAccent = 0xffffff;

  constructor() {
    super(ArenaScene.KEY);
  }

  create(): void {
    this.fx = new FxLayer(this);

    this.unsubscribes.push(
      gameBus.on('match:begin', ({ config, fighters }) => {
        this.buildStage(config.arenaId);

        for (const fighter of fighters) {
          const isLeft = fighter.side === 'left';
          const x = isLeft ? ARENA_WIDTH * 0.28 : ARENA_WIDTH * 0.72;
          const color = isLeft ? P1_COLOR : P2_COLOR;

          this.fighters.set(
            fighter.playerId,
            new ProceduralFighter({
              scene: this,
              x,
              y: FLOOR_Y,
              facing: isLeft ? 1 : -1,
              color,
              accent: 0xffffff,
            }),
          );

          this.positions.set(fighter.playerId, { x, y: FLOOR_Y });
          this.colors.set(fighter.playerId, color);
        }
      }),

      gameBus.on('combat:events', ({ events }) => {
        for (const event of events) this.perform(event);
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
    const scenery = ARENA_SCENERY[arenaId];
    this.arenaAccent = scenery.accent;

    this.backdrop?.destroy();
    this.backdrop = new Backdrop(this, scenery, ARENA_WIDTH, ARENA_HEIGHT);
  }

  /** Runs the choreography and the effects for one event. */
  private perform(event: CombatEvent): void {
    for (const cue of choreographyFor(event)) {
      const fighter = this.fighters.get(cue.playerId);
      if (!fighter) continue;

      if (cue.delayMs > 0) {
        this.time.delayedCall(cue.delayMs, () => fighter.play(cue.animation));
      } else {
        fighter.play(cue.animation);
      }
    }

    const anchors = this.anchorsFor(event);
    if (!anchors) return;

    const actorColor = this.colors.get(actorOf(event) ?? ('' as PlayerId)) ?? 0xffffff;
    this.fx?.play(effectsFor(event, { actorColor, arenaAccent: this.arenaAccent }), anchors);
  }

  private anchorsFor(
    event: CombatEvent,
  ): { actor: { x: number; y: number }; target: { x: number; y: number } } | null {
    const actorId = actorOf(event);
    const targetId = targetOf(event);
    if (!actorId) return null;

    const actor = this.positions.get(actorId);
    // Self-anchored events (combo tier, ultimate ready) have no target; point
    // both anchors at the actor so an effect still has somewhere to land.
    const target = targetId ? this.positions.get(targetId) : actor;

    return actor && target ? { actor, target } : null;
  }

  override update(_time: number, delta: number): void {
    this.backdrop?.update(delta);
  }

  private teardown(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;

    for (const fighter of this.fighters.values()) fighter.destroy();
    this.fighters.clear();
    this.positions.clear();
    this.colors.clear();

    this.fx?.destroy();
    this.fx = null;
    this.backdrop?.destroy();
    this.backdrop = null;
  }
}

function actorOf(event: CombatEvent): PlayerId | null {
  if ('actor' in event) return event.actor;
  if (event.type === 'knockout') return event.winner;
  return null;
}

function targetOf(event: CombatEvent): PlayerId | null {
  if ('target' in event) return event.target;
  if (event.type === 'knockout') return event.loser;
  return null;
}
