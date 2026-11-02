/**
 * Soft interface sounds, synthesised with Web Audio. No audio files to load or license.
 * Palette: a warm D-major pentatonic, so any two sounds played together still sound calm.
 * Uses the iOS "ambient" audio session where available: respects the silent switch and
 * doesn't stop the user's music.
 */
type Name =
  | 'mood' | 'bloom' | 'clear' | 'tick' | 'chipOn' | 'chipOff'
  | 'sheetOpen' | 'sheetClose' | 'step' | 'saved' | 'switch' | 'toggle';

// D4 E4 F#4 A4 B4 D5 E5 F#5 A5 B5 D6
const SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880, 987.77, 1174.66];

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let enabled = true;
let lastTick = 0;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}
export const isSoundEnabled = () => enabled;

/** Create/resume the audio context during a user gesture (needed on iOS). */
export function unlockAudio() {
  if (enabled && (!ctx || ctx.state === 'suspended')) audio();
}

function audio(): AudioContext | undefined {
  if (!enabled || typeof window === 'undefined') return undefined;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return undefined;
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
    ctx = new AC();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3200;
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(lowpass).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One soft mallet note: sine body + a fast-fading overtone for the "wood". */
function note(freq: number, { at = 0, gain = 0.5, decay = 0.55, overtone = 0.25, type = 'sine' as OscillatorType } = {}) {
  const c = audio();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  env.connect(master);

  const body = c.createOscillator();
  body.type = type;
  body.frequency.value = freq;
  body.connect(env);
  body.start(t);
  body.stop(t + decay + 0.05);

  if (overtone > 0) {
    const oEnv = c.createGain();
    oEnv.gain.setValueAtTime(gain * overtone, t);
    oEnv.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.25);
    oEnv.connect(master);
    const o = c.createOscillator();
    o.frequency.value = freq * 4;
    o.connect(oEnv);
    o.start(t);
    o.stop(t + decay * 0.3);
  }
}

/** A short breath of filtered noise, for sheets sliding. */
function air(rising: boolean) {
  const c = audio();
  if (!c || !master) return;
  const t = c.currentTime;
  const len = 0.22;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(rising ? 500 : 1400, t);
  bp.frequency.exponentialRampToValueAtTime(rising ? 1400 : 500, t + len);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.12, t + len * 0.4);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(bp).connect(env).connect(master);
  src.start(t);
  src.stop(t + len);
}

/** Play a named sound. `n` is the 1–5 value for mood/bloom. Never throws. */
export function sound(name: Name, n = 3): void {
  try {
    switch (name) {
      case 'mood': // low → high as the day gets better
        note(SCALE[n - 1], { gain: 0.55, decay: 0.7 });
        note(SCALE[n - 1] * 2, { at: 0.02, gain: 0.12, decay: 0.5, overtone: 0 });
        break;
      case 'bloom': // brighter, kalimba-like; a little sparkle when it fully blooms
        note(SCALE[n + 1], { gain: 0.45, decay: 0.5, type: 'triangle', overtone: 0.15 });
        if (n === 5) {
          note(SCALE[9], { at: 0.09, gain: 0.18, decay: 0.4, overtone: 0 });
          note(SCALE[10], { at: 0.17, gain: 0.14, decay: 0.5, overtone: 0 });
        }
        break;
      case 'clear':
        note(SCALE[0] / 2, { gain: 0.3, decay: 0.25, overtone: 0 });
        break;
      case 'tick': { // slider steps, date taps — throttled so a fast drag stays gentle
        const now = performance.now();
        if (now - lastTick < 35) return;
        lastTick = now;
        note(1760 + n * 40, { gain: 0.06, decay: 0.05, overtone: 0 });
        break;
      }
      case 'toggle':
        note(SCALE[6], { gain: 0.16, decay: 0.12, overtone: 0 });
        break;
      case 'chipOn':
        note(SCALE[7], { gain: 0.28, decay: 0.22, type: 'triangle', overtone: 0 });
        break;
      case 'chipOff':
        note(SCALE[4], { gain: 0.16, decay: 0.15, overtone: 0 });
        break;
      case 'sheetOpen':
        air(true);
        break;
      case 'sheetClose':
        air(false);
        break;
      case 'step':
        note(SCALE[3], { gain: 0.25, decay: 0.2, overtone: 0 });
        note(SCALE[5], { at: 0.06, gain: 0.22, decay: 0.3, overtone: 0 });
        break;
      case 'saved': // the "bloom" chord: an unhurried arpeggio
        [5, 7, 8, 10].forEach((i, k) => note(SCALE[i], { at: k * 0.11, gain: 0.4 - k * 0.05, decay: 1.4, overtone: 0.1 }));
        note(SCALE[0], { at: 0.05, gain: 0.25, decay: 1.8, overtone: 0 });
        break;
      case 'switch':
        note(SCALE[3], { gain: 0.3, decay: 0.3 });
        note(SCALE[5], { at: 0.1, gain: 0.3, decay: 0.45 });
        break;
    }
  } catch {
    // Audio is decoration; never break an interaction over it.
  }
}
