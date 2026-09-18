import { createDrumEngine } from './audio.js';

const $ = id => document.getElementById(id);
const tracks = [['kick', 'Kick'], ['snare', 'Snare'], ['clap', 'Clap'], ['hat', 'Closed hat'], ['openhat', 'Open hat'], ['tom', 'Tom']];
const clone = value => JSON.parse(JSON.stringify(value));
let pattern = {
  kick:    [2,0,0,0,0,0,1,0,2,0,1,0,0,0,0,0],
  snare:   [0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0],
  clap:    [0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
  hat:     [2,0,1,0,1,0,1,0,2,0,1,0,1,0,1,0],
  openhat: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  tom:     [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};
let configured = false, generating = false, queuedResult = null, playingIntent = false;
let swing = .08, lastEvolvedBar = -1, playhead = -1;
let lastPromptOfAppliedResult = null;
let transportIntentVersion = 0;
const pads = {}, rows = {}, muted = new Set();

function log(message, error = false) {
  for (const item of $('activity').children) item.classList.remove('new');
  const item = document.createElement('li');
  item.className = error ? 'error' : 'new';
  const time = document.createElement('time');
  time.dateTime = new Date().toISOString();
  time.textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
  const text = document.createElement('span'); text.textContent = message;
  item.append(time, text); $('activity').prepend(item);
  while ($('activity').children.length > 35) $('activity').lastElementChild.remove();
  $('activity').scrollTop = 0;
}
function updateConnection() {
  $('connection').textContent = generating ? 'Jev is composing…' : configured ? 'Jev connected' : 'Add an API key';
  $('connection-dot').className = generating ? 'busy' : configured ? 'ready' : '';
  $('generate').disabled = generating || Boolean(queuedResult);
  $('generate').textContent = generating ? 'Composing…' : 'Generate ↗';
  for (const buttons of Object.values(pads)) for (const pad of buttons) pad.disabled = generating || Boolean(queuedResult);
}
function updatePads() {
  for (const [track, name] of tracks) {
    pads[track].forEach((pad, index) => {
      const level = pattern[track][index];
      pad.dataset.level = String(level);
      pad.setAttribute('aria-label', `${name}, step ${index + 1}: ${['off', 'hit', 'accent'][level]}`);
      pad.setAttribute('aria-pressed', String(level > 0));
    });
  }
}
function updatePlayhead(index) {
  if (playhead >= 0) {
    $('step-numbers').children[playhead].classList.remove('playhead');
    for (const buttons of Object.values(pads)) buttons[playhead].classList.remove('playhead');
  }
  playhead = index;
  if (index >= 0) {
    $('step-numbers').children[index].classList.add('playhead');
    for (const buttons of Object.values(pads)) buttons[index].classList.add('playhead');
  }
}
function showResult(result) {
  lastPromptOfAppliedResult = result.sourcePrompt;
  $('groove').textContent = result.groove || 'Jev groove';
  $('confidence').textContent = Number.isFinite(result.confidence) ? `${Math.round(result.confidence * 100)}%` : '—';
  $('latency').textContent = Number.isFinite(result.latencyMs) ? `${(result.latencyMs / 1000).toFixed(2)} s` : '—';
  $('confidence').title = `Mean choice confidence · ${result.model || '~typesafe/jev-latest'}`;
  swing = Number.isFinite(result.swing) ? result.swing : 0;
}
function applyQueued() {
  if (!queuedResult) return;
  const result = queuedResult;
  queuedResult = null;
  pattern = clone(result.pattern);
  showResult(result);
  $('queued').hidden = true;
  updatePads(); updateConnection();
  log(`${result.activityName || result.groove || 'New groove'} is playing.`);
}
const engine = createDrumEngine({
  onStep(index, bar) { updatePlayhead(index); $('bar-count').textContent = `BAR ${bar + 1} · 4 / 4`; },
  onBar(bar) {
    if (bar > 0 && bar % Number($('evolve-cadence').value) === 0 && bar !== lastEvolvedBar && $('evolve').checked && engine.playing && !generating && !queuedResult && configured) {
      lastEvolvedBar = bar;
      generate(true);
    }
  },
  onPatternApplied(nextPattern) {
    pattern = clone(nextPattern);
    if (queuedResult) applyQueued();
    else updatePads();
  },
});
engine.setVolume(.7);

for (let index = 0; index < 16; index++) {
  const number = document.createElement('span');
  number.className = `step-number${index % 4 === 0 ? ' beat' : ''}`;
  number.textContent = String(index + 1).padStart(2, '0');
  $('step-numbers').append(number);
}
for (const [track, name] of tracks) {
  const label = document.createElement('button');
  label.type = 'button'; label.className = 'track-label'; label.textContent = name;
  label.setAttribute('aria-label', `Mute ${name}`); label.setAttribute('aria-pressed', 'false');
  label.addEventListener('click', () => {
    muted.has(track) ? muted.delete(track) : muted.add(track);
    engine.setMuted(track, muted.has(track));
    label.setAttribute('aria-pressed', String(muted.has(track)));
    label.setAttribute('aria-label', `${muted.has(track) ? 'Unmute' : 'Mute'} ${name}`);
    rows[track].classList.toggle('muted', muted.has(track));
  });
  const row = document.createElement('div'); row.className = 'track-pads'; rows[track] = row;
  pads[track] = Array.from({length: 16}, (_, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'pad';
    button.addEventListener('click', () => {
      pattern[track][index] = (pattern[track][index] + 1) % 3;
      engine.setStep(track, index, pattern[track][index]);
      updatePads();
    });
    row.append(button); return button;
  });
  $('step-grid').append(label, row);
}
updatePads();

async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed. Please try again.');
  return body;
}
async function generate(evolve = false) {
  if (generating || queuedResult) return;
  const prompt = $('prompt').value.trim();
  if (!prompt) { $('prompt').focus(); return; }
  if (!configured) { $('settings-dialog').showModal(); $('api-key').focus(); return; }
  const isVariation = prompt === lastPromptOfAppliedResult;
  const previousPattern = clone(pattern);
  const requestTransportVersion = transportIntentVersion;
  generating = true; updateConnection();
  log(isVariation ? 'Jev is shaping the next variation…' : `Jev is composing: ${prompt}`);
  try {
    if (!evolve) await engine.unlock();
    const body = await api('/api/generate', {
      prompt, bpm: Number($('tempo').value), ...(isVariation ? {previousPattern} : {}),
    });
    const result = body.result;
    if (!result?.pattern || tracks.some(([track]) => !Array.isArray(result.pattern[track]) || result.pattern[track].length !== 16 || result.pattern[track].some(value => ![0,1,2].includes(value)))) {
      throw new Error('Jev returned an incomplete beat. Your current beat is unchanged.');
    }
    result.sourcePrompt = prompt;
    if (isVariation) {
      const changedTracks = tracks.filter(([track]) => result.pattern[track].some((value, index) => value !== previousPattern[track][index]));
      result.activityName = changedTracks.length
        ? `${changedTracks.map(([, name], index) => index ? name.toLowerCase() : name).join(' + ')} variation`
        : 'Unchanged groove';
    }
    if (engine.playing) {
      queuedResult = result;
      $('queued').hidden = false;
      engine.queuePattern(clone(result.pattern), result.swing || 0);
      log(`${result.activityName || result.groove || 'New groove'} queued for the next bar.`);
    } else {
      pattern = clone(result.pattern);
      engine.setPattern(pattern); engine.setSwing(result.swing || 0);
      showResult(result); updatePads();
      const shouldAutoplay = !evolve && requestTransportVersion === transportIntentVersion;
      const started = shouldAutoplay && await startPlayback();
      log(`${result.activityName || result.groove || 'New groove'} ${started ? 'is playing.' : 'ready. Press Play.'}`);
    }
  } catch (error) { log(error.message || 'Could not generate a beat.', true); }
  finally { generating = false; updateConnection(); }
}
$('generate-form').addEventListener('submit', event => {event.preventDefault(); generate();});
for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => {
  $('prompt').value = button.dataset.prompt; $('prompt').focus();
});
async function startPlayback() {
  playingIntent = true; $('play').disabled = true;
  try {
    lastEvolvedBar = -1;
    await engine.start(clone(pattern), Number($('tempo').value), swing);
    if (!engine.playing) { playingIntent = false; return false; }
    $('play-label').textContent = 'Stop'; $('play-symbol').textContent = '■'; $('play').classList.add('is-playing');
    return true;
  } catch (error) {
    playingIntent = false; log(error.message || 'Could not start audio.', true); return false;
  } finally { $('play').disabled = false; }
}
$('play').addEventListener('click', async () => {
  transportIntentVersion++;
  if (playingIntent) {
    playingIntent = false; engine.stop();
    if (queuedResult) {
      const result = queuedResult;
      queuedResult = null; pattern = clone(result.pattern); showResult(result);
      engine.setPattern(pattern); engine.setSwing(swing); $('queued').hidden = true; updatePads(); updateConnection();
    }
    updatePlayhead(-1); $('bar-count').textContent = '4 / 4';
    $('play-label').textContent = 'Play'; $('play-symbol').textContent = '▶'; $('play').classList.remove('is-playing');
    return;
  }
  await startPlayback();
});
$('tempo').addEventListener('input', () => {
  $('tempo-output').replaceChildren(document.createTextNode(`${$('tempo').value} `));
  const unit = document.createElement('small'); unit.textContent = 'BPM'; $('tempo-output').append(unit);
  engine.setTempo(Number($('tempo').value));
});
$('volume').addEventListener('input', () => engine.setVolume(Number($('volume').value) / 100));
$('evolve').addEventListener('change', () => {
  if ($('evolve').checked && !configured) { $('evolve').checked = false; $('settings-dialog').showModal(); return; }
  log($('evolve').checked ? `Evolve on. Jev will vary the groove ${$('evolve-cadence').selectedOptions[0].textContent.toLowerCase()} while playing.` : 'Evolve off.');
});
$('evolve-cadence').addEventListener('change', () => { if ($('evolve').checked) log(`Jev will vary the groove ${$('evolve-cadence').selectedOptions[0].textContent.toLowerCase()}.`); });
$('settings').addEventListener('click', () => $('settings-dialog').showModal());
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('close', () => { $('api-key').value = ''; $('settings-error').textContent = ''; });
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save-key').disabled = true; $('settings-error').textContent = '';
  try {
    const state = await api('/api/settings', {apiKey: $('api-key').value.trim()});
    configured = state.configured; updateConnection(); $('settings-dialog').close(); log('Jev connected.');
  } catch (error) { $('settings-error').textContent = error.message; }
  finally { $('save-key').disabled = false; }
});
try {
  const state = await api('/api/state'); configured = state.configured; if (!configured) $('evolve').checked = false; updateConnection();
  log('Starter beat loaded. Generate a groove with Jev.');
} catch { updateConnection(); log('Could not reach the server. Reload to reconnect.', true); }
