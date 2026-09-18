import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
const pattern = Object.fromEntries(['kick','snare','clap','hat','openhat','tom'].map(t=>[t,Array(16).fill(0)]));
const result = {pattern,confidence:.8,latencyMs:20,groove:'house',swing:0,model:'test',decisions:[]};
async function fixture(t, options={}) {
  const server=createApp({apiKey:'server-test-secret',generateFn:async()=>result,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  return {rawPost:(path,input,headers)=>new Promise((resolve,reject)=>{const req=http.request(url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});req.on('error',reject);req.end(JSON.stringify(input));}),get:path=>fetch(url+path), post:(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})};
}
test('generation passes musical context and returns the beat without leaking the key',async t=>{
  let received;
  const app=await fixture(t,{generateFn:async (input,options)=>{received={input,options};return result;}});
  const response=await app.post('/api/generate',{prompt:'  quiet house  ',bpm:120,previousPattern:pattern});
  assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.result,result);
  assert.deepEqual(received.input,{prompt:'quiet house',bpm:120,previousPattern:pattern});assert.equal(received.options.apiKey,'server-test-secret');
  assert.ok(!JSON.stringify(data).includes('server-test-secret'));assert.equal(data.busy,false);
});
test('busy generation rejects concurrent generation and settings changes, then releases',async t=>{
  let release,entered;
  const started=new Promise(resolve=>entered=resolve);
  const app=await fixture(t,{generateFn:async()=>{entered();await new Promise(resolve=>release=resolve);return result;}});
  const request=app.post('/api/generate',{prompt:'funk',bpm:100});await started;
  assert.equal((await (await app.get('/api/state')).json()).busy,true);
  assert.equal((await app.post('/api/generate',{prompt:'house',bpm:100})).status,409);
  assert.equal((await app.post('/api/settings',{apiKey:'replacement'})).status,409);
  release();await request;assert.equal((await (await app.get('/api/state')).json()).busy,false);
});
test('failures release busy state and unknown exceptions do not leak provider details',async t=>{
  const app=await fixture(t,{generateFn:async()=>{throw new Error('server-test-secret');}});
  const response=await app.post('/api/generate',{prompt:'funk',bpm:100});assert.equal(response.status,502);
  assert.ok(!(await response.text()).includes('server-test-secret'));
  assert.equal((await (await app.get('/api/state')).json()).busy,false);
});
test('rejects invalid input before making paid calls and blocks cross-origin mutation',async t=>{
  let calls=0;const app=await fixture(t,{generateFn:async()=>{calls++;return result;}});
  for(const input of [{prompt:'',bpm:100},{prompt:'x',bpm:59},{prompt:'x',bpm:181},{prompt:'x',bpm:'100'},{prompt:'x'.repeat(501),bpm:100}]) assert.equal((await app.post('/api/generate',input)).status,400);
  assert.equal((await app.post('/api/generate',{prompt:'x',bpm:100},{Origin:'https://example.com'})).status,403);
  assert.equal((await app.rawPost('/api/generate',{prompt:'x',bpm:100},{Host:'attacker.example'})).status,403);
  assert.equal(calls,0);
});
test('missing key can be configured server-side and never comes back in state',async t=>{
  const app=await fixture(t,{apiKey:''});assert.equal((await (await app.get('/api/state')).json()).configured,false);
  assert.equal((await app.post('/api/generate',{prompt:'x',bpm:100})).status,400);
  const response=await app.post('/api/settings',{apiKey:'new-server-secret'});const data=await response.json();
  assert.equal(data.configured,true);assert.ok(!JSON.stringify(data).includes('new-server-secret'));
});
