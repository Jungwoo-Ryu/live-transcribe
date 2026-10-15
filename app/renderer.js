const $ = id => document.getElementById(id);
const state = { current:null,settings:{},sessions:[],recording:null,task:'answer',output:'',requestId:null,busyAI:false,importing:false,notesTimer:null,closing:false,translationLive:new Map() };
function notice(message,error=false){ $('notice').textContent=message; $('notice').classList.toggle('error',error); }
function time(sec){const n=Math.max(0,Math.floor(sec||0));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
async function attempt(fn){try{return await fn();}catch(e){notice(e.message,true);return null;}}
function view(name){
  for(const s of document.querySelectorAll('.view'))s.hidden=s.id!==`view-${name}`;
  for(const n of document.querySelectorAll('.nav'))n.classList.toggle('active',n.dataset.view===name);
  $('page-title').textContent={live:'A little clarity, in real time.',library:'Keep the good conversations.',setup:'Make it yours. Keep it local.'}[name];
  if(name==='library')attempt(refreshLibrary);
}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>view(b.dataset.view));

function renderMeeting(session){
  state.current=session;
  if(document.activeElement!==$('meeting-title'))$('meeting-title').value=session.title;
  if(document.activeElement!==$('context'))$('context').value=session.notes||'';
  $('meeting-date').textContent=new Date(session.createdAt).toLocaleString()+ (session.endedAt?' · Saved meeting':' · Saved locally');
  const target=$('transcript'),nearBottom=target.scrollHeight-target.scrollTop-target.clientHeight<100;
  if(!session.utterances.length){target.replaceChildren();const empty=document.createElement('div');empty.className='empty-state';empty.innerHTML='<span class="empty-mark">⌁</span><h3>Make room for the conversation.</h3><p>Record your mic, capture meeting audio,<br>or type a line below to get started.</p>';target.append(empty);}
  else{
    const fragment=document.createDocumentFragment();
    for(const u of session.utterances){
      const row=document.createElement('div');row.className=`utterance ${u.speaker==='Me'?'me':''}`;
      const head=document.createElement('div');head.className='utterance-head';
      const avatar=document.createElement('span');avatar.className='speaker-avatar';avatar.textContent=u.speaker.slice(0,2).toUpperCase();
      const label=document.createElement('span');label.textContent=u.speaker;
      const stamp=document.createElement('time');stamp.textContent=time(u.start);
      head.append(avatar,label,stamp);const body=document.createElement('p');body.textContent=u.text;row.append(head,body);
      const live=state.translationLive.get(u.id),status=live?.status||u.translationStatus;
      const translated=live?.text||u.translation||'';
      if(status || translated){
        const block=document.createElement('div');block.className='utterance-translation';block.dataset.utteranceId=u.id;
        const language=document.createElement('span');language.className='translation-language';language.textContent=live?.language||u.translationLanguage||state.settings.outputLanguage;
        const content=document.createElement('div');content.className='translation-text';content.textContent=translated||({queued:'Queued…',translating:'Translating…',streaming:'Translating…',error:'Translation failed.',cancelled:'Translation paused.'}[status]||'');
        block.append(language,content);
        if(status==='error'||status==='cancelled'){
          if(u.translationError){const error=document.createElement('small');error.textContent=u.translationError;block.append(error);}
          const retry=document.createElement('button');retry.className='text-button';retry.textContent='Retry translation';retry.onclick=()=>attempt(()=>window.desk.retryTranslation({id:session.id,utteranceId:u.id}));block.append(retry);
        }
        row.append(block);
      }
      fragment.append(row);
    }
    target.replaceChildren(fragment);if(nearBottom)target.scrollTop=target.scrollHeight;
  }
  if(!state.busyAI)showSavedOutput();
}
function showSavedOutput(){
  state.output=state.task==='report'?(state.current?.report||''):(state.current?.outputs?.[state.task]||'');
  if(state.output)$('ai-output').textContent=state.output;
  else $('ai-output').innerHTML='<p class="muted">Get a response you can say out loud, translate the conversation, or turn it into meeting notes.</p><p class="hint">Add your OpenAI API key in Setup. AI requests use your OpenAI account.</p>';
}
async function ensureMeeting(){if(!state.current)renderMeeting(await window.desk.create('New meeting'));return state.current;}
async function saveNotes(){
  clearTimeout(state.notesTimer);if(!state.current)return;
  const id=state.current.id,notes=$('context').value,title=$('meeting-title').value;
  const updated=await window.desk.patch({id,patch:{notes,title}});
  if(state.current?.id===id){state.current=updated;$('notes-saved').textContent='Saved';}
}
$('context').addEventListener('input',()=>{ $('notes-saved').textContent='Saving…';clearTimeout(state.notesTimer);state.notesTimer=setTimeout(()=>attempt(saveNotes),700); });
$('meeting-title').addEventListener('change',()=>attempt(saveNotes));
$('new-meeting').onclick=()=>attempt(async()=>{if(state.recording||state.importing)throw new Error('Stop recording or finish the import first.');await saveNotes();state.requestId=null;await window.desk.cancel();state.busyAI=false;renderMeeting(await window.desk.create('New meeting'));updateAIControls();notice('New meeting ready.');});
$('manual-form').addEventListener('submit',e=>{e.preventDefault();attempt(async()=>{
  const text=$('manual-text').value.trim();if(!text)return;const s=await ensureMeeting();
  const start=state.recording?(Date.now()-state.recording.at)/1000:0;
  renderMeeting(await window.desk.append({id:s.id,text,speaker:$('manual-speaker').value,start,end:start,source:'manual'}));$('manual-text').value='';
});});

