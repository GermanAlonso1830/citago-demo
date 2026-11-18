// Run with jsdom@26. All data and API responses are synthetic.
const {JSDOM, VirtualConsole}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const errors=[],requests=[];
let verifySuccess=true,pendingResolve=null;
const consoleEvents=new VirtualConsole();
consoleEvents.on('jsdomError',error=>errors.push(error.message));
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../cliente.html'),'utf8'),{
  url:'https://test.local/?biz=basic',runScripts:'dangerously',virtualConsole:consoleEvents,
  beforeParse(window){
    window.HTMLElement.prototype.scrollIntoView=function(){};
    window.fetch=async(url,options={})=>{
      const endpoint=new URL(url).pathname;
      const data=options.body?JSON.parse(options.body):{};
      requests.push({endpoint,data});
      assert(!('phone' in data)&&!('client_phone' in data),'Basic payload must omit phone');
      let body={},status=200;
      if(endpoint.endsWith('/catalog'))body={business:{id:'b',name:'Basic salon',client_identity_mode:'email',timezone:'UTC'},services:[],professionals:[]};
      else if(endpoint.endsWith('/booking/options')){
        if(pendingResolve)await new Promise(resolve=>{pendingResolve=resolve});
        body={can_send:true};
      }
      else if(endpoint.endsWith('/request'))body={challenge_id:'challenge',resend_after_seconds:60,expires_in_seconds:300};
      else if(endpoint.endsWith('/booking/verify')){
        if(!verifySuccess){status=401;body={detail:'Código incorrecto'}}
        else body={booking_verification_token:'proof',email:data.email,full_name:null,expires_in_seconds:600};
      }
      else if(endpoint.endsWith('/my_appointments/verify'))body={access_token:'my-token'};
      else if(endpoint==='/appointments')body={appointment:{status:'CONFIRMED'},email_confirmation:{accepted:true}};
      else if(endpoint.endsWith('/my'))body={appointments:[{service:'Haircut',status:'CONFIRMED',start_at:'2026-12-01T12:00:00Z',price:10000,duration_minutes:30}]};
      else throw Error(endpoint);
      return {ok:status===200,status,json:async()=>body};
    };
  }
});
const w=dom.window,d=w.document;
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
function click(action){const button=d.querySelector('[data-a="'+action+'"]');assert(button,action);button.click()}
function fill(id,value){const input=d.getElementById(id);assert(input,id);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}))}
function accept(id,checked=true){const input=d.getElementById(id);assert(input,id);input.checked=checked;input.dispatchEvent(new w.Event('change',{bubbles:true}))}
function noPhone(){assert(!d.querySelector('#phone,#phoneCountry,#myPhone,#myPhoneCountry'));assert(!d.getElementById('rem'))}
async function verifyBooking(email){
  fill('email',email);click('bookingSend');await tick();
  fill('bookingCode','123456');click('bookingVerify');await tick();
}
(async()=>{
  await tick();
  w.eval("step=4;booking.service={id:'service',name:'Haircut',price:10000};booking.professional={id:'professional'};booking.date='2026-12-01';booking.time='10:00';render()");
  noPhone();assert(d.getElementById('email').closest('fieldset').disabled);
  accept('bookingPrivacy');fill('email','invalid');assert(d.querySelector('[data-a="bookingSend"]').disabled);
  fill('email','new@example.com');assert(!d.querySelector('[data-a="bookingSend"]').disabled);
  click('bookingSend');await tick();assert(d.querySelector('[data-a="bookingSend"]').disabled);
  verifySuccess=false;fill('bookingCode','000000');click('bookingVerify');await tick();assert(d.body.textContent.includes('Código incorrecto'));
  verifySuccess=true;fill('bookingCode','123456');click('bookingVerify');await tick();
  assert(!d.getElementById('name').closest('fieldset').disabled);
  click('book');assert.equal(requests.filter(x=>x.endpoint==='/appointments').length,0);
  fill('name','New Client');click('book');await tick();
  assert(d.body.textContent.includes('Enviamos la confirmación a tu correo.'));noPhone();
  const bookingRequest=requests.find(x=>x.endpoint==='/appointments');assert.equal(bookingRequest.data.reminder_opt_in,false);
  click('my');noPhone();assert(d.getElementById('myEmail').disabled);
  accept('myPrivacy');fill('myEmail','new@example.com');click('identifyMy');await tick();
  assert(d.body.textContent.includes('Cambiar correo'));fill('myCode','123456');click('verifyMyCode');await tick();
  assert(d.body.textContent.includes('Haircut'));assert.equal(w.sessionStorage.getItem('client_otp_v2:basic'),'my-token');
  click('myLogout');assert.equal(w.sessionStorage.getItem('client_otp_v2:basic'),null);
  w.eval("view='home';step=4;bookingPrivacyAccepted=true;bookingProof={phase:'identify',token:'',bound:'',busy:false};render()");
  await verifyBooking('first@example.com');
  fill('email','second@example.com');assert(!w.eval('bookingProof.token'));
  await verifyBooking('second@example.com');accept('bookingPrivacy',false);assert(!w.eval('bookingProof.token'));
  accept('bookingPrivacy');fill('email','pending@example.com');pendingResolve=true;
  click('bookingSend');await tick();fill('email','changed@example.com');pendingResolve();pendingResolve=null;await tick();
  assert(!w.eval('bookingProof.token'));assert.equal(w.eval('bookingProof.phase'),'identify');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Basic client email DOM PASS: consent, new email, OTP, booking without phone, My appointments, logout, contact change, stale request.');
})().then(()=>dom.window.close()).catch(error=>{dom.window.close();console.error(error);process.exitCode=1});
