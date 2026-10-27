// Run: npm install --no-save jsdom && node tests/client-otp.cjs
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('node:assert/strict');
let available=true,expire=false,requests=[];const errors=[];
const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(fs.readFileSync(require('node:path').join(__dirname,'../cliente.html'),'utf8'),{url:'https://test.local/?biz=test',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
 w.fetch=async(url,opts={})=>{const path=new URL(url).pathname;const data=opts.body?JSON.parse(opts.body):{};requests.push({path,data});let body={},status=200;
 if(path.endsWith('/catalog'))body={business:{id:'b',name:'Test',timezone:'UTC'},services:[],professionals:[]};
 else if(path.endsWith('/email/options'))body={requires_email:data.phone!=='+573001234567',email_hint:'o***@e***'};
 else if(path.endsWith('/email/request'))body={challenge_id:'booking-c',resend_after_seconds:60};
 else if(path.endsWith('/email/verify')){if(data.code!=='123456'){status=401;body={detail:'Código incorrecto'}}else body={booking_verification_token:'booking-proof',email:'owner@example.com',expires_in_seconds:600}}
 else if(path.endsWith('/otp/options'))body={methods:[{channel:'email',available},{channel:'whatsapp',available:false}]};
 else if(path.endsWith('/otp/request'))body={challenge_id:'c',resend_after_seconds:60,message:'Código enviado'};
 else if(path.endsWith('/otp/verify')){if(data.code!=='123456'){status=401;body={detail:'Código incorrecto'}}else body={access_token:'token'}}
 else if(path.endsWith('/my')){if(expire){status=401;body={detail:'Sesión vencida'}}else body={appointments:[{service:'Corte',status:'CONFIRMED',professional:'Leo',start_at:'2026-12-01T12:00:00Z',duration_minutes:30,price:10000}]}}
 else throw Error(path);
 return {ok:status===200,status,json:async()=>body};
 };
}});
const w=dom.window,d=w.document,tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const click=a=>{const b=d.querySelector('[data-a="'+a+'"]');assert(b,'missing '+a);b.click()};
const fill=(id,value)=>{const el=d.getElementById(id);assert(el,'missing '+id);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}))};
(async()=>{await tick();click('my');fill('myPhone','3001234567');click('identifyMy');await tick();click('requestMyCode');await tick();
 fill('myCode','123');assert(d.querySelector('[data-a="verifyMyCode"]').disabled);assert(d.querySelector('[data-a="requestMyCode"]').disabled);
 fill('myCode','000000');click('verifyMyCode');await tick();assert(d.body.textContent.includes('Código incorrecto'));
 fill('myCode','123456');click('verifyMyCode');await tick();assert(d.body.textContent.includes('Corte'));
 assert(w.sessionStorage.getItem('client_otp_v2:test')==='token');click('myLogout');assert.equal(w.sessionStorage.getItem('client_otp_v2:test'),null);
 available=false;fill('myPhone','3001234567');click('identifyMy');await tick();assert(d.querySelector('[data-a="requestMyCode"]').disabled);
 click('myBack');available=true;fill('myPhone','3001234567');click('identifyMy');await tick();click('requestMyCode');await tick();
 expire=true;fill('myCode','123456');click('verifyMyCode');await tick();assert(d.getElementById('myPhone'));assert(d.body.textContent.includes('Sesión vencida'));
 w.eval("view='home';step=4;booking={service:{id:'s',name:'Corte',price:10000},professional:{id:'p',name:'Leo'},date:'2026-12-01',time:'10:00',name:'',phoneCountry:'+57',phone:'',email:'',notes:'',reminder:true};render()");
 const reserve=()=>d.querySelector('[data-a="book"]');
 assert(reserve().disabled,'empty booking must be disabled');
 fill('name','   ');fill('phone','3001234567');assert(reserve().disabled,'whitespace name');
 fill('name','Maria');assert(reserve().disabled,'unverified email must block booking');
 click('bookingIdentify');await tick();assert(!d.getElementById('email'),'existing email must not need typing');assert(d.body.textContent.includes('o***@e***'));
 assert(!d.body.textContent.includes('owner@example.com'),'full email hidden before OTP');
 click('bookingSend');await tick();fill('bookingCode','000000');click('bookingVerify');await tick();assert(reserve().disabled);
 fill('bookingCode','123456');click('bookingVerify');await tick();assert(!reserve().disabled);assert(d.body.textContent.includes('owner@example.com'));
 click('bookingSend');await tick();assert(reserve().disabled,'resend invalidates booking authorization');fill('bookingCode','123456');click('bookingVerify');await tick();assert(!reserve().disabled);
 fill('name','');assert(reserve().disabled);fill('name','Maria');assert(!reserve().disabled);
 fill('phone','999123456');d.getElementById('phoneCountry').value='+51';d.getElementById('phoneCountry').dispatchEvent(new w.Event('change',{bubbles:true}));assert(reserve().disabled,'phone change must invalidate proof');
 click('bookingIdentify');await tick();assert(d.getElementById('email'),'new client must enter email');
 fill('email','invalid');click('bookingSend');await tick();assert(reserve().disabled);assert(d.body.textContent.includes('Escribe un correo electrónico válido.'));
 fill('email','new@example.com');click('bookingSend');await tick();fill('bookingCode','123456');click('bookingVerify');await tick();assert(!reserve().disabled);
 w.eval('bookingBusy=true;render()');assert(reserve().disabled,'double submit blocked');
 assert.equal(requests.filter(r=>r.path==='/appointments').length,0,'validation must not create appointments');
 assert(!requests.some(r=>r.path.includes('dev-access')));assert.deepEqual(errors,[]);console.log('Booking validation and DOM flow PASS: OTP, wrong code, disabled controls, list, logout, unavailable email, expired session, no dev-access');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exit(1)});
