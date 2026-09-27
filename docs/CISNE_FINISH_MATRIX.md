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
| purchase-orders (cliente) | Y | Y | Y | Y | Y | UUID | Y | Y | Y | Y | Y | Y | Y | BASIC_GAP | filtro de cliente por lookup humano |
| contracts | Y | Y | Y | Y | - | UUID | Y | Y | Y | Y | Y | Y | Y | BASIC_GAP | filtro de cliente por lookup humano |
| assets | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — (0a55810, 9d2ce38) |
| service-orders | Y | Y | Y | Y | Y | UUID | Y | Y | Y | Y | Y | Y | Y | BASIC_GAP | filtro de cliente por lookup humano |
| measurements | Y | Y | Y | Y | Y | N/A | N/A | Y | Y | Y | Y | Y | Y | DONE | — (superfície via OS) |
| billing | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| documents | Y | Y | Y | Y | N/A | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| **suppliers** | Y | Y | Y | Y | Y | Y | Y | Y | Y | parcial | Y | Y | Y | **DONE** | relações (pedido/nota/payable) — não bloqueia o básico |
| **procurement** | Y | Y | Y | Y | - | Y | Y | Y | Y | Y | Y | Y | Y | **DONE** | editar requisição pendente; centro de custo/categoria (PARK: HUMAN_LOOKUP_API_GAP) |
| **inventory** | Y | Y | Y | Y | - | Y | Y | Y | Y | Y | Y | Y | Y | **DONE** | centro de custo/categoria (PARK); edição de depósito/item inexistente no backend |
| people | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| finance (AR/AP/treasury/recon) | Y | Y | Y | Y | Y | Y | Y | UUID | Y | Y | Y | Y | Y | BASIC_GAP | despesa/orçamento/conciliação/tesouraria: UUID → lookup |
| accounting | Y | Y | Y | Y | Y | Y | Y | UUID | Y | Y | Y | Y | Y | BASIC_GAP | ativo fixo/lançamento: UUID → lookup |
| fiscal | Y | Y | Y | Y | - | Y | Y | UUID | Y | Y | Y | Y | Y | BASIC_GAP | apuração/centro de custo: UUID → lookup |
| payroll | Y | Y | Y | Y | - | Y | Y | UUID | Y | Y | Y | Y | Y | BASIC_GAP | período: UUID → lookup |
| fleet | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| resources | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| alerts | Y | Y | Y | N/A | N/A | Y | Y | Y | Y | Y | Y | Y | Y | DONE | — |
| reports | Y | Y | Y | N/A | N/A | Y | Y | Y | N/A | Y | Y | Y | Y | DONE | — |
| search | Y | Y | N/A | N/A | N/A | Y | Y | Y | N/A | Y | Y | Y | Y | DONE | — |
| access-admin | Y | Y | Y | Y | Y | Y | Y | parical | Y | Y | Y | Y | Y | DONE | âncoras de escopo são técnicas por natureza |
| issuer/establishments | Y | **-** | Y | Y | Y | - | - | - | Y | - | Y | Y | **-** | **BASIC_GAP** | backend completo sem superfície web (entidade sem lista/detalhe) |
| rentals | Y (lista) | Y | - | - | - | - | - | Y | N/A | - | Y | Y | Y | PARK | OUT_OF_RELEASE_1 — coberto por Catálogo+OS+Recursos+Execução |
| transport | Y (lista) | Y | - | - | - | - | - | Y | N/A | - | Y | Y | Y | PARK | OUT_OF_RELEASE_1 — coberto por Catálogo+OS+Recursos+Execução |
| maintenance | - | - | - | - | - | - | - | - | - | - | - | spec | - | PARK | sem modelo local — BACKEND_ABSENT |
| vertical / synthetic-seed / uat | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Y | N/A | PARK | harness de teste, não superfície de produto |

---

## Itens human-lookup bloqueados por backend (PARK: HUMAN_LOOKUP_API_GAP)

Registrados aqui; **não** substituir por input livre nem por carga massiva no navegador.

| Item | Consumidor | Motivo | Status |
| --- | --- | --- | --- |
| Centro de custo (id) | procurement receive, supplier-invoice, fiscal tax-assessment, finance expenses | Sem endpoint de listagem de centro de custo no backend local | ABERTO |
| Categoria de despesa (id) | procurement receive, supplier-invoice validate | Existe `POST finance/expense-categories`, mas **não** existe listagem | ABERTO |
| Documento de origem (UUID) | finance treasury | Identificador da autorização de origem; sem endpoint de listagem | ABERTO |
| Período (id) | finance budgets, fiscal apuração | Período contábil/fiscal sem endpoint de listagem por contexto | ABERTO |

---

## Ordem de ataque (ajustada por impacto operacional)

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

## Registro de execução

| Data | Commit | Módulo | Resultado |
| --- | --- | --- | --- |
| 2026-09-25 | — | inventário | matriz criada; fila definida |
| 2026-09-26 | (este) | suppliers | `GET /api/v1/suppliers` (busca/status/paginação) + concessão `supplier:supplier:list`; web: lista + criação + detalhe sem identificador digitado; rota `/app/suppliers` que **não existia** (deep link caía em página não encontrada). Backend 9/9; web 4/4; shell 17/17; browser real 4/4 (desktop+mobile) |
| 2026-09-26 | (este) | procurement | `GET procurement/requests`, `GET procurement/orders`, `GET supplier-invoices` (busca/status/paginação + concessões `*:list`); fornecedor e CNPJ resolvidos pelo servidor no pedido e na nota; web: hub com três listas reais, criação de solicitação em rota própria, campo de identificador do fornecedor substituído por `HumanLookupField`. Backend 10/10; web 7/7 (hub + lookup); shell 17/17; browser real 4/4 (desktop+mobile) |
| 2026-09-26 | (este) | inventory | `GET inventory/warehouses|items|movements|reservations` (busca/status/tipo/paginação, depósito e item resolvidos por código/nome/SKU + concessões `*:list`); web: hub com quatro listas, detalhe de item (saldo, movimentos, movimentar/reservar/estornar por escolha) e detalhe de depósito; `unitId` derivado do depósito escolhido. Backend 7/7; web 3/3; shell 17/17; catch-up 9/9; browser real 4/4 (desktop+mobile) |
