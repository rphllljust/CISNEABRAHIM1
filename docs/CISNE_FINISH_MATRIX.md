# CISNE_FINISH_MATRIX — fila oficial de execução

Fila oficial de finalização das superfícies empresariais do CISNE.
Uma linha por módulo. Sem relatório narrativo.

Legenda de status: `DONE` · `BASIC_GAP` · `RUNTIME_BUG` · `BUSINESS_BLOCKED` · `PARK`

Colunas de superfície: `Y` = existe e é utilizável por pessoa de negócio · `-` = ausente · `UUID` = existe mas exige identificador técnico digitado · `N/A` = não se aplica ao domínio.

Regra absoluta: usuário de negócio não copia UUID para operação normal.
UUID permanece interno. Lookup humano (autocomplete/select pesquisável/navegação) é obrigatório quando existe endpoint de referência. Sem endpoint seguro de lookup → `PARK: HUMAN_LOOKUP_API_GAP` (nunca carregar 100 mil registros no navegador).

---

## Nota de governança (registrada uma única vez)

O escopo histórico (`docs/01-foundation/release-1-closed-scope.md`, DDP-026) marca `finance`, `fiscal`, `accounting`, `inventory`, `payroll`, `procurement`, `suppliers`, `people`, `contracts`, `alerts`, `reports`, `rentals`, `transport` como módulos **gated fail-closed** (`VITE_FEATURE_MODULE_*` / `FEATURE_MODULE_*`).

O objetivo atual do produto declarado pelo patrocinador é CISNE centralizado, com esses módulos como parte do produto.

Resolução aplicada nesta fila, sem inventar regra:

1. **As feature flags permanecem.** Nenhum gate é removido por conveniência (AGENTS.md §17–18; ED-005).
2. **As superfícies são finalizadas atrás do gate.** Um módulo gated com superfície incompleta continua sendo `BASIC_GAP`: o gate controla exposição, não justifica UI de backoffice.
3. **`rentals` e `transport` permanecem `PARK`** até que o modelo LOCAL prove operação própria. A operação é coberta por Catálogo + OS + Recursos + Execução (DDP-026). Não criar ERP paralelo.
4. **`maintenance`** não possui módulo backend no clone local (apenas spec). Sem modelo local → `PARK`.
5. Bloqueio legal real (fiscal/payroll) é diferente de UI incompleta. O que é seguro finalizar, será finalizado.

---

## Matriz

