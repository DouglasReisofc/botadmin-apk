const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {createRequire}=require('node:module');
const nativeRequire=createRequire(process.cwd()+'/package.json');process.env.META_ENCRYPTION_KEY='test-context-key-never-deployed';
const {NextRequest,NextResponse}=require('next/server');let signedUser=1,owners=[];let pending=true;let exchanges=0;
const mocks={
 'next/server':{NextRequest,NextResponse},'lib/auth':{getCurrentUser:async()=>({id:2,role:'user'})},
 'lib/db':{getDb:()=>({query:async(sql,args)=>[[sql.includes('FROM users')?{id:args[0],role:'admin'}:{id:666}] ]})},
 'lib/meta':{getPublicAppBaseUrl:()=> 'https://botadmin.shop'},
 'lib/profile-connection-preferences':{isConnectionPurpose:x=>['service','groups','both'].includes(x)},
 'lib/meta-platform':{loadMetaPlatformConfig:async()=>({appId:'app',apiVersion:'v25.0',configId:'config'}),publicMetaPlatform:()=>({ready:true}),metaGraph:async(c,t,p)=>p.includes('/phone_numbers')?{data:[{id:'123456789',display_phone_number:'551199999999'}]}:{}},
 'lib/meta-channel':{createPendingMetaProfile:async(u)=>{owners.push(u);return 666},pendingMetaOnboarding:async(i,u)=>{owners.push(u);return u===signedUser&&pending?{token_encrypted:'token'}:null},metaConnection:async(i,u)=>{owners.push(u);return u===signedUser&&!pending?{phone_number_id:'123456789',token_encrypted:'token'}:null},bindMetaConnection:async(u)=>{owners.push(u);pending=false;return 666},requestMetaCoexistenceSync:async()=>({status:'pending'}),storePendingMetaAuthorization:async(i,u)=>{owners.push(u)},updatePendingMetaOnboarding:async()=>{}},
 'lib/wwpanel':{decryptWwPanelSecret:()=> 'stored-token'},
};
function load(name){const module={exports:{}};vm.runInNewContext(fs.readFileSync('/tmp/meta-onboarding-hotfix/'+name+'.cjs','utf8'),{module,exports:module.exports,require:n=>mocks[n]||nativeRequire(n),process,Buffer,URL,URLSearchParams,AbortSignal,fetch:async()=>{exchanges++;return {ok:true,json:async()=>({access_token:'safe-token'})}}});return module.exports;}
const start=load('start').POST,complete=load('complete').POST,frame=load('frame').renderMetaOnboardingFrame;
const post=(body,origin='https://botadmin.shop')=>new NextRequest('https://botadmin.shop/api/meta/onboarding/complete',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
(async()=>{
 const started=await start(post({purpose:'service',native:true}));const data=await started.json();assert.equal(data.instanceId,666);
 // Start authenticated as browser mock user 2; switch ownership to its signed scope.
 signedUser=2;owners=[];
 const page=await frame(new NextRequest('https://botadmin.shop/api/meta/onboarding/frame?context='+data.context+'&instanceId=999'));
 const html=await page.text();assert.match(html,/"instanceId":666/);assert.match(html,/connect-3d.png/);assert.match(html,/const nativeReturn=true/);assert.match(html,/completed=true/);
 // Exercise the browser event ordering: OAuth token first, signup event later.
 const inline=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
 const elements={connect:{hidden:true,disabled:true},status:{textContent:''},return:{hidden:true,href:''}};
 let listener,login,posts=0;const notified=[],timers=[];
 const window={parent:{postMessage:m=>notified.push(m)},location:{origin:'https://botadmin.shop',href:''},addEventListener:(n,f)=>{listener=f}};window.top=window;window.self=window;
 const document={getElementById:id=>elements[id],body:{dataset:{},classList:{add(){}}},querySelector:()=>({textContent:''})};
 vm.runInNewContext(inline,{window,document,navigator:{userAgent:'Android'},FB:{init(){},login:f=>{login=f}},MutationObserver:class{observe(){}},URLSearchParams,setTimeout:f=>{timers.push(f);return timers.length},clearTimeout(){},fetch:async()=>{posts++;return{ok:true,json:async()=>posts===1?{authorizationSaved:true,awaitingSignup:true,pending:true,instanceId:666}:{connected:true,instanceId:666,phoneNumberId:'123456789'}}}});
 window.fbAsyncInit();timers.shift()();login({authResponse:{code:'test-code'}});await new Promise(setImmediate);
 listener({origin:'https://www.facebook.com',data:{type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'987654321',phone_number_id:'123456789'}}});await new Promise(setImmediate);
 assert.equal(posts,2);assert.equal(notified[0].status,'connected');assert.match(window.location.href,/^botadmin:\/\/meta-connected\?state=connected/);assert.equal(elements.connect.hidden,true);
 listener({origin:'https://www.facebook.com',data:{type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'987654321'}}});await new Promise(setImmediate);assert.equal(posts,2,'Completion must not exchange the authorization twice');
 // Change the browser account after start; completion must retain initiating user 2.
 mocks['lib/auth'].getCurrentUser=async()=>({id:3,role:'user'});
 const body={context:data.context,instanceId:666,connectionPurpose:'service',mode:'coexistence',code:'oauth-code',wabaId:'987654321',phoneNumberId:'123456789'};
 let r=await complete(post({...body,instanceId:667}));assert.equal(r.status,403);assert.equal(exchanges,0);
 r=await complete(post({...body,context:data.context+'x'}));assert.equal(r.status,403);assert.equal(exchanges,0);
 r=await complete(post(body,'https://foreign.test'));assert.equal(r.status,403);assert.equal(exchanges,0);
 r=await complete(post(body));assert.equal(r.status,200,JSON.stringify(await r.clone().json()));assert.equal((await r.json()).connected,true);assert.ok(owners.every(u=>u===2));assert.equal(exchanges,1);
 console.log('PASS: signed initiating account, tampered context, wrong profile, cross-origin rejection, successful completion, native return and responsive HTML.');
})().catch(e=>{console.error(e);process.exitCode=1});
