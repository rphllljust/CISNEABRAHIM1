# MASTER 001 — Incremento 02: ligação Medição/Aceite com a Work Inbox

Base integrada: `main@81995dc7ff57f0158565ecccaed6e9e1485dc135` (PR #154 merged).

## Autoridades reutilizadas (sem reimplementação)

- `MeasurementsAccessService`: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED, validações comerciais, transições, rowVersion, histórico e security audit.
- `MeasurementsCapabilityService.recordAcceptance`: comando separado de aceite do cliente, `expectedVersion` + `idempotencyKey`, política comercial, transação PostgreSQL e outbox.
- `MeasurementsCapabilityService.getWorkbench`: Medição 360, comandos com permissões e bloqueios calculados no backend, elegibilidade de Billing e histórico.
- `MeasurementsCapabilityService.getWorkQueue`: stage da projeção autoritativa de revenue leakage por unidade.
- `WorkInboxService.byDomain`: contador e drill calculados sobre a MESMA população após autorização, sem KPI paralelo.
- `ScopeContextRepository.listUnitScopeRefs`: enumeração neutra de unidades, sem conceder acesso.

## Alteração funcional

A fonte `MeasurementsWorkSource` projeta os estágios existentes `MEASURED_NOT_APPROVED` e `APPROVED_NOT_ACCEPTED`, exigindo simultaneamente `READ` efetivo no `getWorkbench` e no `getById` do domínio dono. Rejeição é exceção, nunca aprovação; aceite do cliente é obrigação distinta de aprovação interna. Cada item navega para `/app/service-orders/:serviceOrderId/measurement-workbench` e é removido pelo estado persistido na leitura seguinte.

Nenhuma rota nova de comando, regra de preço, schema, outbox ou estado de workflow foi criado. Prazos são nulos porque a consulta da capability não fornece SLA de decisão. O limite atual de 500 registros por unidade da query do domínio é um teto **sem paginação**: ao atingir o teto, a fonte falha abertamente em vez de publicar KPI potencialmente truncado. O `getWorkQueue` proprietário atualiza a projeção de revenue leakage; a fonte usa essa API existente, não escreve diretamente.

## Situação e aceites

- AC-02-01–10, 13–16: funcionalidades pré-existentes em Medição/Aceite/Billing; requerem evidências executadas para aceitação neste incremento, não apenas presença de código.
- AC-02-11/12: fonte, ACL individual, identidade estável, status persistido e KPI/drill; testes unitários nesta branch, execução em CI pendente.
- AC-02-17–20: PostgreSQL, E2E, lint, typecheck, frontend, release e validação de cadeia completos **PENDENTES** até CI do HEAD e testes de ponta a ponta.
- Sem dados de teste ou aprovação de cliente em produção. Não declarar validação empresarial ou deploy a partir de CI.

## Limites a enfrentar antes do sign-off integral

1. A fila proprietária limita a leitura a 500 itens por unidade e não pagina, inviabilizando exatidão acima do teto. Fail-closed, não falso PASS. Precisará de extensão do contrato proprietário para cursor/paginação antes de escala Tier 1.
2. `getWorkbench` e `getById` revalidam READ objeto a objeto: seguro, mas custo proporcional ao tamanho da fila. Medir e evoluir apenas no módulo dono/queries autoritativas.
3. Não confundir autorização para visualizar obrigação com autorização para executar approve/acceptance; os botões da Medição 360 só usam `availableCommands`.
4. `getWorkQueue` pode reportar estágios que exigem tratamento fora desta fatia (CREATE_MEASUREMENT, BILLING blockers). Não projetá-los como aceite sem uma obrigação real de medição.

## Rollback

Reverter o PR restaura o mesmo contrato de Work Inbox anterior sem alterar dados, migrations ou eventos; as mutações autoritativas de medição/aceite continuam no módulo original.
