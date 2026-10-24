# 63 — DISPATCH + EXECUTION + ACTUALS (backend, frontend e fechamento)

**Status:** implementado e validado em engenharia.
**Classificação:** interpretação de engenharia sobre requisito confirmado do plano diretor.
Nenhuma regra de negócio nova inventada: onde a fonte não existia, a lacuna está declarada
neste documento e no código.

---

## 1. Continuidade da vertical

Esta fase continua exatamente de `READY FOR DISPATCH` e fecha:

```text
READY FOR DISPATCH → DISPATCH → CHECK-IN → START → LIVE EXECUTION
   → OPERATIONAL EVENTS → ACTUALS → COMPLETE → EXECUTION CLOSED
   → MEASUREMENT READY
```

Faturamento e contabilidade **não** entram. A entrega para na base de medição publicada.

---

## 2. O que já existia (e foi preservado)

| Artefato | Estado anterior |
| --- | --- |
| `so.service_orders` + state machine (`DRAFT..CANCELLED`) | completo, com `row_version` |
| `so.planned_resources` / `res.resource_allocations` | completo, com alocação nominal |
| `so.execution_entries` (QUANTITY/MILEAGE/HOUR_METER/OBSERVATION/OCCURRENCE) | completo |
| `so.execution_evidence` | payload por tipo |
| `so.execution_occurrences` | completo |
| `so.operational_cost_entries` | ESTIMATED/ACTUAL |
| `so.execution_command_idempotency` | UNIQUE (ordem, comando, chave) |
| `evt.outbox_events` + `OutboxDomainEventWriter` | transacional |

**Nada disso foi recriado.** A capability apenas acrescenta a camada que faltava.

---

## 3. Defeitos de causa raiz corrigidos

### 3.1 O despacho era um status, não um fato

Não existia como despachar: o operador via `RELEASED` e a única informação disponível era
o status. Consequência medida: a ordem saía sem que ninguém confirmasse habilitação, veículo
ou documentos, e o motivo do bloqueio nunca existia como dado.

**Correção:** `so.service_order_dispatches` — fato com autor, janela, recursos confirmados,
snapshot de prontidão e check-in. O `status` do agregado **não** foi ampliado com
`DISPATCHED`/`READY_FOR_DISPATCH`: esses conceitos são projeção, não estado.

### 3.2 Conclusão sem nenhum realizado

`assertExecutionCompletePreconditions` verificava **somente** evidência declarada no snapshot.
Era possível concluir uma execução sem odômetro final, sem combustível, sem horas e sem
assinatura — e medição e custo eram produzidos sobre o planejado sem que nada indicasse a
falta.

**Correção:** `domain/completion-gate.ts` avalia estado, medidor final, combustível, horas por
pessoa, equipamento, material, quantidade medida, evidência (anexada **e** verificada),
assinatura e situações abertas. Devolve **todos** os motivos, não o primeiro.

### 3.3 `COMPLETED` não era `EXECUTION CLOSED`

O status `COMPLETED` era o fim da linha: nenhum fechamento, nenhuma base de medição. A
medição não tinha sobre o que trabalhar.

**Correção:** `so.execution_closures` + `so.measurement_basis`, criados **no mesmo COMMIT** da
conclusão. O mesmo commit publica `EXECUTION_COMPLETED` e `MEASUREMENT_BASIS_READY`.

### 3.4 Trigger de monotonicidade que não disparava

A primeira versão comparava a leitura apenas contra linhas com `is_initial = false`. O caso
real mais perigoso — abrir o odômetro em 125.000 e registrar 124.000 em seguida — **passava**,
porque não existia leitura não-inicial anterior para servir de referência. Provado com sonda
direta contra PostgreSQL.

**Correção:** a referência é a maior leitura anterior de qualquer natureza; só a leitura de
abertura escapa. Provado em banco novo (`METER_READING_NOT_MONOTONIC`).

### 3.5 Regra de conclusão duplicada no React

`execution-primary-action.ts` recebia `requirementsComplete`, calculado na tela a partir das
evidências, e habilitava "Concluir OS". Era a segunda implementação da regra, que não conhecia
medidor, combustível, horas nem situações.

