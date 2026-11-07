/** MASTER 015 — DNS/TCP/SNI/TLS audit of the EXISTING Coolify hostname.
 * Never log host/IP/cert/body/token. Never write. Bearer only over trusted HTTPS.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
const ERRORS=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ECONNRESET','EPROTO','CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','ERR_SSL_WRONG_VERSION_NUMBER','ERR_TLS_HANDSHAKE_TIMEOUT']);
const safe=e=>ERRORS.has(String(e))?String(e):'OTHER_TLS_OR_NETWORK_ERROR';
const TIMEOUT=3600;
function tcp(host,port){return new Promise(resolve=>{const s=net.connect({host,port,timeout:TIMEOUT});let end=false;function done(x){if(end)return;end=true;s.destroy();resolve(x)}s.once('connect',()=>done({ok:true}));s.once('timeout',()=>done({ok:false,code:'ETIMEDOUT'}));s.once('error',e=>done({ok:false,code:safe(e.code)}));});}
function secure(host,port){return new Promise(resolve=>{const s=tls.connect({host,port,servername:net.isIP(host)?undefined:host,rejectUnauthorized:true,minVersion:'TLSv1.2',timeout:TIMEOUT});let end=false;function done(x){if(end)return;end=true;s.destroy();resolve(x)}s.once('secureConnect',()=>done({ok:s.authorized===true,version:s.getProtocol()??null,code:s.authorized?null:safe(s.authorizationError)}));s.once('timeout',()=>done({ok:false,code:'ETIMEDOUT'}));s.once('error',e=>done({ok:false,code:safe(e.code)}));});}
export async function diagnose(raw,{lookup=dns.lookup,connect=tcp,handshake=secure,authFetch=fetch,token}={}){
 const out={kind:'MASTER015_COOLIFY_TLS_DEEP',status:'NOT_CHECKED',dns:'UNKNOWN',dnsAnswerCount:0,configuredScheme:'UNKNOWN',tcp:{},tls:{},apiAuthStatus:'NOT_ATTEMPTED',credentialsSentOverHttp:false,writesAttempted:false,recommendation:'UNKNOWN'};
 let u;try{u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname.replace(/\/$/,'')!=='/api/v1')throw Error();}catch{out.status='INVALID_CONFIGURED_URL';return out;}
 out.configuredScheme=u.protocol.slice(0,-1);const host=u.hostname;
 try{const list=await lookup(host,{all:true});if(!Array.isArray(list)||!list.length)throw Object.assign(Error(),{code:'ENOTFOUND'});out.dns='RESOLVED';out.dnsAnswerCount=list.length;}catch(e){out.dns=safe(e.code);out.status='DNS_FAILED';out.recommendation='VERIFY_HOST_DNS';return out;}
 const original=Number(u.port||(u.protocol==='https:'?'443':'80'));
 for(const port of [...new Set([80,443,original])]){const v=await connect(host,port);out.tcp[String(port)]=v.ok?'CONNECTED':safe(v.code);}
 for(const port of [...new Set([443,original])]){if(out.tcp[String(port)]!=='CONNECTED')continue;const v=await handshake(host,port);out.tls[String(port)]={state:v.ok?'CERTIFICATE_TRUSTED':safe(v.code),protocol:v.ok?v.version??'UNKNOWN':null};}
 const trusted=[...new Set([443,original])].find(p=>out.tls[String(p)]?.state==='CERTIFICATE_TRUSTED');
 if(trusted===undefined){out.status='NO_TRUSTED_TLS';const codes=Object.values(out.tls).map(x=>x.state);out.recommendation=codes.some(x=>/CERT|VERIFY|SELF_SIGNED/.test(x))?'FIX_ADMIN_CERTIFICATE_OR_HOSTNAME':out.tcp['443']==='CONNECTED'?'DIAGNOSE_TLS_SNI_OR_PROXY_ROUTING':'CHECK_443_FIREWALL_OR_ADMIN_PROXY';return out;}
 if(!token){out.status='TRUSTED_HTTPS_NO_TOKEN';return out;}
 try{const t=new URL(u.href);t.protocol='https:';t.port=trusted===443?'':String(trusted);const r=await authFetch(t.origin+'/api/v1/projects',{method:'GET',redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json'},signal:AbortSignal.timeout(TIMEOUT)});out.apiAuthStatus=String(r.status);}catch{out.apiAuthStatus='HTTPS_API_FAILED';}
 out.status=out.apiAuthStatus==='200'?'AUTHENTICATED_HTTPS_VERIFIED':'TRUSTED_HTTPS_API_UNVERIFIED';
 out.recommendation=out.apiAuthStatus==='200'?'REPLACE_BASE_URL_WITH_VERIFIED_HTTPS_IN_SECRET_STORE':'VERIFY_ADMIN_REVERSE_PROXY_ROUTE';
 return out;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){console.log('MASTER015_COOLIFY_TLS_DEEP='+JSON.stringify(await diagnose(process.env.COOLIFY_BASE_URL,{token:process.env.COOLIFY_TOKEN})))}
