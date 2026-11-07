/** MASTER 015 HML-only: configure secrets in brand-new, undeployed Superset application.
 * Existing ERP apps and production variables are never read or changed.
 */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const NAME='cisne-master-015-superset-hml';
const SHA='5e573277e03015928c3c69e42d86fb7b95da7a14';
const KEYS=['SUPERSET_METADATA_USER','SUPERSET_METADATA_PASSWORD','SUPERSET_SECRET_KEY','SUPERSET_GUEST_TOKEN_JWT_SECRET'];
export async function configure({baseUrl,token,actionAllowed,fetchImpl=fetch,makeSecret=()=>randomBytes(48).toString('hex')}={}) {
 const out={kind:'MASTER015_HML_SECRET_CONFIG',writesAttempted:false,deployed:false,productionChanged:false,result:'NOT_STARTED',httpStatuses:[],keysConfigured:0};
 if(!actionAllowed){out.result='ACTION_CONTEXT_DENIED';return out;}
 if(!baseUrl||!token){out.result='COOLIFY_CREDENTIALS_NOT_AVAILABLE';return out;}
 let root;
 try{const u=new URL(baseUrl);if(!(u.protocol==='https:' || (u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)))||u.username||u.password||u.search||u.hash||u.pathname.replace(/\/$/,'')!=='/api/v1')throw Error();root=u.href.replace(/\/$/,'');}catch{out.result='BASE_URL_INVALID';return out;}
 async function call(path,method='GET',body){try{const res=await fetchImpl(root+path,{method,redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});let data=null;if(res.ok&&method==='GET')try{data=await res.json();}catch{}return{status:res.status,data};}catch{return{status:'NETWORK_ERROR',data:null};}}
 const apps=await call('/applications');if(apps.status!==200||!Array.isArray(apps.data)){out.result='CANNOT_LIST_APPS';return out;}
 const chosen=apps.data.filter(x=>x.name===NAME);if(chosen.length!==1){out.result='HML_APP_NAME_NOT_UNIQUE';return out;}
 const uuid=chosen[0].uuid;
 const app=(await call('/applications/'+encodeURIComponent(uuid))).data;
 const p=await call('/projects');if(p.status!==200||!Array.isArray(p.data)||p.data.length!==1){out.result='PROJECT_NOT_UNIQUE';return out;}
 const envs=await call('/projects/'+encodeURIComponent(p.data[0].uuid)+'/environments');
 const target=Array.isArray(envs.data)?envs.data.filter(x=>x.name==='hml-master-015'):[];
 if(target.length!==1||String(target[0].id)!==String(app?.environment_id)){out.result='HML_SCOPE_MISMATCH';return out;}
 if(app?.name!==NAME||app?.git_commit_sha!==SHA||app?.base_directory!=='/infra/superset'||app?.docker_compose_location!=='/compose.coolify.yaml'||!/^exited/i.test(String(app?.status))){out.result='HML_APP_NOT_SAFE_TO_CONFIGURE';return out;}
 const envResp=await call('/applications/'+encodeURIComponent(uuid)+'/envs');
 if(envResp.status!==200||!Array.isArray(envResp.data)){out.result='CANNOT_INSPECT_ENV_KEYS';return out;}
 const existing=KEYS.map(key=>envResp.data.filter(x=>x.key===key&&x.is_preview!==true));
 if(existing.some(a=>a.length!==1||a[0].is_shown_once===true)){out.result='EXISTING_SECRET_VALUES_OR_AMBIGUOUS_KEYS';return out;}
 // Distinct secrets are generated inside GitHub runner and sent ONLY over HTTPS (or local loopback) to Coolify.
 const planned=[['SUPERSET_METADATA_USER','superset_metadata',false],
  ['SUPERSET_METADATA_PASSWORD',makeSecret(),true],['SUPERSET_SECRET_KEY',makeSecret(),true],
  ['SUPERSET_GUEST_TOKEN_JWT_SECRET',makeSecret(),true]];
 if(new Set(planned.slice(1).map(x=>x[1])).size!==3){out.result='NON_UNIQUE_RANDOM_SECRETS';return out;}
 for(const [key,value,isSecret] of planned){
  out.writesAttempted=true;
  const response=await call('/applications/'+encodeURIComponent(uuid)+'/envs','PATCH',{key,value,is_preview:false,is_literal:true,is_shown_once:isSecret});
  out.httpStatuses.push({key,status:response.status});
  if(response.status!==201&&response.status!==200){out.result='PARTIAL_SECRET_CONFIGURATION_STOPPED';return out;}
  out.keysConfigured++;
 }
 out.result='HML_SECRETS_CONFIGURED_NOT_DEPLOYED';
 return out;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const r=await configure({baseUrl:process.env.COOLIFY_BASE_URL,token:process.env.COOLIFY_TOKEN,actionAllowed:process.env.GITHUB_REF==='refs/heads/ops/master-015-hml-access-probe'&&process.env.HML_SECRET_ACTION==='CONFIGURE_ONLY_WITHOUT_DEPLOY'});
 console.log('MASTER015_HML_SECRET_STATUS='+JSON.stringify(r));
}