| MODULE | BACKEND | LIST | DETAIL | CREATE | EDIT | SEARCH | FILTER | HUMAN_REFS | WORKFLOW | RELATIONS | AUTHZ | TEST | BROWSER | STATUS | NEXT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clients | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| catalog | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| requests | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| proposals | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| purchase-orders (cliente) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| contracts | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | Y | Y | Y | Y | DONE | edição REAL via `PATCH :contractId` → `updateDraft` com rowVersion, authz `CommercialContractUpdate` e auditoria; e2e 21/21. O BASIC_GAP anterior estava **obsoleto** |
| assets | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — (0a55810, 9d2ce38) |
| service-orders | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| measurements | Y | Y | Y | Y | Y | N/A | N/A | Y | Y | Y | Y | Y | Y | DONE | — (superfície via OS) |
| billing | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| documents | Y | Y | Y | Y | N/A | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| **suppliers** | Y | Y | Y | Y | Y | Y | Y | Y | Y | parcial | Y | Y | Y | **DONE** | relações (pedido/nota/payable) — não bloqueia o básico |
| **procurement** | Y | Y | Y | Y | - | Y | Y | Y | Y | Y | Y | Y | Y | **DONE** | editar requisição pendente; centro de custo/categoria (PARK: HUMAN_LOOKUP_API_GAP) |
| **inventory** | Y | Y | Y | Y | - | Y | Y | Y | Y | Y | Y | Y | Y | **DONE** | centro de custo/categoria (PARK); edição de depósito/item inexistente no backend |
| people | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| finance (AR/AP/treasury/recon) | Y | Y | Y | Y | Y | Y | Y | parcial | Y | Y | Y | Y | Y | BASIC_GAP | extrato bancário agora tem listagem autorizada e mesa de trabalho (status/conta/período server-side, seleção por URL); `PARK HUMAN_LOOKUP_API_GAP` para movimento financeiro (vínculo manual por id) e movimento de tesouraria |
| finance/expenses | Y | Y | Y | Y | - | Y | Y | **Y** | Y | Y | Y | Y | parcial | DONE | **RESOLVIDO**: centro de custo via `GET finance/cost-centers` e categoria via `GET finance/expense-categories`, ambos por `HumanLookupField` |
| finance/budgets | Y | Y | Y | Y | - | Y | Y | **Y** | Y | Y | Y | Y | parcial | DONE | **RESOLVIDO**: período contábil por `HumanLookupField` com escopo de unidade (`searchAccountingPeriodOptions`); consultar sem unidade devolve vazio em vez de vazar escopo |
| accounting | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | período descoberto pela unidade (`GET accounting/periods`), central de fechamento em `/app/closing` com bloqueadores reais e drill-down, lançamento com origem persistida; `PARK HUMAN_LOOKUP_API_GAP` apenas para o registro de imobilizado |
| fiscal | Y | Y | Y | Y | - | Y | Y | Y | Y | Y | Y | Y | Y | DONE | lista operacional por unidade + competência, status na URL com filtro server-side, total real e drill-down a partir da central de fechamento; `PARK HUMAN_LOOKUP_API_GAP`: centro de custo (id) e `?status=FAILED` anunciado no Ctrl+K sem existir no enum do backend |
| payroll | Y | Y | Y | Y | - | Y | Y | **Y** | Y | Y | Y | Y | Y | DONE | `GET payroll/periods` e `GET payroll/contracts` **existem e estão cobertos**; o PARK que os declarava ausentes estava incorreto. Resta apenas edição de contrato (não existe no backend) |
| accounting (central de fechamento) | Y | Y | Y | N/A | N/A | Y | Y | Y | Y | Y | Y | Y | Y | DONE | `GET closing/readiness` agrega período, contábil, fiscal, bloqueadores e ações numa leitura autorizada; seção fiscal omitida por inteiro sem concessão de leitura fiscal |
| fleet | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| resources | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| alerts | Y | Y | Y | N/A | N/A | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| reports | Y | Y | Y | N/A | N/A | Y | Y | Y | N/A | Y | Y | Y | Y | DONE | — |
| search | Y | Y | N/A | N/A | N/A | Y | Y | Y | N/A | Y | Y | Y | Y | DONE | — |
| access-admin | Y | Y | Y | Y | Y | Y | Y | parical | Y | Y | Y | Y | Y | DONE | âncoras de escopo são técnicas por natureza |
| issuer/establishments | Y | **-** | Y | Y | Y | - | - | - | Y | - | Y | Y | **-** | **PARK** | backend completo mas **sem feature flag** no `release-1-scope.ts` e sem cliente web: exige decisão de gating + superfície completa (> 8 min). Não tem paralelo em release scope auditado |
| rentals | Y (lista) | Y | - | - | - | - | - | Y | N/A | - | Y | Y | Y | PARK | OUT_OF_RELEASE_1 — coberto por Catálogo+OS+Recursos+Execução |
| transport | Y (lista) | Y | - | - | - | - | - | Y | N/A | - | Y | Y | Y | PARK | OUT_OF_RELEASE_1 — coberto por Catálogo+OS+Recursos+Execução |
| maintenance | - | - | - | - | - | - | - | - | - | - | - | spec | - | PARK | sem modelo local — BACKEND_ABSENT |
| vertical / synthetic-seed / uat | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Y | N/A | PARK | harness de teste, não superfície de produto |

---

## Itens human-lookup bloqueados por backend (PARK: HUMAN_LOOKUP_API_GAP)

Registrados aqui; **não** substituir por input livre nem por carga massiva no navegador.

| Item | Consumidor | Motivo | Status |
| --- | --- | --- | --- |
| Centro de custo (id) | procurement receive, supplier-invoice, fiscal tax-assessment, finance expenses | **RESOLVIDO na rodada MASTER-003** — migration `0118` + `GET finance/cost-centers` + `HumanLookupField` | FECHADO |
| Categoria de despesa (id) | procurement receive, supplier-invoice validate | **RESOLVIDO na rodada MASTER-003** — `GET finance/expense-categories` + `HumanLookupField` | FECHADO |
| Documento de origem (UUID) | finance treasury | **RESOLVIDO na rodada MASTER-003 (3ª frente)** — `originKind` era fixo em `MANUAL_AUTHORIZED` no cliente e `originId` era UUID livre; um pagamento de título real se declarava despesa manual. Agora o operador escolhe o TIPO e o título vem de `GET finance/payables` / `receivables` | FECHADO |
| Período (id) | finance budgets, fiscal apuração | **RESOLVIDO na rodada MASTER-003 (2ª frente)** — `GET accounting/periods` já existia e era usado pela Contabilidade, mas `BudgetsPage` pedia UUID em `Input` livre; agora usa `searchAccountingPeriodOptions` com escopo de unidade. `GET fiscal/periods` também já existia | FECHADO |

