/** MASTER 015 — create an unstarted Git-based Compose application in the newly proven HML environment.
 * Never deploy, mutate existing applications, edit variables, configure public domains, or print secrets.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const fingerprint = (s)=>createHash('sha256').update(String(s)).digest('hex').slice(0,12);
const composeAppName='cisne-master-015-superset-hml';
const sourceSha='5e573277e03015928c3c69e42d86fb7b95da7a14';
export async function createComposeHml({baseUrl,token,apiUuid,webUuid,workerUuid,actionAllowed,fetchImpl=fetch}={}) {
 const r={kind:'MASTER015_HML_COMPOSE_APPLICATION_CREATE',writesAttempted:false,serviceDeployed:false,productionChanged:false,result:'NOT_STARTED',httpStatus:null,applicationFingerprint:null};
 if(!actionAllowed){r.result='NOT_AUTHORIZED_WORKFLOW_CONTEXT';return r;}
 if(![baseUrl,token,apiUuid,webUuid,workerUuid].every(x=>typeof x==='string'&&x.length>0)){r.result='MISSING_ACTION_SECRETS';return r;}
 let root;
 try {const u=new URL(baseUrl);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname.replace(/\/$/,'')!=='/api/v1')throw Error();root=u.href.replace(/\/$/,'');}catch{r.result='INVALID_BASE_URL';return r;}
 const req=async(path,method='GET',body)=>{try{const res=await fetchImpl(root+path,{method,redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});let data=null;if(res.ok)try{data=await res.json();}catch{}return {status:res.status,data};}catch{return{status:'NETWORK_ERROR',data:null};}};
 const p=await req('/projects');if(p.status!==200||!Array.isArray(p.data)||p.data.length!==1||!p.data[0]?.uuid){r.result='PROJECT_AMBIGUOUS';r.httpStatus=p.status;return r;}
 const project=p.data[0];
 const es=await req('/projects/'+encodeURIComponent(project.uuid)+'/environments');
 if(es.status!==200||!Array.isArray(es.data)||es.data.filter(x=>x.name==='hml-master-015').length!==1){r.result='VERIFIED_HML_ENVIRONMENT_MISSING_OR_AMBIGUOUS';r.httpStatus=es.status;return r;}
 const apps=await req('/applications');
 if(apps.status!==200||!Array.isArray(apps.data)){r.result='APPLICATION_INVENTORY_UNAVAILABLE';r.httpStatus=apps.status;return r;}
 if(apps.data.some(x=>x.name===composeAppName)){r.result='SUPERSET_COMPOSE_APP_ALREADY_EXISTS';return r;}
 const expected=[apiUuid,webUuid,workerUuid];if(new Set(expected).size!==3||!expected.every(uuid=>apps.data.filter(x=>x.uuid===uuid).length===1)){r.result='ERP_SERVICE_UUIDS_NOT_MATCHED';return r;}
 const servers=await req('/servers');if(servers.status!==200||!Array.isArray(servers.data)||servers.data.length!==1||!servers.data[0]?.uuid){r.result='SERVER_AMBIGUOUS';r.httpStatus=servers.status;return r;}
 // Never publish because no new metadata secrets or scoped dataset reader have been configured yet.
 const payload={name:composeAppName,description:'MASTER 015 HML only. Not approved for production.',
  project_uuid:project.uuid,environment_name:'hml-master-015',server_uuid:servers.data[0].uuid,
  git_repository:'https://github.com/rphllljust/CISNEABRAHIM1.git',git_branch:'main',git_commit_sha:sourceSha,
  build_pack:'dockercompose',base_directory:'/infra/superset',docker_compose_location:'/compose.coolify.yaml',
  instant_deploy:false,is_auto_deploy_enabled:false,connect_to_docker_network:false,autogenerate_domain:false};
 r.writesAttempted=true;
 const created=await req('/applications/public','POST',payload);r.httpStatus=created.status;
 if(created.status===403){r.result='APPLICATION_CREATE_DENIED_403';return r;}
 if(created.status!==201){r.result='APPLICATION_CREATE_NOT_ACCEPTED';return r;}
 const id=created.data?.uuid;
 if(typeof id!=='string'||id.length<6){r.result='CREATE_RESPONSE_MISSING_UUID';return r;}
 const app=await req('/applications/'+encodeURIComponent(id));
 if(app.status!==200||app.data?.uuid!==id){r.result='CREATE_ACCEPTED_BUT_NOT_RETRIEVED';return r;}
 const name=app.data.name;
 if(name!==composeAppName || app.data.build_pack!=='dockercompose'){r.result='CREATED_RESOURCE_MISMATCH';return r;}
 r.result='HML_COMPOSE_APPLICATION_CREATED_UNDEPLOYED';r.applicationFingerprint=fingerprint(id);
 return r;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const r=await createComposeHml({baseUrl:process.env.COOLIFY_BASE_URL,token:process.env.COOLIFY_TOKEN,apiUuid:process.env.COOLIFY_API_UUID,webUuid:process.env.COOLIFY_WEB_UUID,workerUuid:process.env.COOLIFY_WORKER_UUID,actionAllowed:process.env.GITHUB_REF==='refs/heads/ops/master-015-hml-access-probe'&&process.env.HML_COMPOSE_ACTION==='CREATE_UNDEPLOYED_IF_SAFE'});
 console.log('MASTER015_HML_COMPOSE='+JSON.stringify(r));
}
