const text=document.getElementById('script'),kind=document.getElementById('kind'),status=document.getElementById('status');
function show(d){if(d.kind!=='answer')return;text.textContent=d.text||'Waiting for OpenAI…';kind.textContent='YOUR NEXT WORDS';status.textContent=d.error||({loading:'Waiting for OpenAI…',streaming:'Writing…',done:'Ready to read',cancelled:'Stopped'}[d.status]||'');text.scrollTop=text.scrollHeight;}
window.desk.onEvent(e=>{if(e.type==='ai')show(e.data);});
window.desk.boot().then(s=>{if(s.latestGeneration?.kind==='answer')show({...s.latestGeneration,status:'done'});}).catch(e=>{status.textContent=e.message;});
document.getElementById('close').onclick=()=>window.desk.overlayClose();
