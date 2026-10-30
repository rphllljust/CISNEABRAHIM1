# CISNE ENTERPRISE-001 — Vertical Contrato 360 ↔ OS 360 ↔ Work Inbox ↔ KPI

Baseline: `main@1082ad66711fa9bdcb050bfe90b3df672c8e85cb`
Classificação: **interpretação de engenharia + evidência de código**, não sign-off empresarial.
Ordem: ENTERPRISE TIER 1 / MASTER 001, incremento vertical 01.
Status: **IMPLEMENTED IN BRANCH / VERIFICATION PENDING** até execução dos gates e revisão.

## Decisão arquitetural

Estender a Work Inbox e o monólito modular existentes, **sem** segunda fila, migration ou alteração de contratos HTTP. O PR #151 já integrou Contract 360 ↔ OS 360 sobre `so.contract_id` com listagem escopada PostgreSQL. O objeto de OS já publica transições, versão, histórico e `controlCenter`; o KPI `overdue-service-orders` e seu drill têm teste PostgreSQL de reconciliação. A lacuna verificável deste incremento é a inclusão da obrigação real de OS preparada na fila transacional.

A fonte `ServiceOrdersWorkSource` consulta `ServiceOrdersAccessService.listReadableForWorkInbox` (escopo LIST + predicado SQL `status=PREPARED`, seguido de revalidação batch do PDP e das concessões diretas READ por objeto). O filtro READ usa o mesmo predicado de grants do detalhe de OS, evitando N+1. A paginação percorre a página bruta ainda que todos os seus itens tenham READ negado, impedindo interrupção antecipada e falsos zeros. `nextServiceOrderStep` é o dono do vocabulário de próximo passo. `PREPARED → RELEASE` não equivale à liberação **disponível**: o comando pertence à OS 360 e revalida autorização, bloqueios e concorrência. Nenhuma liberação é executada pela Inbox. `dueAt=null` deliberadamente: janela operacional não é SLA de aprovação. Item identificado por `OPERACOES:OS:RELEASE:<id>`; a mudança de estado na fonte elimina a obrigação na próxima leitura, sem estado paralelo.

## Rastreabilidade de capacidades

| Capability | Existing implementation | Gap e classificação | Reuse strategy / required change | Test | Evidence |
| --- | --- | --- | --- | --- | --- |
| Organização e unidades | `ServiceOrdersAccessAuthz.getListScopeFilter`, PR #140 | EXISTENTE, comportamento escopado | Reutilizar sem ampliar o escopo | integração negativa de unidade | `service-orders-work-inbox.integration.spec.ts` (PENDING execution) |
| Authorization / PDP / SoD | `ServiceOrdersAccessAuthz.assertListAction` e `assertRecordAction`, PR #153 | INCOMPLETA na projeção inicial (LIST ≠ READ); SoD preservado | Reutilizar mesmo matcher do detalhe no filtro batch READ e manter LIST no SQL | testes LIST sem READ, LIST GLOBAL/READ UNIT, 403 e integração grants | integração PostgreSQL e source tests (PENDING) |
| Contrato 360 | `ContractServiceOrdersPanel`, `ContractsDetailPage`, PR #151 | EXISTENTE, código inspecionado | Preservar listagem filtrada por `contractId` persistido | `ContractServiceOrdersPanel.ui.test.tsx`, `contracts.integration.spec.ts` | PR #151 merged; reexecução neste SHA PENDING |
| OS 360 | `ServiceOrderEngineDetailPage`, `ServiceOrdersAccessService`, `operations-control-center` | EXISTENTE, código inspecionado | Reutilizar deep link e comando `release`, sem novo endpoint | `service-order-object-page.ui.test.tsx`, `service-orders.integration.spec.ts` | Inspeção + testes prévios, reexecução PENDING |
| Work Inbox | `WorkInboxModule`, `WorkInboxService`, `WorkspaceQueueSurface` | INCOMPLETA: sem fonte de OS preparada | Registrar uma `WorkItemSource` sem criar fila | source, wiring, integração PostgreSQL | Alterações deste PR (gates PENDING) |
| KPI de trabalho | `WorkInboxService.byDomain`, `DomainWorkZones` | EXISTENTE, agora inclui item de OS | Reutilizar mesma consulta da fila e seu drill | teste de igualdade `byDomain` ↔ `total` | `service-orders.source.spec.ts` + integração (PENDING) |
| KPI de OS vencidas | `drill-equality.integration.spec.ts` e dashboard existente | EXISTENTE, não alterado | Preservar sem KPI paralelo | regression `drill-equality.integration.spec.ts` | Reexecução PENDING |
| Comando OS | `ServiceOrdersAccessService`, `TRANSITIONS`, `controlCenter` | EXISTENTE, não alterado | A ação da Inbox abre a OS; domínio valida `release` | testes de estado, concorrência, auditoria já existentes | Reexecução PENDING |
| Medição/aceite/billing | Módulos existentes; `controlCenter.downstream` | FORA DO PRIMEIRO PR | Preservar; Incrementos 02–03 | pendente | Não declarar funcionalidade adicional |
| Fiscal/financeiro/contabilidade/outbox | Módulos existentes | FORA DO PRIMEIRO PR | Não alterar regras nem migrations | pendente | Não declarar efeitos econômicos |
| Saved Views e design system | `useSavedViews`, `WorkspaceQueueSurface`, `EnterpriseObjectPage` | EXISTENTE, sem modificação | Não duplicar UI nem estado | suítes de workspaces/UI | Reexecução PENDING |
| CI/CD e produção | GitHub Actions + readiness | GATES PENDING | PR protegido, CI por SHA; sem deploy direto | CI / HML conforme política | Nenhuma validação de produção declarada |

