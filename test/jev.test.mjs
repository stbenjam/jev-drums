import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBeat, MODEL, TRACKS, DECISIONS_URL } from '../jev.mjs';

const answer = (choice, confidence = 0.8) => ({ type: 'choice', choice, confidence });
const plan = (groove = 'house') => ({ answers: { groove: answer(groove), swing: answer('light'), evolution: answer('kick') } });
function mock(overrides = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    const data = requests.length === 1 ? (overrides.plan || plan()) : (overrides.result || {
      model: 'jev-test', answers: Object.fromEntries(Object.keys(body.questions).map(track => [track, answer(Object.keys(body.questions[track].criteria)[0])])),
    });
    return { ok: true, json: async () => data };
  };
  return { requests, fetchImpl };
}
const input = { prompt: 'Warm house groove', bpm: 120 };

test('two requests condition complete musical phrases on a shared plan', async () => {
  const { requests, fetchImpl } = mock();
  const result = await generateBeat(input, { apiKey: 'test-secret', fetchImpl });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, DECISIONS_URL);
  assert.equal(requests[0].body.model, MODEL);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(Object.keys(requests[0].body.questions), ['groove', 'swing']);
  assert.deepEqual(Object.keys(requests[1].body.questions), TRACKS);
  assert.equal(requests[1].body.state.groove, 'house');
  assert.equal(requests[1].body.state.swing, 'light');
  assert.equal(result.groove, 'house');
  assert.equal(result.swing, 0.12);
  assert.equal(result.model, 'jev-test');
  assert.ok(Math.abs(result.confidence - 0.8) < 1e-12);
  assert.ok(result.latencyMs >= 0);
  assert.equal(result.decisions.length, 6);
  assert.deepEqual(result.pattern.kick, [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]);
  for (const track of TRACKS) {
    assert.equal(result.pattern[track].length, 16);
    assert.ok(result.pattern[track].every(hit => [0, 1, 2].includes(hit)));
  }
});

test('genre-specific snare anchor and cymbal normalization preserve coherence', async () => {
  for (const groove of ['house', 'hiphop', 'funk', 'dnb', 'halftime']) {
    const requests = [];
    const result = await generateBeat(input, { apiKey: 'secret', fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const data = requests.length === 1 ? plan(groove) : {
        answers: Object.fromEntries(TRACKS.map(track => [track, answer(track === 'hat' ? 'sixteenths' : track === 'openhat' ? 'alternating' : Object.keys(body.questions[track].criteria)[0])])),
      };
      return { ok: true, json: async () => data };
    } });
    assert.equal(result.pattern.hat[6], 0);
    assert.equal(result.pattern.hat[14], 0);
    assert.equal(result.pattern.openhat[6], 1);
    assert.equal(result.pattern.snare[groove === 'halftime' ? 8 : 4], 2);
    if (groove !== 'halftime') assert.equal(result.pattern.snare[12], 2);
  }
});

test('valid previous patterns are supplied to both planning and arrangement', async () => {
  const previousPattern = Object.fromEntries(TRACKS.map(track => [track, Array(16).fill(0)]));
  const { requests, fetchImpl } = mock();
  const result = await generateBeat({ ...input, previousPattern }, { apiKey: 'secret', fetchImpl });
  for (const request of requests) assert.deepEqual(request.body.state.previousPattern, previousPattern);
  assert.deepEqual(Object.keys(requests[1].body.questions), ['kick']);
  assert.notDeepEqual(result.pattern.kick, previousPattern.kick);
  for (const track of TRACKS.filter(track => track !== 'kick')) {
    assert.deepEqual(result.pattern[track], previousPattern[track]);
    assert.equal(result.decisions.find(decision => decision.track === track).choice, 'keep');
  }
});

