# Coolify Runtime — Mapeamento Real (VPS-1)

Este documento registra o estado **real** do plano de execução no OVH VPS-1
(`40.160.38.255`), servidor Coolify `localhost` (`j0gzw63auq0nw5hrgshinait`),
projeto `Rafael / ERP` (`m2mkjru19hvlsittiviumqmu`), ambiente `production`
(`iazjdsh0pvtwsmzjbyswr4lu`).

Classificação dos fatos abaixo: **fato empírico** (medido nesta sessão) salvo
indicação em contrário.

## Recursos provisionados

| Recurso | UUID | Imagem | Estado | Rede |
| --- | --- | --- | --- | --- |
| cisne-postgres | `tvp0zjwhovl1nhh0ey6wl6vi` | postgres:18-alpine | running:healthy | `coolify` (alias `cisne-postgres`) |
| cisne-object-storage | `ttz2xgjnmnnxfimir7gkxnbk` | dxflrs/garage:v2.3.0 | running:healthy | `ttz2xgjnmnn...` + `coolify` (alias `garage`, `cisne-object-storage`) |
| cisne-api | `23smkifoha5rxal32buagipm` | — (até digest) | criado, não deployado | `coolify` |
| cisne-worker | `flcdsoawi7rnfxi7iky2wybg` | — | criado, não deployado | `coolify` |
| cisne-web | `gmffbo3fbwgfhi1dou5wkzmy` | — | criado, não deployado | `coolify` |

## Object storage (Garage v2.3.0)

- Bucket `cisne-production` (id `ac00fcfc...`), alias global `cisne-production`.
- Chave `GKdd815e5306e37bd0c4b25dbc` (`cisne-runtime`), `RWO`, `Can create buckets: false`.
- S3 API em loopback do container (:3900), alcançável de dentro da rede `coolify`
  pelo alias `garage` **após** `docker network connect` (fato empírico: a rede
  própria do serviço isolava o Garage; conectá-lo à `coolify` resolveu).
- **S3 provado** end-to-end: PUT 200 / GET 200 / DELETE 204 / GET-pós 404.
- Versioning: **não exposto na CLI** `garage bucket versioning` (subcomando
  inexistente em v2.3.0). Fato medido, não assumido. `OBJECT_STORAGE_VERSIONING`
  não é setado; `prod-object-storage.ts` trata `versioningEnabled` como `true`
  quando provider ≠ filesystem (não bloqueia).

## Banco de dados

- `cisne_production`, usuário `cisne`, senha rotacionada (48 chars), `AUTH_OK`.
- `max_connections=100` (gate exige ≥20 → **passa**). PGDATA real:
  `/var/lib/postgresql/18/docker` (Postgres 18 mudou o layout; o caminho clássico
  `/var/lib/postgresql/data` **não existe**).
- Conexão interna via alias `cisne-postgres:5432` **provada** (`PG_REACHABLE`).
- TLS interno: **`ssl=off`, sem certificados**. Ver conflito registrado abaixo.
- Migrations **não rodadas** (schema `public` vazio, 0 tabelas) — aguardando a
  imagem autorizada + backup existente.

### Conflito registrado: TLS interno do Postgres

- **Fato**: `GET /api/v1/databases/{uuid}` retorna `enable_ssl=false`;
  `PATCH {"enable_ssl": true}` → `422 This field is not allowed` (campo
  somente-leitura na API do Coolify 4.4.7).
- **Fato**: o servidor recusa `sslmode=require`
  (`server does not support SSL, but SSL was required`).
- **Fato**: `prod-postgres.ts` exige `PGSSLMODE=require` quando
  `PROD_REQUIRE_DB_TLS !== 'false'` (default = exige).
- **Interpretação de engenharia**: `runtime-config.ts` (o gate de boot real de
  `main.ts` / `worker/main.ts`) **não** valida TLS. O `prod-postgres` pertence a
  `runProdInfrastructureValidation`, uma verificação de conformidade de infra, não
  ao caminho de inicialização. Portanto TLS ausente **não impede o boot**.
- **Decisão pendente (dono)**: ou se aceita `PROD_REQUIRE_DB_TLS=false` porque o
  tráfego Postgres nunca sai da rede docker isolada `coolify` (nenhuma porta
  publicada — `is_public=false`, `public_port=null`), ou se exige TLS e o
  certificado precisa ser montado por configuração de compose do Coolify.
- **Tentativa registrada e revertida**: duas tentativas de habilitar `ssl=on`
  editando `postgresql.conf` derrubaram o container em restart-loop
  (`syntax error ... near token "/"` e depois falha por certificado ausente).
  Ambas foram **revertidas com sucesso** a partir de
  `postgresql.conf.pre-cisne-tls`; o container voltou `healthy` e o backup foi
  reexecutado (`status: ok`). Nenhum dado perdido (schema vazio na ocasião).
  Nunca editar `postgresql.conf` de um recurso gerenciado pelo Coolify: o
  caminho suportado é o modelo do próprio Coolify.

## Secrets (Coolify, via API oficial)

Contrato real de runtime (validado em código):

- API/worker: `CISNE_ENV=production`, `NODE_ENV=production`, `DATABASE_URL`
  (`postgres://cisne:***@cisne-postgres:5432/cisne_production`), `JWT_SECRET`
  (≥32 chars), `DOCUMENT_DOWNLOAD_TOKEN_SECRET`, `BACKUP_ENCRYPTION_KEY`
  (base64 32 bytes = AES-256), `OBJECT_STORAGE_*` (provider=s3, bucket,
  endpoint `http://garage:3900`, region `garage`, access/secret, force_path_style=true).
- Web: `CISNE_ENV`, `NODE_ENV`, `CISNE_PUBLIC_API_URL` (contrato PR #63).
- Injetadas via `PATCH /applications/{uuid}/envs/bulk` (endpoint oficial; retorna
  201). `is_preview=false`, `is_buildtime=false`. **O bulk cria entradas `is_preview`
  em algumas versões** — remover as `is_preview=true` após criação (fato empírico).

## Backup

- Script `scripts/ops/cisne-backup.sh` instalado em `/usr/local/bin/cisne-backup.sh`.
- Env `/etc/cisne/backup.env` (root, 600).
- systemd: `cisne-backup.service` + `cisne-backup.timer` (diário ~03:20 UTC).
- Formato: `pg_dump -Fc` + AES-256-GCM (`iv[12]||tag[16]||ct`) — idêntico ao app.
- Retenção: 7 dias. Status em `/srv/cisne-backups/status/latest.json` (`status: ok`).
- **Restauração provada** em `cisne_restore_probe` (pg_restore rc=0, drop após).

## Pendências (não bloqueiam provisionamento, bloqueiam cutover)

1. Digest autorizado das imagens (`ghcr.io/rphllljust/cisne-api`,
   `ghcr.io/rphllljust/cisne-web`) — só após #63 mergeado + `coolify-release.yml`.
2. `Release ready` do #63 (ainda `Visual full` pendente).
3. Domínio/TLS/CORS — **decision pendente do dono** (bloqueia apenas FQDN público).
4. Migrations no banco de produção (mesma imagem autorizada, após backup).
5. Cutover/DNS — Railway fica ativo até prova completa.

## Ordens de serviço (18 PRs 1–50)

Fora de escopo deste ciclo. Não alterados.