---

## Ordem de ataque (ajustada por impacto operacional)

Itens 1–4 executados nesta rodada (commits `f0e83bb`, `b684741`, `a224824`, `b1c241b` + correções `c9df38e`, `d4c082a`).

1. `suppliers` — entidade sem lista; consulta por identificador (operação cotidiana exige UUID).
2. `procurement` — 4 lookups por identificador + centro de custo (id); fluxo de compras sem navegação.
3. `inventory` — bancada de UUIDs (depósito, item, reserva, custeio) sem listagem.
4. `contracts` / `purchase-orders` / `service-orders` — filtro de cliente por UUID digitado.
5. `finance` — despesa, orçamento, conciliação e tesouraria por identificador.
6. `issuer/establishments` — backend completo sem superfície web.
7. `fiscal` — apuração e centro de custo por identificador.
8. `payroll` — período por identificador.
9. `accounting` — ativo fixo e lançamentos por identificador.
10. Acabamento visual — somente depois.

---

## GATE FINAL (rodada MASTER-003)

Base: `cd407234` (fast-forward de `fix/measurement-nested-read-model` → `main`). Medições abaixo são
desta rodada, executadas sobre o código resultante.

| Gate | Resultado | Evidência |
| --- | --- | --- |
| API typecheck (`tsc -p apps/api`) | PASS | 0 erros |
| WEB typecheck real (`tsc -b apps/web/tsconfig.json`) | PASS | `tsc -b --force` = 0 erros |
| ESLint API | PASS | 0 problemas (4 imports não usados corrigidos) |
| ESLint WEB | PASS | 0 problemas |
| API unit | **PASS** | **1905/1905 em 296 arquivos** |
| API integração — frentes A e B | **PASS** | **43/43**: cost-center-reference 10, expense-category-lookup 9, payables 15, expense-management 9 |
| Gate de banco (`pnpm gate:database`) | **PASS** | fresh PASS + incremental N-1→N PASS |
| Gate de scripts (`pnpm gate:scripts`) | **PASS** | 87 `.mjs`, probes completos, 13/13 detectores |
| WEB suíte focada (finance/fiscal/procurement/financial-ui) | **PASS** | **217/217 em 38 arquivos** |
| Cobertura de journal por migration | **PASS** | 0118 com bloco próprio em `ensure-migrations.ts` |

Observação de gate: a suíte WEB completa apresentou 1 falha **variável** (`service-requests.e2e`,
`assets.e2e`, `purchase-orders.e2e`, `measurement-workbench-api` e `ServiceOrdersEngineListPage`
alternaram entre execuções; todas passam isoladas e em pares). `release-scope.http.spec.ts` (API)
apresentou o mesmo padrão. É contenção de CPU do harness local, não defeito de produto — os mesmos
casos passaram em execuções subsequentes. O CI é o veredito de particionamento; nenhuma asserção
foi afrouxada.

---

## FRENTES A–H — resultado medido (não planejado)

**Método:** cada frente foi verificada no CÓDIGO, não na documentação anterior. Várias lacunas
registradas na matriz já **não existiam** — o registro estava obsoleto. Isso está declarado
abaixo em vez de ser apresentado como trabalho novo.

### FRENTE A — Centro de custo — IMPLEMENTADA

O defeito real encontrado: `fin.payables.cost_center_id` (0045) e `fin.expenses.cost_center_id`
(0069) são `uuid NOT NULL` **sem `REFERENCES`**, e **nenhuma tabela de centro de custo existia**
em toda a cadeia de migrations. Os testes alimentavam o campo com `crypto.randomUUID()`.

