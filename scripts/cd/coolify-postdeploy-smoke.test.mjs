import assert from 'node:assert/strict';
import test from 'node:test';
import { DeployRefusedError } from './coolify-deploy.mjs';
import { verifyProduction } from './coolify-postdeploy-smoke.mjs';

const SHA='1'.repeat(40);
const repos={
  api:'ghcr.io/rphllljust/cisne-api',
  worker:'ghcr.io/rphllljust/cisne-worker',
  web:'ghcr.io/rphllljust/cisne-web',
};
const uuids={api:'api-uuid',worker:'worker-uuid',web:'web-uuid'};

function response(status, body, contentType='application/json') {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': contentType } },
  );
}

function fixture({
  badTag=false,
  badDb=false,
  logs='MIGRATIONS OK: applied=0 total=104',
  // Padrao: Web anuncia exatamente a API do runtime (contrato correto).
  advertisedApi='https://api.example.test',
  // Padrao: API autoriza a origem do Web (contrato correto). null = header ausente.
  corsAllowed='https://app.example.test',
  // Padrao: runtime-config nao-cacheavel (exigido pelo nginx.conf).
  runtimeConfigCache='no-store, no-cache, must-revalidate',
}={}) {
  const apps={
    'api-uuid':{fqdn:'https://api.example.test',status:'running:healthy',docker_registry_image_name:repos.api,docker_registry_image_tag:badTag?'latest':SHA},
    'worker-uuid':{fqdn:null,status:'running',docker_registry_image_name:repos.worker,docker_registry_image_tag:SHA},
    'web-uuid':{fqdn:'https://app.example.test',status:'running:healthy',docker_registry_image_name:repos.web,docker_registry_image_tag:SHA},
  };
  const client={
    getApplication:async(uuid)=>apps[uuid],
    call:async(path)=>({logs:path.includes('api-uuid')?logs:'runtime ok'}),
  };
  const fetchImpl=async(url,init={})=>{
    if(url.endsWith('/api/v1/health/ready')) return response(200,{status:'ready',checks:{database:{status:badDb?'down':'up'}}});
    if(url.endsWith('/health')) return response(200,'ok','text/plain');
    // runtime-config: o Web anuncia a API que o browser deve chamar.
    if(url.endsWith('/runtime-config.js')) {
      return new Response(
        `window.__CISNE_RUNTIME_CONFIG__ = { apiBaseUrl: "${advertisedApi}" };`,
        { status:200, headers:{
          'content-type':'text/javascript',
          // Config de runtime nao pode ser cacheada (ver nginx.conf).
          'cache-control': runtimeConfigCache,
        } },
      );
    }
    if(url.endsWith('/api/v1/auth/login')) {
      const payload=JSON.parse(init.body);
      assert.equal(payload.login,'smoke');
      assert.equal(payload.password,'secret');
      return response(200,{accessToken:'token'});
    }
    // A sonda de CORS envia Origin e nao leva authorization; devolve o header de volta.
    if(url.endsWith('/api/v1/auth/session') && init.headers?.origin) {
      const headers={};
      if(corsAllowed!=null) headers['access-control-allow-origin']=corsAllowed;
      return new Response(JSON.stringify({ok:true}),{
        status:200,headers:{'content-type':'application/json',...headers},
      });
    }
    if(url.includes('/api/v1/auth/session')||url.includes('/api/v1/me')||url.includes('/api/v1/catalog/service-definitions')) {
      assert.equal(init.headers.authorization,'Bearer token');
      return response(200,{ok:true});
    }
    return response(404,{});
  };
  return {client,fetchImpl};
}

test('prova runtime, readiness, banco, web, auth e ausencia de 5xx', async()=>{
  const {client,fetchImpl}=fixture();
  const result=await verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'});
  assert.equal(result.readiness.database,'up');
  assert.equal(result.authenticatedSmoke,'ok');
  assert.equal(result.migrations,'ok');
  assert.equal(result.recent5xx,0);
});

test('recusa runtime em tag diferente do SHA autorizado', async()=>{
  const {client,fetchImpl}=fixture({badTag:true});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /tag em runtime divergiu/,
  );
});

test('recusa readiness sem database=up', async()=>{
  const {client,fetchImpl}=fixture({badDb:true});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /database=up/,
  );
});

test('recusa 5xx estruturado nos logs recentes', async()=>{
  const {client,fetchImpl}=fixture({logs:'MIGRATIONS OK: applied=0 total=104\n{"statusCode":500,"path":"/api/v1/x"}'});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /5xx encontrado/,
  );
});

test('credenciais de smoke sao obrigatorias', async()=>{
  const {client,fetchImpl}=fixture();
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'',password:''}),
    DeployRefusedError,
  );
});

test('recusa producao sem prova de migrations no log da API', async()=>{
  const {client,fetchImpl}=fixture({logs:'api started sem migration proof'});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /MIGRATIONS OK/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REGRESSAO DO BUG REAL: "Nao foi possivel conectar ao servidor" na tela de login.
//
// A API estava saudavel, o login por curl funcionava e `restarts=0` em tudo — e o browser
// nao conseguia logar. As duas causas estao abaixo, cada uma com seu teste.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('recusa Web que anuncia API em esquema diferente (http vs https)', async()=>{
  // O bug: runtime-config apontava https:// para uma API que so serve http://.
  const {client,fetchImpl}=fixture({advertisedApi:'http://api.example.test'});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /runtime-config aponta para API diferente/,
  );
});

test('recusa Web que anuncia outro host de API', async()=>{
  const {client,fetchImpl}=fixture({advertisedApi:'https://outra-api.example.test'});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /runtime-config aponta para API diferente/,
  );
});

test('recusa API sem Access-Control-Allow-Origin para a origem do Web', async()=>{
  // O bug: CORS_ORIGIN vazio em producao -> API nao devolvia o header -> browser descarta.
  const {client,fetchImpl}=fixture({corsAllowed:null});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /CORS: API nao autoriza a origem do Web/,
  );
});

test('recusa API que autoriza origem diferente da origem do Web', async()=>{
  const {client,fetchImpl}=fixture({corsAllowed:'https://outra-app.example.test'});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /CORS: API autoriza origem diferente/,
  );
});

test('aceita Access-Control-Allow-Origin curinga', async()=>{
  const {client,fetchImpl}=fixture({corsAllowed:'*'});
  const result=await verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'});
  assert.equal(result.authenticatedSmoke,'ok');
});

test('recusa runtime-config cacheavel', async()=>{
  // Sem no-store, um browser que ja carregou a config antiga mantem o login quebrado
  // depois do deploy: o sintoma sobrevive a correcao e parece "producao ainda quebrada".
  const {client,fetchImpl}=fixture({runtimeConfigCache:'public, max-age=600'});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /Cache-Control no-store/,
  );
});

test('recusa runtime-config sem Cache-Control', async()=>{
  const {client,fetchImpl}=fixture({runtimeConfigCache:''});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /Cache-Control no-store/,
  );
});