test('every evolution changes one or two tracks, with optional keep and cymbal conflict handling', async () => {
  const initial = await generateBeat(input, { apiKey: 'secret', fetchImpl: mock().fetchImpl });
  const previousPattern = initial.pattern;
  previousPattern.openhat[6] = 1;
  previousPattern.hat[6] = 0;
  for (const evolution of ['kick', 'hat', 'snare', 'clap', 'tom', 'kick_hat', 'snare_hat', 'clap_hat', 'tom_hat', 'hats']) {
    const planned = plan(); planned.answers.evolution = answer(evolution);
    const { fetchImpl, requests } = mock({ plan: planned });
    const result = await generateBeat({ ...input, previousPattern }, { apiKey: 'secret', fetchImpl });
    const changed = TRACKS.filter(track => JSON.stringify(result.pattern[track]) !== JSON.stringify(previousPattern[track]));
    assert.ok(changed.length >= 1 && changed.length <= 2, `${evolution}: ${changed}`);
    const selected = Object.keys(requests[1].body.questions);
    assert.equal(Object.hasOwn(requests[1].body.questions[selected[0]].criteria, 'keep'), false);
    if (selected.length === 2) assert.ok(Object.hasOwn(requests[1].body.questions[selected[1]].criteria, 'keep'));
    for (let index = 0; index < 16; index++) assert.ok(!(result.pattern.hat[index] && result.pattern.openhat[index]));
  }
});

test('does not offer an impossible closed-hat change when every step already has an open hat', async () => {
  const previousPattern = Object.fromEntries(TRACKS.map(track => [track, Array(16).fill(track === 'openhat' ? 1 : 0)]));
  const { fetchImpl, requests } = mock();
  await generateBeat({ ...input, previousPattern }, { apiKey: 'secret', fetchImpl });
  assert.equal(Object.hasOwn(requests[0].body.questions.evolution.criteria, 'hat'), false);
});

test('invalid prompt, tempo, previous patterns and missing keys make no requests', async () => {
  let calls = 0;
  const options = { apiKey: 'secret', fetchImpl: async () => { calls++; throw new Error('unexpected'); } };
  for (const value of [null, undefined, [], { ...input, prompt: '' }, { ...input, prompt: 'a'.repeat(501) }, { ...input, bpm: 59 }, { ...input, bpm: 181 }, { ...input, bpm: NaN }, { ...input, bpm: '120' }, { ...input, previousPattern: {} }, { ...input, previousPattern: null }, { ...input, previousPattern: Object.fromEntries(TRACKS.map(track => [track, Array(16)])) }]) {
    await assert.rejects(generateBeat(value, options), error => error.code.startsWith('INVALID_'));
  }
  await assert.rejects(generateBeat(input, { ...options, apiKey: '' }), { code: 'MISSING_API_KEY' });
  assert.equal(calls, 0);
});

test('rejects unknown plan and track choices instead of falling back', async () => {
  const invalidPlan = mock({ plan: plan('unknown') });
  await assert.rejects(generateBeat(input, { apiKey: 'secret', fetchImpl: invalidPlan.fetchImpl }), { code: 'INVALID_DECISION' });
  assert.equal(invalidPlan.requests.length, 1);
  const invalidTrack = mock({ result: { answers: { kick: answer('unknown') } } });
  await assert.rejects(generateBeat(input, { apiKey: 'secret', fetchImpl: invalidTrack.fetchImpl }), { code: 'INVALID_DECISION' });
});

test('untrusted error bodies, JSON failures and network errors are sanitized', async () => {
  for (const [fetchImpl, code] of [
    [async () => { throw new Error('secret-key in network URL'); }, 'NETWORK_ERROR'],
    [async () => ({ ok: false, status: 429, json: async () => { throw new Error('secret-key'); } }), 'UPSTREAM_ERROR'],
    [async () => ({ ok: true, json: async () => { throw new Error('secret-key'); } }), 'INVALID_RESPONSE'],
  ]) {
    await assert.rejects(generateBeat(input, { apiKey: 'secret-key', fetchImpl }), error => error.code === code && !error.message.includes('secret-key'));
  }
});

test('missing and invalid confidences yield null rather than fabricated certainty', async () => {
  let calls = 0;
  const result = await generateBeat(input, { apiKey: 'secret', fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body);
    const answers = ++calls === 1 ? { groove: answer('house', -1), swing: answer('straight', null) } :
      Object.fromEntries(TRACKS.map(track => [track, answer(Object.keys(body.questions[track].criteria)[0], 9)]));
    return { ok: true, json: async () => ({ answers }) };
  } });
  assert.equal(result.confidence, null);
  assert.ok(result.decisions.every(decision => decision.confidence === null));
});

