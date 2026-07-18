// 한 줄 목적: Web Audio API로 짧은 효과음을 코드 생성해 재생한다
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneSpec {
  freq: number;
  endFreq?: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  delay?: number;
}

function play(tones: ToneSpec[]): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  for (const t of tones) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const start = now + (t.delay ?? 0);
    osc.type = t.type ?? 'triangle';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.endFreq) osc.frequency.exponentialRampToValueAtTime(t.endFreq, start + t.dur);
    const vol = t.vol ?? 0.12;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(vol, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + t.dur + 0.05);
  }
}

export const sfx = {
  select(): void {
    play([{ freq: 660, dur: 0.08, type: 'sine' }]);
  },
  move(): void {
    play([{ freq: 330, endFreq: 440, dur: 0.12, type: 'sine' }]);
  },
  attack(): void {
    play([
      { freq: 220, endFreq: 110, dur: 0.15, type: 'sawtooth', vol: 0.09 },
      { freq: 880, endFreq: 440, dur: 0.06, type: 'square', vol: 0.05 },
    ]);
  },
  hit(): void {
    play([{ freq: 150, endFreq: 70, dur: 0.18, type: 'square', vol: 0.09 }]);
  },
  capture(): void {
    play([
      { freq: 523, dur: 0.1, type: 'triangle' },
      { freq: 659, dur: 0.1, delay: 0.09, type: 'triangle' },
      { freq: 784, dur: 0.16, delay: 0.18, type: 'triangle' },
    ]);
  },
  turn(): void {
    play([
      { freq: 392, dur: 0.09, type: 'triangle' },
      { freq: 523, dur: 0.12, delay: 0.08, type: 'triangle' },
    ]);
  },
  win(): void {
    play([
      { freq: 523, dur: 0.14, type: 'triangle' },
      { freq: 659, dur: 0.14, delay: 0.13, type: 'triangle' },
      { freq: 784, dur: 0.14, delay: 0.26, type: 'triangle' },
      { freq: 1047, dur: 0.4, delay: 0.39, type: 'triangle' },
    ]);
  },
  lose(): void {
    play([
      { freq: 392, dur: 0.2, type: 'triangle' },
      { freq: 330, dur: 0.2, delay: 0.18, type: 'triangle' },
      { freq: 262, dur: 0.45, delay: 0.36, type: 'triangle' },
    ]);
  },
};
