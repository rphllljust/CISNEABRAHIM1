# CI Execution Plane — GitHub-hosted

Este documento cobre **onde o CI executa** e **por que**. Para a estrutura do monorepo, ver
[`../17-bootstrap/repository-structure.md`](../17-bootstrap/repository-structure.md).

> **Mudança de decisão (2026-10-22).** A versão anterior descrevia um runner self-hosted no VPS-1
> da OVH. Essa premissa foi **revogada**: o VPS-1 é o host de produção/runtime (Coolify + CISNE
> API + CISNE Web) e não hospeda CI. O bootstrap de runner permanece no repositório apenas como
> referência caso a decisão mude.

## Separação de planos

```
GitHub                       OVH VPS-1
──────────────────           ────────────────────────────
source authority             Coolify (deploy/runtime)
CI / control plane           CISNE API
quality gates                CISNE Web
Release ready                proxy / rede / logs
release authority            banco de runtime
```

**O CI nunca roda no host de produção.** Motivo medido, não estético:

| Fato | Consequência se compartilhado |
| --- | --- |
| VPS-1 tem 2 vCPU / 3,8 GB | 3 workers Vitest + PostgreSQL competiriam com php-fpm, Horizon e Reverb |
| Disco é HDD (`ROTA=1`) | 114 specs com `TRUNCATE` frequente saturariam I/O da aplicação |
| Docker socket compartilhado | CI poderia afetar containers de produção |
| Sem margem de RAM | OOM do kernel mata o processo que escolher — possivelmente a aplicação |

Isolamento não é preferência: é o que impede que um teste pesado degrade a aplicação em uso.

## Arquitetura do CI

```
GitHub Actions (control plane)
  ├─ static-quality ─┐
  ├─ unit shards ────┤
  ├─ database-gate ──┤   fan-out imediato, sem `needs` artificial
  ├─ build-release ──┤
  ├─ visual-critical ┤
  ├─ api-e2e ────────┤
  └─ integration-executor ──┐
                            ▼
                     Release ready (fail-closed)
```

### integration-executor (job único, `ubuntu-latest`)

```
checkout           1×
pnpm install       1×
build workspace    1×     → @cisne/database/dist para o serializer
PostgreSQL         1×     → services.postgres do job
migrations         1×     → cisne_integration_template
clones             N×     → cisne_it_01..N  (CREATE DATABASE ... TEMPLATE)
workers            N×     → Vitest paralelos, maxWorkers: 1, banco próprio cada
cleanup            sempre  → finally, inclusive em falha
```

Nenhum `needs` artificial: todos os gates independentes começam juntos.

### Por que isolamento por database funciona

Cada worker recebe `TEST_DATABASE_URL` de um database **fisicamente distinto**. Advisory locks
no Postgres são escopados **por database**: dois workers em bancos diferentes pegam locks
diferentes mesmo com a **mesma** chave `0x43534e45`.

Consequência: `maxWorkers: 1` permanece dentro de cada worker, sem nenhuma contenção entre
workers. Nenhuma linha de `integration-test-db-lock.ts` foi alterada.

**Shard é unidade de isolamento. Concorrência é unidade de política.**

## Política de concorrência

A quantidade de workers é **política explícita**, nunca derivada do host:

```yaml
CI_INTEGRATION_WORKERS: ${{ vars.CI_INTEGRATION_WORKERS || '3' }}
```

`os.availableParallelism()` é **métrica** publicada em `ci-metrics.json`, não autoridade.
Derivar dele produzia dois erros opostos: numa máquina grande escalava sem ninguém decidir;
numa máquina pequena limitava e impedia testar oversubscription controlada.

### Baseline validada — run `39794404313`

```json
{
  "shardCount": 3,
  "integrationSec": 373.7,
  "specCountExpected": 114,
  "specsCovered": 114,
  "slowestShardSec": 370.7,
  "fastestShardSec": 359.5,
  "runnerSeconds": 1099.7,
  "phases": { "plan": 0.1, "migrate+clone": 2.9, "workers": 370.7 },
  "memory": { "swapUsedDeltaMb": 0 }
}
```

Desbalanceamento LPT: **1,03×** (370,7 vs 359,5). 114/114 specs, zero órfão, zero duplicata.

