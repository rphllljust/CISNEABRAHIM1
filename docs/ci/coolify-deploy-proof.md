# CISNE em produção no Coolify — prova de deploy

Estado **executado e verificado** no OVH VPS-1 em 2026-10-22.

## Release

| campo | valor |
| --- | --- |
| SOURCE_SHA | `9431e8bb0671c4b8a51ddde7f098be4a67767c13` |
| ARTIFACT_DIGEST | `sha256:cf296bade7ccd8ef5cfe08c300cac8b07c134b455e951a2b9ac8562440d16095` |
| API_DIGEST | `sha256:19dd73228e451a2f3e6c3c1ae2d830d2763cf0ef6caf9e51ef587ab729955f0a` |
| WEB_DIGEST | `sha256:70b86b0faf21b17cb14a127907cf9ebba1681e7ea9d68516ebfb35256c7e1f13` |
| CI run autorizador | `39856511078` (`Release ready=success`) |

Publicado pelo `coolify-release.yml` após `Release ready`. A tag de cada imagem **é**
o source SHA, e o manifest dessa tag foi resolvido para confirmar o digest antes do
deploy (`verifyPublishedDigest`).

## Deployments

| app | deployment_uuid | status |
| --- | --- | --- |
| cisne-api | `sdgrciawb4ifjn44loxan6fw` | finished |
| cisne-worker | `xvpsvvevgujkze8r19euoac6` | finished |
| cisne-web | `avvbo8lcfjptvl1x8pefh9mq` | finished |

## Provenance verificada em runtime

```
API    ghcr.io/rphllljust/cisne-api:9431e8bb...  ->  sha256:19dd7322...   OK
WORKER ghcr.io/rphllljust/cisne-api:9431e8bb...  ->  sha256:19dd7322...   OK  (mesmo da API)
WEB    ghcr.io/rphllljust/cisne-web:9431e8bb...  ->  sha256:70b86b0f...   OK
```

`restarts = 0` nos três containers (sem restart loop).

## Health e smoke

```
GET /api/v1/health/ready  200  {"status":"ready","checks":{"database":{"status":"up","latencyMs":2}}}
GET /api/v1/health/live   200  {"status":"ok"}
GET  (web) /health        200  ok
POST /api/v1/auth/login   401  AUTH_INVALID_CREDENTIALS
GET  /api/v1/me           401  AUTH_UNAUTHORIZED
GET  /api/v1/catalog/...  401  AUTH_UNAUTHORIZED
```

Zero 5xx. Os 401 são rejeições corretas (sem credencial), não falhas.

## Migrations

- Executadas **do mesmo release**: `packages/database/dist/cli/run-migrate-cli.js`
  dentro da imagem autorizada, com `DATABASE_URL_FILE` (secret montado).
- Resultado: `MIGRATIONS OK: applied=104 total=104`.
- Nenhum SQL manual.

## Backup e restore

- Backup pós-migration: dumps de 868 B (banco vazio) → **941.973 B**.
- AES-256-GCM (`iv[12] || tag[16] || ct`), retenção 7 dias, status `ok`.
- **Restore provado**: decrypt → `pg_restore` rc=0 em `cisne_restore_probe` →
  **312 tabelas** e 29 schemas restaurados → banco descartável removido.

## Contratos descobertos empiricamente (Coolify 4.4.7)

| tentativa | resultado |
| --- | --- |
| `docker_registry_image_tag: '@sha256:...'` | **422** field format is invalid |
| `docker_registry_image_tag: 'sha256:...'` | **422** field format is invalid |
| `static_image: 'ghcr.io/...@sha256:...'` | **422** selected static image is invalid |
| `docker_registry_image_name` sem host | pull em **docker.io** → 'pull access denied' |
| `name: 'ghcr.io/owner/repo'` + `tag: <sha>` | **200 OK** |
| `health_check_type: 'command'` | **422** invalid |
| `health_check_command` | **422** invalid |
| `enable_ssl` em database | **422** field not allowed |
| `custom_docker_run_options` em database | **422** field not allowed |
| `docker_compose_raw` (service) sem base64 | **422** should be base64 encoded |

## Decisão registrada: healthcheck da API

A imagem runtime-only é `node:24-alpine`, **sem `curl`/`wget`**. O Coolify 4.4.7
executa o probe dentro do container (`docker exec`), então o healthcheck falhava e
ele revertia um deploy que estava saudável (o log mostrava
`Nest application successfully started` e todas as rotas mapeadas).

Duas opções foram consideradas:

1. Adicionar `curl` à imagem — rejeitada: mudaria o artefato autorizado e exigiria
   novo build/release.
2. `health_check_enabled=false` no container + **probe HTTP externo** por mim.

Foi adotada a (2). O gate de readiness **não foi removido**: ele é executado por
`GET /api/v1/health/ready` (com verificação de `database.status=up`) a partir da
rede `coolify`. Muda quem executa o probe, não a exigência.

## Pendências que não bloqueiam o runtime atual

1. **Domínio/TLS público** — decisão do dono. O FQDN sslip.io já tem TLS via
   Traefik; `CISNE_PUBLIC_API_URL` aponta para ele.
2. **Backup off-host** — backup no mesmo VPS não encerra DR. Bloqueio explícito.
3. **TLS do painel Coolify** — exposto em `http://40.160.38.255:8000` sem TLS;
   fora do escopo deste ciclo por decisão de priorização.
4. **Cutover/DNS** — não existe fallback Railway. Rollback operacional usa o último digest GHCR comprovadamente saudável e redeploy controlado pelo Coolify.
5. `PROD_REQUIRE_DB_TLS=false` aceito: tráfego Postgres não sai da rede docker
   isolada `coolify` (nenhuma porta publicada).
