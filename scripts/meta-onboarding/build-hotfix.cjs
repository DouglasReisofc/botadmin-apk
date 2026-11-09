const esbuild=require('esbuild');
const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
const deps={
 'next/server': {id:45592,exports:{NextRequest:'NextRequest',NextResponse:'NextResponse'}},
 'lib/auth':{id:20424,exports:{getCurrentUser:'HW'}},
 'lib/db':{id:8216,exports:{getDb:'getDb'}},
 'lib/meta-platform':{id:85911,exports:{loadMetaPlatformConfig:'lE',publicMetaPlatform:'AY',metaGraph:'CS'}},
 'lib/meta':{id:85423,exports:{getPublicAppBaseUrl:'getPublicAppBaseUrl'}},
 'lib/profile-connection-preferences':{id:94149,exports:{isConnectionPurpose:'P5'}},
 'lib/meta-channel':{id:65701,exports:{bindMetaConnection:'JP',createPendingMetaProfile:'qP',metaConnection:'I9',pendingMetaOnboarding:'yY',requestMetaCoexistenceSync:'eU',storePendingMetaAuthorization:'DV',updatePendingMetaOnboarding:'Fn'}},
 'lib/wwpanel':{id:51044,exports:{decryptWwPanelSecret:'decryptWwPanelSecret'}}
};
(async()=>{
 fs.mkdirSync('/tmp/meta-onboarding-hotfix',{recursive:true});
 for(const [route,entry,mid,exportName] of [['start','app/api/meta/onboarding/start/route.ts',13381,'POST'],['complete','app/api/meta/onboarding/complete/route.ts',23214,'POST'],['frame','app/api/meta/onboarding/onboarding-frame.ts',83930,'renderMetaOnboardingFrame']]){
  const used=new Set();
  const result=await esbuild.build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',target:'node20',plugins:[{name:'runtime-deps',setup(build){build.onResolve({filter:/^(lib\/|next\/server$)/},a=>{if(a.path==='lib/meta-onboarding-context')return{path:path.join(root,'lib/meta-onboarding-context.ts')};if(!deps[a.path])throw Error('Unknown runtime import '+a.path);used.add(a.path);return {path:a.path,external:true}})}}]});
  const names=[...used];const ids=names.map(x=>deps[x].id);const v=names.map((_,i)=>'dep'+i);
  const cases=names.map((n,i)=>`case ${JSON.stringify(n)}:return {${Object.entries(deps[n].exports).map(([a,b])=>`${a}:${v[i]}.${b}`).join(',')}};`).join('');
  const code=`(mod,out,wp)=>{wp.a(mod,async(resolve,done)=>{try{wp.r(out);let handler;wp.d(out,{${route==='frame'?'g':'POST'}:()=>handler});let loaded=resolve([${ids.map(x=>'wp('+x+')')}]);let [${v}]=loaded.then?(await loaded)():loaded;const compiled={exports:{}};const runtimeRequire=name=>{switch(name){${cases}default:return require(name)}};((require,module,exports)=>{${result.outputFiles[0].text}\n})(runtimeRequire,compiled,compiled.exports);handler=compiled.exports.${exportName};done()}catch(error){done(error)}})}`;
  fs.writeFileSync(`/tmp/meta-onboarding-hotfix/${route}.json`,JSON.stringify({mid,code}));
  fs.writeFileSync(`/tmp/meta-onboarding-hotfix/${route}.cjs`,result.outputFiles[0].text);
  console.log(route,code.length);
 }
})();
