// npm install --no-save jsdom@26 && node tests/session-storage.cjs
// DOM tests with synthetic credentials and mocked API; no production requests.
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.join(__dirname,'..'),TOKEN='synthetic-business-token';
const legacy={nuvalite_access_token:'old-secret',nuvalite_session:'1',citago_demo_final_v1:'{"REC":[{"bz":{"name":"OLD DEMO"}}]}'};
const me={full_name:'Test owner',email:'owner@example.test',businesses:[{id:'test-business',name:'Test business',subscription_status:'ACTIVE'}]};
const tick=()=>new Promise(r=>setTimeout(r,20));
const doms=[];
function open(file,{session={},local={},fetcher}={}){
 const errors=[],requests=[],writes=[],html=fs.readFileSync(path.join(root,file),'utf8');
 const console=new VirtualConsole();
 console.on('jsdomError',e=>{if(!/Not implemented: navigation/.test(e.message))errors.push(e)});
 console.on('error',(...args)=>errors.push(new Error(args.join(' '))));
 const dom=new JSDOM(html,{url:'https://nuvalite.test/'+file+(file.startsWith('negocio')?'?id=test-business':''),runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,beforeParse(w){
  w.Headers=Headers;w.Request=Request;w.scrollTo=()=>{};w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};
  for(const [k,v] of Object.entries({...legacy,...local}))w.localStorage.setItem(k,v);
  for(const [k,v] of Object.entries(session))w.sessionStorage.setItem(k,v);
  const set=w.Storage.prototype.setItem;
  w.Storage.prototype.setItem=function(k,v){if(this===w.localStorage)writes.push(k);return set.call(this,k,v)};
  w.fetch=async(url,opts={})=>{
   requests.push({url:String(url),opts});
   if(fetcher)return fetcher(String(url),opts);
   if(String(url).endsWith('/auth/me'))return response(me);
   if(String(url).endsWith('/settings'))return response({name:'Test business',whatsapp:'573000000000',slug:'test-business'});
   if(String(url).includes('/dashboard?'))return response({date:new URL(url).searchParams.get('date'),business_name:'Test business',appointments:{total:0,confirmed:0,pending:0,completed:0,cancelled:0,no_show:0},upcoming_appointments:0});
   if(String(url).includes('/public/'))return response({});
   return response([]);
  };
 }});doms.push(dom);
 return {dom,w:dom.window,errors,requests,writes,setFetcher(fn){fetcher=fn}};
}
function response(data,status=200){return {ok:status>=200&&status<300,status,json:async()=>data}}
function clean(t){for(const key of Object.keys(legacy))assert.equal(t.w.localStorage.getItem(key),null,key);assert.deepEqual(t.writes,[]);assert.deepEqual(t.errors.map(e=>e.message),[])}
function snapshot(storage){return Object.fromEntries(Array.from({length:storage.length},(_,i)=>{const k=storage.key(i);return[k,storage.getItem(k)]}))}
(async()=>{
 // Compile every inline script and forbid persistent reads/writes anywhere.
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(script[1],{filename:file});
  assert(!/localStorage\.(?:getItem|setItem|clear)\s*\(/.test(html),file);
  assert(!/persistShared|hydrateShared|refreshShared/.test(html),file);
  const cleanup=html.match(/<script>\s*\/\/ Remove only legacy NUVALITE[\s\S]*?<\/script>/);
  assert(cleanup,file+' cleanup');
  const store=new Map(Object.entries({...legacy,unrelated:'keep'}));
  vm.runInNewContext(cleanup[0].replace(/<\/?script>/g,''),{window:{localStorage:{removeItem:key=>store.delete(key)}}});
  assert.deepEqual([...store.entries()],[['unrelated','keep']]);
  vm.runInNewContext(cleanup[0].replace(/<\/?script>/g,''),{window:{get localStorage(){throw Error('disabled')}}});
 }
 const login=open('login.html',{local:{unrelated:'keep'},fetcher:async()=>response({access_token:TOKEN})});
 await tick();clean(login);assert.equal(login.w.localStorage.getItem('unrelated'),'keep');assert.equal(login.w.sessionStorage.getItem('nuvalite_access_token'),null);
 login.w.document.querySelector('#email').value='owner@example.test';login.w.document.querySelector('#password').value='SyntheticPassword123';
 await login.w.document.querySelector('#loginForm').onsubmit({preventDefault(){},submitter:login.w.document.querySelector('#loginForm button')});
 assert.equal(login.w.sessionStorage.getItem('nuvalite_access_token'),TOKEN);assert.equal(login.w.sessionStorage.getItem('nuvalite_session'),'1');clean(login);
 const session=snapshot(login.w.sessionStorage);
 const account=open('mi-cuenta.html',{session});await tick();clean(account);assert.equal(account.requests[0].opts.headers.Authorization,'Bearer '+TOKEN);assert(account.w.document.querySelector('#apps').textContent.includes('Entrar'));
 for(const file of ['negocio.html','negocio-minimal-premium.html','negocio-moderna-llamativa.html']){
  const business=open(file,{session});await tick();clean(business);
  assert(business.requests.some(r=>r.url.endsWith('/settings')),file+' loads settings');
  assert(business.w.document.body.textContent.includes('Test business'),file+' renders settings');
  for(const r of business.requests)assert.equal(new Headers(r.opts.headers).get('Authorization'),'Bearer '+TOKEN);
  business.w.dispatchEvent(new business.w.Event('focus'));business.w.dispatchEvent(new business.w.StorageEvent('storage',{key:'citago_demo_final_v1',newValue:'{}'}));business.w.render();clean(business);
  business.setFetcher(async()=>response({},401));
  await business.w.fetch('https://citago-backend.onrender.com/businesses/test-business/services');
  assert.equal(business.w.sessionStorage.getItem('nuvalite_access_token'),null);assert.equal(business.w.sessionStorage.getItem('nuvalite_session'),null);clean(business);
  const noSession=open(file);await tick();clean(noSession);assert.equal(noSession.requests.length,0,file+' denies unauthenticated boot');
  const expired=open(file,{session,fetcher:async()=>response({},401)});await tick();clean(expired);assert.equal(expired.w.sessionStorage.getItem('nuvalite_access_token'),null);assert.equal(expired.w.sessionStorage.getItem('nuvalite_session'),null);
 }
 const reload=open('mi-cuenta.html',{session});await tick();assert(reload.w.document.querySelector('#apps').textContent.includes('Entrar'));clean(reload);
 const freshTab=open('login.html');await tick();assert.equal(freshTab.w.sessionStorage.getItem('nuvalite_access_token'),null);clean(freshTab);
 account.w.document.querySelector('#logout').click();assert.equal(account.w.sessionStorage.getItem('nuvalite_access_token'),null);assert.equal(account.w.sessionStorage.getItem('nuvalite_session'),null);clean(account);
 const expiredAccount=open('mi-cuenta.html',{session,fetcher:async()=>response({},401)});await tick();clean(expiredAccount);assert.equal(expiredAccount.w.sessionStorage.getItem('nuvalite_access_token'),null);
 const register=open('registro.html',{fetcher:async()=>response({access_token:TOKEN})});await tick();
 register.w.document.querySelector('#email').value='owner@example.test';register.w.document.querySelector('#otp').value='123456';register.w.document.querySelector('#verifyBtn').disabled=false;
 await register.w.document.querySelector('#regForm').onsubmit({preventDefault(){}});assert.equal(register.w.sessionStorage.getItem('nuvalite_access_token'),TOKEN);clean(register);
 const platform=open('plataforma.html');await tick();clean(platform);assert.equal(platform.requests.length,0);
 const admin=open('plataforma.html',{session:{citago_platform_token:'synthetic-admin-token'},fetcher:async url=>response(url.endsWith('/auth/me')?{global_role:'SUPER_ADMIN',full_name:'Test admin'}:[])});await tick();clean(admin);assert.equal(admin.w.sessionStorage.getItem('citago_platform_token'),'synthetic-admin-token');
 admin.w.logoutPlatform();assert.equal(admin.w.sessionStorage.getItem('citago_platform_token'),null);clean(admin);
 console.log('PASS: session login/registration/account/business variants, API auth, 401/logout, reload, empty tab, admin session, demo cleanup/no rewrites, unrelated data retained, disabled storage, all inline syntax. Mocked DOM, not live production.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>doms.forEach(d=>d.window.close()));
