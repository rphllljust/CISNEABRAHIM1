# Produção Coolify — estado e provas

`SOURCE_SHA = 09d796a995f5d2b5c76b350a8940b92c970c8105`
(release `39877914958` → **success**, incluindo o step
`Deploy authorized digests to Coolify`).

## Recursos em produção

| app | imagem | digest | estado |
| --- | --- | --- | --- |
| cisne-api | `cisne-api:09d796a9…` | `sha256:e02b7e4b…` | running |
| cisne-worker | `cisne-worker:09d796a9…` | `sha256:721cddb7…` | running, restarts=0 |
| cisne-web | `cisne-web:09d796a9…` | `sha256:ba1c4ed1…` | healthy |
| cisne-postgres | PostgreSQL 18 | — | healthy, 312 tabelas |
| cisne-object-storage | Garage v2.3.0 | — | healthy, S3 provado |

Mesmo source SHA nas três aplicações. Digests em execução **iguais** aos
publicados no GHCR para esse SHA.

## Worker dedicado — arquitetura final

```
image .... ghcr.io/rphllljust/cisne-worker:09d796a9…
argv ..... node apps/api/dist/worker/main.js
status ... running          restarts ... 0
outbox ... Outbox publisher starting id=outbox-1
inbox .... Integration inbox processor starting id=inbox-1
reports .. Report generation handler registered
postgres . PG_OK db=cisne_production
garage ... GARAGE_DNS_OK 10.0.1.8
```

O container executa **apenas** o processo de fila — não levanta servidor HTTP.

### Por que a imagem dedicada existe

O Coolify 4.4.7, com `build_pack=dockerimage`, não materializa `command:` no
compose gerado. Medido campo por campo:

| campo | resultado |
| --- | --- |
| `start_command` | ignorado no compose |
| `docker_compose_custom_start_command` | ignorado no compose |
| `custom_docker_run_options: --entrypoint node` | gera apenas `entrypoint:`, deixando `Cmd=null` |
| `docker_compose_raw` | **422** This field is not allowed (proibido em applications) |

O processo é sempre o `CMD` da imagem. Por isso o worker precisa de imagem
própria, derivada da API (`FROM ${CISNE_API_IMAGE}`), trocando só o `CMD`.

### Defeito que impedia o worker dedicado

```
TypeError: Cannot read properties of null (reading 'getInstance')
    at DocumentsModule.onModuleInit
    at async bootstrap (apps/api/dist/worker/main.js:19)
```

`WorkerAppModule` carrega `DocumentsModule`, e o worker sobe com
`NestFactory.createApplicationContext` — sem adapter HTTP. O `onModuleInit`
chamava `httpAdapter.getInstance()` sem guarda, e o processo morria em ~1s. O
Docker reiniciava em loop **com o `argv` correto**, o que tornava o sintoma
enganoso: parecia problema de comando, era de contexto do Nest.

Corrigido com optional chaining + 3 testes de regressão, verificados por mutação
(revertendo o `?.` o teste falha com exatamente o TypeError de produção).

## Health e smoke

```
GET /api/v1/health/ready   200  status=ready, database=up (latencyMs=1)
GET /api/v1/health/live    200  status=ok
GET (web) /health          200  ok
POST /api/v1/auth/login    200  accessToken + refreshToken + session
GET  /api/v1/auth/session  200
GET  /api/v1/me            200  permissoes=7 (catalog:service:*)
GET  /api/v1/catalog/…     200  {"items":[],"limit":20,"offset":0}
POST /api/v1/auth/refresh  200
```

Contrato sem credencial: 401/400 estruturados com `correlationId`, 404 em rota
inexistente (não 500), preflight CORS 204. **Zero 5xx.**

## Perfis de produção (4)

Criados pela CLI `ensure-production-credentials` do release autorizado:

```
abrahim@cisne.invalid    active, hash ok, 7 grants catalog:service:*
empregado@cisne.invalid  active, hash ok
monica@cisne.invalid     active, hash ok
rafael@cisne.invalid     active, hash ok
```

As 8 variáveis `PROD_PROFILE_*` estão registradas no `cisne-api`, então um rebuild
pode recriar as identidades pela mesma CLI. Nenhuma senha vive em arquivo local.

Detalhe que custou tempo: o `action` do grant é a string **completa**
(`catalog:service:list`), não o verbo isolado (`list`). Com o formato errado o
`/me` reportava as permissões mas o catálogo respondia 403.

## Migrations

104 aplicadas pelo runner do **próprio release** autorizado, com
`DATABASE_URL_FILE`. Schema real: **312 tabelas**, 29 schemas.

## Backup e restore

- Backup pós-release: `status: ok`, AES-256-GCM (`iv[12]||tag[16]||ct`),
  retenção 7 dias, timer systemd diário.
- **Restore é a prova**: decrypt → `pg_restore` rc=0 em banco descartável →
  **312 tabelas** e 29 schemas restaurados → `DROP`.
- **Backup off-host continua pendente** — backup no mesmo VPS não encerra DR.

## Capacidade com o worker dedicado

| container | antes (fallback) | agora (dedicado) |
| --- | --- | --- |
| cisne-api | 94.3 MiB | 81.87 MiB |
| cisne-worker | 82.16 MiB | **50.7 MiB** |
| cisne-web | 5.76 MiB | 5.05 MiB |
| cisne-postgres | 72.8 MiB | 83.61 MiB |
| garage | 3.59 MiB | 9.39 MiB |

RAM disponível **2409 MB** de 3814. Swap 271 MB de 2048. `restarts=0` nos 11
containers. O worker dedicado economiza ~31 MiB por não levantar servidor HTTP.

## CI — caminho crítico

| job | antes | depois |
| --- | --- | --- |
| Visual critical | 684s | **60-82s** |
| Install Playwright Chromium | 622-633s | **1-30s** (cache hit) |
| Integration | 644s | ~600-660s (baseline) |
| Lint / Typecheck / Audit | 105s | 106-114s |
| API E2E | 204s | 200-201s |

Ganho de ~600s por run no job visual, com a suite intacta (nenhum snapshot
removido, `maxDiffPixelRatio` inalterado).

O `Integration` continua definindo o wall-clock. A instrumentação por teste
(PR #73) existe para medir onde o custo está antes de qualquer nova otimização —
e já documenta que o custo é distribuído (TOP 10 = 37% da soma), então
micro-otimizar specs individuais rende pouco.

## Pipeline automatizado

```
GitHub → CI → Release Ready → GHCR → Coolify → api / worker / web
```

Execuções completas sem intervenção manual, cada uma publicando e deployando o
mesmo SHA nas três aplicações.

## Pendências declaradas

1. **Domínio/TLS público** — decisão do proprietário.
2. **Backup off-host** — bloqueio explícito de DR.
3. **TLS do painel Coolify** — exposto em `http://:8000`; priorizado fora deste ciclo.
4. **Cutover/DNS** — Railway permanece como fallback até as provas acima.
