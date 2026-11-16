/** Provision an isolated HML *environment only*, never touch existing workloads.
 * Exact preconditions: one project, one existing production environment, known three CISNE UUIDs,
 * explicit action runner trigger, no HML environment already present.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const hash = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 12);
const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const hml = (v) => /(?:^|[^a-z])(hml|homologacao|homologation|homolog)(?:[^a-z]|$)/.test(normalize(v));
export async function createHml({baseUrl,token,apiUuid,webUuid,workerUuid,actionAllowed,fetchImpl=fetch}={}) {
  const r={kind:'MASTER015_HML_ENVIRONMENT_CREATE',mode:'GUARDED_ONE_TIME',writesAttempted:false,serviceCreated:false,productionChanged:false,result:'NOT_ATTEMPTED',httpStatus:null,environmentFingerprint:null};
  if (!actionAllowed) {r.result='NOT_AUTHORIZED_WORKFLOW_CONTEXT';return r;}
  if (![baseUrl,token,apiUuid,webUuid,workerUuid].every(x=>typeof x==='string'&&x.length>0)) {r.result='REQUIRED_ACTION_SECRETS_MISSING';return r;}
  let base;
  try {const u=new URL(baseUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname.replace(/\/$/,'')!=='/api/v1')throw Error();base=u.href.replace(/\/$/,'');}catch{r.result='COOLIFY_URL_INVALID';return r;}
  async function call(path,method='GET',body) {
    try {const res=await fetchImpl(base+path,{method,redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
      let data=null; if(res.ok) try{data=await res.json();}catch{} return {status:res.status,data};
    } catch{return{status:'NETWORK_ERROR',data:null};}
  }
  const ps=await call('/projects');if(ps.status!==200||!Array.isArray(ps.data)||ps.data.length!==1){r.result='PROJECT_NOT_UNAMBIGUOUS';r.httpStatus=ps.status;return r;}
  const p=ps.data[0];if(typeof p.uuid!=='string'||!p.uuid){r.result='PROJECT_UUID_MISSING';return r;}
  const es=await call('/projects/'+encodeURIComponent(p.uuid)+'/environments');if(es.status!==200||!Array.isArray(es.data)){r.result='ENVIRONMENT_LIST_UNAVAILABLE';r.httpStatus=es.status;return r;}
  if(es.data.some(x=>hml(x.name))){r.result='HML_ENVIRONMENT_ALREADY_EXISTS';return r;}
  if(es.data.length!==1||!['production','prod'].includes(normalize(es.data[0].name))){r.result='EXISTING_ENVIRONMENT_NOT_IDENTIFIED_AS_PRODUCTION';return r;}
  const apps=await call('/applications');if(apps.status!==200||!Array.isArray(apps.data)){r.result='APPLICATION_SCOPE_UNAVAILABLE';r.httpStatus=apps.status;return r;}
  const ids=[apiUuid,webUuid,workerUuid];
  if(new Set(ids).size!==3||!ids.every(x=>apps.data.filter(a=>a.uuid===x).length===1)) {r.result='ERP_RUNTIME_UUID_SCOPE_MISMATCH';return r;}
  // Only modification is an additional empty environment. Never update the existing production env.
  r.writesAttempted=true;
  const create=await call('/projects/'+encodeURIComponent(p.uuid)+'/environments','POST',{name:'hml-master-015'});
  r.httpStatus=create.status;
  if(create.status===403){r.result='CREATE_ENVIRONMENT_DENIED_403_WRITE_SCOPE';return r;}
  if(create.status===401){r.result='CREATE_ENVIRONMENT_UNAUTHENTICATED_401';return r;}
  if(create.status!==201){r.result='CREATE_ENVIRONMENT_NOT_ACCEPTED';return r;}
  const check=await call('/projects/'+encodeURIComponent(p.uuid)+'/environments');
  const created=check.status===200&&Array.isArray(check.data)?check.data.filter(x=>normalize(x.name)==='hml-master-015'):[];
  if(created.length!==1){r.result='CREATE_ACCEPTED_BUT_NOT_VERIFIED';return r;}
  r.result='HML_ENVIRONMENT_CREATED_AND_RETRIEVED';
  r.environmentFingerprint=hash(created[0].uuid??created[0].id);
  return r;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const r=await createHml({baseUrl:process.env.COOLIFY_BASE_URL,token:process.env.COOLIFY_TOKEN,apiUuid:process.env.COOLIFY_API_UUID,webUuid:process.env.COOLIFY_WEB_UUID,workerUuid:process.env.COOLIFY_WORKER_UUID,actionAllowed:process.env.GITHUB_REF==='refs/heads/ops/master-015-hml-access-probe'&&process.env.HML_ENVIRONMENT_ACTION==='CREATE_IF_STRICTLY_ELIGIBLE'});
 console.log('MASTER015_HML_ENVIRONMENT='+JSON.stringify(r));
}
