const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SessionStore,LiveTranslationQueue}=require('../app/core.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-translate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new SessionStore(dir);let s=store.create('Meeting');for(const text of ['First question','Second question','Third question'])s=store.append(s.id,{text,speaker:'Other'});return {store,s};}

test('live translation is deduplicated, bounded and saved on its original line with context',async t=>{
 const {store,s}=setup(t),calls=[],events=[];
 const queue=new LiveTranslationQueue({store,concurrency:1,maxPending:2,onEvent:e=>events.push(e),createAI:()=>({generate:args=>new Promise(resolve=>{calls.push({args,resolve});}),cancel(){}})});
 const task=i=>({meetingId:s.id,utteranceId:s.utterances[i].id,model:'gpt-4.1-mini',language:'Korean'});
 assert.equal(queue.enqueue(task(0)),true);assert.equal(queue.enqueue(task(0)),false);
 assert.equal(queue.enqueue(task(1)),true);assert.equal(calls.length,1);
 assert.equal(queue.enqueue(task(2)),false);assert.equal(store.get(s.id).utterances[2].translationStatus,'error');
 // A concurrent transcript addition must not be overwritten by a translation result.
 store.append(s.id,{text:'Fourth question'});calls[0].args.onDelta('첫');calls[0].resolve('첫 번째 질문');await tick();
 assert.equal(calls.length,2);assert.equal(calls[1].args.target,'Second question');assert.equal(calls[1].args.session.utterances.at(-1).text,'First question');
 calls[1].resolve('두 번째 질문');await tick();
 const current=store.get(s.id);assert.equal(current.utterances.length,4);assert.equal(current.utterances[0].translation,'첫 번째 질문');assert.equal(current.utterances[1].translation,'두 번째 질문');
 assert.equal(queue.enqueue(task(0)),false);assert.match(store.markdown(s.id),/Korean: 첫 번째 질문/);assert(events.some(e=>e.status==='streaming'&&e.text==='첫'));
});

test('turning off automatic translation cancels pending work and rejects late writes',async t=>{
 const {store,s}=setup(t),calls=[];
 const queue=new LiveTranslationQueue({store,concurrency:1,createAI:()=>({generate:args=>new Promise(resolve=>calls.push({args,resolve})),cancel(){}})});
 for(const u of s.utterances)queue.enqueue({meetingId:s.id,utteranceId:u.id,model:'gpt-4.1-mini',language:'Korean'});
 queue.cancel();calls[0].args.onDelta('late partial');calls[0].resolve('late translation');await tick();
 assert.equal(calls.length,1);assert.equal(queue.tasks.size,0);
 for(const u of store.get(s.id).utterances){assert.equal(u.translationStatus,'cancelled');assert.equal(u.translation,'');}
});

test('failed translation is retryable and secret text is redacted before persistence',async t=>{
 const {store,s}=setup(t);let fail=true;
 const queue=new LiveTranslationQueue({store,sanitizeError:message=>message.replace('test-secret','[redacted]'),createAI:()=>({async generate(){if(fail)throw new Error('Invalid key test-secret');return '성공';},cancel(){}})});
 const task={meetingId:s.id,utteranceId:s.utterances[0].id,model:'gpt-4.1-mini',language:'Korean'};
 queue.enqueue(task);await tick();assert.equal(store.get(s.id).utterances[0].translationError,'Invalid key [redacted]');
 fail=false;queue.enqueue(task);await tick();assert.equal(store.get(s.id).utterances[0].translation,'성공');
});
