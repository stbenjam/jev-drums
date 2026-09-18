// A small synthesized kit. Playback is scheduled on the audio clock, not the UI clock.
export const TRACKS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom'];

function clamp(value, low, high, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(low, Math.min(high, number)) : fallback;
}

function copyPattern(pattern) {
  return Object.fromEntries(TRACKS.map(track => [track,
    Array.from({ length: 16 }, (_, index) => Math.round(clamp(pattern?.[track]?.[index], 0, 2, 0))),
  ]));
}

export function createDrumEngine({ onStep, onBar, onPatternApplied } = {}) {
  let context, master, compressor, noiseBuffer, scheduler;
  let running = false, generation = 0, step = 0, bar = 0, nextTime = 0;
  let bpm = 112, swing = 0, volume = 0.7;
  let pattern = copyPattern(), queued = null;
  const muted = new Set(), voices = new Set(), callbacks = new Set();

  function initialize() {
    if (context) return;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) throw new Error('This browser does not support Web Audio.');
    context = new AudioContext({ latencyHint: 'interactive' });
    master = context.createGain();
    master.gain.value = volume;
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -13;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.16;
    master.connect(compressor);
    compressor.connect(context.destination);
    noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  function sourceVoice(source, nodes, end) {
    const voice = { source, nodes };
    voices.add(voice);
    source.onended = () => {
      voices.delete(voice);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
    source.stop(end);
  }

  function tone(at, from, to, duration, level, type = 'sine') {
    const source = context.createOscillator();
    const envelope = context.createGain();
    source.type = type;
    source.frequency.setValueAtTime(from, at);
    source.frequency.exponentialRampToValueAtTime(to, at + Math.min(duration * 0.55, 0.13));
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(level, at + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(envelope);
    envelope.connect(master);
    source.start(at);
    sourceVoice(source, [envelope], at + duration + 0.01);
  }

  function noise(at, duration, frequency, level, type = 'highpass', resonance = 0.7) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = resonance;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(level, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(at, Math.random() * 0.5);
    sourceVoice(source, [filter, envelope], at + duration + 0.01);
  }

  function play(track, velocity, at) {
    const v = velocity === 2 ? 1 : 0.68;
    switch (track) {
      case 'kick':
        tone(at, 155, 43, 0.42, 0.9 * v);
        noise(at, 0.018, 1600, 0.1 * v);
        break;
      case 'snare':
        tone(at, 190, 130, 0.11, 0.26 * v, 'triangle');
        noise(at, 0.19, 1300, 0.48 * v);
        break;
      case 'clap':
        for (let i = 0; i < 3; i++) noise(at + i * 0.011, i === 2 ? 0.15 : 0.02, 1700, 0.42 * v, 'bandpass', 0.8);
        break;
      case 'hat': noise(at, 0.046, 7400, 0.3 * v); break;
      case 'openhat': noise(at, 0.28, 6500, 0.24 * v); break;
      case 'tom': tone(at, 230, 82, 0.3, 0.55 * v); break;
    }
  }

  function atAudibleTime(time, callback) {
    const token = generation;
    // Base latency is the delay between the audio graph and the speakers.
    const delay = Math.max(0, (time - context.currentTime + (context.baseLatency || 0)) * 1000);
    const timer = setTimeout(() => {
      callbacks.delete(timer);
      if (running && token === generation) callback();
    }, delay);
    callbacks.add(timer);
  }

  function schedule() {
    if (!running) return;
    // A suspended/backgrounded page resumes on a new bar instead of firing missed beats.
    if (nextTime < context.currentTime - 0.2) {
      nextTime = context.currentTime + 0.03;
      step = 0;
      bar++;
    }
    while (nextTime < context.currentTime + 0.1) {
      if (step === 0 && queued) {
        pattern = queued.pattern;
        if (queued.swing !== undefined) swing = queued.swing;
        queued = null;
        const applied = copyPattern(pattern);
        atAudibleTime(nextTime, () => onPatternApplied?.(applied));
      }
      const duration = 60 / bpm / 4;
      const audibleTime = nextTime + (step % 2 ? duration * swing : 0);
      for (const track of TRACKS) {
        if (!muted.has(track) && pattern[track][step]) play(track, pattern[track][step], audibleTime);
      }
      const currentStep = step, currentBar = bar;
      atAudibleTime(audibleTime, () => {
        if (currentStep === 0) onBar?.(currentBar);
        if (running) onStep?.(currentStep, currentBar);
      });
      nextTime += duration;
      if (++step === 16) { step = 0; bar++; }
    }
  }

  function stop() {
    running = false;
    generation++;
    clearInterval(scheduler);
    scheduler = undefined;
    for (const timer of callbacks) clearTimeout(timer);
    callbacks.clear();
    for (const voice of voices) {
      voice.source.onended = null;
      try { voice.source.stop(); } catch { /* Already ended. */ }
      voice.source.disconnect();
      for (const node of voice.nodes) node.disconnect();
    }
    voices.clear();
    queued = null;
  }

  return {
    async start(nextPattern, nextBpm = 112, nextSwing = 0) {
      stop();
      const token = generation;
      initialize();
      await context.resume();
      if (token !== generation) return;
      pattern = copyPattern(nextPattern);
      bpm = clamp(nextBpm, 60, 180, 112);
      swing = clamp(nextSwing, 0, 0.6, 0);
      step = 0;
      bar = 0;
      nextTime = context.currentTime + 0.04;
      running = true;
      schedule();
      scheduler = setInterval(schedule, 25);
    },
    stop,
    setTempo(value) { bpm = clamp(value, 60, 180, bpm); },
    setSwing(value) { swing = clamp(value, 0, 0.6, swing); },
    setPattern(value) { pattern = copyPattern(value); queued = null; },
    queuePattern(value, nextSwing) {
      const clean = copyPattern(value);
      if (!running) {
        pattern = clean;
        if (nextSwing !== undefined) swing = clamp(nextSwing, 0, 0.6, swing);
        onPatternApplied?.(copyPattern(clean));
      } else {
        queued = { pattern: clean, swing: nextSwing === undefined ? undefined : clamp(nextSwing, 0, 0.6, swing) };
      }
    },
    setStep(track, index, value) {
      if (TRACKS.includes(track) && Number.isInteger(index) && index >= 0 && index < 16) {
        pattern[track][index] = Math.round(clamp(value, 0, 2, 0));
      }
    },
    setMuted(track, value) { if (value) muted.add(track); else muted.delete(track); },
    setVolume(value) {
      volume = clamp(value, 0, 1, volume);
      master?.gain.setTargetAtTime(volume, context.currentTime, 0.015);
    },
    get playing() { return running; },
  };
}
