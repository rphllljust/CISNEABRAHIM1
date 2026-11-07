import test from 'node:test';
import assert from 'node:assert/strict';
import { createComposeHml } from './coolify-hml-create-compose-app.mjs';
const respond=(x,s=200)=>new Response(JSON.stringify(x),{status:s});
const env={baseUrl:'https://coolify.internal/api/v1',token:'secret-never-log',apiUuid:'api',webUuid:'web',workerUuid:'worker',actionAllowed:true};
function fake({envName='hml-master-015',postStatus=201,existing=false}={}){
 const calls=[];const fetchImpl=async(url,init)=>{
  const path=new URL(url).pathname;calls.push({path,method:init.method,payload:init.body?JSON.parse(init.body):null});
  if(path.endsWith('/projects'))return respond([{uuid:'private-project'}]);
  if(path.endsWith('/environments'))return respond([{name:envName}]);
  if(path.endsWith('/servers'))return respond([{uuid:'private-server'}]);
  if(path.endsWith('/applications'))return respond([...['api','web','worker'].map(uuid=>({uuid})),...(existing?[{uuid:'old',name:'cisne-master-015-superset-hml'}]:[])]);
  if(path.endsWith('/applications/public'))return respond({uuid:'new-app-uuid'},postStatus);
  if(path.endsWith('/applications/new-app-uuid'))return respond({uuid:'new-app-uuid',name:'cisne-master-015-superset-hml',build_pack:'dockercompose'});
  throw Error('unmatched');
 };return {calls,fetchImpl};
}
test('no action context means no network requests',async()=>{const r=await createComposeHml({...env,actionAllowed:false,fetchImpl:()=>{throw Error('should not call')}});assert.equal(r.writesAttempted,false);});
test('cannot create app without explicitly verified HML environment',async()=>{const f=fake({envName:'production'});const r=await createComposeHml({...env,fetchImpl:f.fetchImpl});assert.equal(r.writesAttempted,false);assert.equal(r.result,'VERIFIED_HML_ENVIRONMENT_MISSING_OR_AMBIGUOUS');});
test('cannot duplicate app',async()=>{const f=fake({existing:true});const r=await createComposeHml({...env,fetchImpl:f.fetchImpl});assert.equal(r.writesAttempted,false);assert.equal(r.result,'SUPERSET_COMPOSE_APP_ALREADY_EXISTS');});
test('safe creation is undeployed and respects exact Compose path and branch',async()=>{const f=fake();const r=await createComposeHml({...env,fetchImpl:f.fetchImpl});assert.equal(r.result,'HML_COMPOSE_APPLICATION_CREATED_UNDEPLOYED');assert.equal(r.serviceDeployed,false);assert.equal(r.productionChanged,false);const p=f.calls.filter(x=>x.method==='POST');assert.equal(p.length,1);assert.equal(p[0].payload.base_directory,'/infra/superset');assert.equal(p[0].payload.docker_compose_location,'/compose.coolify.yaml');assert.equal(p[0].payload.instant_deploy,false);assert.equal(p[0].payload.is_auto_deploy_enabled,false);assert.ok(!JSON.stringify(r).includes('private-server'));assert.ok(!JSON.stringify(r).includes('secret-never-log'));});
