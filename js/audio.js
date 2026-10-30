// ---------- Audio ----------
// Procedural WebAudio SFX; no audio files.
import { mr } from './utils.js';

let actx = null, master = null, noiseBuf = null, muted = false;
export function initAudio(){
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.32; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
  } catch(e){ actx = null; }
}
export function toggleMute(){ muted = !muted; }
function sNoise(dur, freq, vol){
  if (!actx || muted) return;
  const t = actx.currentTime, src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  src.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t+dur+0.05);
}
function sTone(f1, f2, dur, type, vol){
  if (!actx || muted) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(Math.max(20,f2), t+dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+0.05);
}
export const sfx = {
  shot: () => { sNoise(0.14, 1900, 0.55); sTone(180, 60, 0.08, 'square', 0.12); },
  hit: () => sTone(140, 60, 0.07, 'sine', 0.25),
  hurt: () => sTone(220, 90, 0.18, 'sawtooth', 0.18),
  crystal: () => { sTone(980, 1300, 0.12, 'sine', 0.12); sTone(1470, 1900, 0.1, 'sine', 0.06); },
  shatter: () => { sNoise(1.2, 5000, 0.5); sTone(520, 60, 1.6, 'sawtooth', 0.18); },
  roar: () => { sTone(80, 45, 2.4, 'sawtooth', 0.25); sNoise(2.0, 400, 0.3); },
  pickup: () => sTone(560, 980, 0.14, 'triangle', 0.2),
  reload: () => { sTone(900, 700, 0.04, 'square', 0.08); setTimeout(() => sTone(700, 900, 0.05, 'square', 0.08), 160); },
  groan: () => sTone(mr(90,130), mr(60,80), mr(0.5,0.9), 'sawtooth', 0.04),
  open: () => { sTone(330, 660, 0.4, 'triangle', 0.18); setTimeout(() => sTone(440, 880, 0.5, 'triangle', 0.18), 220); }
};
