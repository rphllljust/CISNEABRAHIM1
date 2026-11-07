import test from 'node:test';import assert from 'node:assert/strict';
import {configure} from './coolify-hml-configure-secrets.mjs';
const respond=(x,s=200)=>new Response(JSON.stringify(x),{status:s});
const env={baseUrl:'https://coolify.internal/api/v1',token:'secret-bearer',actionAllowed:true,makeSecret:(()=>{let n=0;return()=> 'random-secret-'+(++n);})()};
function fixture({status='exited',locked=false}={}){
 const req=[];
 const fetchImpl=async(url,init)=>{const path=new URL(url).pathname;req.push({path,method:init.method,body:init.body?JSON.parse(init.body):null});
  if(path==='/api/v1/applications'&&init.method==='GET')return respond([{name:'cisne-master-015-superset-hml',uuid:'app-hml'}]);
  if(path==='/api/v1/applications/app-hml'&&init.method==='GET')return respond({name:'cisne-master-015-superset-hml',git_commit_sha:'5e573277e03015928c3c69e42d86fb7b95da7a14',base_directory:'/infra/superset',docker_compose_location:'/compose.coolify.yaml',status,environment_id:4});
  if(path==='/api/v1/projects')return respond([{uuid:'project-private'}]);
  if(path.endsWith('/environments'))return respond([{name:'hml-master-015',id:4}]);
  if(path.endsWith('/envs')&&init.method==='GET')return respond(['SUPERSET_METADATA_USER','SUPERSET_METADATA_PASSWORD','SUPERSET_SECRET_KEY','SUPERSET_GUEST_TOKEN_JWT_SECRET'].map(key=>({key,is_preview:false,is_shown_once:locked})));
  if(path.endsWith('/envs')&&init.method==='PATCH')return respond({},201);
  throw Error('unmatched '+path);
 };return{req,fetchImpl};
}
test('action context required and refuses before contacting API',async()=>{const r=await configure({...env,actionAllowed:false,fetchImpl:()=>{throw Error('called')}});assert.equal(r.writesAttempted,false);});
test('existing shown-once secret refuses rotation',async()=>{const f=fixture({locked:true});const r=await configure({...env,fetchImpl:f.fetchImpl});assert.equal(r.result,'EXISTING_SECRET_VALUES_OR_AMBIGUOUS_KEYS');assert.equal(r.writesAttempted,false);});
test('running app refuses config changes',async()=>{const f=fixture({status:'running:healthy'});const r=await configure({...env,fetchImpl:f.fetchImpl});assert.equal(r.result,'HML_APP_NOT_SAFE_TO_CONFIGURE');assert.equal(r.writesAttempted,false);});
test('configures four values, three unique secret values never returned',async()=>{const f=fixture();const r=await configure({...env,fetchImpl:f.fetchImpl});assert.equal(r.result,'HML_SECRETS_CONFIGURED_NOT_DEPLOYED');assert.equal(r.keysConfigured,4);const patches=f.req.filter(x=>x.method==='PATCH');assert.equal(patches.length,4);assert.equal(patches.filter(x=>x.body.is_shown_once).length,3);assert.equal(new Set(patches.slice(1).map(x=>x.body.value)).size,3);assert.equal(r.deployed,false);assert.equal(r.productionChanged,false);assert.ok(!JSON.stringify(r).includes('random-secret'));assert.ok(!JSON.stringify(r).includes('secret-bearer'));});
