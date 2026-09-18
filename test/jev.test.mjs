import test from 'node:test';
import assert from 'node:assert/strict';
import {generateBeat, MODEL, TRACKS, DECISIONS_URL} from '../jev.mjs';
const input={prompt:'Warm house groove',bpm:120};
const answer=(choice='off',confidence=.8)=>({type:'choice',choice,confidence});
function mock(transform=(_,i)=>answer(['off','hit','accent'][i%3])) {
 const requests=[];
 return {requests,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,options,body});
  return {ok:true,json:async()=>({model:'jev-test',answers:Object.fromEntries(Object.keys(body.questions).map((id,i)=>[id,transform(id,i)]))})};
 }};
}
test('one request asks exactly 96 independent cells with shared composition and explicit coordinates',async()=>{
 const {requests,fetchImpl}=mock();const result=await generateBeat(input,{apiKey:'secret',fetchImpl});
 assert.equal(requests.length,1);const request=requests[0];assert.equal(request.url,DECISIONS_URL);assert.equal(request.body.model,MODEL);assert.equal(request.options.headers.Authorization,'Bearer secret');
 assert.ok(request.options.signal instanceof AbortSignal);assert.equal(request.body.state.prompt,input.prompt);assert.equal(request.body.state.stepDurationMs,125);
 const expected=TRACKS.flatMap(track=>Array.from({length:16},(_,step)=>`${track}_${step}`));assert.deepEqual(Object.keys(request.body.questions),expected);
 for(const [i,id] of expected.entries()) {
  const q=request.body.questions[id];assert.equal(q.type,'choice');assert.deepEqual(Object.keys(q.criteria),['off','hit','accent']);assert.match(q.instructions,new RegExp(`step ${i%16+1} of 16`));
  assert.equal(result.pattern[TRACKS[Math.floor(i/16)]][i%16],i%3);
 }
 assert.equal(result.decisions.length,96);assert.equal(result.model,'jev-test');assert.equal(result.swing,0);assert.ok(Math.abs(result.confidence-.8)<1e-12);assert.ok(result.latencyMs>=0);
});
test('continuations provide the full previous bar and reevaluate all cells without forced pattern substitutions',async()=>{
 const previousPattern=Object.fromEntries(TRACKS.map(t=>[t,Array(16).fill(0)]));
 const {requests,fetchImpl}=mock(()=>answer('accent'));const result=await generateBeat({...input,previousPattern},{apiKey:'secret',fetchImpl});
 assert.equal(requests.length,1);assert.deepEqual(requests[0].body.state.previousPattern,previousPattern);assert.equal(Object.keys(requests[0].body.questions).length,96);
 for(const track of TRACKS)assert.deepEqual(result.pattern[track],Array(16).fill(2));
 // Even simultaneous cymbal decisions are preserved: the generator does not silently rewrite model outputs.
 assert.equal(result.pattern.hat[0],2);assert.equal(result.pattern.openhat[0],2);assert.deepEqual(previousPattern.kick,Array(16).fill(0));
});
test('one missing or invalid cell rejects the whole response',async()=>{
 for(const bad of [undefined,null,{},answer('invented'),{type:'score',choice:'hit'},answer('__proto__')]) {
  const {fetchImpl}=mock(id=>id==='tom_15'?bad:answer());await assert.rejects(generateBeat(input,{apiKey:'secret',fetchImpl}),{code:'INVALID_DECISION'});
 }
});
test('weighted per-cell sampling uses Jev probabilities and exposes provider choice',async()=>{
 for(const [roll,expected] of [[0,1],[.499999,1],[.5,2],[.99999,2]]) {
  const {fetchImpl}=mock(()=>({...answer(),probabilities:{unknown:100,off:0,hit:2,accent:2}}));
  const result=await generateBeat(input,{apiKey:'secret',fetchImpl,random:()=>roll});
  assert.ok(Object.values(result.pattern).flat().every(value=>value===expected));assert.equal(result.decisions[0].selection,'sampled');assert.equal(result.decisions[0].providerChoice,'off');assert.equal(result.decisions[0].confidence,.8);
 }
});
test('invalid probability distributions preserve the validated provider choice',async()=>{
 for(const probabilities of [undefined,null,[],{}, {unknown:1},{off:0},{off:-1,hit:1},{off:NaN},{off:Infinity},{off:'1'}]) {
  const {fetchImpl}=mock(()=>({...answer('hit'),probabilities}));
  const result=await generateBeat(input,{apiKey:'secret',fetchImpl,random:()=>{throw Error('must not sample');}});assert.equal(result.decisions[0].selection,'max');assert.equal(result.pattern.kick[0],1);
 }
 for(const random of [null,()=>-1,()=>1,()=>NaN])await assert.rejects(generateBeat(input,{apiKey:'secret',random,fetchImpl:mock(()=>({...answer(),probabilities:{off:1}})).fetchImpl}),{code:'INVALID_INPUT'});
});
test('invalid input or missing keys never make requests',async()=>{
 let calls=0;const options={apiKey:'secret',fetchImpl:async()=>{calls++;throw Error('unexpected');}};
 for(const value of [null,undefined,[],{...input,prompt:''},{...input,prompt:'a'.repeat(501)},{...input,bpm:59},{...input,bpm:181},{...input,bpm:NaN},{...input,bpm:'120'},{...input,previousPattern:{}},{...input,previousPattern:null},{...input,previousPattern:Object.fromEntries(TRACKS.map(t=>[t,Array(16)]))}])await assert.rejects(generateBeat(value,options),e=>e.code.startsWith('INVALID_'));
 await assert.rejects(generateBeat(input,{...options,apiKey:''}),{code:'MISSING_API_KEY'});assert.equal(calls,0);
});
test('provider and network failures cannot expose credentials',async()=>{
 for(const [fetchImpl,code] of [[async()=>{throw Error('secret-key');},'NETWORK_ERROR'],[async()=>({ok:false,status:429,json:async()=>{throw Error('secret-key');}}),'UPSTREAM_ERROR'],[async()=>({ok:true,json:async()=>{throw Error('secret-key');}}),'INVALID_RESPONSE']])await assert.rejects(generateBeat(input,{apiKey:'secret-key',fetchImpl}),e=>e.code===code&&!e.message.includes('secret-key'));
});
test('missing and invalid confidences are excluded instead of fabricated',async()=>{
 const result=await generateBeat(input,{apiKey:'secret',fetchImpl:mock((_,i)=>answer('off',[null,-1,9,NaN][i%4])).fetchImpl});assert.equal(result.confidence,null);assert.ok(result.decisions.every(d=>d.confidence===null));
});