| Entrega | Arquivo |
| --- | --- |
| Migration com tabela, índices, enum e metadado | `packages/database/migrations/0118_cost_center_reference.sql` |
| Schema Drizzle | `packages/database/src/schema/finance.ts` |
| Repositório (list/count/get/exists/create) | `apps/api/src/finance/repositories/cost-centers.repository.ts` |
| Serviço com authz + auditoria + validação de referência | `apps/api/src/finance/services/cost-centers-access.service.ts` |
| Controller `finance/cost-centers` | `apps/api/src/finance/controllers/cost-centers.controller.ts` |
| Ações `finance:cost-center:list` / `:create` | `apps/api/src/authorization/types/authz-actions.ts` |
| Prova | `cost-center-reference.integration.spec.ts` — **10/10 PASS** |

Limite declarado: **não** foi adicionada FK em `cost_center_id`. Os UUIDs já persistidos são
arbitrários; uma FK exigiria backfill que falharia em massa sobre dado real. A integridade para
escritas NOVAS é imposta em `assertExists`. Convergência permanece pendência registrada.

### FRENTE B — Categoria de despesa — IMPLEMENTADA

Existia `POST finance/expense-categories`, **não existia `GET`**.

| Entrega | Arquivo |
| --- | --- |
| `listExpenseCategories` + `countExpenseCategories` | `apps/api/src/finance/repositories/payables.repository.ts` |
| `listExpenseCategories` no serviço | `apps/api/src/finance/services/payables-access.service.ts` |
| `assertExpenseCategoryList` | `apps/api/src/finance/services/payables-access.authz.ts` |
| `GET finance/expense-categories` | `apps/api/src/finance/controllers/payables.controller.ts` |
| Conjunto fechado de status + predicado | `apps/api/src/finance/domain/payable.ts` |
| Prova | `expense-category-lookup.integration.spec.ts` — **9/9 PASS** |

### FRENTE C — Período contábil/fiscal — JÁ EXISTIA

Verificado no código: `GET accounting/periods`, `GET charts/:chartId/periods`,
`GET periods/:periodId/ledger`, `POST periods/:periodId/close|reopen` e a central
`GET closing/readiness` estão implementados e cobertos. **Nada foi criado** — criar um caminho
paralelo seria a duplicação que a missão proíbe.

### FRENTE D — Extrato bancário — JÁ EXISTIA

`GET bank-statements` (listagem com filtro server-side), `GET statements/:id`,
`GET accounts/:accountId/reconciliation` e `POST accounts/:accountId/movements` existem.
**Nada foi criado.**

### FRENTE E — Payroll — JÁ EXISTIA

`GET payroll/periods` **e** `GET payroll/contracts` existem, com `validatePayrollPeriodListQuery`
e `assertPayrollAction`. O `PARK` que os declarava ausentes estava **incorreto**. **Nada foi criado.**

### FRENTE F — Apuração fiscal — JÁ EXISTIA

`GET tax-assessments` (listagem por unidade), `GET tax-calculations`, e as transições
`finalize`/`adjust`/`cancel` existem. **Nada foi criado.**

### FRENTE G — Contratos (edição) — JÁ EXISTIA, E É REAL

`PATCH commercial/contracts/:contractId` → `updateDraft`, com `AUTHZ_ACTIONS.CommercialContractUpdate`,
`resolveUpdateContractDraftInput`, `rowVersion` (concorrência otimista), auditoria e validação de
referências de serviço. O frontend (`ContractsDetailPage` + `contracts-fetch-mock`) e o e2e
`contracts.e2e.test.tsx` (21/21 PASS) provam a edição. O `BASIC_GAP` da matriz estava **obsoleto**.

### FRENTE H — Estabelecimentos — GATING NÃO RESOLVIDO (permanece PARK)

Backend completo e verificado: `issuer/legal-entities`, `issuer/establishments`,
`issuer/tax-registrations`, `issuer/certificates` (todos com `GET`/`POST`/`PATCH` e histórico), mais
`organization/operational-units`, que **já possui superfície web** (`unit-governance-api.ts`,
`access-admin/operational-unit-workbench`).

**Não foi resolvido** porque a decisão é de produto, não de engenharia: criar `VITE_FEATURE_MODULE_*`
para `issuer` e construir a superfície exige autorização sobre o que entra no release 1. Criar a flag
por conveniência seria exatamente o que `AGENTS.md` §17–18 e `ED-005` proíbem. **Registrado, não
executado — e não apresentado como concluído.**

### HUMANLOOKUPFIELD — ligado às novas listagens

