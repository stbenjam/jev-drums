import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrumEngine, TRACKS } from '../public/audio.js';

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const contexts = [];
  const parameter = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  class AudioContext {
    constructor() { this.sources = []; this.sampleRate = 100; this.baseLatency = 0; contexts.push(this); }
    get currentTime() { return Date.now() / 1000; }
    resume() { return Promise.resolve(); }
    createGain() { return { ...node(), gain: parameter() }; }
    createDynamicsCompressor() {
      return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() };
    }
    createBiquadFilter() { return { ...node(), frequency: parameter(), Q: parameter() }; }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createOscillator() { return this.source('tone'); }
    createBufferSource() { return this.source('noise'); }
    source(kind) {
      const source = { ...node(), kind, frequency: parameter(), start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; } };
      this.sources.push(source);
      return source;
    }
  }
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = AudioContext;
  t.after(() => { if (previous) globalThis.AudioContext = previous; else delete globalThis.AudioContext; });
  return { contexts, tick(ms) { for (let elapsed = 0; elapsed < ms; elapsed += 5) t.mock.timers.tick(Math.min(5, ms - elapsed)); } };
}

const blank = () => Object.fromEntries(TRACKS.map(track => [track, Array(16).fill(0)]));

test('audio starts on demand, swings odd steps, and keeps the bar length', async t => {
  const { contexts, tick } = fixture(t);
  const steps = [], bars = [];
  const engine = createDrumEngine({ onStep: (step, bar) => steps.push([step, bar, Date.now()]), onBar: bar => bars.push(bar) });
  t.after(() => engine.stop());
  assert.equal(contexts.length, 0);
  const pattern = blank();
  pattern.tom.fill(1);
  await engine.start(pattern, 120, 0.3);
  tick(2100);
  const starts = contexts[0].sources.map(source => source.startTime);
  assert.ok(Math.abs(starts[0] - 0.04) < 0.00001);
  assert.ok(Math.abs(starts[1] - 0.2025) < 0.00001);
  assert.ok(Math.abs(starts[2] - 0.29) < 0.00001);
  assert.ok(Math.abs(starts[16] - 2.04) < 0.00001);
  assert.deepEqual(bars, [0, 1]);
  assert.equal(steps[0][2], 40);
});

test('queued patterns become audible and update the UI at the next bar', async t => {
  const { contexts, tick } = fixture(t);
  const applied = [];
  const engine = createDrumEngine({ onPatternApplied: pattern => applied.push({ pattern, time: Date.now() }) });
  t.after(() => engine.stop());
  await engine.start(blank(), 120);
  tick(100);
  const next = blank();
  next.tom[0] = 2;
  engine.queuePattern(next);
  next.tom[0] = 0; // The queue owns its snapshot.
  tick(1900);
  assert.equal(applied.length, 0);
  assert.equal(contexts[0].sources.length, 1);
  assert.ok(Math.abs(contexts[0].sources[0].startTime - 2.04) < 0.00001);
  tick(50);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].pattern.tom[0], 2);
  assert.equal(applied[0].time, 2040);
});

test('stop cancels pending sounds and UI callbacks, and restarting works', async t => {
  const { contexts, tick } = fixture(t);
  const steps = [];
  const engine = createDrumEngine({ onStep: step => steps.push(step) });
  t.after(() => engine.stop());
  const pattern = blank();
  pattern.kick.fill(1);
  await engine.start(pattern);
  assert.equal(engine.playing, true);
  engine.stop();
  assert.equal(engine.playing, false);
  assert.ok(contexts[0].sources.every(source => source.disconnected && source.stopTime === undefined));
  tick(500);
  assert.deepEqual(steps, []);
  await engine.start(pattern);
  tick(50);
  assert.deepEqual(steps, [0]);
  assert.equal(contexts.length, 1);
});

test('stop during context resume cannot resurrect playback', async t => {
  const { contexts, tick } = fixture(t);
  const engine = createDrumEngine();
  const starting = engine.start(blank());
  engine.stop();
  await starting;
  tick(500);
  assert.equal(engine.playing, false);
  assert.equal(contexts[0].sources.length, 0);
});


test('unlock resumes the shared context without starting playback', async t => {
  const { contexts, tick } = fixture(t);
  const steps = [];
  const engine = createDrumEngine({ onStep: step => steps.push(step) });
  t.after(() => engine.stop());
  await engine.unlock();
  await engine.unlock();
  tick(500);
  assert.equal(contexts.length, 1);
  assert.equal(engine.playing, false);
  assert.equal(contexts[0].sources.length, 0);
  assert.deepEqual(steps, []);
  const pattern = blank();
  pattern.tom[0] = 1;
  await engine.start(pattern);
  tick(50);
  assert.equal(contexts.length, 1);
  assert.equal(engine.playing, true);
  assert.deepEqual(steps, [0]);
});
