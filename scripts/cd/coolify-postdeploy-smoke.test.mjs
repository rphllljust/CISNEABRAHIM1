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

function fixture({badTag=false,badDb=false,logs='MIGRATIONS OK: applied=0 total=104'}={}) {
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
    if(url.endsWith('/api/v1/auth/login')) {
      const payload=JSON.parse(init.body);
      assert.equal(payload.login,'smoke');
      assert.equal(payload.password,'secret');
      return response(200,{accessToken:'token'});
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
