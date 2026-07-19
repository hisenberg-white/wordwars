import type { SoundKind } from './soundFor';

/**
 * Procedurally synthesised combat audio.
 *
 * No sound files. Same reasoning as the procedural fighters (plan §6.3):
 * waiting on an audio pass would mean shipping a silent game through the
 * playtest gate, and a silent fighting game feels broken in a way no amount of
 * animation fixes. Synthesis gets us punchy, cohesive, zero-download audio
 * now; real samples swap in behind this same interface in phase 5.
 *
 * Every voice is built from the same two ingredients — a filtered noise burst
 * for the "crack" and a pitched oscillator for the "body". Real impact sounds
 * work the same way, which is why this reads as a hit rather than a beep.
 */
export interface Voice {
  readonly duration: number;
  render(ctx: AudioContext, destination: AudioNode, pitch: number, gain: number): void;
}

/** A short burst of filtered noise: the transient crack of a strike. */
function noiseBurst(
  ctx: AudioContext,
  destination: AudioNode,
  options: {
    duration: number;
    gain: number;
    filterHz: number;
    filterType?: BiquadFilterType;
    sweepTo?: number;
  },
): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * options.duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < frames; i += 1) {
    // Exponential decay envelope baked into the buffer — cheaper than a gain
    // ramp and gives the sharp attack an impact needs.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = options.filterType ?? 'lowpass';
  filter.frequency.setValueAtTime(options.filterHz, ctx.currentTime);
  if (options.sweepTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, options.sweepTo),
      ctx.currentTime + options.duration,
    );
  }

  const amp = ctx.createGain();
  amp.gain.value = options.gain;

  source.connect(filter).connect(amp).connect(destination);
  source.start();
  source.stop(ctx.currentTime + options.duration);
}

/** A pitched tone with an envelope: the body and weight behind the crack. */
function tone(
  ctx: AudioContext,
  destination: AudioNode,
  options: {
    type: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    gain: number;
    delay?: number;
  },
): void {
  const start = ctx.currentTime + (options.delay ?? 0);

  const osc = ctx.createOscillator();
  osc.type = options.type;
  osc.frequency.setValueAtTime(options.from, start);
  if (options.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), start + options.duration);
  }

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(options.gain, start + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

  osc.connect(amp).connect(destination);
  osc.start(start);
  osc.stop(start + options.duration + 0.02);
}

/**
 * The voices.
 *
 * Each is tuned to occupy a different part of the spectrum so a busy exchange
 * stays legible: impacts sit mid, crits sit bright, the Ultimate sweeps
 * through everything, and a miss stays low and dull where nothing else lives.
 */
export const VOICES: Record<SoundKind, Voice> = {
  impact: {
    duration: 0.18,
    render: (ctx, dest, pitch, gain) => {
      noiseBurst(ctx, dest, {
        duration: 0.09,
        gain: gain * 0.6,
        filterHz: 2400 * pitch,
        sweepTo: 600,
      });
      tone(ctx, dest, {
        type: 'triangle',
        from: 180 * pitch,
        to: 70,
        duration: 0.16,
        gain: gain * 0.5,
      });
    },
  },

  crit: {
    duration: 0.3,
    render: (ctx, dest, pitch, gain) => {
      noiseBurst(ctx, dest, {
        duration: 0.13,
        gain: gain * 0.7,
        filterHz: 5200 * pitch,
        sweepTo: 900,
      });
      tone(ctx, dest, {
        type: 'square',
        from: 520 * pitch,
        to: 160,
        duration: 0.22,
        gain: gain * 0.32,
      });
      tone(ctx, dest, { type: 'triangle', from: 120, to: 55, duration: 0.28, gain: gain * 0.5 });
    },
  },

  ultimate: {
    duration: 1.2,
    render: (ctx, dest, _pitch, gain) => {
      // Rising charge, then the hit. The pause between them is the moment.
      tone(ctx, dest, { type: 'sawtooth', from: 90, to: 900, duration: 0.42, gain: gain * 0.28 });
      noiseBurst(ctx, dest, { duration: 0.4, gain: gain * 0.25, filterHz: 400, sweepTo: 6000 });

      tone(ctx, dest, {
        type: 'square',
        from: 700,
        to: 90,
        duration: 0.5,
        gain: gain * 0.4,
        delay: 0.44,
      });
      tone(ctx, dest, {
        type: 'sine',
        from: 70,
        to: 32,
        duration: 0.7,
        gain: gain * 0.75,
        delay: 0.44,
      });
    },
  },

  ko: {
    duration: 1.4,
    render: (ctx, dest, _pitch, gain) => {
      noiseBurst(ctx, dest, { duration: 0.5, gain: gain * 0.5, filterHz: 1800, sweepTo: 120 });
      tone(ctx, dest, { type: 'sine', from: 90, to: 28, duration: 1.1, gain: gain * 0.9 });
      tone(ctx, dest, { type: 'triangle', from: 300, to: 60, duration: 0.5, gain: gain * 0.3 });
    },
  },

  miss: {
    duration: 0.16,
    render: (ctx, dest, _pitch, gain) => {
      // Low and dull, in a register nothing else occupies — recognisable with
      // your eyes on the next word rather than the fighters.
      tone(ctx, dest, { type: 'sine', from: 110, to: 62, duration: 0.14, gain: gain * 0.7 });
      noiseBurst(ctx, dest, { duration: 0.05, gain: gain * 0.15, filterHz: 400 });
    },
  },

  'combo-up': {
    duration: 0.24,
    render: (ctx, dest, pitch, gain) => {
      tone(ctx, dest, { type: 'triangle', from: 480 * pitch, duration: 0.09, gain: gain * 0.4 });
      tone(ctx, dest, {
        type: 'triangle',
        from: 720 * pitch,
        duration: 0.14,
        gain: gain * 0.4,
        delay: 0.07,
      });
    },
  },

  'ultimate-ready': {
    duration: 0.6,
    render: (ctx, dest, _pitch, gain) => {
      // An ascending third — unmistakably "something is available now".
      tone(ctx, dest, { type: 'sine', from: 520, duration: 0.16, gain: gain * 0.35 });
      tone(ctx, dest, { type: 'sine', from: 660, duration: 0.16, gain: gain * 0.35, delay: 0.13 });
      tone(ctx, dest, { type: 'sine', from: 880, duration: 0.3, gain: gain * 0.4, delay: 0.26 });
    },
  },

  keystroke: {
    duration: 0.03,
    render: (ctx, dest, pitch, gain) => {
      noiseBurst(ctx, dest, {
        duration: 0.02,
        gain,
        filterHz: 3200 * pitch,
        filterType: 'bandpass',
      });
    },
  },

  'keystroke-error': {
    duration: 0.07,
    render: (ctx, dest, _pitch, gain) => {
      tone(ctx, dest, { type: 'square', from: 220, to: 140, duration: 0.06, gain: gain * 0.5 });
    },
  },
};