async function refreshLibrary(){
  state.sessions=await window.desk.list();$('meeting-count').textContent=state.sessions.length;const list=$('library-list');list.replaceChildren();
  if(!state.sessions.length){const e=document.createElement('p');e.className='library-empty';e.textContent='Your saved meetings will appear here.';list.append(e);return;}
  for(const s of state.sessions){
    const row=document.createElement('article');row.className='library-item';const info=document.createElement('div');info.className='info';
    const title=document.createElement('h3');title.textContent=s.title;const meta=document.createElement('span');meta.className='muted';
    meta.textContent=`${new Date(s.createdAt).toLocaleString()} · ${s.count} lines${s.hasReport?' · Meeting notes ready':''}`;info.append(title,meta);
    const open=document.createElement('button');open.className='secondary';open.textContent='Open';open.onclick=()=>attempt(async()=>{if(state.recording||state.importing)throw new Error('Finish the active recording or import first.');await saveNotes();state.requestId=null;await window.desk.cancel();state.busyAI=false;renderMeeting(await window.desk.get(s.id));updateAIControls();view('live');});
    const del=document.createElement('button');del.className='text-button';del.textContent='Delete';del.onclick=()=>attempt(async()=>{if(await window.desk.delete(s.id)){if(state.current?.id===s.id){state.current=null;renderMeeting(await window.desk.create('New meeting'));}await refreshLibrary();}});
    row.append(info,open,del);list.append(row);
  }
}
$('refresh-library').onclick=()=>attempt(refreshLibrary);
$('export').onclick=()=>attempt(async()=>{const s=await ensureMeeting();await saveNotes();const file=await window.desk.export(s.id);if(file)notice(`Exported: ${file}`);});
$('open-data').onclick=()=>attempt(()=>window.desk.openData());
$('open-audio').onclick=()=>attempt(async()=>window.desk.openAudio((await ensureMeeting()).id));
$('open-overlay').onclick=()=>attempt(()=>window.desk.overlay());

