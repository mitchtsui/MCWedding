/* Local Chromium integration: synthetic guests and mocked caption transport, no live services. */
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const puppeteer = require(process.env.PUPPETEER_MODULE || path.resolve(__dirname, '../../Personal - wset-atlas/node_modules/puppeteer'));
const root = path.resolve(__dirname, '..');
const eventId = '11111111-1111-4111-8111-111111111111';
const token = 'test+caption/token=' + 'A'.repeat(30);
const captionCalls = [], errors = [];
const hubEnv={WEDDING_HUB_PASSWORD:'synthetic-hub',WEDDING_HUB_SESSION_SECRET:'synthetic-hub-secret-for-browser-check-123456'};
Object.assign(process.env,hubEnv);
const hubHandler=require('../api/hub-session.js').createHandler({env:hubEnv});
const vipHandler=require('../api/vip-assets.js').createHandler({env:hubEnv});
let middleware;
let preflightAllowed = true;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status, payload) => {res.writeHead(status, {'Content-Type':'application/json'});res.end(JSON.stringify(payload));};
  if(url.pathname==='/api/hub-session.js'){
    let raw='';for await(const chunk of req)raw+=chunk;req.body=raw;return hubHandler(req,res);
  }
  if(url.pathname==='/api/vip-assets.js')return vipHandler(req,res);
  if(middleware){
    const result=middleware(new Request('http://'+req.headers.host+req.url,{headers:req.headers}));
    if(result.headers.get('x-middleware-next')!=='1'){
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;
    }
  }
  if (url.pathname === '/api/seating-view' || url.pathname === '/api/seating-view.js') return json(200,{ok:true,guests:[{name:'Guest One',table_number:1},{name:'Guest Two',table_number:15}],meta:{updated_at:'2026-10-13T00:00:00Z'}});
  if (url.pathname === '/api/captions.js') {
    let raw=''; for await (const chunk of req) raw+=chunk;
    const input=req.method==='GET'?Object.fromEntries(url.searchParams):JSON.parse(raw||'{}');
    captionCalls.push(input.action);
    if(input.action==='config') return json(200,{ok:true,data:{enabled:true,guestLinksReady:true,supportedLanguages:['en','ja','zh-CN']}});
    if(input.action==='operatorStatus') return json(200,{ok:true,data:{authenticated:(req.headers.cookie||'').includes('hub-test=1'),expiresAt:Date.now()+3600000}});
    if(input.action==='operatorLogin') {
      if(input.password!=='local-test-only')return json(401,{ok:false,error:{code:'UNAUTHENTICATED',message:'Password not recognised'}});
      res.setHeader('Set-Cookie','hub-test=1; Path=/; HttpOnly; SameSite=Strict');
      return json(200,{ok:true,data:{authenticated:true,expiresAt:Date.now()+3600000}});
    }
    if(input.action==='operatorLogout') {res.setHeader('Set-Cookie','hub-test=; Path=/; Max-Age=0');return json(200,{ok:true,data:{authenticated:false}});}
    if(input.action==='preflight') return preflightAllowed?json(200,{ok:true,data:{enabled:true,guestLinksReady:true}}):json(401,{ok:false,error:{code:'UNAUTHENTICATED',message:'Session expired'}});
    return json(503,{ok:false,error:{code:'TEST_SERVICE_UNAVAILABLE',message:'No live service in this local test'}});
  }
  // Fail the test if operator mode attempts to create the old sign-in client.
  if(url.pathname==='/vendor/supabase.js'){res.setHeader('Content-Type','text/javascript');res.end('window.supabase={createClient(){throw new Error("Unexpected Supabase client in password test")}};');return;}
  if(url.pathname==='/api/config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.SUPABASE_URL="";window.SUPABASE_ANON_KEY="";');return;}
  const name=decodeURIComponent(url.pathname.slice(1));
  const allowed=/^(?:wedding-(?:party|day|hub-embed)[a-z-]*\.(?:html|js|css)|vip-guide(?:-data)?\.(?:html|js)|seating-view\.(?:html|js|css)|live-captions[a-z-]*\.(?:html|js|css)|photos\/vip\/[a-z-]+\.jpg|vendor\/qr\.js)$/;
  if(!allowed.test(name)){res.writeHead(404).end();return;}
  try {res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'image/jpeg');res.end(await fs.readFile(path.join(root,name)));}catch{res.writeHead(404).end();}
});
async function main(){
 middleware=(await import('../middleware.js')).default;
 await fs.mkdir(path.join(root,'.cache'),{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-first-run']});
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base+'/wedding-party.html',{waitUntil:'networkidle0'});
  assert.ok(page.url().includes('wedding-party-login.html'));
  const blocked=await page.evaluate(async()=>{const r=await fetch('/vip-guide-data.js');return{status:r.status,body:await r.text()};});
  assert.equal(blocked.status,401);assert.ok(!blocked.body.includes('VIP_PEOPLE'));
  await page.type('#hubPassword',hubEnv.WEDDING_HUB_PASSWORD);
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.$eval('#hubLoginForm',e=>e.requestSubmit())]);
  assert.ok(page.url().includes('wedding-party.html'));
  const getFrame=async id=>(await page.$('#'+id)).contentFrame();
  const measurements=[];
  for(const width of [344,390,744,1280]){
   await page.setViewport({width,height:900});
   for(const tab of ['day','vips','seating','captions']){
    await page.click('#tab-'+tab);
    if(tab!=='captions'){
     const child=await getFrame(tab==='day'?'dayFrame':tab==='vips'?'vipsFrame':'seatingFrame');
     await child.waitForSelector(tab==='day'?'#person':tab==='vips'?'.person-card':'#guest-search');
     const dims=await child.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
     assert.equal(dims.width,dims.scroll,`${tab} overflow at ${width}`);
     const adminLinks=await child.$$eval('a[href*="admin.html"]',es=>es.filter(e=>e.getClientRects().length).length);
     assert.equal(adminLinks,0,`${tab} admin navigation visible`);
     if(tab==='vips'){
      const rows=await child.$$eval('.family-row',es=>es.map(row=>[...row.querySelectorAll('h3')].map(e=>e.textContent)));
      assert.deepEqual(rows.map(row=>row.length),[3,3,2,1,4,5,4]);
      const rowLines=await child.$$eval('.family-row',es=>es.every(row=>new Set([...row.children].map(e=>e.offsetTop)).size===1));
      assert.ok(rowLines,'Each family row stays on one line');
     }
    }
    const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({w:e.offsetWidth,h:e.offsetHeight})),docHeight:document.documentElement.scrollHeight,height:innerHeight}));
    assert.equal(dims.width,dims.scroll);assert.equal(dims.docHeight,dims.height);assert.ok(dims.buttons.every(b=>b.w>=44&&b.h>=44));
   }
   await page.click('#tab-vips');await page.screenshot({path:path.join(root,`.cache/hub-${width}.png`)});
   measurements.push({width,overflow:false,tabs:4});
  }
  // Keep view state and frame identity when switching tabs.
  const vip=await getFrame('vipsFrame');const firstName=await vip.$eval('.person-card h3',e=>e.textContent);await vip.type('#vipSearch',firstName);
  await page.click('#tab-day');await page.click('#tab-vips');
  assert.equal(await (await getFrame('vipsFrame')).$eval('#vipSearch',e=>e.value),firstName);
  await page.focus('#tab-vips');await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('#tab-seating',e=>e.getAttribute('aria-selected')),'true');
  await page.click('#tab-captions');await page.click('#operateButton');
  const operator=await getFrame('operatorFrame');
  await operator.waitForSelector('#live-auth-password',{visible:true});
  assert.equal(await operator.$eval('#live-auth-email',e=>e.getClientRects().length),0);
  await operator.type('#live-auth-password','wrong-password');
  await operator.$eval('#live-auth-form',e=>e.requestSubmit());
  await operator.waitForFunction(()=>document.getElementById('live-auth-status').textContent.includes('Password'));
  await operator.$eval('#live-auth-password',e=>e.value='');await operator.type('#live-auth-password','local-test-only');
  await operator.$eval('#live-auth-form',e=>e.requestSubmit());
  await operator.waitForSelector('#hub-logout',{visible:true});
  await page.click('#tab-day');await page.click('#tab-captions');
  assert.equal((await getFrame('operatorFrame')),operator);
  await operator.click('#hub-logout');await operator.waitForSelector('#live-auth-password',{visible:true});
  await page.click('#watchButton');
  const guestLink=base+'/live-captions.html?live=1&event='+eventId+'#'+new URLSearchParams({token});
  await page.type('#captionLink',guestLink);await page.$eval('#captionLinkForm',e=>e.requestSubmit());
  await page.waitForSelector('#viewerFrame',{visible:true});
  assert.ok((await page.$eval('#viewerFrame',e=>e.src)).includes(encodeURIComponent(token)));
  assert.ok(page.url().includes('#captions?'));assert.ok(!new URL(page.url()).search);
  await page.click('#tab-vips');assert.ok(page.url().includes('token='));
  await page.reload({waitUntil:'networkidle0'});await page.click('#tab-captions');
  assert.equal(await page.$eval('#viewerFrame',e=>e.hidden),false);
  assert.ok(captionCalls.includes('operatorLogin')&&captionCalls.includes('operatorLogout'));
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.click('#hubLogout')]);
  assert.ok(page.url().includes('wedding-party-login.html'));
  const afterLogout=await page.evaluate(async()=>{const r=await fetch('/vip-guide-data.js');return r.status;});
  assert.equal(afterLogout,401);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({measurements,checks:['tab state retention','keyboard tabs','password gate','wrong password','login/logout','operator iframe retention','base64 caption link','fragment-only invite','invite survives tab/reload'],errors},null,2));
 }finally{if(browser)await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;server.close();});