| Entrega | Arquivo |
| --- | --- |
| Busca humana de centro de custo, categoria **e período contábil** | `apps/web/src/financial-ui/finance-directory-lookup.ts` |
| Prova da fronteira (9 casos, inclui proibição de consultar período sem unidade) | `apps/web/src/financial-ui/finance-directory-lookup.test.ts` |
| `ExpensesPage` — campo UUID → escolha | `apps/web/src/finance/pages/ExpensesPage.tsx` |
| `TaxAssessmentsPage` — idem | `apps/web/src/fiscal/pages/TaxAssessmentsPage.tsx` |
| `ProcurementPages` (conferência **e** nota) — idem | `apps/web/src/procurement/pages/ProcurementPages.tsx` |
| `BudgetsPage` — período contábil por escolha, com escopo de unidade | `apps/web/src/finance/pages/BudgetsPage.tsx` |

**Cinco** consumidores que antes digitavam UUID agora escolhem de uma lista publicada pelo servidor.

---

## Registro de execução

| Data | Commit | Módulo | Resultado |
| --- | --- | --- | --- |
| 2026-11-05 | (este) | **MASTER-003 A/B** | Centro de custo (migration 0118 + tabela + listagem + `assertExists`) e categoria de despesa (`GET` que faltava). 4 consumidores saíram do UUID digitado para `HumanLookupField`. Testes: cost-center 10/10, expense-category 9/9, payables 15/15, expense-management 9/9; web focado 217/217 em 38 arquivos; API unit 1905/1905 em 296 arquivos; gate de banco fresh+incremental PASS; gate de scripts PASS |
| 2026-11-05 | (este) | **MASTER-003 C–H** | Verificação no CÓDIGO (não na documentação): C (`accounting/periods`), D (`bank-statements`), E (`payroll/periods` + `payroll/contracts`), F (`tax-assessments`), G (`PATCH contracts/:id` → `updateDraft`) **já estavam implementados e cobertos** — nada foi criado para evitar caminho paralelo. H permanece **PARK** por decisão de gating de produto, não por falta de código |
| 2026-09-25 | — | inventário | matriz criada; fila definida |
| 2026-09-26 | (este) | suppliers | `GET /api/v1/suppliers` (busca/status/paginação) + concessão `supplier:supplier:list`; web: lista + criação + detalhe sem identificador digitado; rota `/app/suppliers` que **não existia** (deep link caía em página não encontrada). Backend 9/9; web 4/4; shell 17/17; browser real 4/4 (desktop+mobile) |
| 2026-09-26 | (este) | procurement | `GET procurement/requests`, `GET procurement/orders`, `GET supplier-invoices` (busca/status/paginação + concessões `*:list`); fornecedor e CNPJ resolvidos pelo servidor no pedido e na nota; web: hub com três listas reais, criação de solicitação em rota própria, campo de identificador do fornecedor substituído por `HumanLookupField`. Backend 10/10; web 7/7 (hub + lookup); shell 17/17; browser real 4/4 (desktop+mobile) |
| 2026-09-26 | (este) | inventory | `GET inventory/warehouses|items|movements|reservations` (busca/status/tipo/paginação, depósito e item resolvidos por código/nome/SKU + concessões `*:list`); web: hub com quatro listas, detalhe de item (saldo, movimentos, movimentar/reservar/estornar por escolha) e detalhe de depósito; `unitId` derivado do depósito escolhido. Backend 7/7; web 3/3; shell 17/17; catch-up 9/9; browser real 4/4 (desktop+mobile) |
| 2026-09-26 | (este) | filtros de cliente | `HumanLookupField` + `searchClientOptions` substituem o campo "UUID do cliente" em OS, pedidos de compra e contratos (frontend apenas; a listagem de Clientes já existia). Também corrigido teste obsoleto do shell de OS que exigia links de etapa substituídos pela próxima ação. Testes afetados: OS list 3/3, PO 4/4, contratos 2/2 |
| 2026-09-26 | (este) | fronteira de contexto + testes obsoletos | As listas de Compras resolviam o fornecedor por junção direta com `pty.suppliers`, violando `module-boundary-rules` (PROCUREMENT lendo tabela privada do contexto Comercial). Corrigido pelo caminho correto: port `CommercialSupplier` ganhou `findReferencesByIds` e `searchIdsByTerm`, implementados no contexto dono; a referência humana e o filtro por nome/CNPJ passam a atravessar a fronteira pelo port. Também corrigidos dois testes obsoletos: `service-requests-access.characterization` (mocks sem os colaboradores atuais) e `assets.e2e` (esperava "disponível" para ativo com alocação vigente). API unit 1014/1014 (220 arquivos); integração focada 33/33; web 618/618 |
| 2026-09-26 | `?` (fast closure) | finance/expenses | Sem **rota** alguma: `/app/finance/expenses` não existia e a despesa só era alcançável por identificador. `GET finance/expenses` (busca, status, paginação) + concessão `finance:expense:list`; rotas lista/cadastro/detalhe, item de navegação, volta para a lista no detalhe. Web focado 3/3 |
| 2026-09-26 | `?` (fast closure) | finance/budgets | Mesmo defeito: `/app/finance/budgets` sem rota. `GET finance/budgets` (busca, status, paginação) + concessão `finance:budget:list`; rotas lista/cadastro/detalhe + navegação |
| 2026-09-27 | `fefa4b8` | gates obsoletos | Suite web estava **671/672**: `frontend-resilience.ui.test.tsx` exigia `Ver lista filtrada` no bloco de atenção do dashboard, rótulo substituído por `resolveAttentionAction` (verbo de gestão por tipo de item). Asserção atualizada de forma estrita, sem afrouxar verificação. No mesmo commit, dois gates já verificados que estavam **sem commit** na árvore: `report-authz-negative.e2e` (sem `FEATURE_MODULE_REPORTS` o `ReleaseScopeGuard` global respondia 403 FEATURE_DISABLED em toda rota `/reports` e mascarava 401/403/400/200; e2e 6/6) e `truncateServiceOrderTables` (faltava limpar `com.purchase_order_consumption_entries`, que referencia `bil.billing_records` com `ON DELETE RESTRICT` e derrubava o `beforeEach` do suite inteiro) |
| 2026-09-27 | `4b3d8c2` | operator / conciliação | Removidos `view.reconciliation.unmatched` e `view.reconciliation.review`: apontavam para `/app/finance/reconciliation?matchStatus=...`, mas a tela é bancada de consulta por identificador de extrato e **não lê search params** — filtro prometido no Ctrl+K e descartado em silêncio na chegada. Filtro real exigiria `GET statements` (inexistente) → `PARK: SILENT_FILTER_GAP` documentado no próprio registry. Navegação segue por `nav:/app/finance/reconciliation`. Operator focado 28/28 |

