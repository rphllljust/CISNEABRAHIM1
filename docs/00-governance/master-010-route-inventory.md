# MASTER 010 — inventário estático de rotas e rastreabilidade de correção

**Data:** 2026-11-05 · **Base SHA:** `f9147c8396f8795e03dfc931f3557a65e0fbaa40` · **Branch:** `fix/master-010-filter-layout-state`

**Origem do inventário:** expressões `<Route path="…">` no código de `apps/web/src/AppRoutes.tsx`, sem inferir rotas de outras árvores ou configurações. São **137 declarações**, **136 caminhos distintos** (130 rotas `/app`); a rota curinga `*` aparece 2 vezes por contextos de roteamento diferentes. Inventário estático não é auditoria visual ou funcional.

**GATE MASTER 010:** `NO-GO`. Não existe prova de Playwright por esta entrega para todos os viewports, módulos, estados e jornadas. `CÓDIGO ALTERADO` não é sinônimo de `PASS`.

| Rota | Estado da investigação | Defeito constatado na origem | Correção registrada | Teste / evidência |
| --- | --- | --- | --- | --- |
| `*` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/access-denied` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/access-admin` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/balancete` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/balanco` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/chart` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/closing` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/diario` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/dre` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/economic-posting` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/economic-trace/:factKind/:factId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/fechamentos` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/fixed-assets` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/fixed-assets/:registerId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/journals` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/journals/:journalId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/origens` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/accounting/razao` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/admin/metadata` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/admin/view-lab` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/alerts` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/assets` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/assets/:assetId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/assets/:assetId/edit` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/assets/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/billing` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/catalog` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/catalog/:definitionId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/catalog/:definitionId/compare` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/catalog/:definitionId/versions/:versionNumber` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/catalog/:definitionId/versions/:versionNumber/edit` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/catalog/:definitionId/versions/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/catalog/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/clients` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/clients/:clientId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/clients/:clientId/edit` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/clients/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/closing` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/contracts` | Inspecionada parcialmente (código) | Filtros de estado, pesquisa, datas e avançado ignorados por `hasActiveFilters`; reset recriava `clientId` | `ContractsListPage` + `WorkspaceToolbar` + `WorklistField` | Testes novos; CI, visual, HML e operação real pendentes |
| `/app/contracts/:contractId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/contracts/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/documents` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/budgets` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/budgets/:budgetId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/budgets/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/expenses` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/expenses/:expenseId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/expenses/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/forecast` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/payables` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/payables/:payableId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/receivables` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/receivables/:receivableId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/reconciliation` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/reconciliation/:statementId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/treasury` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/finance/treasury/:accountId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/apuracao` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/apuracao/:calculationId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/assessments` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/assessments/:assessmentId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/documents` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/documents/:fiscalDocumentId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/periods` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/periods/:periodId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/tributos` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fiscal/tributos/:taxRuleId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/fleet` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/inventory` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/inventory/items/:itemId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/inventory/warehouses/:warehouseId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/measurement` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/measurement/revenue-leakage` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/modules` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/no-access` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/operational-profitability` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/operations/dispatch` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/operations/execution` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/payroll` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/payroll/periods/:periodId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/people` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/people/:personId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/people/:personId/edit` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/people/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/platform` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/procurement` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/procurement/invoices` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/procurement/invoices/:invoiceId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/procurement/matches/:matchId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/procurement/orders/:orderId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/procurement/requests/:requestId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/procurement/requests/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/proposals` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/proposals/:proposalId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/proposals/:proposalId/edit` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/proposals/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/purchase-orders` | Inspecionada parcialmente (código) | Mesma divergência de filtros; resultado de requisição antiga podia prevalecer sobre filtro novo | `PurchaseOrdersListPage` + moldura compartilhada; geração de requisições | Testes novos; CI, visual, HML e operação real pendentes |
| `/app/purchase-orders/:purchaseOrderId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/purchase-orders/:purchaseOrderId/edit` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/purchase-orders/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/rentals` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/reports` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/reports/compliance` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/requests` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/requests/:serviceRequestId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/requests/:serviceRequestId/edit` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/requests/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/search` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/:serviceOrderId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/:serviceOrderId/billing` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/:serviceOrderId/billing/document` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/:serviceOrderId/execution` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/:serviceOrderId/measurement` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/:serviceOrderId/measurement-workbench` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/:serviceOrderId/planning` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/:serviceOrderId/workbench` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/service-orders/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/suppliers` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/suppliers/:supplierId` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/suppliers/new` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/transport` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/work-inbox` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/workspaces` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/workspaces/comercial` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/workspaces/contabilidade` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/workspaces/financeiro` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/workspaces/fiscal` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/workspaces/operacoes` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/app/workspaces/suprimentos` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/login` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/session-expired` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |
| `/unavailable` | **PENDENTE** | Não identificado / não presumir ausência | Não há alteração de página comprovada nesta rodada | Gate visual e funcional não executado |

## Lacunas e critérios de aceite

- Conferir também rotas registradas por `*Route` e configuração dinâmica que não estejam nesse inventário.
- Rastrear por rota: layout, filtros, indicadores, estados vazios, chamadas API, autorização, unidade operacional, banco e comandos; cada item exige evidência distinta.
- Executar em 390/768/1440/1920 px, com perfis autorizados/restritos, base sem dados e base real, sem gerar dados fictícios.
- Registrar por rota: defeito, causa, arquivo, teste automatizado, evidência visual antes/depois, fonte dos KPIs, estado HML e estado produção.
- Bloquear entrega enquanto rotas não auditadas, falhas e gates pendentes existirem. Não transferir `DONE` de matriz de funcionalidade para `PASS` de aceite visual.

**Cobertura declarada deste registro:** 2 rotas tiveram inspeção de código e alterações, mas **nenhuma rota recebeu aprovação visual ou operacional MASTER 010**. Os demais 134 caminhos aguardam investigação. Isso não revoga testes históricos válidos; apenas evita reaproveitar provas sem vínculo com o SHA desta entrega.