function updateAIControls(){
  const label={answer:'Generate answer',translation:'Translate conversation',report:'Generate meeting notes'}[state.task];
  $('generate').textContent=state.busyAI?'Asking OpenAI…':label+' ↗';$('generate').disabled=state.busyAI;$('cancel-ai').hidden=!state.busyAI;
  for(const b of document.querySelectorAll('[data-task]')){b.classList.toggle('selected',b.dataset.task===state.task);b.disabled=state.busyAI;}
}
for(const b of document.querySelectorAll('[data-task]'))b.onclick=()=>{state.task=b.dataset.task;showSavedOutput();updateAIControls();};
$('generate').onclick=()=>attempt(async()=>{
  await saveNotes();const s=await ensureMeeting();
  if(!state.settings.model||!state.settings.hasApiKey){view('setup');throw new Error('Add your OpenAI API key and model in Setup first.');}
  const requestId=crypto.randomUUID();state.requestId=requestId;state.busyAI=true;state.output='';updateAIControls();$('ai-output').textContent='Waiting for OpenAI…';
  try{await window.desk.generate({id:s.id,kind:state.task,requestId});}catch(e){state.busyAI=false;updateAIControls();throw e;}
});
$('cancel-ai').onclick=()=>attempt(async()=>{await window.desk.cancel();state.busyAI=false;updateAIControls();notice('Generation stopped.');});
$('copy-output').onclick=()=>attempt(async()=>{if(!state.output)throw new Error('Generate something to copy first.');await navigator.clipboard.writeText(state.output);notice('Copied.');});

function settingsPayload(){return {model:$('openai-model').value,apiKey:$('openai-key').value,rememberKey:$('remember-key').checked,whisperModel:$('whisper-model').value,speechLanguage:$('speech-language').value,
  outputLanguage:$('output-language').value,recordAudio:$('save-audio').checked,protectOverlay:$('protect-overlay').checked};}
async function saveSettings(){state.settings=await window.desk.settings(settingsPayload());$('openai-key').value='';updateKeyStatus();updateAutoTranslation();notice('Settings saved.');}
function updateKeyStatus(){ $('openai-status').textContent=state.settings.hasApiKey ? `OpenAI key ready (${state.settings.keyStorage}). Requests use your API account.` : 'Add an OpenAI API key or set OPENAI_API_KEY before starting.'; }
function renderSettings(){
  $('whisper-model').value=state.settings.whisperModel;$('speech-language').value=state.settings.speechLanguage;
  $('output-language').value=state.settings.outputLanguage;$('save-audio').checked=state.settings.recordAudio;$('protect-overlay').checked=state.settings.protectOverlay;
  $('openai-model').value=state.settings.model||'gpt-4.1-mini';updateKeyStatus();updateAutoTranslation();
}
function updateAutoTranslation(){ $('auto-translate').checked=Boolean(state.settings.autoTranslate);$('translation-target').textContent=`${state.settings.outputLanguage||'English'} · OpenAI API usage`; }
$('auto-translate').onchange=()=>attempt(async()=>{
  const enabled=$('auto-translate').checked;
  try{state.settings=await window.desk.autoTranslate(enabled);updateAutoTranslation();notice(enabled?'Automatic translation enabled for new lines. OpenAI API usage applies.':'Automatic translation paused. Pending translations were cancelled.');}
  catch(e){updateAutoTranslation();throw e;}
});
$('save-settings').onclick=()=>attempt(saveSettings);
$('refresh-models').onclick=()=>attempt(async()=>{
  await saveSettings();$('openai-status').textContent='Checking your OpenAI API connection…';
  const models=await window.desk.models();$('openai-model-list').replaceChildren();
  for(const model of models){const o=document.createElement('option');o.value=model.name;$('openai-model-list').append(o);}
  $('openai-status').textContent=`Connected. ${models.length} text-model candidates found. Choose a Responses-compatible model and Save settings.`;
});
$('check-speech').onclick=()=>attempt(async()=>{const r=await window.desk.speechCheck();$('speech-status').textContent=`faster-whisper ${r.version} installed.`;notice('Speech package is installed. Prepare a model before recording.');});
$('prepare-speech').onclick=()=>attempt(async()=>{
  $('prepare-speech').disabled=true;
  try{await saveSettings();notice('Preparing speech model. First use downloads weights; this can take a few minutes.');await window.desk.warmup({download:true});$('speech-status').textContent=`${state.settings.whisperModel} ready on CPU.`;notice('Speech model is ready.');}
  finally{$('prepare-speech').disabled=false;}
});
async function refreshScreens(){
  const sources=await window.desk.sources();$('screen-source').replaceChildren();
  for(const s of sources){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;$('screen-source').append(o);}
}
$('refresh-screens').onclick=()=>attempt(refreshScreens);
$('use-system').onchange=()=>{if($('use-system').checked)attempt(refreshScreens);};

