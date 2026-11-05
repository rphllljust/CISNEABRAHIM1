# CISNE — Benchmark operacional ERP Tier 1 e matriz única dos 16 módulos

**Programa:** MASTER 001, adendo de entrega integrada e benchmark ERP Tier 1.  
**Base inspecionada:** `main@04a5b22718b2a19960e35bb4ead2d4ad44235558` (2026-11-04).  
**Branch de integração:** `erp-tier1-full-delivery`.  
**Release:** único; proibição de promover módulos isolados.  
**Situação deste registro:** auditoria de código **parcial**, sem validação visual autenticada da aplicação atual nem HML/produção. Este arquivo não constitui aceite.

## 1. Padrões públicos de comparação

| Referência | Capacidades a comparar, não aparência para copiar | Fontes públicas |
|---|---|---|
| SAP Fiori | List Report + Object Page como par, Worklist para tratamento de trabalho, Analytical List Page para visão KPI/gráfico/tabela ligada a drilldown; filtros/variantes com contexto de navegação; ações e estado de registro | [SAP Fiori elements](https://www.sap.com/design-system/fiori-design-web/v1-142/discover/frameworks/sap-fiori-elements), [SAP Learning](https://learning.sap.com/courses/learning-the-basics-of-sap-fiori/explaining-sap-fiori-development_e7330fcf-e183-495b-8485-1b53b23595d6), [Variants](https://help.sap.com/docs/ABAP_PLATFORM_NEW/468a97775123488ab3345a0c48cadd8f/8ce658e05498466d9a74823b94e840ac.html) |
| Dynamics 365 Finance & Operations | Workspace por função; lista de tarefas, tiles e links que respeitem filtros e visões salvas; personalização, página de contexto e foco na execução | [Operational workspaces](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/build-workspaces), [Personalize the user experience](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/get-started/personalize-user-experience) |
| Oracle Fusion / Redwood | Jornada orientada ao contexto do objeto, ações e orientação vinculadas ao processo, conteúdo de seção e acessibilidade; não presumir que guided journeys estejam disponíveis em todo módulo | [Oracle Guided Journeys](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/faicf/guided-journeys.html), [Redwood Context Parameters](https://docs.oracle.com/en/cloud/saas/readiness/hcm/26b/hure-26b/26B-hr-wn-f43664.htm) |

**Escopo do benchmark:** reproduzir padrões de trabalho mediante implementação original React/NestJS/PostgreSQL, sem copiar código, ícones, branding ou componentes licenciados de terceiros.

## 2. AS-IS verificável versus TO-BE por módulo

AS-IS abaixo declara **somente indícios concretos observados na árvore e em arquivos do repositório**, não prova de completude. Por exemplo: um diretório existente não comprova que o fluxo funciona. Todos os critérios só passam quando backend, persistência, segurança, UI, teste e HML tiverem evidência no **mesmo SHA candidato**.

| # | Módulo | AS-IS visto no código | TO-BE: diferença que precisa ser comprovada | Aceite técnico a anexar |
|---|---|---|---|---|
| 01 | Central Empresarial P0 | `apps/web/src/dashboard/`, `work-inbox/`; `apps/api/src/dashboard/`, `work-inbox/` | Workspace por função, filas/SLAs/bloqueios com evidência do backend, saved views e comando com atualização do contexto; padrão Dynamics Workspaces + Fiori Worklist | Fila autorizada -> objeto -> comando -> fila reconciliada e KPI de fonte única |
| 02 | Clientes 360° P0 | `apps/web/src/clients/`, `apps/api/src/clients/`, `Client360ExecutivePanel`; existe navegação de relacionamentos e contexto financeiro | Object Page com contratos/OS/documentos/financeiro/histórico, decisões e drilldown filtrado com contexto, sem contador inferido | Navegar em cada vínculo com `clientId`, mesmo conjunto no backend e sem exposição quando 403 |
| 03 | Solicitações P1 | `apps/web/src/requests/`, `apps/api/src/requests/` | List Report + Object Page de ciclo real de triagem, responsável, SLA, aprovação, conversão e origem | Da solicitação à conversão e resultado persistido; auditoria e precondições |
| 04 | Propostas e Contratos P1 | `apps/web/src/proposals/`, `contracts/`, `apps/api/src/commercial/` | Workbench de versões/aceite/vigência e execução, propagação de obrigação de contrato à OS | Abertura de proposta -> contrato -> OS por IDs autoritativos |
| 05 | Ordens de Serviço P0 | `apps/web/src/service-orders/`, `apps/api/src/service-orders/` | Worklist/Object Page/Workbench com planejamento, recursos, execução, medição, custo físico × monetário, faturamento e next action derivado do servidor | OS 360 até o fato econômico; conflito 409, versão, grants e recálculo após comando |
| 06 | Pessoas P1 | `apps/web/src/people/`, `apps/api/src/people/` | Pessoa 360° de elegibilidade, disponibilidade e participação, proteção de dados e alocação | Pessoa elegível -> alocação -> OS -> histórico, com escopo e consentimentos pertinentes |
| 07 | Ativos e Frota P1 | `apps/web/src/assets/`, `fleet/`; `apps/api/src/resources/` | Objetos 360° e reserva de recurso autoritativa, restrições, custos e manutenção sem duplicar cadastros | Reserva -> OS -> liberação, concorrência e rastreio por ativo |
| 08 | Locações e Transporte P1 | `apps/web/src/rentals/` e `transport/`; `feature-flags.ts` classifica ambos como `STUB_MODULES` | **Lacuna funcional comprovada:** desenvolver backend autorizado e workbench apoiado no ciclo atual de OS, sem inventar segundo motor | Contratação/dispatch -> execução -> medição -> resultado econômico. Até então NO-GO |
| 09 | Catálogo P1 | `apps/web/src/catalog/`, `apps/api/src/catalog/` | Versionamento/publicação/comparação de versões e preservação de snapshot da OS | Revisão do serviço não modifica OS histórica; teste em PostgreSQL |
| 10 | GED P1 | `apps/web/src/documents/`, `apps/api/src/documents/` | Serviço transversal de versão, metadado, download em lote, acesso por registro e trilha; OCR opcional | Anexação/autorização/vínculo por cliente, pessoa, ativo, contrato e OS |
| 11 | Compras e Estoque P0 | `apps/web/src/procurement/`, `inventory/`; módulos homônimos API | Procure-to-Pay, recebimento e reconciliação de quantidades, custo, título, consumo e 3-way-match quando aplicável | Requisição -> PO -> recebimento -> estoque -> payable, comprovado com integridade e auditoria |
| 12 | Financeiro P0 | `apps/web/src/finance/`, `apps/api/src/finance/` | Workbench de payables/receivables/tesouraria/conciliação, multi-moeda e aging com drillback e precision decimal | Evento financeiro -> movimento persistido -> conciliação -> origem, sem duplicidade |
| 13 | Fiscal P0 | `apps/web/src/fiscal/`, `apps/api/src/fiscal/` | Documentos, autorizações e apurações baseadas em regras validadas; integração com fatura e contabilidade | Documento -> evento fiscal -> obrigação autorizada; sem alíquota inventada |
| 14 | Contabilidade P0 | `apps/web/src/accounting/`, `apps/api/src/accounting/` | Subledger, double-entry, diário, razão, reconciliação e fechamento controlado por fatos e regras versionadas | Fato econômico -> lançamento balanceado -> relatório reconciliado; bloqueadores reais |
| 15 | Folha P1 | `apps/web/src/payroll/`, `apps/api/src/payroll/` | Eventos por competência, aprovação, custo de pessoa e obrigações/integração, somente regras trabalhistas confirmadas | Período -> processamento autorizado -> título/subledger, quando fontes legais aprovadas |
| 16 | Relatórios e BI P1 | `apps/web/src/reports/`, `analytics/`; `apps/api/src/reports/`, `analytics/`; catálogo `semantic-dashboard.ts` | Analytical List Page com KPI autoritativo, filtros, período, fonte, atualização, exportação e drilldown com mesmo escopo | Total do relatório reconcilia com query autoritativa e origem transacional |

## 3. Correções reais já registradas nesta branch

| Commit | Caminhos | Resultado comprovável pelo objeto Git | Testes ainda necessários |
|---|---|---|---|
| `eae7805abae441a7ae9ed1df36561f5d0bedbae9` | `clients/components/Client360ExecutivePanel.tsx`, `clients/hooks/useClientRelatedRecords.tsx`, teste da ficha | Navegação por links filtrados `clientId`, uso de `summary.recordCount` de PO e `total` de OS quando existentes, sem fabricar `count` | Web unitário/contrato + navegação real no Chrome |
| `fb1d6364816fa43ba6c48a2bceba382299c9b4f9` | Probes e rotas de Clientes/Propostas/Capability, teste de regressão | Erros de rede/5xx exibem recuperação em vez de redirecionar falsamente como 403 | Typecheck/lint/Vitest/Chrome, verificar autenticação real |

**Critério de registro:** objeto Git confirmado não equivale a teste PASS; teste escrito não equivale a executado. Não indicar `100%` para nenhuma capacidade por esses commits.

## 4. Matriz única de evidências (não inventar percentual)

Estado inicial desta matriz em **04/11/2026**, antes dos gates de qualquer candidata unificada:

| Módulo | Implementação integral | Integração transversal | Testes no SHA candidato | Homologação HML |
|---|---|---|---|---|
| 01 Central | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 02 Clientes | PARCIAL — commits acima | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 03 Solicitações | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 04 Propostas e Contratos | PARCIAL — gate de rota | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 05 OS | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 06 Pessoas | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 07 Ativos e Frota | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 08 Locações e Transporte | BLOQUEADO: stub | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 09 Catálogo | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 10 GED | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 11 Compras e Estoque | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 12 Financeiro | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 13 Fiscal | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 14 Contabilidade | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 15 Folha | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |
| 16 Relatórios e BI | NÃO VALIDADO | NÃO VALIDADO | NÃO EXECUTADO | NÃO EXECUTADA |

`NÃO VALIDADO` significa ausência de evidência integral para o programa, **não** que todo o código do módulo esteja ausente. Nenhuma porcentagem deve ser extraída de contagem de arquivos, commits, telas ou itens da página.

## 5. Cinco provas empresariais obrigatórias

- **A. Service-to-Cash:** Solicitação -> Proposta -> Contrato -> OS -> Medição/Aceite -> Billing -> Fiscal -> AR -> Tesouraria -> Contabilidade.
- **B. Procure-to-Pay:** Requisição -> Autorização -> PO -> Recebimento -> Estoque/Despesa -> AP -> Pagamento -> Contabilidade.
- **C. Resource-to-Service:** Pessoa/Ativo/Frota -> elegibilidade -> reserva -> OS -> execução -> consumo/custo -> liberação.
- **D. Document-to-Evidence:** GED -> versão e autorização -> vínculo -> operação -> auditoria; falha de acesso nunca expõe documentos.
- **E. Record-to-Report:** transação -> read model -> KPI -> lista sob filtro equivalente -> objeto original, com mesma regra de escopo e total.

Cada prova deve registrar IDs, timestamps, usuário/escopo, status antes/depois, `rowVersion`, operação, banco, logs saneados, testes e prints desktop/mobile; remover dados pessoais das evidências.

## 6. Qualidade, convergência e liberação

Os gates precisam cobrir lint, typecheck, build de API/Web/Worker, contratos, domínio, PostgreSQL Integration, API E2E, Chromium, Visual Critical/Full, segurança, HML real, revisão de migrations/rollback e validação de produção. `SKIP`, `CANCELLED`, `N/A` e falha não são PASS.

**Bloqueios identificados:** Locações e Transporte aparecem como stub; decisões de negócio em `docs/01-foundation/domain-decisions-pending.md` permanecem abertas; o GitHub connector demonstra alterações remotas, mas não fornece working tree local, `git status`, Vitest/Playwright executados ou evidência de deploy.

**Fluxo autorizado:** commits técnicos na branch única -> revisão e um PR de release integral -> gates -> merge na `main` -> imagens imutáveis GHCR -> deploy exclusivamente no Coolify -> smoke, TLS, browser e aceite produtivo. Não publicar na Railway, não inserir dados fictícios em produção, não contornar os gates.

**Condição de conclusão:** 16/16 critérios de módulo comprovados + 5/5 jornadas aprovadas + gates completos no mesmo SHA + PR integrado + produção no Coolify comprovada; caso contrário permanecer NÃO VALIDADO e não declarar percentual de entrega fictício.
