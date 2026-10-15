// Optional desktop integration test: npm install --no-save playwright
// This test uses a OpenAI Responses protocol fixture, not a real language model.
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-desktop-test-'));const requests=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'gpt-4.1-mini'}]}));return;}
    let input='';for await(const bytes of req)input+=bytes;const payload=JSON.parse(input);requests.push(payload);
    const text=payload.instructions.includes('Translate only the TARGET')?'내일 후속 안내를 드리겠습니다.':payload.instructions.includes('Write meeting notes')?'## Decisions\nShip Friday only after QA passes.':'We can aim for Friday, provided QA passes.';
    res.setHeader('Content-Type','text/event-stream');res.write('data: '+JSON.stringify({type:'response.output_text.delta',delta:text.slice(0,20)})+'\n\n');
    res.end('data: '+JSON.stringify({type:'response.output_text.delta',delta:text.slice(20)})+'\n\ndata: {"type":"response.completed"}\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let instance;
  const launch=()=>electron.launch({executablePath:require('electron'),args:[root,...(process.platform==='linux'?['--no-sandbox','--ozone-platform=headless','--disable-gpu']:[])],
    env:{...process.env,MEETING_DESK_DATA_DIR:dir,OPENAI_API_KEY:'test-placeholder'},timeout:30000});
  try{
    instance=await launch();await instance.evaluate((_electron,port)=>{const original=globalThis.fetch;globalThis.fetch=(url,options)=>original(`http://127.0.0.1:${port}${new URL(url).pathname}`,options);},server.address().port);const page=await instance.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Ready.')||document.getElementById('notice').textContent.includes('Welcome.'));
    await page.locator('#meeting-title').fill('Launch planning');await page.locator('#meeting-title').blur();
    await page.locator('#manual-text').fill('Can we ship Friday?');await page.locator('#manual-form button').click();
    await page.waitForFunction(()=>document.querySelectorAll('.utterance').length===1);
    await page.locator('#manual-speaker').selectOption('Me');await page.locator('#manual-text').fill('Only after QA passes.');await page.locator('#manual-form button').click();
    await page.waitForFunction(()=>document.querySelectorAll('.utterance').length===2);
    await page.locator('#context').fill('Do not promise a date until QA approves.');await page.locator('#context').blur();
    await page.locator('[data-view="setup"]').click();await page.locator('#refresh-models').click();await page.waitForFunction(()=>document.getElementById('openai-status').textContent.startsWith('Connected.'));
    await page.locator('#save-settings').click();await page.waitForFunction(()=>document.getElementById('notice').textContent==='Settings saved.');
    await page.locator('[data-view="live"]').click();await page.locator('#generate').click();
    await page.waitForFunction(()=>document.getElementById('ai-output').textContent.includes('provided QA passes.'));
    const nextWindow=instance.waitForEvent('window');await page.locator('#open-overlay').click();const prompt=await nextWindow;
    await prompt.waitForFunction(()=>document.getElementById('script').textContent.includes('provided QA passes.'));
    const rejected=await prompt.evaluate(async()=>{try{await window.desk.get('anything');return false;}catch(e){return /Untrusted window/.test(e.message);}});
    assert.equal(rejected,true,'Overlay must not be able to read arbitrary meetings through IPC.');
    await page.locator('[data-task="report"]').click();await page.locator('#generate').click();
    await page.waitForFunction(()=>document.getElementById('ai-output').textContent.includes('## Decisions'));
    // No manual Translate click: new transcript lines should translate automatically.
    await page.locator('[data-view="setup"]').click();await page.locator('#output-language').selectOption('Korean');await page.locator('#save-settings').click();
    await page.locator('[data-view="live"]').click();await page.locator('#auto-translate').check();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Automatic translation enabled'));
    await page.locator('#manual-text').fill('We will follow up tomorrow.');await page.locator('#manual-form button').click();
    await page.waitForFunction(()=>document.querySelector('.translation-text')?.textContent==='내일 후속 안내를 드리겠습니다.');
    await page.locator('#auto-translate').uncheck();
    const exportFile=path.join(dir,'export.md');
    await instance.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exportFile);
    await page.locator('#export').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Exported:'));
    assert.match(fs.readFileSync(exportFile,'utf8'),/Ship Friday only after QA passes/);assert.match(fs.readFileSync(exportFile,'utf8'),/내일 후속 안내를 드리겠습니다/);
    assert.match(requests[0].input,/Do not promise a date/);
    await page.locator('[data-view="library"]').click();await page.waitForFunction(()=>document.querySelectorAll('.library-item').length===1);
    assert.match(await page.locator('.library-item').innerText(),/Launch planning/);
    assert.equal(errors.length,0,errors.join('\n'));
    const boot=await page.evaluate(()=>window.desk.boot());assert(boot.settings.hasApiKey);assert(!JSON.stringify(boot).includes('test-placeholder'));assert(!fs.readFileSync(path.join(dir,'preferences.json'),'utf8').includes('test-placeholder'));
    await instance.close();instance=await launch();const reopened=await instance.firstWindow();
    await reopened.waitForFunction(()=>document.querySelectorAll('.utterance').length===3);
    assert.equal(await reopened.locator('#meeting-title').inputValue(),'Launch planning');
    assert.match(await reopened.locator('.translation-text').innerText(),/내일 후속 안내를 드리겠습니다/);
    await reopened.locator('[data-task="report"]').click();
    assert.match(await reopened.locator('#ai-output').innerText(),/## Decisions/);
    if(process.env.MEETING_DESK_SCREENSHOT)await reopened.screenshot({path:process.env.MEETING_DESK_SCREENSHOT,fullPage:true});
    console.log('PASS: native Electron IPC, transcript, reference context, OpenAI Responses protocol, overlay role restriction, automatic per-line translation, bilingual export, library and restart persistence.');
  }finally{
    if(instance)await instance.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