async function attachStream(stream,channel,recording){
  const audioTracks=stream.getAudioTracks();if(!audioTracks.length){stream.getTracks().forEach(t=>t.stop());throw new Error('The selected source has no audio track. Use a supported loopback source or import an audio file.');}
  const context=new AudioContext({ sampleRate:16000 });
  if(context.sampleRate!==16000){await context.close();stream.getTracks().forEach(t=>t.stop());throw new Error('16 kHz audio capture is unavailable on this device. Import an audio file instead.');}
  try{
    await context.audioWorklet.addModule('./capture-worklet.js');
    const node=new AudioWorkletNode(context,'chunk-capture',{ processorOptions:{seconds:8},numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1] });
    const source=context.createMediaStreamSource(new MediaStream(audioTracks));const gain=context.createGain();gain.gain.value=0;
    source.connect(node);node.connect(gain);gain.connect(context.destination);
    const entry={stream,context,node,source,gain,flushResolve:null};recording.entries.push(entry);
    const baseOffset=(Date.now()-recording.at)/1000;
    node.port.onmessage=e=>{
      const d=e.data;if(d.flushed){entry.flushResolve?.();entry.flushResolve=null;return;}
      if(!d.pcm)return;
      const promise=window.desk.chunk({id:recording.id,channel,pcm:d.pcm,rms:d.rms,offset:baseOffset+d.offset})
        .catch(error=>{recording.failures++;notice(error.message,true);}).finally(()=>{recording.pending.delete(promise);updateProcessing(recording);});
      recording.pending.add(promise);updateProcessing(recording);
    };
    for(const track of audioTracks)track.addEventListener('ended',()=>{if(!recording.stopping)attempt(stopRecording);});
    await context.resume();
  }catch(e){if(!recording.entries.some(x=>x.context===context)){await context.close();stream.getTracks().forEach(t=>t.stop());}throw e;}
}
function updateProcessing(r){$('processing').textContent=r.pending.size?`${r.pending.size} chunk(s) processing`:'8-second local speech chunks';}
function setRecordingControls(on){
  $('record').textContent=on?'■ Stop recording':'● Start recording';$('record').classList.toggle('recording',on);$('capture-state').textContent=on?'● Recording':'Not recording';$('capture-state').classList.toggle('live',on);
  for(const id of ['use-mic','use-system','screen-source','refresh-screens','new-meeting','import-audio'])$(id).disabled=on;
}
async function startRecording(){
  if(state.importing)throw new Error('Wait for the audio import to finish.');
  if(!$('use-mic').checked&&!$('use-system').checked)throw new Error('Select microphone or system audio.');
  $('record').disabled=true;
  try{
    await saveNotes();await ensureMeeting();
    if(state.current.endedAt||state.current.utterances.length){const notes=state.current.notes;state.requestId=null;await window.desk.cancel();state.busyAI=false;updateAIControls();renderMeeting(await window.desk.create('Meeting '+new Date().toLocaleDateString()));state.current=await window.desk.patch({id:state.current.id,patch:{notes}});$('context').value=notes;}
    if($('use-system').checked&&!$('screen-source').value)await refreshScreens();
    notice('Loading local speech model…');await window.desk.warmup();
    const capture=await window.desk.captureStart({id:state.current.id,sourceId:$('screen-source').value});
    const recording={...capture,entries:[],pending:new Set(),failures:0,stopping:false};state.recording=recording;
    try{
      if($('use-mic').checked)await attachStream(await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}),'me',recording);
      if($('use-system').checked)await attachStream(await navigator.mediaDevices.getDisplayMedia({audio:true,video:{width:320,height:240,frameRate:1}}),'other',recording);
      setRecordingControls(true);
      recording.timer=setInterval(()=>{$('duration').textContent=time((Date.now()-recording.at)/1000);},500);
      notice(`Recording locally.${capture.recordAudio?' WAV audio saving is on.':' Audio is processed in memory; only transcript text is saved.'}`);
    }catch(e){await stopRecording();throw e;}
  }finally{$('record').disabled=false;}
}
async function stopRecording(){
  const r=state.recording;if(!r||r.stopping)return;r.stopping=true;$('record').disabled=true;clearInterval(r.timer);
  notice('Finishing the last audio chunk and saving your transcript…');
  try{
    for(const e of r.entries){
      // Stop new input, flush the remaining samples, then release tracks.
      e.source.disconnect();
      await new Promise(resolve=>{const timer=setTimeout(resolve,2000);e.flushResolve=()=>{clearTimeout(timer);resolve();};e.node.port.postMessage('flush');});
      e.stream.getTracks().forEach(t=>t.stop());e.node.disconnect();e.gain.disconnect();await e.context.close();
    }
    await Promise.allSettled([...r.pending]);
    renderMeeting(await window.desk.captureStop(r.id));
    notice(r.failures?`Saved with ${r.failures} speech chunk error(s). ${r.recordAudio?'You can re-import the saved WAV audio.':'Some transcript audio could not be processed.'}`:'Meeting saved. Generate meeting notes whenever you are ready.',Boolean(r.failures));
  }finally{state.recording=null;setRecordingControls(false);$('record').disabled=false;updateProcessing({pending:new Set()});await refreshLibrary();}
}
$('record').onclick=()=>attempt(()=>state.recording?stopRecording():startRecording());
$('import-audio').onclick=()=>attempt(async()=>{
  if(state.recording)throw new Error('Stop recording before importing.');await saveNotes();state.importing=true;$('import-audio').disabled=true;
  try{notice('Choose an audio file. It will be transcribed locally; long files can take several minutes.');const s=await window.desk.import();if(s){renderMeeting(s);notice('Imported transcript saved.');await refreshLibrary();}}
  finally{state.importing=false;$('import-audio').disabled=false;}
});