## Critérios de aceitação e limites

- AC-01–04: atendidos anteriormente em estrutura, **revalidação pendente** neste SHA; o PR não recria Contratos/OS.
- AC-05–06: código acrescentado para obrigação `PREPARED`, rota e próxima decisão coerentes; testes criados, execução pendente.
- AC-07, 09–10: comando de domínio/auditoria/versão existente, não modificado; regressão obrigatória pendente.
- AC-08, 11–13: testes novos de escopo, LIST sem READ, READ restrito à unidade, 403, estado real, contagem e leitura sem prazo fictício; execução pendente.
- AC-14–16: dependentes de GitHub Actions e revisão.
- AC-15: nenhuma migration, alteração de schema ou contrato público neste PR.
- AC-17: não realizar alterações em produção.

## Riscos e controles

1. **Leitura paginada sob concorrência**: sem snapshot transacional entre requisições de página, uma OS que muda durante a coleta pode deslocar offsets. A Inbox faz deduplicação lógica, mas não promete snapshot. Reavaliação e eventual paginação por cursor ficam condicionadas a evidência de carga/necessidade.
2. **Ação não autorizada**: a fonte indica revisão para liberação, não executa nem garante `release`. A UI 360 e o servidor revalidam.
3. **Convivência com alertas**: alertas de atraso/stalled continuam obrigações próprias. A nova fonte só representa a etapa `PREPARED → RELEASE`; monitorar eventual sobreposição de significado antes de propor deduplicação entre domínios.
4. **Falha parcial**: erro de infraestrutura sobe para `unavailableDomains`; 403 é ausência de visibilidade, não fila falha. A filtragem READ é fail-closed; PDP retorna DENY sob falha de avaliação, exigindo observabilidade do próprio autorizador para diferenciar indisponibilidade de ausência de permissão.
5. **Testes**: a integração usa PostgreSQL descartável. Dados diretos de fixture NÃO são operações empresariais de produção nem prova de que o comando foi executado via API.

## Expansão condicionada

Próxima fatia independente apenas após gates e revisão: OS concluída → medição → aceite, utilizando identidades persistidas, permissão e eventos existentes. Não iniciar nesta branch.
