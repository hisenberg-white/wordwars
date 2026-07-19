import { gameBus } from '@/game/bus';
import { audio } from './AudioEngine';
import { keystrokeSound, soundFor } from './soundFor';

/**
 * Connects the game bus to the mixer.
 *
 * Subscribes once for the lifetime of the app. Audio hangs off the same event
 * stream as the renderer, so it cannot drift out of sync with what is on
 * screen — a hit sound that fires without a visible hit would be worse than
 * silence.
 */
export function bindAudio(): () => void {
  const offCombat = gameBus.on('combat:events', ({ events }) => {
    for (const event of events) {
      const spec = soundFor(event);
      if (spec) audio.play(spec);
    }
  });

  /**
   * Keystroke ticks.
   *
   * Fired only when the typed length GREW — otherwise backspacing would click
   * too, and holding a key to delete a word would sound like a drum roll.
   */
  let lastLength = 0;
  let lastWordIndex = -1;

  const offTyping = gameBus.on('typing:progress', (progress) => {
    if (progress.wordIndex !== lastWordIndex) {
      lastWordIndex = progress.wordIndex;
      lastLength = 0;
    }

    if (progress.typed.length > lastLength) {
      const index = progress.typed.length - 1;
      audio.play(keystrokeSound(progress.typed[index] === progress.expected[index]));
    }

    lastLength = progress.typed.length;
  });

  return () => {
    offCombat();
    offTyping();
  };
}

/**
 * Unlocks audio on the player's first interaction.
 *
 * Every browser blocks sound until a gesture. Listening once on the whole
 * document means the unlock happens on whatever the player clicks first, and
 * they never see a "click to enable audio" prompt — which is a request to fix
 * a problem they did not create.
 */
export function installAudioUnlock(): () => void {
  const unlock = () => audio.unlock();

  const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown'];
  for (const event of events) {
    document.addEventListener(event, unlock, { once: false, passive: true });
  }

  return () => {
    for (const event of events) document.removeEventListener(event, unlock);
  };
}
