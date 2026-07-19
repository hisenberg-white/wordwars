import Phaser from 'phaser';
import { ArenaScene, ARENA_HEIGHT, ARENA_WIDTH } from './scenes/ArenaScene';

/**
 * Boots the Phaser instance.
 *
 * Imported dynamically (see `GameCanvas`) so the ~1MB engine is never part of
 * the landing page bundle — the first paint must not wait on the game engine
 * (plan §6.4).
 */
export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    // Transparent so the CSS backdrop and HUD compose with the canvas rather
    // than the canvas painting over them.
    transparent: true,
    scene: [ArenaScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    // No physics: nothing in this game falls, collides or bounces. Every
    // motion is an authored tween, so a physics step would be pure overhead.
    physics: undefined,
    render: {
      antialias: true,
      powerPreference: 'high-performance',
      // The scene never reads pixels back; skipping the preserve flag lets the
      // browser discard the buffer after each frame.
      preserveDrawingBuffer: false,
    },
    fps: { target: 60, min: 30 },
    // The InputEngine owns the keyboard (plan §4.1). Letting Phaser also bind
    // it would double-handle every keystroke.
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    banner: false,
    audio: { noAudio: true },
  });
}