### PARK — SILENT_FILTER_GAP (comando Ctrl+K prometia filtro não suportado pela tela)

| Comando | Tela | Motivo | Ação |
| --- | --- | --- | --- |
| `view.reconciliation.unmatched` | `/app/finance/reconciliation` | tela não lê `matchStatus`; sem listagem de extratos no backend | removido; não reintroduzir sem filtro real |
| `view.reconciliation.review` | `/app/finance/reconciliation` | idem | removido; não reintroduzir sem filtro real |

### PARK — HUMAN_LOOKUP_API_GAP (sem listagem no backend; não inventar)

| Entity | Consumidor | Situação |
| --- | --- | --- |
| Extrato bancário | finance/bank-reconciliation | **RESOLVIDO** — `GET bank-statements` publica listagem com filtro server-side |
| Movimento financeiro / transação | finance/bank-reconciliation, treasury | `GET accounts/:accountId/reconciliation` + `POST .../movements`; vínculo manual por id permanece |
| Documento de origem (UUID) | finance/treasury | **RESOLVIDO** — tipo de origem escolhido + título por `HumanLookupField` |
| Centro de custo (id) | procurement, fiscal, finance/expenses | **RESOLVIDO** — migration 0118 + `GET finance/cost-centers` + `HumanLookupField` nos 4 consumidores |
| Categoria de despesa (id) | procurement, finance/expenses | **RESOLVIDO** — `GET finance/expense-categories` + `HumanLookupField` |
| Período de folha | payroll | **RESOLVIDO** — `GET payroll/periods` e `GET payroll/contracts` já existiam; o PARK estava incorreto |
| Cálculo tributário (apuração) | fiscal/apuração | **RESOLVIDO** — `GET tax-assessments` já existia; o PARK estava incorreto |
| Registro de ativo imobilizado | accounting/fixed-assets | **RESOLVIDO na rodada MASTER-003 (4ª frente)** — `GET accounting/fixed-assets?unitId=X` agora LISTA; com `operationalAssetId` mantém a consulta por ativo (contrato anterior intacto) | FECHADO |
| Pessoa jurídica / estabelecimento | issuer/establishments | backend completo; **gating não decidido** — PARK mantido por decisão de produto |