function weightedMock(kickProbabilities, evolutionProbabilities) {
  let calls = 0;
  const requests = [];
  return { requests, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (++calls === 1) {
      const data = plan();
      data.answers.groove.probabilities = { house: 0.1, hiphop: 0.9 };
      data.answers.swing.probabilities = { light: 0.1, straight: 0.9 };
      data.answers.evolution.probabilities = evolutionProbabilities;
      return { ok: true, json: async () => data };
    }
    const answers = Object.fromEntries(Object.keys(body.questions).map(track => [track, {
      ...answer(Object.keys(body.questions[track].criteria)[0]),
      ...(track === 'kick' ? { probabilities: kickProbabilities } : {}),
    }]));
    return { ok: true, json: async () => ({ answers }) };
  } };
}

test('weighted choices vary identical prompts while keeping groove and swing at provider choices', async () => {
  const results = [];
  for (const random of [() => 0, () => 0.9]) {
    results.push(await generateBeat(input, { apiKey: 'secret', random,
      fetchImpl: weightedMock({ four_floor: 0.8, floor_pickup: 0.2 }).fetchImpl }));
  }
  assert.notDeepEqual(results[0].pattern.kick, results[1].pattern.kick);
  for (const result of results) {
    assert.equal(result.groove, 'house');
    assert.equal(result.swing, 0.12);
    const decision = result.decisions.find(value => value.track === 'kick');
    assert.equal(decision.providerChoice, 'four_floor');
    assert.equal(decision.selection, 'sampled');
    assert.equal(decision.confidence, 0.8);
  }
  assert.equal(results[1].decisions[0].choice, 'floor_pickup');
});

test('weighted sampling ignores unknown and zero-weight options and respects probability boundaries', async () => {
  for (const [roll, expected] of [[0, 'floor_pickup'], [0.499999, 'floor_pickup'], [0.5, 'floor_skip'], [0.99999, 'floor_skip']]) {
    const result = await generateBeat(input, { apiKey: 'secret', random: () => roll,
      fetchImpl: weightedMock({ unknown: 100000, four_floor: 0, floor_pickup: 2, floor_skip: 2 }).fetchImpl });
    assert.equal(result.decisions[0].choice, expected);
  }
});

test('missing, empty, malformed, negative and zero-total distributions fall back to validated provider choice', async () => {
  for (const probabilities of [undefined, null, [], {}, { unknown: 1 }, { four_floor: 0 }, { four_floor: -1, floor_pickup: 1 }, { four_floor: NaN }, { four_floor: Infinity }, { four_floor: '1' }]) {
    const result = await generateBeat(input, { apiKey: 'secret', random: () => { throw new Error('must not sample'); },
      fetchImpl: weightedMock(probabilities).fetchImpl });
    assert.equal(result.decisions[0].choice, 'four_floor');
    assert.equal(result.decisions[0].selection, 'max');
  }
  for (const random of [null, () => -0.1, () => 1, () => NaN]) {
    await assert.rejects(generateBeat(input, { apiKey: 'secret', random,
      fetchImpl: weightedMock({ four_floor: 1 }).fetchImpl }), { code: 'INVALID_INPUT' });
  }
});

test('weighted evolution selection varies different tracks and preserves a guaranteed primary change', async () => {
  const previousPattern = (await generateBeat(input, { apiKey: 'secret', fetchImpl: mock().fetchImpl })).pattern;
  const results = [];
  for (const roll of [0, 0.9]) {
    const { fetchImpl, requests } = weightedMock({ four_floor: 999, floor_pickup: 1 }, { kick: 0.6, tom: 0.4 });
    const result = await generateBeat({ ...input, previousPattern }, { apiKey: 'secret', random: () => roll, fetchImpl });
    const expectedTrack = roll === 0 ? 'kick' : 'tom';
    assert.deepEqual(Object.keys(requests[1].questions), [expectedTrack]);
    assert.notDeepEqual(result.pattern[expectedTrack], previousPattern[expectedTrack]);
    assert.equal(result.evolution.providerChoice, 'kick');
    assert.equal(result.evolution.choice, expectedTrack);
    assert.equal(result.evolution.selection, 'sampled');
    const changed = TRACKS.filter(track => JSON.stringify(result.pattern[track]) !== JSON.stringify(previousPattern[track]));
    assert.deepEqual(changed, [expectedTrack]);
    results.push(result);
  }
  assert.notDeepEqual(results[0].pattern, results[1].pattern);
});
