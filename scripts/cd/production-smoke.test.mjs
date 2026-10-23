import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductionSmokeError, runProductionSmoke } from './production-smoke.mjs';

const SHA='a'.repeat(40);
const config={
  coolifyBaseUrl:'https://coolify.test/api/v1',
  coolifyToken:'token',
  apiUuid:'api-uuid',
  workerUuid:'worker-uuid',
  webUuid:'web-uuid',
  expectedSourceSha:SHA,
  login:'smoke@example.invalid',
  password:'secret',
};

function response(status, body={}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers:{'content-type':'application/json'},
  });
}

function fakeFetch({apiStatus='running:healthy', tag=SHA, readyDb='up'}={}) {
  return async (url, init={}) => {
    const value=String(url);
    if (value.endsWith('/applications/api-uuid')) return response(200,{status:apiStatus,fqdn:'https://api.example',docker_registry_image_name:'ghcr.io/rphllljust/cisne-api',docker_registry_image_tag:tag});
    if (value.endsWith('/applications/worker-uuid')) return response(200,{status:'running',docker_registry_image_name:'ghcr.io/rphllljust/cisne-worker',docker_registry_image_tag:tag});
    if (value.endsWith('/applications/web-uuid')) return response(200,{status:'running:healthy',fqdn:'https://web.example',docker_registry_image_name:'ghcr.io/rphllljust/cisne-web',docker_registry_image_tag:tag});
    if (value.includes('/logs?')) return response(200,{logs:new Date().toISOString()+' INFO request status=200'});
    if (value.endsWith('/api/v1/health/live')) return response(200,{status:'ok'});
    if (value.endsWith('/api/v1/health/ready')) return response(200,{status:'ready',database:{status:readyDb}});
    if (value.endsWith('/health')) return response(200,'ok');
    if (value.endsWith('/api/v1/auth/login')) return response(200,{accessToken:'token'});
    if (value.endsWith('/api/v1/auth/session')) return response(200,{session:{}});
    if (value.endsWith('/api/v1/me')) return response(200,{permissions:[]});
    if (value.includes('/api/v1/catalog/service-definitions')) return response(200,{items:[]});
    return response(404,{});
  };
}

test('prova SHA, runtime, banco, web, auth, catalogo e logs', async()=>{
  const out=await runProductionSmoke(config,fakeFetch());
  assert.equal(out.sourceSha,SHA);
  assert.equal(out.database,'up');
  assert.equal(out.auth,'ok');
  assert.equal(out.logs,'clean');
});

test('reprova tag diferente do SHA autorizado', async()=>{
  await assert.rejects(()=>runProductionSmoke(config,fakeFetch({tag:'b'.repeat(40)})),ProductionSmokeError);
});

test('reprova banco nao-ready', async()=>{
  await assert.rejects(()=>runProductionSmoke(config,fakeFetch({readyDb:'down'})),/banco up/);
});

test('reprova runtime nao-running', async()=>{
  await assert.rejects(()=>runProductionSmoke(config,fakeFetch({apiStatus:'exited'})),/status runtime/);
});
