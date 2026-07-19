import Phaser from 'phaser';
import type { ArenaId, CombatEvent, PlayerId } from '@wordwars/shared';
import { ARENA_SCENERY } from '../arenaTheme';
import { gameBus } from '../bus';
import { Backdrop } from '../entities/Backdrop';
import { ProceduralFighter, type FighterView } from '../entities/Fighter';
import { choreographyFor } from '../fx/choreography';
import { effectsFor } from '../fx/effects';
import { settingsManager } from '@/settings/SettingsManager';
import { particleScale } from '@/settings/settings';
import { FxLayer } from '../fx/FxLayer';
import { DamageNumbers } from '../feel/DamageNumbers';
import { HitStop } from '../feel/HitStop';
import { combineFeel, feelFor, type ImpactFeel } from '../feel/impact';

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
  private hitStop: HitStop | null = null;
  private damageNumbers: DamageNumbers | null = null;
  private maxHp = 4000;
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
    this.hitStop = new HitStop(this);
    this.damageNumbers = new DamageNumbers(this);

    /*
     * Read from settings on every batch, not sampled once here.
     *
     * This used to snapshot `matchMedia` at scene creation, so a player who
     * turned reduced motion on mid-session kept getting screen shake until
     * they reloaded — the setting simply appeared not to work. Shake is the
     * one effect that can make somebody physically unwell, so it has to
     * respond the moment they ask it to stop.
     */

    this.unsubscribes.push(
      gameBus.on('match:begin', ({ config, fighters }) => {
        this.buildStage(config.arenaId);
        this.maxHp = config.maxHp;

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
        const feels: ImpactFeel[] = [];

        for (const event of events) {
          this.perform(event);

          const feel = feelFor(event, {
            reducedMotion: settingsManager.reducedMotion,
            maxHp: this.maxHp,
          });
          feels.push(feel);

          const anchors = this.anchorsFor(event);
          if (feel.damageNumber && anchors) {
            this.damageNumbers?.show(anchors.target, feel.damageNumber);
          }
        }

        // Combined, not applied per event: two hits in one 33ms flush must not
        // freeze the game for the sum of both.
        const combined = combineFeel(feels);
        this.hitStop?.freeze(combined.hitStopMs);

        if (combined.shake) {
          this.cameras.main.shake(combined.shake.durationMs, combined.shake.intensity);
        }
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
    this.fx?.play(
      effectsFor(event, {
        actorColor,
        arenaAccent: this.arenaAccent,
        particleScale: particleScale(settingsManager.current.quality),
      }),
      anchors,
    );
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
    this.hitStop?.destroy();
    this.hitStop = null;
    this.damageNumbers?.destroy();
    this.damageNumbers = null;
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
