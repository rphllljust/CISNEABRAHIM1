# CI Execution Plane — runner OVH

Este documento cobre **o que existe hoje** e **o corte para o runner dedicado**. Não descreve a
estrutura do monorepo; para isso, ver [`repository-structure.md`](./repository-structure.md).

## Por que o runner existe

Medição da baseline (run `39785822308`, o run que foi para a `main`):

| Métrica | Valor |
| --- | --- |
| `commit → Release Ready` | 3m24s |
| Shard mais lento | 196s |
| Shard mais rápido | 127s |
| **Overhead por shard** | **44s** (13 container + 2 checkout + 3 pnpm + 5 node + 3 install + 3 migrate + 19 build) |
| 8 shards × 44s | **352s desperdiçados** |
| Teste real | 146s |
| Total | ~28 runner-minutes |

O gargalo não era o GitHub Actions. Era pagar o mesmo overhead de setup oito vezes, em oito
máquinas frias, para executar 146s de teste.

## Arquitetura

```
GitHub Actions (control plane)
  ├─ static-quality ─┐
  ├─ unit shards ────┤
  ├─ database-gate ──┤
  ├─ build-release ──┤   fan-out imediato, sem `needs` artificial
  ├─ visual-critical ┤
  ├─ api-e2e ────────┤
  └─ integration-executor ──┐
                            ▼
                     Release ready (fail-closed)

integration-executor (execution plane)
  checkout      1×
  pnpm install  1×
  build         1×
  PostgreSQL    1×  (residente no host)
  migrations    1×  → cisne_integration_template
  clones        8×  → cisne_it_01..08    (~120ms cada)
  workers       8×  Vitest paralelos, LPT ponderado, maxWorkers: 1
  cleanup       sempre, inclusive em falha
```

GitHub decide (branch protection, required checks, `Release Ready`, merge). O runner apenas
executa carga pesada.

## Por que o isolamento continua correto

Cada worker recebe `TEST_DATABASE_URL` de um database **fisicamente distinto**
(`cisne_it_01`..`cisne_it_08`). Advisory locks no Postgres são escopados **por database**: dois
workers em bancos diferentes pegam locks diferentes mesmo com a **mesma** chave `0x43534e45`.

Consequência: `maxWorkers: 1` permanece dentro de cada worker, sem nenhuma contenção entre
workers. Nenhuma linha de `integration-test-db-lock.ts` foi alterada.

**Shard é unidade de isolamento. Concorrência é unidade de CPU.** São dimensões diferentes — o
executor deriva o paralelismo real de `os.availableParallelism()`, não do número de shards.

## Provisionar o runner

Pré-requisito: uma VM Linux (alvo: 8 vCPU, 16 GB RAM, NVMe 100 GB), isolada da aplicação.

```bash
# Token: GitHub > Settings > Actions > Runners > New self-hosted runner
export CISNE_REPO_URL=https://github.com/rphllljust/CISNEABRAHIM1
export CISNE_RUNNER_TOKEN=<token>

sudo -E bash scripts/ci/bootstrap-runner.sh
```

O bootstrap é idempotente e configura:

- Docker (para o PostgreSQL de teste)
- Node 22 + pnpm 9.15.9 — **a mesma versão do CI**, para não divergir
- PostgreSQL residente `cisne-ci-postgres`, escutando **apenas** em `127.0.0.1`
- Caches persistentes em `/opt/cisne-ci-cache` (`pnpm-store`, `turbo`)
- Runner `self-hosted` com labels `self-hosted,cisne-ci,ovh`
- Serviço systemd (sobrevive a reboot)

Caches ficam **fora** do workspace: `actions/checkout` limpa o diretório de trabalho a cada job,
então um store dentro dele seria apagado. Isso é o que faz o install cair para sub-segundo.

## Política de concorrência — VPS-1

A quantidade de workers é **política explícita**, não derivada da máquina:

```yaml
CI_INTEGRATION_WORKERS: ${{ vars.CI_INTEGRATION_WORKERS || '3' }}
```

**3 workers é o baseline.** 4 é candidato. `os.availableParallelism()` é métrica reportada no
`ci-metrics.json`, nunca a autoridade.

Por quê: derivar de vCPU produzia dois erros opostos — numa máquina grande escalava para 8 sem
ninguém ter decidido; numa máquina pequena limitava a 2 e impedia testar oversubscription
controlada. Este workload é **I/O-bound** (espera de PostgreSQL), então oversubscription pode
vencer. Mas só a medição decide.

