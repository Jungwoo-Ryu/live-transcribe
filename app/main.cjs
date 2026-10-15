'use strict';
const { app, BrowserWindow, ipcMain, dialog, session: electronSession, desktopCapturer, shell, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { SessionStore, SpeechWorker, OpenAIAI, LiveTranslationQueue, pythonPath, limit, safeId } = require('./core.cjs');

const ROOT = path.resolve(__dirname, '..');
if(process.env.MEETING_DESK_DATA_DIR) app.setPath('userData',path.resolve(process.env.MEETING_DESK_DATA_DIR));
let main, overlay, store, speech, translations, settings, settingsFile;
let activeCapture = null, selectedSource = null, generation = null, allowQuit = false;
let apiKey = '', keyStorage = 'none', keyFile;
const ai = new OpenAIAI({ getApiKey: () => apiKey });
const windows = new Set();
const defaults = { provider:'openai', model: 'gpt-4.1-mini', whisperModel: 'base', speechLanguage: 'auto', outputLanguage: 'English', recordAudio: false, protectOverlay: false, autoTranslate:false };
const WHISPER_MODELS = ['tiny','base','small','medium','large-v3','turbo'];

function broadcast(type, data) {
  for (const w of windows) if (!w.isDestroyed()) w.webContents.send('desk:event', { type, data });
}
function trusted(event) {
  return main && !main.isDestroyed() && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame;
}
function handle(name, fn, allowOverlay = false) {
  ipcMain.handle(`desk:${name}`, async (event, payload) => {
    const isOverlay = allowOverlay && overlay && !overlay.isDestroyed() && event.sender === overlay.webContents && event.senderFrame === overlay.webContents.mainFrame;
    if (!trusted(event) && !isOverlay) return { ok: false, error: 'Untrusted window.' };
    try { return { ok: true, data: await fn(payload, event) }; }
    catch (e) { const message=e.message || String(e); return { ok:false,error:apiKey?message.split(apiKey).join('[redacted]'):message }; }
  });
}
function secureWindow(options) {
  const w = new BrowserWindow({ backgroundColor: '#f4f5f1', ...options,
    webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, backgroundThrottling: false } });
  windows.add(w); w.once('closed', () => windows.delete(w));
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return w;
}
function makeMain() {
  main = secureWindow({ width: 1330, height: 880, minWidth: 1020, minHeight: 720, title: 'Free Meeting Desk' });
  main.loadFile(path.join(__dirname,'index.html'));
  main.on('close', event => {
    if (!allowQuit) { event.preventDefault(); main.webContents.send('desk:event',{type:'close-request'}); return; }
    activeCapture = null; ai.cancel(); translations.cancel(); speech.stop();
    if(overlay && !overlay.isDestroyed()) overlay.close();
  });
}
function showOverlay() {
  if (!overlay || overlay.isDestroyed()) {
    overlay = secureWindow({ width: 620, height: 340, minWidth: 400, minHeight: 180, frame: false, alwaysOnTop: true,
      title: 'Meeting prompter', skipTaskbar: false });
    overlay.setContentProtection(settings.protectOverlay);
    overlay.loadFile(path.join(__dirname,'overlay.html'));
  } else { overlay.show(); overlay.focus(); }
  return true;
}
function saveSettings(patch) {
  const next = { ...settings };
  if (patch.model !== undefined) next.model = limit(patch.model,150);
  if (patch.outputLanguage !== undefined) next.outputLanguage = limit(patch.outputLanguage,60) || 'English';
  if (WHISPER_MODELS.includes(patch.whisperModel)) next.whisperModel = patch.whisperModel;
  if (['auto','en','ko','zh','ja','es','fr','de'].includes(patch.speechLanguage)) next.speechLanguage = patch.speechLanguage;
  for (const key of ['recordAudio','protectOverlay']) if (typeof patch[key] === 'boolean') next[key] = patch[key];
  if(typeof patch.apiKey==='string' && patch.apiKey.trim()) {
    const value=patch.apiKey.trim();
    if(value.length>4096 || /[\r\n]/.test(value)) throw new Error('Enter a valid API key without line breaks.');
    const canEncrypt=safeStorage.isEncryptionAvailable() && (process.platform!=='linux' || safeStorage.getSelectedStorageBackend?.()!=='basic_text');
    if(patch.rememberKey!==false && canEncrypt) {
      fs.writeFileSync(keyFile,safeStorage.encryptString(value),{mode:0o600}); keyStorage='encrypted';
    } else { fs.rmSync(keyFile,{force:true}); keyStorage='session'; }
    apiKey=value;
  }
  settings = next;
  const temp = `${settingsFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2)); fs.renameSync(temp,settingsFile);
  if(overlay && !overlay.isDestroyed()) overlay.setContentProtection(settings.protectOverlay);
  return publicSettings();
}
function publicSettings() { return {...settings,hasApiKey:Boolean(apiKey),keyStorage}; }
function scheduleTranslations(meeting, ids) {
  if(!settings.autoTranslate || !apiKey)return;
  for(const utteranceId of ids) translations.enqueue({meetingId:meeting.id,utteranceId,model:settings.model,language:settings.outputLanguage});
}
function wavHeader(dataSize) {
  const b = Buffer.alloc(44);
  b.write('RIFF'); b.writeUInt32LE(dataSize+36,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(16000,24); b.writeUInt32LE(32000,28);
  b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(dataSize,40);
  return b;
}
function recordPCM(id, channel, pcm) {
  const dir = path.join(app.getPath('userData'),'audio',id); fs.mkdirSync(dir,{ recursive:true });
  const file = path.join(dir,`${channel}.wav`);
  if (!fs.existsSync(file)) fs.writeFileSync(file,wavHeader(0),{ mode:0o600 });
  fs.appendFileSync(file,pcm);
  const size = fs.statSync(file).size - 44;
  const fd = fs.openSync(file,'r+'); try { fs.writeSync(fd,wavHeader(size),0,44,0); } finally { fs.closeSync(fd); }
}

function register() {
  handle('boot', () => ({ settings:publicSettings(), sessions: store.list(), speechInstalled: Boolean(pythonPath(ROOT)), platform: process.platform,
    dataDirectory: app.getPath('userData'), activeCapture, latestGeneration: generation ? { id:generation.id, text:generation.text, kind:generation.kind } : null }), true);
  handle('settings', patch => { if (activeCapture) throw new Error('Stop recording before changing settings.'); return saveSettings(patch || {}); });
  handle('autoTranslate', enabled => {
    if(typeof enabled!=='boolean')throw new Error('Invalid translation toggle.');
    if(enabled && !apiKey)throw new Error('Add your OpenAI API key in Setup before enabling automatic translation.');
    settings.autoTranslate=enabled;
    if(!enabled)translations.cancel();
    const saved=saveSettings({});broadcast('translation-setting',{enabled});return saved;
  });
  handle('retryTranslation', p => {
    if(!apiKey)throw new Error('Add your OpenAI API key in Setup.');
    return translations.enqueue({meetingId:p.id,utteranceId:p.utteranceId,model:settings.model,language:settings.outputLanguage});
  });
  handle('create', title => { if (activeCapture) throw new Error('Stop the current recording first.'); return store.create(title); });
  handle('list', () => store.list());
  handle('get', id => store.get(id));
  handle('patch', p => store.patch(p.id,p.patch || {}));
  handle('append', p => { const s = store.append(p.id,p);broadcast('meeting',s);if(s.utterances.length)scheduleTranslations(s,[s.utterances.at(-1).id]);return store.get(s.id); });
  handle('delete', async id => {
    if (activeCapture?.id === id) throw new Error('Stop recording first.');
    const s = store.get(id);
    const r = await dialog.showMessageBox(main,{ type:'question', buttons:['Cancel','Delete'], defaultId:0, cancelId:0,
      message:`Delete “${s.title}”?`, detail:'This removes its transcript, generated notes and saved audio from this app.' });
    if (r.response !== 1) return false;
    translations.cancel(id);store.delete(id); fs.rmSync(path.join(app.getPath('userData'),'audio',id),{ recursive:true,force:true }); return true;
  });
  handle('export', async id => {
    const s = store.get(id);
    const r = await dialog.showSaveDialog(main,{ defaultPath:`${s.title.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,80) || 'meeting'}.md`,
      filters:[{ name:'Markdown', extensions:['md'] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath,store.markdown(id),'utf8'); return r.filePath;
  });
  handle('models', () => ai.models());
  handle('speechCheck', () => speech.request({ action:'ping' }));
  handle('warmup', p => speech.request({ action:'warmup', model:settings.whisperModel,allow_download:p?.download===true }));
  handle('sources', async () => (await desktopCapturer.getSources({ types:['screen'],thumbnailSize:{ width:0,height:0 } })).map(s => ({ id:s.id,name:s.name })));
  handle('captureStart', p => {
    if (activeCapture) throw new Error('Recording is already running.');
    const s = store.get(p.id);
    if (s.endedAt) throw new Error('Create a new meeting to record.');
    if (!pythonPath(ROOT)) throw new Error('Install speech first: npm run setup:speech');
    if (s.utterances.length) throw new Error('Create a new meeting to record a fresh timeline.');
    selectedSource = limit(p.sourceId,300);
    activeCapture = { id:p.id, at:Date.now(), recordAudio:settings.recordAudio };
    broadcast('capture',activeCapture); return activeCapture;
  });
  handle('captureStop', id => {
    if (activeCapture?.id !== id) throw new Error('This meeting is not recording.');
    activeCapture = null;
    const s = store.patch(id,{ endedAt:new Date().toISOString() });
    broadcast('capture',null); broadcast('meeting',s); return s;
  });
  handle('chunk', async p => {
    if (activeCapture?.id !== p.id || !['me','other'].includes(p.channel)) throw new Error('Inactive capture.');
    const pcm = Buffer.from(p.pcm);
    if (pcm.length > 16000*2*61 || pcm.length % 2) throw new Error('Invalid audio chunk.');
    if (activeCapture.recordAudio) recordPCM(p.id,p.channel,pcm);
    if (p.rms < 0.005 || pcm.length < 3200) return { skipped:true };
    const model = settings.whisperModel, language = settings.speechLanguage;
    const result = await speech.request({ action:'transcribe', pcm:pcm.toString('base64'),model,language });
    // Capture ID remains attached to every request; late work cannot enter another meeting.
    if (!safeId(p.id) || !fs.existsSync(store.file(p.id))) return { discarded:true };
    let s = store.get(p.id);const newIds=[];
    for (const seg of result.segments) {
      s = store.append(p.id,{ text:seg.text, speaker:p.channel==='me'?'Me':'Other',
        start:Math.max(0,Number(p.offset)||0)+seg.start,end:Math.max(0,Number(p.offset)||0)+seg.end,source:'speech' });
      newIds.push(s.utterances.at(-1).id);
    }
    broadcast('meeting',s);scheduleTranslations(s,newIds);return { count:result.segments.length };
  });
  handle('import', async () => {
    if (activeCapture || speech.busy) throw new Error('Finish recording and speech processing before importing.');
    const r = await dialog.showOpenDialog(main,{ properties:['openFile'], filters:[{ name:'Audio',extensions:['wav','mp3','m4a','mp4','webm','ogg','flac'] }] });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    if (fs.statSync(file).size > 500*1024*1024) throw new Error('Choose an audio file under 500 MB.');
    const s = store.create(path.basename(file,path.extname(file)));
    broadcast('import-status',{ id:s.id,message:'Transcribing imported audio locally…' });
    try {
      const result = await speech.request({ action:'file',path:file,model:settings.whisperModel,language:settings.speechLanguage });
      let current = s;
      for (const seg of result.segments) current.utterances.push({ id:require('node:crypto').randomUUID(),text:seg.text,
        speaker:'Audio',start:seg.start,end:seg.end,source:'import',at:new Date().toISOString() });
      current.endedAt = new Date().toISOString(); store.write(current); broadcast('meeting',current); return current;
    } catch (e) { store.patch(s.id,{ endedAt:new Date().toISOString(),notes:`Import did not finish: ${e.message}` }); throw e; }
  });
  handle('generate', p => {
    if (!['answer','translation','report'].includes(p.kind) || !safeId(p.requestId)) throw new Error('Invalid AI request.');
    const s = store.get(p.id);
    if (!s.utterances.length) throw new Error('Add transcript text or record a conversation first.');
    ai.cancel(); const job = { id:p.requestId,meetingId:p.id,kind:p.kind,text:'',cancelled:false }; generation = job;
    const model = settings.model, language = settings.outputLanguage;
    setImmediate(async () => {
      if (generation !== job || job.cancelled) return;
      broadcast('ai',{ id:job.id,kind:job.kind,text:'',status:'loading' });
      try {
        const text = await ai.generate({ model,kind:p.kind,session:s,language,onDelta:delta => {
          if (generation !== job || job.cancelled) return;
          job.text += delta; broadcast('ai',{ id:job.id,kind:job.kind,text:job.text,status:'streaming' });
        } });
        if (generation !== job || job.cancelled) return;
        if (fs.existsSync(store.file(s.id))) {
          const updated = p.kind==='report' ? store.patch(s.id,{ report:text }) : store.patch(s.id,{ outputKind:p.kind,output:text });
          broadcast('meeting',updated);
        }
        broadcast('ai',{ id:job.id,kind:job.kind,text,status:'done' });
      } catch (e) {
        if (generation === job) broadcast('ai',{ id:job.id,kind:job.kind,text:job.text,status:job.cancelled?'cancelled':'error',error:job.cancelled?'Cancelled':(apiKey?e.message.split(apiKey).join('[redacted]'):e.message) });
      }
    });
    return job.id;
  });
  handle('cancel', () => { if (generation) generation.cancelled = true; ai.cancel(); return true; });
  handle('quit', () => { allowQuit = true; app.quit(); return true; });
  handle('overlay', showOverlay);
  handle('overlayClose', () => { overlay?.hide(); return true; },true);
  handle('openData', () => shell.openPath(app.getPath('userData')));
  handle('openAudio', id => { store.get(id); const dir=path.join(app.getPath('userData'),'audio',id); if(!fs.existsSync(dir)) throw new Error('No saved audio. Enable Save audio before recording.'); return shell.openPath(dir); });
}

app.whenReady().then(() => {
  settingsFile = path.join(app.getPath('userData'),'preferences.json');
  let saved={};try { saved=JSON.parse(fs.readFileSync(settingsFile,'utf8')); } catch {}
  settings={...defaults,...saved,provider:'openai'};
  if(saved.provider!=='openai' || !settings.model) settings.model=defaults.model;
  keyFile=path.join(app.getPath('userData'),'openai-key.bin');
  if(process.env.OPENAI_API_KEY) { apiKey=process.env.OPENAI_API_KEY.trim();keyStorage='environment'; }
  else { try { if(safeStorage.isEncryptionAvailable()) { apiKey=safeStorage.decryptString(fs.readFileSync(keyFile));keyStorage='encrypted'; } } catch {} }
  settings.autoTranslate=Boolean(settings.autoTranslate && apiKey);
  store = new SessionStore(path.join(app.getPath('userData'),'meetings'));
  translations=new LiveTranslationQueue({store,createAI:()=>new OpenAIAI({getApiKey:()=>apiKey}),onMeeting:s=>broadcast('meeting',s),sanitizeError:message=>apiKey?message.split(apiKey).join('[redacted]'):message,
    onEvent:data=>broadcast('live-translation',{...data,error:apiKey?data.error.split(apiKey).join('[redacted]'):data.error})});
  speech = new SpeechWorker(ROOT,msg => broadcast('speech-status',msg));
  const sess = electronSession.defaultSession;
  sess.setPermissionRequestHandler((contents,permission,callback) => callback(Boolean(main && contents===main.webContents && permission==='media')));
  sess.setPermissionCheckHandler((contents,permission) => Boolean(main && contents===main.webContents && permission==='media'));
  sess.setDisplayMediaRequestHandler(async (request,callback) => {
    if (!activeCapture || request.frame !== main?.webContents.mainFrame) { callback({}); return; }
    try {
      const sources = await desktopCapturer.getSources({ types:['screen'],thumbnailSize:{ width:0,height:0 } });
      const source = sources.find(s => s.id===selectedSource);
      if (!source) { callback({}); return; }
      callback({ video:source,audio:'loopback' });
    } catch { callback({}); }
  });
  register(); makeMain();
  app.on('activate', () => { if(!main || main.isDestroyed()) makeMain(); });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if(!allowQuit && main && !main.isDestroyed()) { event.preventDefault(); main.webContents.send('desk:event',{type:'close-request'}); return; }
  speech?.stop(); ai.cancel(); translations?.cancel();
});