window.desk.onEvent(event=>{
  const d=event.data;
  if(event.type==='live-translation'&&state.current?.id===d.meetingId){
    if(['done','error','cancelled'].includes(d.status))state.translationLive.delete(d.utteranceId);
    else state.translationLive.set(d.utteranceId,d);
    renderMeeting(state.current);
  }
  if(event.type==='meeting'&&state.current?.id===d.id)renderMeeting(d);
  if(event.type==='speech-status'){$('speech-status').textContent=d.message;if(!state.recording)notice(d.message);}
  if(event.type==='import-status')notice(d.message);
  if(event.type==='close-request'&&!state.closing){state.closing=true;attempt(async()=>{try{await stopRecording();await saveNotes();await window.desk.quit();}catch(e){state.closing=false;throw e;}});}
  if(event.type==='ai'&&d.id===state.requestId){
    state.output=d.text;$('ai-output').textContent=d.text||'Waiting for OpenAI…';$('ai-output').scrollTop=$('ai-output').scrollHeight;
    if(['done','error','cancelled'].includes(d.status)){state.busyAI=false;updateAIControls();notice(d.error||'Saved OpenAI output.',d.status==='error');}
  }
});

attempt(async()=>{
  const boot=await window.desk.boot();state.settings=boot.settings;state.sessions=boot.sessions;renderSettings();
  $('meeting-count').textContent=boot.sessions.length;
  renderMeeting(boot.sessions.length?await window.desk.get(boot.sessions[0].id):await window.desk.create('New meeting'));
  $('speech-status').textContent=boot.speechInstalled?'Speech package found. Prepare/check the model.':'Speech not installed. Run npm run setup:speech.';
  updateAIControls();notice(boot.speechInstalled?'Ready. Record a meeting or add transcript text.':'Welcome. Open Setup to prepare speech and add your OpenAI API key.');
});
