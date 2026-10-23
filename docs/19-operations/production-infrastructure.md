# OPS-PROD-001 — Infraestrutura de produção

| Campo       | Valor                    |
| ----------- | ------------------------ |
| Document ID | OPS-PROD-001             |
| Prompt      | 88                       |
| Status      | IMPLEMENTED (engenharia) |

## Objetivo

Infraestrutura real de produção com mínimo privilégio, resiliência e operação previsível.

## Compute (dimensionamento)

Derivado do **Prompt 82** (`prod-sizing.ts`) — não por palpite:

| Parâmetro | Valor baseline | Fonte |
| --------- | -------------- | ----- |
| Concorrência medida (benchmark) | max 3 / cenário | `performance-scenarios.ts` |
| Headroom | 2.5× | `performance-budgets.ts` |
| API replicas | 1–2 | baseline inicial |
| API CPU | 1 vCPU | medido + margem operacional |
| API RAM | 1024 MB | medido + margem operacional |
| Postgres `max_connections` | `replicas × pool_max + 15` | pool app + outbox + admin |

**Classificação:** interpretação de engenharia — não é SLA empresarial confirmado.

## PostgreSQL

| Controle | Implementação |
| -------- | ------------- |
| Storage durável | volume nomeado `cisne_prod_pg_data` |
| Backup | integração Prompt 84 (`BACKUP_ENABLE_POSTGRES`) |
| Connection limits | `max_connections` dimensionado em `prod-sizing.ts` |
| Monitoring | métricas pool + alertas técnicos (Prompt 80) |
| TLS | `PGSSLMODE=require` / `sslmode=require` em `DATABASE_URL` |
| Rede restrita | sem porta pública; host interno apenas |

## Object storage

| Controle | Implementação |
| -------- | ------------- |
| Private by default | bucket sem anonymous access (`mc anonymous set none`) |
| Versioning | `mc version enable` / provider versioning |
| Lifecycle | regra ILM 365d (ajustar conforme política legal DDP-019) |
| Backup | Prompt 84 `BACKUP_ENABLE_OBJECT_STORAGE` |

Produção exige `OBJECT_STORAGE_PROVIDER=s3` (MinIO/S3-compatible). Filesystem local só com `PROD_ALLOW_FILESYSTEM_STORAGE=I_UNDERSTAND` para drills isolados.

## Network

- Edge: somente **80/443** (`PROD_EXPOSED_PORTS`)
- PostgreSQL: **não público** (`prod-network.ts`)
- Object storage endpoint: rede privada / IAM
- Compose: rede `cisne_prod_internal` (`internal: true`)

## TLS

- URLs públicas **HTTPS** obrigatórias (`PROD_PUBLIC_*`)
- Caddy com certificados automatizados (Let's Encrypt) quando `PROD_DOMAIN` aponta para host real
- HTTP → HTTPS redirect

## Secrets

| Controle | Implementação |
| -------- | ------------- |
| Secret manager | `PROD_REQUIRE_SECRET_STORE=true` + `*_FILE` paths |
| Rotação | plano 90d; dual-key JWT suportado (`prod-secrets.ts`) |
| Scan | bloqueio de chaves embutidas / padrões AWS+PEM |

Nenhum secret no artifact de build (Prompt 87).

## Service account

- App runtime **sem** credencial administrativa cloud (`PROD_CLOUD_ADMIN_CREDENTIALS=false`)
- Backup com role dedicada (`BACKUP_USE_DEDICATED_ROLE=true`)
- Object storage via IAM scoped (`OBJECT_STORAGE_IAM_ROLE=true`)

## Scaling

Baseline apenas — múltiplas instâncias exigem:

| Componente | Requisito |
| ---------- | --------- |
| Sessions | PostgreSQL compartilhado (stateless API + DB sessions) |
| Outbox worker | locking via `claimPending` — não duplicar sem coordenação |
| Uploads | storage compartilhado S3 |
| API | stateless; `PROD_API_REPLICAS>1` exige S3 |

## Cost controls

- `PROD_COST_ALERTS_ENABLED=true`
- `PROD_MONTHLY_BUDGET_USD` — alerta de budget (configurar no provider cloud)

## Validation

```bash
pnpm prod:validate
```

Estágios (`runProdInfrastructureValidation`):

1. environment
2. compute_sizing
3. network
4. postgres
5. object_storage
6. tls
7. secrets
8. service_account
9. scaling
10. cost_controls
11. backup
12. observability
13. security_scan

## Provisionamento referência

```bash
cp .env.prod.example .env.prod
# editar secrets e domínios
docker compose -f docker/prod/compose.yaml --env-file .env.prod up -d --build
pnpm prod:validate
```

Artefatos:

- `docker/prod/compose.yaml` — stack endurecida
- `docker/prod/Caddyfile` — TLS edge
- `apps/api/src/ops/prod/**` — políticas e validação
- `.env.prod.example`

## Bloqueadores empresariais remanescentes

| Item | Status |
| ---- | ------ |
| RPO/RTO | `TARGET_NOT_DEFINED` (DDP-016) |
| Provedor cloud definitivo | OVH VPS + Coolify — IMPLEMENTED |
| Runtime | OVH VPS gerenciado pelo Coolify |

## Documentos relacionados

- [backup-strategy.md](./backup-strategy.md)
- [cd-pipeline.md](./cd-pipeline.md)
- [performance-test-plan.md](../16-testing/performance-test-plan.md)
