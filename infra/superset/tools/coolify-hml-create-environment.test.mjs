import test from 'node:test';
import assert from 'node:assert/strict';
import { createHml } from './coolify-hml-create-environment.mjs';
const ok=(d,s=200)=>new Response(JSON.stringify(d),{status:s});
const env={baseUrl:'https://internal.coolify.test/api/v1',token:'never-log',apiUuid:'api',webUuid:'web',workerUuid:'worker',actionAllowed:true};
const mock=(postStatus=403,envName='production')=>{
 const methods=[];
 const fetchImpl=async(url,opt)=>{
  const path=new URL(url).pathname;methods.push(opt.method+' '+path);
  if(path.endsWith('/projects'))return ok([{uuid:'project-uuid'}]);
  if(path.endsWith('/environments'))return opt.method==='POST'?ok({},postStatus):ok([{name:envName,uuid:'prod-env'}]);
  if(path.endsWith('/applications'))return ok([{uuid:'api'},{uuid:'web'},{uuid:'worker'}]);
  throw Error('unknown');
 };
 return {fetchImpl,methods};
};
test('Requires exact operator-approved action context and makes no request otherwise',async()=>{
 const q=await createHml({...env,actionAllowed:false,fetchImpl:()=>{throw Error('never')}});assert.equal(q.writesAttempted,false);
});
test('403 is reported without revealing sensitive values or claiming environment creation',async()=>{
 const m=mock();const q=await createHml({...env,fetchImpl:m.fetchImpl});
 assert.equal(q.result,'CREATE_ENVIRONMENT_DENIED_403_WRITE_SCOPE');assert.equal(q.httpStatus,403);assert.equal(q.writesAttempted,true);
 assert.equal(q.serviceCreated,false);assert.equal(q.productionChanged,false);
 assert.ok(!JSON.stringify(q).includes('never-log'));assert.ok(!JSON.stringify(q).includes('project-uuid'));
});
test('Unknown existing environment refuses any write',async()=>{
 const m=mock(201,'undocumented');const q=await createHml({...env,fetchImpl:m.fetchImpl});
 assert.equal(q.writesAttempted,false);assert.ok(!m.methods.some(x=>x.startsWith('POST')));
});
test('Existing HML prevents duplicate creation',async()=>{
 const m=mock(201,'hml');const q=await createHml({...env,fetchImpl:m.fetchImpl});
 assert.equal(q.result,'HML_ENVIRONMENT_ALREADY_EXISTS');assert.equal(q.writesAttempted,false);
});
