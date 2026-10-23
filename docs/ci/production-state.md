# Produção Coolify — estado e provas

Release autorizado: **`208a700128cf7d7d5b11d8ac1abb8cf9df4e16c2`**
(`Coolify Release Images` run `39871152001` → **success**, incluindo o step
`Deploy authorized digests to Coolify`).

## Pipeline automatizado, sem intervenção manual

```
main → CI → Release Ready → GHCR → Coolify → runtime
```

| etapa | resultado |
| --- | --- |
| `Require Release Ready` | success (seletor resolve o run de CI pelo SHA) |
| `Publish immutable API/Web images` | success (3 imagens) |
| `Deploy authorized digests to Coolify` | success (PATCH + POST /deploy + estado terminal) |

O último step só passa com os três deployments em `finished`.

## Imagens em execução

| app | imagem | observação |
| --- | --- | --- |
| cisne-api | `ghcr.io/rphllljust/cisne-api:208a7001…` | `@sha256:b7395013…` |
| cisne-worker | `ghcr.io/rphllljust/cisne-worker:208a7001…` | `@sha256:0b13e510…` |
| cisne-web | `ghcr.io/rphllljust/cisne-web:208a7001…` | `@sha256:23438fe8…` |

Mesmo source SHA nos três. A imagem do worker deriva da API
(`FROM ${CISNE_API_IMAGE}`) e declara `CMD ["node","apps/api/dist/worker/main.js"]`.

## Health

```
GET /api/v1/health/ready   200  status=ready, database=up (latencyMs=1)
GET /api/v1/health/live    200  status=ok
GET (web) /health          200  ok
```

## Smoke autenticado (perfil real de produção)

```
POST /api/v1/auth/login    200  accessToken + refreshToken + session
GET  /api/v1/auth/session  200  identityId + session
GET  /api/v1/me            200  permissoes=7 (catalog:service:*)
GET  /api/v1/catalog/service-definitions  200  {"items":[],"limit":20,"offset":0}
POST /api/v1/auth/refresh  200
```

Zero 5xx. Contrato sem credencial (401/400 estruturados, 404 em rota
inexistente, preflight CORS 204) também verificado.

## Perfis de produção

Criados pela CLI do próprio release (`ensure-production-credentials`), com
`DATABASE_URL_FILE`:

```json
{"status":"PRODUCTION_CREDENTIALS_READY",
 "logins":["abrahim@cisne.invalid","monica@cisne.invalid",
           "rafael@cisne.invalid","empregado@cisne.invalid"]}
```

Grants concedidos com a **action completa** (`catalog:service:list`, não `list`).
Esse detalhe foi o que fez o catálogo responder 403 antes da correção.

## Migrations

104 aplicadas pelo runner do release autorizado, com `DATABASE_URL_FILE`.
Schema real: 312 tabelas, 29 schemas.

## Backup e restore

- Backup pós-migration: 941.973 B, AES-256-GCM, retenção 7 dias, `status: ok`.
- Restore provado em banco descartável: `pg_restore` rc=0, 312 tabelas.
- **Backup off-host continua pendente** — backup no mesmo VPS não encerra DR.

## Defeito aberto (corrigido em PR, worker em rollback)

O worker com imagem dedicada entrou em restart-loop:

```
TypeError: Cannot read properties of null (reading 'getInstance')
    at DocumentsModule.onModuleInit
    at async bootstrap (apps/api/dist/worker/main.js:19)
```

`DocumentsModule` chamava `adapterHost.httpAdapter.getInstance()` sem guarda; o
worker sobe com `createApplicationContext` (sem adapter HTTP).

Correção: `fix/worker-documents-http-adapter` (guard + 3 testes de regressão,
verificado por mutação). Enquanto ela não chega à main, o worker roda na imagem
da API com `WORKER_ENABLED=true` — estado que já operava com `restarts=0` e
outbox/inbox/reports ativos.

## Pendências que não bloqueiam o runtime atual

1. **Domínio/TLS público** — decisão do dono.
2. **Backup off-host** — bloqueio explícito de DR.
3. **TLS do painel Coolify** — fora do escopo deste ciclo por priorização.
4. **Cutover/DNS** — Railway permanece como fallback.
