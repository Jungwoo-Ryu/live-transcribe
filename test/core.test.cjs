const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { SessionStore, OpenAIAI, readSSE, SpeechWorker } = require('../app/core.cjs');

test('meeting persists edits, Unicode transcript and report across reopen; export retains speakers', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-desk-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let store=new SessionStore(root),s=store.create('제품 회의');
  store.append(s.id,{text:'请下周发给我。',speaker:'Other',start:8,end:10});
  store.append(s.id,{text:'금요일까지 보내겠습니다.',speaker:'Me',start:12,end:15});
  store.patch(s.id,{notes:'Launch context',report:'## Decisions\nFriday delivery.',outputKind:'answer',output:'I will send it Friday.'});
  store=new SessionStore(root);s=store.get(s.id);
  assert.equal(s.utterances.length,2);assert.equal(s.notes,'Launch context');assert.equal(s.outputs.answer,'I will send it Friday.');
  assert.match(store.markdown(s.id),/\*\*Other\*\* \(0:08\): 请下周发给我。/);assert.match(store.markdown(s.id),/Friday delivery/);
  assert.equal(store.list()[0].hasReport,true);
  assert.throws(()=>store.get('../../anything'),/Invalid/);
  store.delete(s.id);assert.equal(store.list().length,0);
});

test('fragmented UTF-8 SSE survives CRLF frames and a final missing newline',async()=>{
 const bytes=new TextEncoder().encode('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"你好"}\r\n\r\ndata: {"type":"response.completed"}');
 async function* chunks(){for(let i=0;i<bytes.length;i+=2)yield bytes.slice(i,i+2);}
 const records=[];for await(const e of readSSE(chunks()))records.push(e);
 assert.deepEqual(records,[{type:'response.output_text.delta',delta:'你好'},{type:'response.completed'}]);
});
async function fixture(t, chat) {
 const received=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'gpt-4.1-mini'},{id:'gpt-audio'}]}));return;}
  let body='';for await(const part of req)body+=part;received.push({body:JSON.parse(body),authorization:req.headers.authorization});chat(req,res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const urls=[];const ai=new OpenAIAI({getApiKey:()=> 'test-placeholder',fetcher:(url,options)=>{urls.push(url);return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options);}});
 return {ai,received,urls};
}
const event=(value)=>`data: ${JSON.stringify(value)}\n\n`;
test('OpenAI authenticates, streams Responses text, disables storage and sends reference context',async t=>{
 const {ai,received,urls}=await fixture(t,(_req,res)=>{res.write(event({type:'response.output_text.delta',delta:'Hello '}));res.write(event({type:'response.output_text.delta',delta:'world'}));res.end(event({type:'response.completed'}));});
 assert.deepEqual((await ai.models()).map(m=>m.name),['gpt-4.1-mini']);const deltas=[];
 const text=await ai.generate({model:'gpt-4.1-mini',kind:'answer',session:{notes:'No discount',utterances:[{speaker:'Other',text:'Can you lower the price?'}]},onDelta:d=>deltas.push(d)});
 assert.equal(text,'Hello world');assert.deepEqual(deltas,['Hello ','world']);assert.equal(received[0].authorization,'Bearer test-placeholder');
 assert.equal(received[0].body.store,false);assert.equal(received[0].body.stream,true);assert.equal(received[0].body.model,'gpt-4.1-mini');
 assert.match(received[0].body.input,/No discount/);assert.match(received[0].body.input,/lower the price/);
 assert.equal(urls.at(-1),'https://api.openai.com/v1/responses');assert(!('think' in received[0].body));
});
test('failed and abruptly ended streams do not become successful saved outputs',async t=>{
 const {ai}=await fixture(t,(_req,res)=>res.end(event({type:'response.output_text.delta',delta:'Partial'})+event({type:'response.failed',response:{error:{message:'quota exceeded'}}})));
 await assert.rejects(ai.generate({model:'gpt-4.1-mini',kind:'report',session:{utterances:[]}}),/quota exceeded/);
 const second=await fixture(t,(_req,res)=>res.end(event({type:'response.output_text.delta',delta:'Partial'})));
 await assert.rejects(second.ai.generate({model:'gpt-4.1-mini',kind:'answer',session:{utterances:[]}}),/before completion/);
});
test('OpenAI cancellation aborts an in-flight response',async t=>{
 const {ai}=await fixture(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(event({type:'response.output_text.delta',delta:'Starting'}));});
 await assert.rejects(ai.generate({model:'gpt-4.1-mini',kind:'answer',session:{utterances:[]},onDelta:()=>ai.cancel()}),/abort/i);
});
test('OpenAI requests fail clearly without a key or with invalid credentials',async t=>{
 const ai=new OpenAIAI({getApiKey:()=>''});await assert.rejects(ai.models(),/Add your OpenAI API key/);
 const {ai:bad}=await fixture(t,(_req,res)=>{res.writeHead(401);res.end(JSON.stringify({error:{message:'Invalid key'}}));});
 await assert.rejects(bad.generate({model:'gpt-4.1-mini',kind:'answer',session:{utterances:[]}}),/HTTP 401/);
});

test('missing speech environment gives a setup instruction, not a hanging request',async()=>{
  const speech=new SpeechWorker('/path/that/does/not/exist');
  await assert.rejects(speech.request({action:'ping'}),/npm run setup:speech/);assert.equal(speech.busy,0);
});

test('audio worklet preserves the final partial chunk and monotonic offsets',()=>{
  const vm=require('node:vm');const messages=[];
  class Processor{constructor(){this.port={postMessage:value=>messages.push(value)};}}
  const ctx={AudioWorkletProcessor:Processor,sampleRate:16000,registerProcessor:(_name,ctor)=>{ctx.Processor=ctor;},Float32Array,Int16Array,Math};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/capture-worklet.js'),'utf8'),ctx);
  const worklet=new ctx.Processor({processorOptions:{seconds:1}});
  worklet.process([[new Float32Array(16000).fill(.5)]]);
  worklet.process([[new Float32Array(8000).fill(.25)]]);
  worklet.port.onmessage({data:'flush'});
  assert.equal(messages[0].pcm.byteLength,32000);assert.equal(messages[0].offset,0);
  assert.equal(messages[1].pcm.byteLength,16000);assert.equal(messages[1].offset,1);
  assert.equal(new Int16Array(messages[1].pcm)[0],8192);
  assert.equal(messages[2].flushed,true);
});
