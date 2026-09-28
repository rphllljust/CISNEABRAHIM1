# LEGACY_SURFACE_DEBT — superfícies fora do contrato de interação

Registro aberto em 2026-09-27 (BIG WAVE 04D). Este arquivo existe para que a dívida visual
remanescente seja **priorizada**, e não varrida às cegas numa refatoração global.

Classificação: **dívida de interação** — telas que ainda pertencem à família antiga
(`button-row`, `button-link`, `shell-page`, `form-hint`, `form-error`) e que por isso não
parecem ter sido feitas pela mesma equipe das object pages canônicas.

## Contrato a aplicar

Primitivos compartilhados (não criar uma segunda biblioteca):

| Primitivo | Arquivo | Papel |
| --- | --- | --- |
| `BuilderSection` | `apps/web/src/ui/builder.tsx` | Seção com título, descrição curta e ação **da própria seção** |
| `BuilderSummary` | `apps/web/src/ui/builder.tsx` | Faixa compacta com o resumo da edição corrente (nunca KPI inventado) |
| `CollectionEditor` | `apps/web/src/ui/builder.tsx` | Repetidor único, remoção discreta com nome acessível e confirmação |
| `StickyActionBar` | `apps/web/src/ui/builder.tsx` | Área de ação fixa; a ação principal não se perde no fim da página |
| `CurrencyField` | `apps/web/src/ui/CurrencyField.tsx` | Dinheiro com normalização única, BRL na leitura e erro inline |
| Guarda P0 | `apps/web/src/ui/accessible-controls.test.ts` | Falha o build se algum controle interativo nascer sem nome acessível |

## Já convertido (não reabrir sem motivo)

- Catálogo de serviços: criação, rascunho e nova versão (`apps/web/src/catalog/**`).
- Criação/edição comercial: proposta, pedido de compra, solicitação.
- Cadastros: ativo físico e pessoa (criação/edição).

## Inventário remanescente (42 arquivos com padrão legado)

Ordenado por concentração do padrão antigo. Contagem = ocorrências de
`button-row|button-link|shell-page|catalog-page|form-hint|form-error`.

| Ocorrências | Arquivo | Observação |
| --- | --- | --- |
| 14 | `catalog/pages/ServiceDefinitionDetailPage.tsx` | Object page de catálogo ainda na família antiga |
| 9 | `requests/pages/ServiceRequestDetailPage.tsx` | Detail ainda não migrado |
| 9 | `clients/pages/ClientEditPage.tsx` | Edição de cliente (a object page já é canônica) |
| 8 | `service-orders/pages/ServiceOrderPlanningPage.tsx` | Object page canônica, casca legada |
| 7 | `clients/pages/ClientCreatePage.tsx` | Criação — candidato direto ao contrato |
| 7 | `catalog/pages/ServiceDefinitionVersionDetailPage.tsx` | Versão de catálogo |
| 7 | `contracts/pages/ContractsDetailPage.tsx` | Contratos inteiro fora do contrato |
| 7 | `requests/pages/ServiceRequestEditPage.tsx` | Edição de solicitação |
| 6 | `assets/pages/PhysicalAssetEditPage.tsx` | Casca legada remanescente |
| 5 | `purchase-orders/pages/PurchaseOrderEditPage.tsx` | Casca legada remanescente |
| 5 | `purchase-orders/pages/PurchaseOrderDetailPage.tsx` | Detail |
| 5 | `proposals/pages/ProposalEditPage.tsx` | Casca legada remanescente |
| 5 | `billing/pages/ServiceOrderBillingPage.tsx` | Workbench de faturamento |
| 5 | `service-orders/pages/ServiceOrderMeasurementPage.tsx` | Workbench de medição |
| 5 | `billing/pages/ServiceOrderBillingDocumentPage.tsx` | Documento de faturamento |
| 4 | `people/pages/PersonEditPage.tsx` | Casca legada remanescente |
| 4 | `requests/pages/ServiceRequestCreatePage.tsx` | Casca legada remanescente |
| 4 | `proposals/pages/ProposalCreatePage.tsx` | Casca legada remanescente |
| 4 | `assets/pages/PhysicalAssetDetailPage.tsx` | Detail |
| 4 | `purchase-orders/pages/PurchaseOrderCreatePage.tsx` | Casca legada remanescente |
| 4 | `billing/pages/BillingDashboardPage.tsx` | Entrada de faturamento |
| 3 | `people/pages/PersonDetailPage.tsx`, `people/pages/PersonCreatePage.tsx`, `catalog/pages/ServiceDefinitionComparePage.tsx`, `contracts/pages/ContractsCreatePage.tsx`, `clients/pages/ClientDetailPage.tsx`, `assets/pages/PhysicalAssetCreatePage.tsx` | Cascas legadas remanescentes |
| 2 | `service-orders/components/OccurrenceForm.tsx`, `service-orders/components/ExecutionActivityPanel.tsx`, `finance/pages/ReceivableDetailPage.tsx` | Formulários/painéis |
| 1 | `shell/ShellErrorBoundary.tsx`, `clients/components/ConfirmDialog.tsx`, `pages/AppHomePage.tsx`, `pages/ShellNotFoundPage.tsx`, `pages/PlatformDiagnosticsPage.tsx`, `pages/ShellAccessDeniedPage.tsx`, componentes de form já migrados | Resíduos de classe isolada |

Além das classes, existem **125 ocorrências de `<button>` cru** (sem o primitivo `Button`) no
`apps/web/src`. Elas não são todas defeito: parte é controle nativo legítimo. A regra é migrar
para o primitivo quando a tela já estiver sendo convertida — não varrer por conta própria.

## Ordem de propagação sugerida

1. **Detalhes que já são object page canônica mas mantêm casca legada** — `ServiceOrderPlanningPage`,
   `PhysicalAssetDetailPage`, `PurchaseOrderDetailPage`, `PersonDetailPage`, `ClientDetailPage`:
   troca de moldura, sem tocar em regra.
2. **Criações/edições restantes** — `ClientCreatePage`, `ClientEditPage`, `ContractsCreatePage`,
   `ContractsDetailPage`.
3. **Workbenches** — `ServiceOrderMeasurementPage`, `ServiceOrderBillingPage`,
   `BillingDashboardPage`, `BillingDocumentPage`.
4. **Catálogo (detalhes)** — `ServiceDefinitionDetailPage`, `ServiceDefinitionVersionDetailPage`,
   `ServiceDefinitionComparePage`.
5. **Resíduos** — classes soltas em `shell/**` e `pages/**`.

## Critério de parada

Uma tela só entra nesta fila quando a adoção for **barata e segura** com os primitivos atuais.
Se a conversão exigir primitivo novo ou mudança de contrato de API, ela **não** deve ser feita
dentro de uma onda de padronização: vira item próprio, com fonte e decisão registradas.
Não criar segunda biblioteca de componentes.
