// Run: npm install --no-save --package-lock=false --ignore-scripts jsdom@26 && node tests/client-otp.cjs
// Confirm stays clickable to explain missing data; invalid attempts must never create appointments.
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('node:assert/strict');
let available=true,expire=false,requests=[],receiptAccepted=true,receiptStatus="CONFIRMED";const errors=[];
const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(fs.readFileSync(require('node:path').join(__dirname,'../cliente.html'),'utf8'),{url:'https://test.local/?biz=test',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'))};
 w.HTMLElement.prototype.scrollIntoView=function(){w.lastRevealed=this.id||this.getAttribute('role')};
 w.fetch=async(url,opts={})=>{const path=new URL(url).pathname;const data=opts.body?JSON.parse(opts.body):{};requests.push({path,data});let body={},status=200;
 if(path.endsWith('/catalog'))body={business:{id:'b',name:'Test',timezone:'UTC'},services:[],professionals:[]};
 else if(path.endsWith('/email/options'))body={requires_email:data.phone!=='+573001234567',email_hint:'o***@e***'};
 else if(path.endsWith('/email/request'))body={challenge_id:'booking-c',resend_after_seconds:60};
 else if(path.endsWith('/email/verify')){if(data.code!=='123456'){status=401;body={detail:'Código incorrecto'}}else body={booking_verification_token:'booking-proof',email:'owner@example.com',expires_in_seconds:600}}
 else if(path.endsWith('/otp/options'))body={methods:[{channel:'email',available},{channel:'whatsapp',available:false}]};
 else if(path.endsWith('/otp/request'))body={challenge_id:'c',resend_after_seconds:60,message:'Código enviado'};
 else if(path.endsWith('/otp/verify')){if(data.code!=='123456'){status=401;body={detail:'Código incorrecto'}}else body={access_token:'token'}}
 else if(path==='/appointments')body={appointment:{status:receiptStatus},email_confirmation:{accepted:receiptAccepted}};
 else if(path.endsWith('/my')){if(expire){status=401;body={detail:'Sesión vencida'}}else body={appointments:[{service:'Corte',status:'CONFIRMED',professional:'Leo',start_at:'2026-12-01T12:00:00Z',duration_minutes:30,price:10000}]}}
 else throw Error(path);
 return {ok:status===200,status,json:async()=>body};
 };
}});
const w=dom.window,d=w.document,tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const accept=id=>{const el=d.getElementById(id);assert(el,'missing '+id);assert(!el.checked,'consent starts unchecked');el.checked=true;el.dispatchEvent(new w.Event('change',{bubbles:true}))};
const click=a=>{const b=d.querySelector('[data-a="'+a+'"]');assert(b,'missing '+a);b.click()};
const fill=(id,value)=>{const el=d.getElementById(id);assert(el,'missing '+id);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}))};
(async()=>{await tick();click('my');assert(d.querySelector('[data-a="identifyMy"]').disabled);accept('myPrivacy');assert.equal(w.lastRevealed,'myPhone');fill('myPhone','3001234567');click('identifyMy');await tick();click('requestMyCode');await tick();
 fill('myCode','123');assert(d.querySelector('[data-a="verifyMyCode"]').disabled);assert(d.querySelector('[data-a="requestMyCode"]').disabled);
 fill('myCode','000000');click('verifyMyCode');await tick();assert(d.body.textContent.includes('Código incorrecto'));
 fill('myCode','123456');click('verifyMyCode');await tick();assert(d.body.textContent.includes('Corte'));
 assert(w.sessionStorage.getItem('client_otp_v2:test')==='token');click('myLogout');assert.equal(w.sessionStorage.getItem('client_otp_v2:test'),null);
 available=false;accept('myPrivacy');fill('myPhone','3001234567');click('identifyMy');await tick();assert(d.querySelector('[data-a="requestMyCode"]').disabled);
 click('myBack');available=true;accept('myPrivacy');fill('myPhone','3001234567');click('identifyMy');await tick();click('requestMyCode');await tick();
 expire=true;fill('myCode','123456');click('verifyMyCode');await tick();assert(d.getElementById('myPhone'));assert(d.body.textContent.includes('Sesión vencida'));
 w.eval("view='home';step=4;booking={service:{id:'s',name:'Corte',price:10000},professional:{id:'p',name:'Leo'},date:'2026-12-01',time:'10:00',name:'',phoneCountry:'+57',phone:'',email:'',notes:'',reminder:false};render()");
 assert(d.querySelector('[data-a="bookingIdentify"]').disabled);
 assert(!d.getElementById('rem').checked,'reminders must be an independent unchecked choice');
 const policyPanel=d.querySelector('.panelBody'),nameBeforePolicy=d.getElementById('name');policyPanel.scrollTop=240;nameBeforePolicy.focus();
 assert(d.body.textContent.includes('contacto@nuvlite.com'));assert(!/Germán Alonso|hotmail.com|Soledad/.test(d.body.textContent));
 click('privacy');assert(d.getElementById('privacyDialog').open);assert(d.querySelector('#privacyDialog iframe').src.endsWith('/legal/privacidad-2026-10-28.html'));
 d.getElementById('closePrivacy').click();assert(!d.getElementById('privacyDialog').open);assert.equal(d.querySelector('.panelBody'),policyPanel);assert.equal(policyPanel.scrollTop,240);assert.equal(d.getElementById('name'),nameBeforePolicy);
 const noConsentCount=requests.length;fill('phone','3001234567');await new Promise(r=>setTimeout(r,750));assert.equal(requests.length,noConsentCount);
 fill('phone','');const acceptanceRequests=requests.length;accept('bookingPrivacy');assert.equal(w.lastRevealed,'name','accepting privacy reveals the first contact field');assert.equal(d.querySelector('.panelBody'),policyPanel);assert.equal(d.getElementById('name'),nameBeforePolicy);assert.equal(requests.length,acceptanceRequests,'accepting without a number must not send a request');
 const reserve=()=>d.querySelector('[data-a="book"]');
 const assertBlocked=(field,label)=>{
  assert(!reserve().disabled,label+': action must explain missing data');
  const before=requests.filter(r=>r.path==='/appointments').length;
  click('book');
  assert.equal(requests.filter(r=>r.path==='/appointments').length,before,label+': no appointment request');
  const feedback=d.getElementById('bookingFieldError');
  assert(feedback,label+': visible validation message');
  assert.equal(feedback.dataset.field,field,label+': first invalid field');
  assert.equal(feedback.getAttribute('role'),'alert');
  assert(feedback.textContent.trim(),label+': nonempty guidance');
  assert.equal(w.lastRevealed,field,label+': reveal invalid field');
 };

 assertBlocked('name','empty booking');
 fill('name','   ');fill('phone','3001234567');assertBlocked('name','whitespace name');
 fill('name','Maria');assertBlocked('bookingEmailTitle','unverified email');
 fill('phone','');assertBlocked('phone','missing phone');fill('phone','123');assertBlocked('phone','short phone');fill('phone','3001234567');
 const panel=d.querySelector('.panelBody'),nameInput=d.getElementById('name');panel.scrollTop=280;
 click('bookingIdentify');await tick();assert.equal(d.querySelector('.panelBody'),panel);assert.equal(panel.scrollTop,280);assert.equal(d.getElementById('name'),nameInput);assert.equal(w.lastRevealed,'bookingEmailTitle');assert(!d.getElementById('email'),'existing email must not need typing');assert(d.body.textContent.includes('o***@e***'));
 assert(!d.body.textContent.includes('owner@example.com'),'full email hidden before OTP');
 click('bookingSend');await tick();assert.equal(w.lastRevealed,'bookingCode');assert.equal(d.querySelector('.panelBody'),panel);assert.equal(panel.scrollTop,280);assert(d.querySelector('[data-a="bookingVerify"]').disabled);fill('bookingCode','12ab');assert.equal(d.getElementById('bookingCode').value,'12');assert(d.querySelector('[data-a="bookingVerify"]').disabled);fill('bookingCode','000000');click('bookingVerify');await tick();assertBlocked('bookingCode','wrong verification code');
 fill('bookingCode','123456');click('bookingVerify');await tick();assert(!reserve().disabled);assert(d.body.textContent.includes('owner@example.com'));
 assert.equal(w.lastRevealed,'bookingEmailVerified');assert.equal(d.querySelector('.panelBody'),panel);assert.equal(panel.scrollTop,280);
 assert(!d.querySelector('[data-a="bookingVerify"]'),'verified state removes verify action');
 assert(!d.querySelector('[data-a="bookingSend"]'),'verified state removes resend action');
 const requestCount=requests.length;await w.eval("bookingEmailAction('request')");assert.equal(requests.length,requestCount,'verified state rejects accidental resend');
 w.eval('bookingProof.expiresAt=Date.now()-1');await new Promise(r=>setTimeout(r,1100));assertBlocked('bookingEmailTitle','expired proof');assert(d.querySelector('[data-a="bookingSend"]'));click('bookingSend');await tick();fill('bookingCode','123456');click('bookingVerify');await tick();assert(!reserve().disabled);
 fill('name','');assertBlocked('name','name removed after verification');fill('name','Maria');assert(!reserve().disabled);
 fill('phone','999123456');d.getElementById('phoneCountry').value='+51';d.getElementById('phoneCountry').dispatchEvent(new w.Event('change',{bubbles:true}));assertBlocked('bookingEmailTitle','phone change invalidates proof');
 click('bookingIdentify');await tick();assert(d.getElementById('email'),'new client must enter email');assert.equal(w.lastRevealed,'email');
 fill('email','invalid');click('bookingSend');await tick();assertBlocked('email','invalid email');assert(d.body.textContent.includes('Escribe un correo electrónico válido.'));
 fill('email','new@example.com');click('bookingSend');await tick();fill('bookingCode','123456');click('bookingVerify');await tick();assert(!reserve().disabled);
 w.eval('bookingBusy=true;render()');assert(reserve().disabled,'double submit blocked');const busyCount=requests.filter(r=>r.path==='/appointments').length;click('book');await tick();assert.equal(requests.filter(r=>r.path==='/appointments').length,busyCount,'busy submit must not create another appointment');
 assert.equal(requests.filter(r=>r.path==='/appointments').length,0,'validation must not create appointments');
 w.eval('bookingBusy=false;render()');click('book');await tick();assert(d.body.textContent.includes('Enviamos la confirmación a tu correo.'));
 receiptAccepted=false;w.eval("step=4;bookingProof={phase:'verified',token:'proof2',bound:bookingIdentity(),expiresAt:Date.now()+600000,busy:false};render()");click('book');await tick();assert(d.body.textContent.includes('no necesitas volver a reservar'));
 receiptAccepted=true;receiptStatus='PENDING';w.eval("step=4;bookingProof={phase:'verified',token:'proof3',bound:bookingIdentity(),expiresAt:Date.now()+600000,busy:false};render()");click('book');await tick();assert(d.body.textContent.includes('falta la aprobación del negocio'));
 // Completing the phone reveals the next step without finding the hidden Continue button.
 w.eval("view='home';step=4;booking.phoneCountry='+57';booking.phone='';bookingProof={phase:'identify',token:'',bound:'',busy:false};render()");
 const autoPanel=d.querySelector('.panelBody');autoPanel.scrollTop=300;
 let optionsBefore=requests.filter(r=>r.path.endsWith('/email/options')).length;
 const sendsBefore=requests.filter(r=>r.path.endsWith('/email/request')).length;
 fill('phone','300123456');await new Promise(r=>setTimeout(r,750));assert.equal(requests.filter(r=>r.path.endsWith('/email/options')).length,optionsBefore,'partial phone must not trigger lookup');
 fill('phone','3001234567');await new Promise(r=>setTimeout(r,750));
 assert.equal(requests.filter(r=>r.path.endsWith('/email/options')).length,optionsBefore+1);
 assert.equal(w.lastRevealed,'bookingEmailTitle');assert(d.body.textContent.includes('o***@e***'));assert.equal(d.querySelector('.panelBody'),autoPanel);
 await new Promise(r=>setTimeout(r,750));assert.equal(requests.filter(r=>r.path.endsWith('/email/options')).length,optionsBefore+1,'no repeated lookup');
 fill('phone','3011234567');d.getElementById('phone').dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 assert.equal(w.lastRevealed,'email');assert(d.getElementById('email'),'new number reveals email entry');
 assert.equal(requests.filter(r=>r.path.endsWith('/email/request')).length,sendsBefore,'lookup must not send a code');
 // Revoking authorization immediately invalidates the current booking proof.
 const consent=d.getElementById('bookingPrivacy');consent.checked=false;consent.dispatchEvent(new w.Event('change',{bubbles:true}));
 assertBlocked('bookingPrivacy','consent revoked');assert(d.querySelector('[data-a="bookingIdentify"]').disabled);
 assert(!d.getElementById('bookingCode'));
 for(const req of requests.filter(r=>r.path.endsWith('/options')||r.path.endsWith('/request'))){assert.equal(req.data.privacy_accepted,true);assert.equal(req.data.privacy_version,'2026-10-28')}
 assert.equal(requests.filter(r=>r.path==='/appointments').length,3,'only the three valid confirmation scenarios submit');
 assert(!requests.some(r=>r.path.includes('dev-access')));assert.deepEqual(errors,[]);console.log('Booking validation and DOM flow PASS: OTP, wrong code, incomplete data guidance with zero submissions, valid confirmations, double-submit guard, list, logout, unavailable email, expired session, no dev-access');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exit(1)});