### Promoção de concorrência

Comparação controlada de 3 vs 4 workers no **mesmo commit, mesma runner class, mesmo PostgreSQL**:

```
4 vence SOMENTE se:
  median(T4) <= 0.90 × median(T3)
E simultaneamente:
  OOM = 0 · swap não cresce · workers mortos = 0 · cobertura 114/114
```

Instrumento: `node scripts/ci/benchmark-workers.mjs` (lê `artifacts/bench/w<N>-run<M>.json`).

Benchmark **decide política**; o CI normal executa o vencedor. Rodar 3 e 4 em cada PR duplicaria
custo sem produzir informação nova.

## Scheduler LPT

`scripts/ci/integration-shard-plan.mjs` distribui os 114 specs por duração.

**Fonte de peso, em ordem:**

1. `artifacts/ci/integration-timings.json` — mediana das últimas 5 amostras reais por spec
2. `SEED_MS` — tabela medida, semente de bootstrap quando não há histórico
3. mediana global — conservadora, para spec novo sem histórico

**Spec sem peso nunca é descartado.** Ele entra com peso mediano.

O histórico é lido tolerando BOM: sem isso, um arquivo salvo por editor faria o LPT descartar
todo o histórico em silêncio e degradar o balanceamento sem nenhum sinal.

Validação fail-closed antes de qualquer teste:

```
descobertos == alocados == únicos == 114
zero duplicata · zero órfão · zero fantasma
```

Qualquer violação: `exit 1`. Cobertura perdida com CI verde seria falso verde.

## Ferramentas

| Arquivo | Função |
| --- | --- |
| `apps/api/scripts/integration-executor.mjs` | orquestra template, clones, workers e cleanup |
| `scripts/ci/integration-shard-plan.mjs` | scheduler LPT, determinístico e fail-closed |
| `scripts/ci/integration-timings.mjs` | coleta histórico por spec e publica métricas |
| `apps/api/src/test/ci-timings-reporter.mjs` | reporter do Vitest (`onTestModuleEnd`) |
| `scripts/ci/benchmark-workers.mjs` | comparador 3 vs 4 com a regra dos 10% |

## Fail-closed

| Condição | Resultado |
| --- | --- |
| worker falhou ou morreu | `exit 1` |
| spec sem shard / duplicado / fantasma | `exit 1` |
| scheduler quebrou | `exit 1` |
| cobertura incompleta | `exit 1` |
| banco não clonou | `exit 1` |
| prefixo de database inválido | `exit 1` — impede `DROP` fora do namespace `cisne_*` |
| cleanup falhou | `exit 1` — resíduo contamina o próximo run |

`Release ready` continua sendo o único agregador exigido pela ruleset da `main`, e reprova
`skipped`, `cancelled` e `failure` — apenas `success` explícito produz verde.

## Telemetria

`collect` e `summary` rodam em steps próprios com tratamento explícito: falha vira `::warning::`
identificável e publica `artifacts/ci/telemetry-failure.log`. Não existe `|| true` genérico — a
falha é visível sem derrubar um CI válido por problema secundário.

## Observabilidade

`artifacts/ci/ci-metrics.json` por run:

```json
{
  "shardCount": 3,
  "workerPolicy": "CI_INTEGRATION_WORKERS",
  "availableParallelism": 4,
  "integrationSec": 0,
  "specCountExpected": 114,
  "specsCovered": 114,
  "slowestShardSec": 0,
  "runnerSeconds": 0,
  "phases": { "plan": 0, "hygiene": 0, "migrate+clone": 0, "workers": 0 },
  "memory": { "swapUsedDeltaMb": 0, "swapInPagesDelta": 0 },
  "loadAverageDuring": 0,
  "shards": [{ "worker": 1, "specs": 38, "exitCode": 0, "sec": 0 }]
}
```

## Se o CI voltar a precisar de host dedicado

A condição para reabrir a decisão é **medida**, não preferência: o tempo de integração passar a
dominar o caminho crítico de forma que não possa ser tratado dentro do horário do runner
GitHub-hosted. Nesse caso, o caminho é **um VPS dedicado a CI**, nunca o VPS de produção.

`bootstrap-runner.sh` permanece no repositório para esse cenário. Ele **não** deve ser executado
no VPS-1.
