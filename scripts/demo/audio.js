/**
 * Renders the demo video's audio track in the stage page (OfflineAudioContext), using the app's own synth
 * (src/lib/sound.ts): the interface sounds logged during the recording, soft chapter transitions and a
 * quiet generated melody. Procedural only: no audio files. Returns a mono 16-bit WAV as base64.
 *
 * Called from record.mjs as page.evaluate(renderDemoAudio, { base, duration, events, music }).
 * events: [{ at: seconds from the video start, name: app sound name | 'chapter' | 'intro' | 'outro', n }]
 */
export async function renderDemoAudio({ base, duration, events, music }) {
  const { play, note, air, makeOutput, SCALE } = await import(base + 'src/lib/sound.ts');
  const RATE = 44100;
  const c = new OfflineAudioContext(1, Math.ceil(duration * RATE), RATE);

  // Interface sounds: the app's chain, louder than on the phone (a video plays quieter than a tap feels).
  const ui = makeOutput(c, 0.55);
  // Transitions and music: their own buses.
  const fx = makeOutput(c, 0.5);
  const musicBus = c.createGain();
  const musicLp = c.createBiquadFilter();
  musicLp.type = 'lowpass';
  musicLp.frequency.value = 1800;
  musicBus.connect(musicLp).connect(c.destination);

  for (const e of events) {
    const t = Math.max(0, e.at);
    if (e.at < -1 || t >= duration) continue; // well before the first frame: seeding, loading
    if (e.name === 'chapter') {
      // a soft rising breath, then a two-note chime
      air(c, fx, t, true, 0.6, 0.22);
      note(c, fx, t, SCALE[5], { at: 0.28, gain: 0.32, decay: 1.1, overtone: 0.12 });
      note(c, fx, t, SCALE[7], { at: 0.4, gain: 0.26, decay: 1.4, overtone: 0.08 });
    } else if (e.name === 'intro' || e.name === 'outro') {
      // the app's "saved" bloom chord, slowed down
      const steps = e.name === 'intro' ? [5, 7, 8, 10] : [10, 8, 7, 5];
      steps.forEach((i, k) => note(c, fx, t, SCALE[i], { at: 0.2 + k * 0.2, gain: 0.34 - k * 0.04, decay: 2.6, overtone: 0.08 }));
      note(c, fx, t, SCALE[0] / 2, { at: 0.1, gain: 0.3, decay: 3.2, overtone: 0 });
    } else {
      play(c, ui, e.name, e.n ?? 3, t);
    }
  }

  if (music) {
    // Ambient pad: D – Bm – G – Asus, 4 s each, slow swells, plus a sparse music-box line in D pentatonic.
    const CHORDS = [[146.83, 185.0, 220.0], [123.47, 146.83, 185.0], [98.0, 123.47, 146.83], [110.0, 146.83, 164.81]];
    const BAR = 4;
    const fadeIn = 2, fadeOut = 3;
    musicBus.gain.setValueAtTime(0, 0);
    musicBus.gain.linearRampToValueAtTime(1, fadeIn);
    musicBus.gain.setValueAtTime(1, Math.max(fadeIn, duration - fadeOut));
    musicBus.gain.linearRampToValueAtTime(0, duration);
    for (let bar = 0, t = 0; t < duration; bar++, t += BAR) {
      for (const [k, f] of CHORDS[bar % 4].entries()) {
        for (const detune of [-4, 4]) {
          const o = c.createOscillator();
          o.type = k === 0 ? 'sine' : 'triangle';
          o.frequency.value = f;
          o.detune.value = detune;
          const g = c.createGain();
          const peak = (k === 0 ? 0.05 : 0.03);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(peak, t + 1.4);
          g.gain.setValueAtTime(peak, t + BAR - 0.6);
          g.gain.linearRampToValueAtTime(0, t + BAR + 1.2);
          o.connect(g).connect(musicBus);
          o.start(t);
          o.stop(t + BAR + 1.3);
        }
      }
    }
    // Music box: seeded random walk over the upper pentatonic, so every render plays the same tune.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let idx = 6;
    for (let t = 1.5; t < duration - 2; t += 1 + Math.round(rnd() * 2) * 0.5) {
      idx = Math.min(10, Math.max(4, idx + Math.round(rnd() * 4 - 2)));
      note(c, musicBus, t, SCALE[idx], { gain: 0.07, decay: 1.6, overtone: 0.2 });
    }
  }

  const buf = await c.startRendering();
  const pcm = buf.getChannelData(0);
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
