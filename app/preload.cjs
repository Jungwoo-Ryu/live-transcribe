const { contextBridge, ipcRenderer } = require('electron');
const invoke = name => async payload => {
  const result = await ipcRenderer.invoke(`desk:${name}`, payload);
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
const api = {};
for (const name of ['boot','settings','autoTranslate','retryTranslation','create','list','get','patch','append','delete','export','models','speechCheck','warmup',
  'sources','captureStart','captureStop','chunk','import','generate','cancel','overlay','overlayClose','openData','openAudio','quit']) api[name] = invoke(name);
api.onEvent = listener => {
  const fn = (_event,payload) => listener(payload);
  ipcRenderer.on('desk:event',fn); return () => ipcRenderer.removeListener('desk:event',fn);
};
contextBridge.exposeInMainWorld('desk',api);