### Regra matemática de promoção 3 → 4

```
T3 = tempo total com 3 workers
T4 = tempo total com 4 workers

4 vence SOMENTE se:
  T4 <= 0.90 × T3        (pelo menos 10% mais rápido)

E simultaneamente:
  OOM events            = 0
  swap usado não cresce (swapUsedDeltaMb <= 0)
  swap-in/out durante   = estável
  workers mortos        = 0
  flakiness nova        = 0
  erros PostgreSQL      = 0
```

Se a diferença ficar próxima do limite, decidir por **mediana de múltiplos runs** — nunca pelo
melhor run isolado. Escolher 4 por um run favorável é escolher por acaso.

### Como medir

Mesmo commit, mesmo runner, mesma versão de PostgreSQL, mesmos 114 specs, mesmo build.

```bash
gh variable set CI_INTEGRATION_WORKERS --body "3"   # baseline
# ... rodar, registrar integrationSec e ci-metrics.json

gh variable set CI_INTEGRATION_WORKERS --body "4"   # candidato
# ... rodar, comparar
```

`ci-metrics.json` já publica o necessário para a decisão:

| Campo | Uso |
| --- | --- |
| `integrationSec` | T3 / T4 |
| `slowestShardSec` | caminho crítico |
| `memory.before` / `memory.after` | folga real (`MemAvailable`) |
| `memory.swapUsedDeltaMb` | **reprova a promoção se > 0** |
| `memory.swapInPagesDelta` / `swapOutPagesDelta` | pressão de memória |
| `loadAverageDuring` | distingue lentidão de teste × host saturado |
| `availableParallelism` | hardware real, para interpretar o resultado |

### Fora de política

5, 6 ou 8 workers no VPS-1 **não** são alvo. Este hardware tem política de 3–4.

## Ativar o runner no CI

```bash
gh variable set CI_INTEGRATION_RUNNER --body "self-hosted"
```

O workflow já lê essa variável:

```yaml
runs-on: ${{ vars.CI_INTEGRATION_RUNNER || 'ubuntu-latest' }}
```

Sem a variável, o CI roda em `ubuntu-latest` (fallback transitório — sobe PostgreSQL como
container). Com a variável, o executor inteiro roda no host quente.

## Segurança

| Item | Política |
| --- | --- |
| PostgreSQL de teste | loopback apenas (`127.0.0.1`), nunca exposto |
| Credenciais do banco | descartáveis por design; não são secrets de produção |
| Token do runner | por variável de ambiente; nunca versionado |
| Usuário do runner | `cisne-ci` dedicado, nunca root |
| CI × produção | hosts separados; CI não disputa CPU/RAM/I/O com runtime |

`fsync=off` e `synchronous_commit=off` no PostgreSQL de teste são seguros **porque** o banco só
contém dados descartáveis, e aceleram migrations e fixtures. Nunca use isso num banco real.

## Fail-closed

Nenhuma otimização pode gerar falso verde. O executor aborta (`exit 1`) quando:

| Condição | Motivo |
| --- | --- |
| worker falhou ou morreu | resultado incompleto |
| spec sem shard | cobertura perdida |
| spec duplicado | trabalho repetido mascarando órfão |
| scheduler quebrou | partição não confiável |
| cobertura incompleta | `executados != descobertos` |
| banco não clonou | worker rodaria contra banco errado |
| cleanup falhou | resíduo contamina o próximo run |

O `Release Ready` continua sendo o único agregador exigido pela ruleset da `main`, e reprova
`skipped`, `cancelled` e `failure` — só `success` explícito produz verde.

## Observabilidade

Cada run publica `artifacts/ci/ci-metrics.json`:

```json
{
  "shardCount": 8,
  "integrationSec": 0,
  "specCountExpected": 114,
  "specsCovered": 114,
  "slowestShardSec": 0,
  "runnerSeconds": 0,
  "phases": { "plan": 0, "hygiene": 0, "migrate+clone": 0, "workers": 0 },
  "shards": [{ "worker": 1, "specs": 13, "exitCode": 0, "sec": 0 }]
}
```

E `artifacts/ci/integration-timings.json` mantém as últimas 5 amostras por spec. O scheduler LPT
usa a **mediana** dessas amostras como peso — resistente a outlier, reativo a regressão.

Specs sem histórico entram com peso mediano conservador e ganham histórico na primeira execução.
