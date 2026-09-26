# Deploy Railway — SISTEMA CISNE RONDÔNIA

Runbook de implantação no [Railway](https://railway.com) para o monorepo atual
(pnpm + Turbo: `apps/api`, `apps/web`, `packages/database`). Imagens **reproduzíveis**
via Dockerfile; migrations como **pre-deploy**; healthcheck em **readiness**.

> Autoridade de detalhes: [Railway — Config as Code](https://docs.railway.com/config-as-code/reference)
> e [Railway — Pre-deploy command](https://docs.railway.com/deploy/builds#pre-deploy-command).

## 1. Serviços (3)

| Serviço | Tipo | Imagem/Dockerfile | Porta pública |
| ------- | ---- | ----------------- | ------------- |
| `cisne-db` | PostgreSQL (plugin Railway) | — | interna |
| `cisne-api` | Web service | `docker/hml/Dockerfile.api` | `$PORT` (3000) |
| `cisne-web` | Web service | `docker/railway/Dockerfile.web` | 80 |

O PostgreSQL do Railway injeta `DATABASE_URL` (e `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`).
O serviço API e o worker usam `DATABASE_URL`; nada de `localhost` em produção.

## 2. API (`cisne-api`)

- **Root directory:** raiz do repositório (monorepo).
- **Builder:** Dockerfile → `docker/hml/Dockerfile.api`.
- **Start command:** `node apps/api/dist/main.js` (já é o CMD da imagem).
- **Pre-deploy command:** `node packages/database/dist/cli/run-migrate-cli.js`
  (o runner hermético aplica as migrations do journal antes do container subir;
  falha de migration **bloqueia** o deployment).
- **Healthcheck path:** `/api/v1/health/ready` — responde `2xx` **somente** quando o
  banco está acessível (readiness), e `503` quando não (ver `apps/api/src/health`).
- **Timeout do healthcheck:** 300 s.

Variáveis (NUNCA credenciais de desenvolvimento):

| Variável | Valor/Nota |
| -------- | ---------- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | injetada pelo plugin PostgreSQL |
| `JWT_SECRET` | ≥32 chars, gerado (nunca `local-dev-jwt-secret...`) |
| `JWT_ISSUER` | `cisne-api` |
| `JWT_AUDIENCE` | `cisne-clients` |
| `JWT_ACCESS_TTL_SECONDS` | `900` |
| `JWT_REFRESH_TTL_SECONDS` | `43200` |
| `CORS_ORIGIN` | URL pública do `cisne-web` (ex.: `https://cisne-web.up.railway.app`) |
| `AUTH_LOGIN_RATE_LIMIT_PER_MINUTE` | `10` |
| `SECURITY_RATE_REFRESH_MAX` | `60` (por IP+UA; cada reload completo consome 1 refresh) |
| `OBJECT_STORAGE_PROVIDER` | `filesystem` (ou S3 em evolução posterior) |
| `OBJECT_STORAGE_ROOT` | `/data/object-storage` (volume persistente) |
| `FEATURE_MODULE_*` | conforme superfície Release 1 (finance/fiscal/accounting/inventory/payroll/procurement/suppliers/contracts/people/rentals/transport/alerts/reports/approval-matrix/operational-profitability) |

Volume: anexar um volume persistente em `/data` para `OBJECT_STORAGE_ROOT` (documentos).

## 3. Web (`cisne-web`)

- **Root directory:** raiz do repositório (monorepo).
- **Builder:** Dockerfile → `docker/railway/Dockerfile.web`.
- **Build argument (obrigatório):** `VITE_API_BASE_URL=https://<cisne-api>.up.railway.app`
  (injetado no build do Vite; definir em Build → Build arguments ou via variável de serviço).
- **Healthcheck path:** `/health` (nginx devolve 200; SPA é estático).

Variáveis: `PORT=80`, `VITE_API_BASE_URL` (argumento de build).

## 4. Bootstrap administrativo (produção)

Depois de `cisne-api` estar healthy, criar a primeira identidade pelo mecanismo oficial
(CLI hermética já embutida na imagem):

```bash
railway run --service cisne-api \
  BOOTSTRAP_ADMIN_LOGIN='admin@empresa.example' \
  BOOTSTRAP_ADMIN_PASSWORD='<senha-forte>' \
  BOOTSTRAP_CONFIRM='I_UNDERSTAND' \
  node packages/database/dist/cli/run-bootstrap-cli.js
```

**Proibido** em produção: seed de desenvolvimento, `Dev-Only-1!Synthetic`, qualquer
senha de dev, `DATABASE_URL` apontando para `localhost`, `CORS_ORIGIN=*`.

## 5. Smoke público (obrigatório)

1. `GET https://<cisne-api>.up.railway.app/api/v1/health/live` → `200`.
2. `GET https://<cisne-api>.up.railway.app/api/v1/health/ready` → `200` (`database up`).
3. `POST /api/v1/auth/login` com a identidade bootstrap → `200` + `accessToken`.
4. `https://<cisne-web>.up.railway.app/login` abre; login; navegação; sem `localhost`;
   sem erro de CORS; refresh preserva sessão.
5. Percorrer as páginas básicas e o fluxo empresarial completo pela UI.

## 6. Notas de monorepo

- Nenhum arquivo da árvore é copiado desnecessariamente no runner: o `Dockerfile.api`
  copia apenas `dist` + migrations + manifests; o `Dockerfile.web` copia apenas `dist`.
- `dist/` é gitignored: as imagens são construídas a partir do código (não de artefato
  commitado), garantindo build reproduzível.
