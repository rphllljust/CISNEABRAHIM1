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
  // Superficie de modulos reportada pela API em /modules/registry.
  modules=[
    {moduleCode:'clients',name:'Clientes',status:'available',availability:true,routes:['/api/v1/clients']},
    {moduleCode:'finance',name:'Financeiro',status:'enabled',availability:true,routes:['/api/v1/finance']},
  ],
  // Rotas de modulo que respondem 403/404/500 (superficie anunciada mas inacessivel).
  unreachableRoutes=[],
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
    // Registro de modulos: o smoke agora prova coerencia de superficie front/back.
    // Formato real de `GET /api/v1/modules/registry` (ModuleRegistrySummary[]).
    if(url.includes('/api/v1/modules/registry')) {
      assert.equal(init.headers.authorization,'Bearer token');
      return response(200,modules);
    }
    // Rotas de modulo: existem e autorizam, salvo as declaradas inacessiveis.
    const moduleRouteHit=unreachableRoutes.find((route)=>url.includes(route));
    if(moduleRouteHit) return response(403,{message:'FEATURE_DISABLED'});
    if(url.includes('/api/v1/finance')||url.includes('/api/v1/clients')||url.includes('/api/v1/service-orders')) {
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

test('recusa runtime-config com Cache-Control duplicado', async()=>{
  // DEFEITO MEDIDO (release e705c6bb): `expires -1` no nginx adicionava um SEGUNDO
  // Cache-Control ao lado do add_header. `headers.get` une os dois com ", ", e um leitor que
  // pegasse o primeiro veria "no-cache" em vez de "no-store" — a guarda passaria a medir o
  // clima, nao a politica. Cabecalho duplicado e ambiguidade de caching: reprova.
  const {client,fetchImpl}=fixture({
    runtimeConfigCache:'no-cache, no-store, no-cache, must-revalidate',
  });
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /Cache-Control duplicado/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// COERENCIA DE SUPERFICIE — as duas familias de flags sao independentes e podem divergir.
//
// DEFEITO QUE ESTES CASOS FECHAM (medido em 2026-10-23): o artefato de producao era compilado
// com os 13 modulos construidos DESLIGADOS, e o smoke passava porque so provava health, login
// e `catalog`. Nenhum modulo gated era tocado. O operador recebia menu mutilado com o deploy
// "verde".
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('recusa modulo anunciado como enabled que responde FEATURE_DISABLED', async()=>{
  const {client,fetchImpl}=fixture({unreachableRoutes:['/api/v1/finance']});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /anunciados como enabled mas inacessiveis pela identidade do smoke: finance/,
  );
});

test('recusa modulo STUB habilitado em producao', async()=>{
  const {client,fetchImpl}=fixture({
    modules:[
      {moduleCode:'clients',name:'Clientes',status:'available',availability:true,routes:['/api/v1/clients']},
      {moduleCode:'rentals',name:'Locacoes',status:'enabled',availability:true,routes:['/api/v1/clients']},
    ],
  });
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /modulos STUB habilitados em producao: rentals/,
  );
});

test('recusa registry vazio: nao prova superficie de modulos', async()=>{
  const {client,fetchImpl}=fixture({modules:[]});
  await assert.rejects(
    ()=>verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'}),
    /module registry vazio/,
  );
});

test('devolve a superficie de modulos entregue, para auditoria', async()=>{
  // Sem isso, "o smoke passou" nao dizia QUAIS modulos o operador recebeu: um deploy
  // verde podia entregar produto mutilado e ninguem percebia.
  const {client,fetchImpl}=fixture({
    modules:[
      {moduleCode:'clients',name:'Clientes',status:'available',availability:true,routes:['/api/v1/clients']},
      {moduleCode:'finance',name:'Financeiro',status:'enabled',availability:true,routes:['/api/v1/finance']},
      {moduleCode:'payroll',name:'Folha',status:'not_released',availability:false,routes:['/api/v1/payroll']},
    ],
  });
  const result=await verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'});
  assert.equal(result.modules.total,3);
  assert.deepEqual(result.modules.enabled,['finance']);
  assert.deepEqual(result.modules.notReleased,['payroll']);
});

test('prova rota com query pre-existente sem corromper a URL', async()=>{
  // DEFEITO MEDIDO (2026-10-23): a versao anterior concatenava `?limit=1&offset=0` sempre.
  // Para rota que JA tem query, gerava `...?unitId=x&limit=1?limit=1&offset=0` — URL
  // invalida que nao provava acesso, enquanto o smoke dizia PASS e o operador nao via o menu.
  const seen=[];
  const {client,fetchImpl}=fixture({
    modules:[
      {moduleCode:'finance',name:'Financeiro',status:'enabled',availability:true,
       routes:['/api/v1/finance/receivables?limit=1&offset=0']},
    ],
  });
  const wrapped=async(url,init)=>{
    seen.push(url);
    return fetchImpl(url,init);
  };
  const result=await verifyProduction({client,fetchImpl:wrapped,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'});
  const financeProbe=seen.find((u)=>u.includes('/api/v1/finance/receivables'));
  assert.ok(financeProbe,'a sonda do finance deveria ter sido feita');
  // Um unico '?' na URL: a query existente foi respeitada.
  assert.equal(financeProbe.split('?').length-1,1,'URL nao pode ter dois separadores de query');
  assert.deepEqual(result.modules.visible,['finance']);
});

test('modulo inacessivel nao entra em visible', async()=>{
  const {client,fetchImpl}=fixture({unreachableRoutes:['/api/v1/finance']});
  try{
    await verifyProduction({client,fetchImpl,sourceSha:SHA,repositories:repos,uuids,login:'smoke',password:'secret'});
    assert.fail('deveria reprovar modulo inacessivel');
  }catch(error){
    assert.match(String(error.message),/finance/);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CONTRATO DA SONDA — MODULE_ENTRY_READS precisa espelhar surface-access.ts.
//
// DEFEITO MEDIDO (release 40039709574): a sonda usava `routes` do module-registry, que sao
// PREFIXOS DECLARATIVOS e nao endpoints. `/api/v1/finance` nao existe: os controllers
// registram `finance/receivables`, `finance/budgets` etc., sem @Get() na raiz. Resultado:
// 7 modulos reprovados com 404 por defeito da SONDA, enquanto `people` passava porque tem
// @Get() raiz. Este teste impede que a sonda volte a divergir do que o menu realmente chama.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('MODULE_ENTRY_READS cobre todos os modulos construidos e usa rota de sub-caminho', async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('./coolify-postdeploy-smoke.mjs',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('MODULE_ENTRY_READS'),source.indexOf('};',source.indexOf('MODULE_ENTRY_READS')));
  const entries=[...block.matchAll(/'?([a-z-]+)'?:\s*'(\/api\/v1\/[^']+)'/g)].map((m)=>[m[1],m[2]]);
  const nulls=[...block.matchAll(/'?([a-z-]+)'?:\s*null/g)].map((m)=>m[1]);
  const map=Object.fromEntries(entries);

  // Todo modulo construido precisa de sonda: habilitado sem sonda = nao provado.
  // `null` e ausencia DECLARADA de superficie de UI (approval-matrix so tem @Post e nao
  // esta em nav-config.ts). Omitir continua falhando: a declaracao e obrigatoria.
  for(const moduleCode of ['finance','accounting','fiscal','inventory','payroll','procurement','suppliers','contracts','people','alerts','reports','approval-matrix','operational-profitability']){
    assert.ok(map[moduleCode] || nulls.includes(moduleCode),`${moduleCode} sem sonda de leitura declarada`);
  }

  // A rota precisa ser endpoint real, nao o prefixo do registry: ao menos 3 segmentos.
  for(const [moduleCode,route] of Object.entries(map)){
    const path=route.split('?')[0];
    const segments=path.split('/').filter(Boolean);
    assert.ok(segments.length>=3,`${moduleCode}: '${route}' parece prefixo declarativo, nao endpoint real`);
  }
});