**Correção:** o parâmetro passou a ser `backendAllowsComplete` = `completionGate.canComplete`.
Teste de fitness reprova o retorno do padrão antigo.

### 3.6 Prontidão adivinhada pelo nome do tipo de recurso

A exigência de condutor era inferida por regex sobre o código do tipo. Falhou no dado real:
`WATER_TRUCK` (caminhão pipa) não casa com nenhum padrão em português, e o serviço passou a
exigir EQUIPAMENTO e a não exigir condutor.

**Correção:** a fonte é `cat.physical_resource_types.classification` (enum fechado), lido em
lote e passado ao domínio como conjunto de códigos veiculares.

---

## 4. Limites de fonte declarados

Não são contornados, são **reportados**:

| Fonte ausente | Efeito declarado |
| --- | --- |
| `mnt.maintenance_orders` não existe | Dimensão MAINTENANCE = `NOT_APPLICABLE` quando o fato é `null`. O sistema **não afirma** "sem manutenção". |
| `wrk.workforce_member_qualifications` não existe | Dimensão QUALIFICATION = `NOT_APPLICABLE`. **Não há bloqueio por habilitação vencida hoje** — a lacuna é visível, não silenciosa. |
| `cat.physical_resource_types.requires_driver` não existe | Exigência derivada da classificação `VEHICLE`. Registrado como interpretação. |
| SLA não persistido na OS | `dueAt` lido de `contract_snapshot.dueAt`. Sem contrato, `null` — nunca inventado. |

```text
PENDING: MODELAGEM DE QUALIFICAÇÃO E MANUTENÇÃO
A capability está pronta para consumir ambas as fontes. Quando existirem, as dimensões
QUALIFICATION e MAINTENANCE passam a decidir SEM alteração no domínio.
```

---

## 5. Superfícies entregues

### Backend

| Rota | Tipo |
| --- | --- |
| `GET /api/v1/query/operations/dispatch` | read model do board |
| `GET /api/v1/query/operations/execution` | read model do console |
| `GET /api/v1/query/service-orders/:id/overview` | object page |
| `GET /api/v1/query/service-orders/:id/measurement-readiness` | prontidão de medição |
| `POST .../commands/dispatch` | comando |
| `POST .../commands/check-in` | comando |
| `POST .../commands/register-actual` | comando |
| `POST .../commands/register-meter` | comando |
| `POST .../commands/register-fuel` | comando |
| `POST .../commands/register-signature` | comando |

### Frontend

- `/app/workspaces/operacoes` — estação de operação (despacho + execução)
- `/app/operations/dispatch` — Dispatch Board
- `/app/operations/execution` — Execution Console
- Object page de execução passou a ler o gate do backend

---

## 6. Invariantes de banco

18 sondas executadas contra PostgreSQL real (`tmp/dbtools/prove-invariants.mjs`), todas PASS:

despacho único por OS · janela válida · monotonicidade (incl. referência de abertura) ·
leitura inicial/final única · realizado não negativo · recurso obrigatório por tipo ·
chave de idempotência única · volume de combustível positivo · base READY única ·
situação aberta única (e reabertura após resolução) · fechamento por número ·
FK de ordem inexistente · read contract espelha tabela.

---

## 7. Testes

| Camada | Resultado |
| --- | --- |
| API unit (domínio + serviço) | **1567+ PASS** |
| API integração (PostgreSQL) | `service-order-execution` 18/18, `operations` 15/15 |
| Web unit/componente/e2e | **1191 PASS** |
| Fitness arquitetural | **19/19** |
| Gate de migrations (fresh + incremental) | PASS |
| Gate de scripts + ratchet de tamanho | PASS |
| Lint (api + web) | PASS |
| Build (turborepo) | PASS |

---

## 8. O que esta fase NÃO entrega

- Faturamento e contabilidade (verticals seguintes).
- Motor de custeio completo — apenas os **fatos** que ele consome.
- Resolução das dimensões QUALIFICATION e MAINTENANCE (dependem de modelagem ausente).
- Medição: a base é **publicada**; o workbench de medição é da próxima capability.
