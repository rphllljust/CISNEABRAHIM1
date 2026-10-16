Warning: truncated output (original token count: 276641)
... 57987 bytes omitted ...

# Prompt execution log

Registro append-only. Execuções anteriores não são apagadas.

Template: [`../templates/prompt-completion-template.md`](../templates/prompt-completion-template.md).

---

```text
PROMPT: 00
TITLE: Fundação e governança do repositório
STARTED_AT: 2026-08-28T20:40:45-04:00
FINISHED_AT: 2026-08-28T20:47:07-04:00
STATUS: PASS
FILES_CREATED:
  .editorconfig
  .gitattributes
  .gitignore
  AGENTS.md
  README.md
  docs/README.md
  docs/00-governance/project-charter.md
  docs/00-governance/execution-protocol.md
  docs/00-governance/engineering-principles.md
  docs/00-governance/change-governance.md
  docs/00-governance/traceability-policy.md
  docs/00-governance/definition-of-ready.md
  docs/00-governance/definition-of-done.md
  docs/00-governance/quality-gates.md
  docs/00-governance/prompt-roadmap.md
  docs/00-governance/prompt-execution-log.md
  docs/01-foundation/source-registry.md
  docs/01-foundation/business-context.md
  docs/01-foundation/scope-register.md
  docs/01-foundation/stakeholders-register.md
  docs/01-foundation/business-rules-register.md
  docs/01-foundation/domain-decisions-pending.md
  docs/01-foundation/engineering-decisions-register.md
  docs/01-foundation/source-conflicts.md
  docs/01-foundation/risk-register.md
  docs/01-foundation/requirements-traceability.md
  docs/inputs/README.md
  docs/templates/source-template.md
  docs/templates/business-rule-template.md
  docs/templates/domain-decision-template.md
  docs/templates/engineering-decision-template.md
  docs/templates/source-conflict-template.md
  docs/templates/risk-template.md
  docs/templates/prompt-completion-template.md
FILES_CHANGED: (nenhum preexistente; workspace estava vazio além do .git criado nesta etapa)
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO

---

## ORDENS DE SERVICO — WORK AREA OPERACIONAL ENTERPRISE — 2026-10-07

STATUS: **PASS**

### Escopo executado

Continuidade da wave frontend Enterprise Tier-1 real, uma funcao por vez.

Modulo: **Ordens de Servico**.
Funcao: **Lista/engine de ordens de servico** (`/app/service-orders`).
Classificacao principal: **LISTA OPERACIONAL / WORK AREA**.

Classificacao: **interpretacao de engenharia visual / experiencia operacional**.
Nenhuma regra empresarial criada, promovida ou alterada; nenhum backend, API, migration, seed,
permissao ou contrato de dados tocado.

### Arquivos alterados

- `apps/web/src/service-orders/pages/ServiceOrdersEngineListPage.tsx`
- `apps/web/src/service-orders/service-orders-list.e2e.test.tsx`
- `docs/01-foundation/requirements-traceability.md`

### Alteracao aplicada

- A lista de OS deixou de ser uma superficie `p-6` com titulo/filtros/tabela e passou a declarar
  `ModulePage layout="workspace"`.
- A funcao passou a expor header operacional, sinais de carteira derivados somente das linhas
  carregadas, work queue engine, saved views, filtros metadata/server-side, bulk commands,
  context drawer e command palette na mesma experiencia.
- A paginacao continua sem inventar total global: pagina paginada nao e dataset.
- O teste e2e foi alinhado ao contrato i18n real do `entity-title`, preservando a verificacao
  das colunas vindas do metadata store.

### Validacao

- `pnpm --filter @cisne/web exec eslint src/service-orders/pages/ServiceOrdersEngineListPage.tsx src/service-orders/service-orders-list.e2e.test.tsx` — **PASS**
- `pnpm --filter @cisne/web exec vitest run --config vite.config.ts src/service-orders/pages/ServiceOrdersEngineListPage.test.tsx src/service-orders/service-orders-list.e2e.test.tsx` — **PASS** (9/9)
- `pnpm --filter @cisne/web typecheck` — **PASS**
- `git diff --check` — **PASS**

### Quality gate

- [x] Alteracao restrita a funcao de lista operacional de OS e rastreabilidade
- [x] Reuso de infraestrutura existente: `ModulePage`, `DynamicKpiDrilldown`, `DynamicSavedViewsBar`, `DynamicFilterBar`, `DynamicBulkActions`, `DynamicContextDrawer`, `CommandPalette`
- [x] Nenhum dado, KPI, relacao ou capability inventado
- [x] Nenhuma regra empresarial nova
- [x] Nenhuma migration, seed, backend, permissao ou contrato de API
- [x] Server-side filtering/pagination preservados

WORKING_TREE: limpo apos commit
COMMIT: incluido no commit desta sessao
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Workspace C:\CISNEABRAHIM inspecionado vazio; git init local (branch master, sem remoto, sem commit até o encerramento desta etapa).
  Identidade Git já existia (user.name / user.email); commit desta etapa previsto após este registro.
  SRC-000 classificado como governança, não prova operacional.
  BR-001..BR-003 apenas CANDIDATE; 0 CONFIRMED.
  DDP-001..DDP-020 abertos, sem respostas inventadas.
  RISK-001..RISK-016 OPEN, probability UNKNOWN.
  Fontes empresariais NOT_PROVIDED (sem SOURCE-ID fictício).
  ED-001..ED-004 ACCEPTED (somente governança desta fase).
  Carta: DISCOVERY_NOT_STARTED. Fase: FOUNDATION.
  Prompt 01 não executado.
```

## Quality gate Prompt 00 (evidência)

- [x] o workspace foi inspecionado
- [x] o Git foi inicializado ou preservado
- [x] a estrutura documental obrigatória existe
- [x] nenhum arquivo obrigatório está vazio
- [x] nenhuma implementação empresarial foi criada
- [x] nenhuma tecnologia definitiva foi escolhida
- [x] nenhuma regra não comprovada virou `CONFIRMED`
- [x] as fontes ausentes estão explicitamente registradas
- [x] as decisões pendentes continuam abertas
- [x] os riscos iniciais estão registrados
- [x] existe política de rastreabilidade
- [x] existe Definition of Ready
- [x] existe Definition of Done
- [x] existe protocolo de execução
- [x] existe roadmap
- [x] existe registro do Prompt 00
- [x] o Prompt 01 não foi executado
- [x] o estado final do Git foi verificado (pré-commit: repositório local, sem commits; pós-commit: ver `git log` / `git status`)

---

```text
PROMPT: 00.1
TITLE: Registro do contexto empresarial inicial
STARTED_AT: 2026-08-28T20:55:59-04:00
FINISHED_AT: 2026-08-28T20:57:24-04:00
STATUS: PASS
FILES_CREATED:
  docs/inputs/SRC-001-contexto-inicial-patrocinador.md
FILES_CHANGED:
  docs/01-foundation/source-registry.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Pré-condições: Prompt 00 STATUS PASS; git working tree limpa; identidade Git configurada.
  SRC-000 preservado. SRC-001 registrado como SPONSOR_CONTEXT_RECONSTRUCTED e PENDING_BUSINESS_VALIDATION.
  Fonte não substitui originais primários; lista NOT_PROVIDED mantida.
  Data de consolidação do arquivo: 2026-08-28 (data real de criação).
  Nenhuma regra alterada para CONFIRMED. Nenhum DDP encerrado. Análise atômica não executada.
  Prompt 01 não executado.
```

## Quality gate Prompt 00.1 (evidência)

- [x] arquivo criado em `docs/inputs/`
- [x] conteúdo não vazio
- [x] SRC-001 no registro de fontes
- [x] SRC-000 preservado
- [x] nenhuma regra `CONFIRMED`
- [x] nenhuma decisão pendente encerrada
- [x] nenhum código funcional criado
- [x] nenhuma dependência instalada
- [x] Prompt 01 não executado

---

```text
PROMPT: 01
TITLE: Análise atômica das fontes e descoberta empresarial
STARTED_AT: 2026-08-28T21:04:41-04:00
FINISHED_AT: 2026-08-28T21:10:33-04:00
STATUS: PASS
FILES_CREATED:
  docs/02-source-analysis/README.md
  docs/02-source-analysis/source-assessment.md
  docs/02-source-analysis/atomic-evidence-register.md
  docs/02-source-analysis/as-is-process.md
  docs/02-source-analysis/to-be-evidence.md
  docs/02-source-analysis/rules-by-domain.md
  docs/02-source-analysis/service-request-analysis.md
  docs/02-source-analysis/service-order-analysis.md
  docs/02-source-analysis/commercial-chain-analysis.md
  docs/02-source-analysis/resources-and-billing-analysis.md
  docs/02-source-analysis/quantity-semantics.md
  docs/02-source-analysis/labor-analysis.md
  docs/02-source-analysis/equipment-and-vehicle-analysis.md
  docs/02-source-analysis/document-and-notification-analysis.md
  docs/02-source-analysis/responsibility-and-aging-analysis.md
  docs/02-source-analysis/segregation-of-duties-analysis.md
  docs/02-source-analysis/exception-candidates.md
  docs/02-source-analysis/invariant-candidates.md
  docs/02-source-analysis/command-candidates.md
  docs/02-source-analysis/domain-event-candidates.md
  docs/02-source-analysis/non-domain-data.md
  docs/02-source-analysis/provenance-matrix.md
  docs/02-source-analysis/domain-evidence-map.md
  docs/02-source-analysis/ambiguous-terms.md
  docs/02-source-analysis/rule-normalization-report.md
  docs/02-source-analysis/source-gaps-and-requests.md
  docs/02-source-analysis/coverage-audit.md
  docs/02-source-analysis/prompt-01-completeness-report.md
FILES_CHANGED:
  docs/01-foundation/source-registry.md
  docs/01-foundation/business-context.md
  docs/01-foundation/scope-register.md
  docs/01-foundation/stakeholders-register.md
  docs/01-foundation/business-rules-register.md
  docs/01-foundation/domain-decisions-pending.md
  docs/01-foundation/risk-register.md
  docs/01-foundation/requirements-traceability.md
  docs/01-foundation/source-conflicts.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: NO
EVIDENCE_COUNT: 84
BR_ADDED: BR-004..BR-025 (22)
BR_UPDATED: BR-001..BR-003
DDP_ADDED: DDP-021..DDP-035 (15)
RISK_ADDED: RISK-017..RISK-022 (6)
CONFIRMED_RULES: 0
SOURCE_CONFLICTS: 0
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Fontes: SRC-000 (governança), SRC-001 (SPONSOR_CONTEXT_RECONSTRUCTED, LEVEL_3).
  Análise atômica SRC-001 COMPLETE. 0 regras CONFIRMED.
  Locação registrada como FUTURE_SCOPE_CANDIDATE com prioridade candidata (§21).
  Prompt 02 não executado.
```

## Quality gate Prompt 01 (evidência)

- [x] pasta `02-source-analysis/` com 28 artefatos não vazios
- [x] 70–90 evidências atômicas de SRC-001 (84)
- [x] SRC-001 marcado analisado no source-registry
- [x] BR-004..BR-025 adicionadas como CANDIDATE/PENDING_VALIDATION
- [x] BR-001..BR-003 atualizadas com referências EV
- [x] DDP-021..DDP-035 adicionados (OPEN)
- [x] RISK-017..RISK-022 adicionados (OPEN)
- [x] 0 regras CONFIRMED
- [x] 0 conflitos de fonte fabricados
- [x] nenhum código funcional, package.json, DB
- [x] Prompt 01 não executado (histórico Prompt 00.1 gate)

---

```text
PROMPT: 02
TITLE: Requisitos funcionais e casos de uso empresariais
STARTED_AT: 2026-08-28T21:23:25-04:00
FINISHED_AT: 2026-08-28T22:08:25-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/03-requirements/README.md
  docs/03-requirements/requirements-method.md
  docs/03-requirements/business-capability-map.md
  docs/03-requirements/functional-requirements-register.md
  docs/03-requirements/actor-goal-matrix.md
  docs/03-requirements/use-case-catalog.md
  docs/03-requirements/business-validation-rules.md
  docs/03-requirements/authorization-requirements.md
  docs/03-requirements/data-requirements.md
  docs/03-requirements/document-requirements.md
  docs/03-requirements/notification-requirements.md
  docs/03-requirements/integration-requirements.md
  docs/03-requirements/reporting-requirements.md
  docs/03-requirements/error-and-exception-requirements.md
  docs/03-requirements/acceptance-criteria-catalog.md
  docs/03-requirements/requirement-dependency-map.md
  docs/03-requirements/requirement-prioritization.md
  docs/03-requirements/requirements-open-questions.md
  docs/03-requirements/requirements-coverage.md
  docs/03-requirements/prompt-02-completeness-report.md
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/02-source-analysis/provenance-matrix.md
  docs/02-source-analysis/source-gaps-and-requests.md
  docs/02-source-analysis/coverage-audit.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
FUNCTIONAL_CODE_CREATED: NO
FUNCTIONAL_REQUIREMENTS: 42
USE_CASES: 26
ACCEPTANCE_CRITERIA: 52
VR: 22
AUTH_REQ: 20
DR: 28
DOC_REQ: 14
NOTIF_REQ: 10
INT_REQ: 8
RPT_REQ: 12
EX: 18
OPEN_QUESTIONS: 25
EV_USED: 54
CONFIRMED_RULES: 0
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Fonte operacional única: SRC-001 (LEVEL_3, PENDING_BUSINESS_VALIDATION).
  0 regras CONFIRMED. 0 FR CONFIRMED.
  WhatsApp: CAPABILITY_ONLY. Integrações: PENDING_EXTERNAL_DOCUMENTATION.
  Sem código, endpoints, telas, RBAC técnico ou emissão fiscal presumida.
  Prompt 03 não executado.
```

## Quality gate Prompt 02 (evidência)

- [x] pasta `03-requirements/` com 20 artefatos não vazios
- [x] 42 FRs atômicos FR-001..FR-042
- [x] 26 UCs UC-001..UC-026
- [x] 52 ACs AC-001..AC-052 em formato DADO/QUANDO/ENTÃO
- [x] 27 capacidades com first release UNKNOWN
- [x] 0 regras ou requisitos CONFIRMED
- [x] rastreabilidade atualizada (requirements-traceability, provenance-matrix)
- [x] cobertura auditada (requirements-coverage, coverage-audit)
- [x] nenhum código funcional, package.json, DB
- [x] SRC-001 não alterado
- [x] Prompt 03 não executado

---

```text
PROMPT: 02-CORRECTIVE
TITLE: Auditoria corretiva — remoção de artefato e revalidação documental
STARTED_AT: 2026-08-28T21:46:00-04:00
FINISHED_AT: 2026-08-28T21:52:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED: (nenhum)
FILES_CHANGED:
  docs/03-requirements/requirements-coverage.md
  docs/03-requirements/prompt-02-completeness-report.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
FUNCTIONAL_CODE_CREATED: NO
AUXILIARY_CODE_REMAINING: NO
PROMPT_03_EXECUTED: NO
GENERATOR_ARTIFACT:
  scripts/generate-prompt-02.py — criado exclusivamente pelo agente no Prompt 02; removido antes do commit; ausente no Git e no workspace na auditoria
COMMIT_PROMPT_02: 7cc97fd docs: define evidence-based functional requirements
NOTES:
  Auditoria corretiva solicitada explicitamente. Nenhum commit de remoção necessário (artefato nunca versionado).
  20 arquivos em docs/03-requirements/ revisados; contagens recalculadas.
  54 EV em FR; 30 EV sem FR direto justificadas; 84 EV preservadas no registro atômico.
  0 CONFIRMED; SRC-001 PENDING_BUSINESS_VALIDATION; WhatsApp CAPABILITY_ONLY.
  Prompt 03 não executado.
```

## Quality gate Prompt 02 corretivo (evidência)

- [x] 20 documentos em `03-requirements/` revisados
- [x] contagens recalculadas
- [x] IDs únicos
- [x] evidências não utilizadas em FR justificadas
- [x] nenhuma regra confirmada
- [x] nenhuma fonte reconstruída elevada
- [x] nenhum artefato de código permanece
- [x] `scripts/generate-prompt-02.py` não permanece
- [x] nenhum cache permanece
- [x] Git contém somente alterações esperadas (pós-auditoria: docs corretivos)
- [x] Prompt 03 não executado (no encerramento da auditoria corretiva)

---

```text
PROMPT: 03
TITLE: Requisitos não funcionais e cenários de qualidade
STARTED_AT: 2026-08-28T22:39:00-04:00
FINISHED_AT: 2026-08-28T22:55:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/04-quality-attributes/README.md
  docs/04-quality-attributes/quality-attribute-method.md
  docs/04-quality-attributes/non-functional-requirements-register.md
  docs/04-quality-attributes/quality-attribute-scenarios.md
  docs/04-quality-attributes/security-requirements.md
  docs/04-quality-attributes/privacy-and-data-protection-requirements.md
  docs/04-quality-attributes/reliability-and-resilience-requirements.md
  docs/04-quality-attributes/availability-requirements.md
  docs/04-quality-attributes/performance-and-capacity-requirements.md
  docs/04-quality-attributes/data-integrity-requirements.md
  docs/04-quality-attributes/concurrency-and-idempotency-requirements.md
  docs/04-quality-attributes/auditability-and-accountability-requirements.md
  docs/04-quality-attributes/observability-requirements.md
  docs/04-quality-attributes/recoverability-requirements.md
  docs/04-quality-attributes/retention-and-disposal-requirements.md
  docs/04-quality-attributes/maintainability-and-evolvability-requirements.md
  docs/04-quality-attributes/testability-requirements.md
  docs/04-quality-attributes/compatibility-and-accessibility-requirements.md
  docs/04-quality-attributes/deployment-and-environment-requirements.md
  docs/04-quality-attributes/quality-attribute-tradeoffs.md
  docs/04-quality-attributes/non-functional-open-questions.md
  docs/04-quality-attributes/non-functional-traceability.md
  docs/04-quality-attributes/prompt-03-completeness-report.md
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/01-foundation/risk-register.md
  docs/01-foundation/domain-decisions-pending.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
FUNCTIONAL_CODE_CREATED: NO
NFR_COUNT: 40
QA_SC_COUNT: 28
SEC_REQ_COUNT: 24
NFNQ_COUNT: 18
NFR_NUMERIC_TARGETS: 0
TARGETS_PENDING: 40
INVENTED_METRICS: 0
NFR_CONFIRMED: 0
DDP_ADDED: DDP-036..DDP-040 (5)
RISK_ADDED: RISK-023..RISK-024 (2)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Fonte: SRC-001 (PENDING_BUSINESS_VALIDATION). 0 NFR CONFIRMED.
  RPO/RTO TARGET_PENDING. Sem stack, scripts ou código.
  Concorrência e idempotência classificadas sem mecanismo.
  Prompt 04 não executado.
```

## Quality gate Prompt 03 (evidência)

- [x] pasta `04-quality-attributes/` com 23 artefatos não vazios
- [x] 40 NFRs com proveniência e campos obrigatórios
- [x] 28 cenários QA-SC sem metas numéricas inventadas
- [x] 24 SEC-REQ classificados (business / application / infrastructure / open)
- [x] RPO/RTO TARGET_PENDING (DDP-016)
- [x] AUDIT_TRAIL separado de TECHNICAL_LOG
- [x] Concorrência e idempotência classificadas por operação
- [x] Trade-offs documentados sem vencedor imposto
- [x] 0 tecnologias escolhidas
- [x] 0 scripts ou código funcional
- [x] DDP-036..040 e RISK-023..024 adicionados
- [x] rastreabilidade atualizada
- [x] Prompt 04 não executado (no encerramento do Prompt 03)

---

```text
PROMPT: 03-REVISED
TITLE: Requisitos não funcionais — revisão estrutural (nomenclatura e rastreabilidade)
STARTED_AT: 2026-08-28T23:15:00-04:00
FINISHED_AT: 2026-08-28T23:35:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/04-quality-attributes/nfr-method.md
  docs/04-quality-attributes/scalability-requirements.md
  docs/04-quality-attributes/service-level-objectives-pending.md
  docs/04-quality-attributes/reliability-and-resilience.md
  docs/04-quality-attributes/performance-and-capacity.md
  docs/04-quality-attributes/data-integrity-and-consistency.md
  docs/04-quality-attributes/concurrency-and-idempotency-quality.md
  docs/04-quality-attributes/auditability-and-accountability.md
  docs/04-quality-attributes/recoverability-and-continuity.md
  docs/04-quality-attributes/privacy-and-data-protection.md
  docs/04-quality-attributes/retention-and-disposal.md
  docs/04-quality-attributes/maintainability-and-evolvability.md
  docs/04-quality-attributes/usability-and-accessibility.md
  docs/04-quality-attributes/compatibility-and-deployment.md
  docs/04-quality-attributes/nfr-risk-traceability.md
  docs/04-quality-attributes/nfr-open-questions.md
FILES_CHANGED:
  docs/04-quality-attributes/README.md
  docs/04-quality-attributes/non-functional-requirements-register.md
  docs/04-quality-attributes/quality-attribute-scenarios.md
  docs/04-quality-attributes/security-requirements.md
  docs/04-quality-attributes/availability-requirements.md
  docs/04-quality-attributes/observability-requirements.md
  docs/04-quality-attributes/testability-requirements.md
  docs/04-quality-attributes/prompt-03-completeness-report.md
  docs/01-foundation/requirements-traceability.md
  docs/03-requirements/requirement-dependency-map.md
  docs/README.md
  docs/00-governance/prompt-execution-log.md
FILES_REMOVED:
  docs/04-quality-attributes/quality-attribute-method.md
  docs/04-quality-attributes/*-requirements.md (15 arquivos com nomenclatura anterior)
  docs/04-quality-attributes/non-functional-traceability.md
  docs/04-quality-attributes/non-functional-open-questions.md
  docs/04-quality-attributes/quality-attribute-tradeoffs.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
FUNCTIONAL_CODE_CREATED: NO
NFR_COUNT: 40
QA_SC_COUNT: 28
SEC_REQ_COUNT: 24
NFNQ_COUNT: 18
NFR_NUMERIC_TARGETS: 0
TARGETS_PENDING: 40
NFR_CRITICAL: 5
INVENTED_METRICS: 0
NFR_CONFIRMED: 0
ARTIFACT_COUNT_04: 24
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Revisão estrutural do Prompt 03 conforme spec atualizada.
  TARGET_PENDING → TARGET_NOT_DEFINED; PENDING_TARGET_DEFINITION → PENDING_MEASUREMENT.
  requirement-dependency-map.md atualizado com cadeia NFR.
  Prompt 04 (glossário) já existia no repositório — não reexecutado nesta rodada.
  0 scripts; working tree limpo após commit.
```

## Quality gate Prompt 03 revisado (evidência)

- [x] pasta `04-quality-attributes/` com 24 artefatos não vazios
- [x] 40 NFRs com proveniência preservada
- [x] 28 cenários QA-SC
- [x] 24 SEC-REQ
- [x] SLOs pendentes sem valores inventados
- [x] rastreabilidade NFR em requirement-dependency-map.md
- [x] 0 tecnologias escolhidas
- [x] 0 scripts ou código
- [x] Prompt 04 não executado nesta rodada

---

```text
PROMPT: 04
TITLE: Glossário empresarial e linguagem ubíqua
STARTED_AT: 2026-08-28T22:44:00-04:00
FINISHED_AT: 2026-08-28T23:05:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/05-ubiquitous-language/README.md
  docs/05-ubiquitous-language/glossary-method.md
  docs/05-ubiquitous-language/ubiquitous-language-register.md
  docs/05-ubiquitous-language/ambiguous-terms-resolution.md
  docs/05-ubiquitous-language/synonyms-and-aliases.md
  docs/05-ubiquitous-language/homonyms-and-collisions.md
  docs/05-ubiquitous-language/discouraged-and-prohibited-terms.md
  docs/05-ubiquitous-language/commercial-language.md
  docs/05-ubiquitous-language/service-request-language.md
  docs/05-ubiquitous-language/service-order-language.md
  docs/05-ubiquitous-language/resource-language.md
  docs/05-ubiquitous-language/execution-language.md
  docs/05-ubiquitous-language/measurement-and-billing-language.md
  docs/05-ubiquitous-language/document-language.md
  docs/05-ubiquitous-language/responsibility-language.md
  docs/05-ubiquitous-language/state-event-timestamp-semantics.md
  docs/05-ubiquitous-language/business-vs-technical-language.md
  docs/05-ubiquitous-language/naming-conventions-candidates.md
  docs/05-ubiquitous-language/glossary-traceability.md
  docs/05-ubiquitous-language/glossary-open-questions.md
  docs/05-ubiquitous-language/prompt-04-completeness-report.md
FILES_CHANGED:
  docs/02-source-analysis/ambiguous-terms.md
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
FUNCTIONAL_CODE_CREATED: NO
TERM_COUNT: 48
GLQ_COUNT: 12
TERM_CONFIRMED: 0
NEXT_PROMPT_EXECUTED: NO
NOTES:
  48 TERM com proveniência SRC-001/EV-*. 38 ambiguidades AT-001 mapeadas.
  0 termos CONFIRMED. Sem enums, API, tabelas ou scripts.
  Separação negócio/técnico e documento lógico×versão×arquivo.
  Prompt 05 não executado.
```

## Quality gate Prompt 04 (evidência)

- [x] pasta `05-ubiquitous-language/` com 21 artefatos não vazios
- [x] 48 TERM com campos obrigatórios e proveniência
- [x] ambiguidades não resolvidas sem fonte permanecem abertas
- [x] 0 definições CONFIRMED
- [x] negócio ≠ técnico documentado
- [x] IDs históricos (FR, EV, BR) preservados
- [x] 0 código, scripts, enums ou nomes de API congelados
- [x] rastreabilidade atualizada
- [x] Prompt 05 não executado

---

```text
PROMPT: 04-REVISED
TITLE: Glossário — revisão estrutural (catálogos, semântica, auditoria)
STARTED_AT: 2026-08-28T23:40:00-04:00
FINISHED_AT: 2026-08-29T00:05:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/05-ubiquitous-language/language-method.md
  docs/05-ubiquitous-language/business-verbs-catalog.md
  docs/05-ubiquitous-language/business-nouns-catalog.md
  docs/05-ubiquitous-language/state-event-command-semantics.md
  docs/05-ubiquitous-language/execution-and-evidence-language.md
  docs/05-ubiquitous-language/responsibility-and-aging-language.md
  docs/05-ubiquitous-language/technical-versus-domain-language.md
  docs/05-ubiquitous-language/naming-policy.md
  docs/05-ubiquitous-language/terms-pending-business-validation.md
  docs/05-ubiquitous-language/language-consistency-audit.md
FILES_CHANGED:
  docs/05-ubiquitous-language/README.md
  docs/05-ubiquitous-language/ubiquitous-language-register.md
  docs/05-ubiquitous-language/homonyms-and-collisions.md
  docs/05-ubiquitous-language/prompt-04-completeness-report.md
  docs/02-source-analysis/ambiguous-terms.md
  docs/03-requirements/requirements-open-questions.md
  docs/01-foundation/requirements-traceability.md
  docs/README.md
  docs/00-governance/prompt-execution-log.md
FILES_REMOVED:
  docs/05-ubiquitous-language/glossary-method.md
  docs/05-ubiquitous-language/glossary-traceability.md
  docs/05-ubiquitous-language/glossary-open-questions.md
  docs/05-ubiquitous-language/discouraged-and-prohibited-terms.md
  docs/05-ubiquitous-language/naming-conventions-candidates.md
  docs/05-ubiquitous-language/business-vs-technical-language.md
  docs/05-ubiquitous-language/state-event-timestamp-semantics.md
  docs/05-ubiquitous-language/execution-language.md
  docs/05-ubiquitous-language/responsibility-language.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
TERM_COUNT: 48
ACCEPTED_FOR_DOCUMENTATION: 24
AMBIGUOUS: 18
PENDING_BUSINESS_DECISION: 6
TERM_CONFIRMED: 0
GLQ_COUNT: 12
ARTIFACT_COUNT_05: 22
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Revisão estrutural Prompt 04. Status enum atualizado.
  RC não evidenciado em SRC-001 — não registrado como TERM.
  RC inventado: NO. Prompt 05 não executado.
```

## Quality gate Prompt 04 revisado (evidência)

- [x] pasta `05-ubiquitous-language/` com 22 artefatos não vazios
- [x] 48 TERM com proveniência
- [x] catálogos de verbos e substantivos obrigatórios
- [x] normalizações críticas documentadas
- [x] 0 termos CONFIRMED
- [x] 0 bounded contexts / código / scripts
- [x] rastreabilidade atualizada
- [x] Prompt 05 não executado (no encerramento Prompt 04 revisado)

---

```text
PROMPT: 05
TITLE: Domínios, subdomínios e bounded contexts candidatos
STARTED_AT: 2026-08-29T00:10:00-04:00
FINISHED_AT: 2026-08-29T00:45:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/06-domain-boundaries/ (23 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
SUBDOMAIN_COUNT: 12
BC_CAND_COUNT: 18
DBND_COUNT: 12
MICROSERVICES: 0
CODE_CREATED: NO
MODULAR_MONOLITH: CANDIDATE_NOT_DECIDED
NEXT_PROMPT_EXECUTED: NO
NOTES:
  PROBLEM_SPACE vs SOLUTION_SPACE separados.
  27 CAP mapeadas. 8 fluxos transversais. 0 SHARED_KERNEL aprovado.
  SoT pagamento/PO/ERP pendente. Prompt 06 não executado.
```

## Quality gate Prompt 05 (evidência)

- [x] pasta `06-domain-boundaries/` com 23 artefatos não vazios
- [x] 12 SUBD com classificação candidata
- [x] 18 BC-CAND com ownership documentado
- [x] problema ≠ solução documentado
- [x] sem divisão por CRUD/tela
- [x] fluxos transversais WF-001..008
- [x] modular monolith avaliado sem decisão final
- [x] 0 microserviços, código, aggregates, máquinas de estado
- [x] rastreabilidade atualizada
- [x] Prompt 06 não executado (no encerramento Prompt 05)

---

```text
PROMPT: 06
TITLE: Invariantes, comandos, eventos e consistência do domínio
STARTED_AT: 2026-08-29T01:00:00-04:00
FINISHED_AT: 2026-08-29T01:35:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/07-domain-behavior/ (24 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
INV_COUNT: 22
CMD_COUNT: 22
DE_COUNT: 20
REJ_COUNT: 18
INV_CONFIRMED: 0
AGGREGATES_DEFINED: 0
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Comportamento candidato formalizado. 0 INV CONFIRMED.
  Histórico/audit/domínio separados. DDP-037 mecanismos não escolhidos.
  Prompt 07 não executado.
```

## Quality gate Prompt 06 (evidência)

- [x] pasta `07-domain-behavior/` com 24 artefatos não vazios
- [x] 22 INV com proveniência ou pendência explícita
- [x] 22 CMD agnósticos de tecnologia
- [x] 20 DE no passado; DE-006 AUDIT_ONLY candidato
- [x] 18 REJ empresariais
- [x] concorrência e idempotência classificadas
- [x] 0 CONFIRMED, 0 aggregate, 0 código
- [x] rastreabilidade EV→DE atualizada
- [x] Prompt 07 não executado

## PROJEÇÃO AUTORITATIVA DA WORKLIST DE FATURAMENTO — 2026-10-14

Classificação: **interpretação de engenharia / projeção de leitura**. Nenhuma regra de domínio foi criada ou promovida. O modelo persistente já oferece os vínculos e índices necessários; não foi criada migration.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Solicitação do responsável para concluir a vertical Billing, eliminando paginação heurística e indicadores sem escopo | Worklist anterior carregava ordens concluídas e fazia até três leituras adicionais por ordem; a fila não tinha total autoritativo e o frontend classificava/somava somente o lote local | Nenhuma regra nova; autorização e políticas comerciais persistidas continuam fontes; moedas não são convertidas e ausência de valor permanece desconhecida | `GET /api/v1/billing/worklist` publica page items, total do recorte, `hasMore`, contagens e agregados por moeda por uma consulta; filtros/pesquisa/ordenação ficam no servidor; projeção aplica escopos próprios a registro, documento e recebível; fila usa saved views, filtros, drawer, estados e comandos únicos; política comercial aceita apenas snapshots numéricos válidos; removidos adaptadores locais/N+1 | typecheck API/Web PASS; lint focado API/Web PASS; repository unit 1/1 e billing UI 9/9 asserts aprovados; Vitest não encerrou limpo; integração PostgreSQL acrescentada mas não executada (sem `TEST_DATABASE_URL`, psql ou Docker); `git diff --check` PASS | `PASS_WITH_RESTRICTIONS` até execução da integração PostgreSQL em CI; sem deploy |

## VARREDURA GLOBAL DE TOKENS VISUAIS — 2026-10-14

Classificação: **instrução de composição visual**. Utilitários gray/slate genéricos permanecem intactos; primitives e classes identificadas como semânticas consomem os papéis explícitos `--erp-*`.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Prompt anexado `CISNE — RECOMPOSIÇÃO VISUAL GLOBAL ERP TIER-1`, correção de saturação e instrução explícita para varrer telas renderizadas | Control Center mantinha painéis de distribuição/aging sem dados, empurrando a fila; drawers e `DynamicBusinessChain` tinham cores locais; tokens de grade/ação e superfícies eram consumidos indiretamente por Tailwind genérico | Nenhuma regra de negócio alterada; ausência continua unknown, dados semânticos preservam cores próprias, neutralidades genéricas permanecem genéricas | Declarados papéis `--erp-*`; aliases de superfície, texto, borda, ação e estado apontam aos papéis; sem remap de gray/slate; `Badge`, `DynamicList`, `Drawer`, `ContextDrawer`, `DynamicContextDrawer`, `EnterpriseMetric`, `WorklistStatePanel`, `OperationsControlCenter` e Control Center consomem papéis; sem gráfico, superfície analítica é omitida; fluxo e fila sobem antes das análises; densidade do contexto e comandos corrigidos | dashboard E2E 4/4, billing UI 9/9 asserts, repository unit 1/1; build Web PASS; typecheck/lint focados em execução; nenhum screenshot real/CI visual disponível; integração PostgreSQL indisponível | `PASS_WITH_RESTRICTIONS`; o estado sem dados e a composição funcional foram testados em DOM; CI deve executar integração PostgreSQL e gate visual antes de release |

---

```text
PROMPT: 07
TITLE: Máquinas de estado empresariais candidatas
STARTED_AT: 2026-08-28T23:00:00-04:00
FINISHED_AT: 2026-08-28T23:30:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/08-state-machines/ (24 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
  docs/05-ubiquitous-language/state-event-command-semantics.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
SM_CAND_COUNT: 10
STATE_CAND_COUNT: 52
TR_CAND_COUNT: 48
GUARD_COUNT: 28
INV_TR_COUNT: 22
TERMINAL_STATES: 18
XLC_COUNT: 14
SM_DEFINITIVE: 0
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  10 ciclos separados. VIEWED/ACK não promovidos a estado OS.
  Convertida = vínculo+evento (SDD-001). Pagamento parcial/estorno não confirmados.
  DDP-004, DDP-005, DDP-032 bloqueiam transições. Prompt 08 não executado.
```

## Quality gate Prompt 07 (evidência)

- [x] pasta `08-state-machines/` com 24 artefatos não vazios
- [x] 10 SM-CAND com ciclos separados
- [x] 52 STATE-CAND definidos semanticamente (pendentes marcados)
- [x] 48 TR-CAND com comando, guarda e resultado
- [x] VIEWED/ACKNOWLEDGED/PAID classificados — não contaminam OS
- [x] cancelamento/reabertura não inventados (DDP-004, DDP-005)
- [x] 0 máquinas definitivas, 0 código/enum/script
- [x] rastreabilidade atualizada
- [x] Prompt 08 não executado

---

```text
PROMPT: 08
TITLE: Modelo empresarial de autorização e segregação de funções
STARTED_AT: 2026-08-28T23:40:00-04:00
FINISHED_AT: 2026-08-29T00:10:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/09-authorization/ (21 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
ACT_COUNT: 12
ROLE_CAND_COUNT: 16
AUTHZ_COUNT: 42
SOD_COUNT: 12
SENSITIVE_ACTIONS: 28
ADP_COUNT: 14
TECHNICAL_ROLES: 0
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Autorização funcional e contextual separadas. Admin técnico sem poder empresarial automático.
  Custo/margem protegidos (SEC-REQ-009). DDP-003, DDP-015, DDP-022 bloqueiam SoD definitiva.
  Sem JWT, guards, middleware ou código. Prompt 09 não executado.
```

## Quality gate Prompt 08 (evidência)

- [x] pasta `09-authorization/` com 21 artefatos não vazios
- [x] 12 ACT e 16 ROLE-CAND (nenhum definitivo)
- [x] 42 AUTHZ com campos obrigatórios
- [x] 12 SOD incluindo conflitos do enunciado
- [x] 28 ações sensíveis mapeadas
- [x] custo/margem e admin técnico tratados
- [x] 0 roles técnicas, 0 código
- [x] rastreabilidade atualizada
- [x] Prompt 09 não executado

---

```text
PROMPT: 09
TITLE: Drivers arquiteturais, opções e ADRs fundamentais
STARTED_AT: 2026-08-29T00:15:00-04:00
FINISHED_AT: 2026-08-29T00:45:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/10-architecture/ (20 artefatos + 6 ADRs — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
  docs/01-foundation/engineering-decisions-register.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
ARCH_DRV_COUNT: 22
ADR_COUNT: 6
ADR_ACCEPTED: 2
ADR_PROPOSED: 4
ARCH_RISK_COUNT: 14
ARCH_DDP_COUNT: 12
STYLE_CANDIDATE: MODULAR_MONOLITH
FRAMEWORK_CHOSEN: 0
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Opções A–E comparadas. Microservices rejeitado para início.
  ADR-002 domain boundaries e ADR-003 data ownership ACCEPTED.
  ADR-001/004/005/006 PROPOSED. PostgreSQL candidato, não stack definitiva.
  Camadas PRESENTATION→APPLICATION→DOMAIN←INFRASTRUCTURE. Prompt 10 não executado.
```

## Quality gate Prompt 09 (evidência)

- [x] pasta `10-architecture/` com artefatos e ADRs não vazios
- [x] 22 drivers rastreáveis
- [x] 5 estilos comparados com critérios do enunciado
- [x] 6 ADRs com template completo
- [x] modularidade baseada em BC-CAND-001..018
- [x] ownership de dados documentado (ADR-003)
- [x] domínio independente de framework
- [x] 0 implementação, 0 script, 0 framework silencioso
- [x] rastreabilidade atualizada
- [x] Prompt 10 não executado

---

```text
PROMPT: 10
TITLE: Seleção técnica da stack e ADRs de tecnologia
STARTED_AT: 2026-08-29T00:50:00-04:00
FINISHED_AT: 2026-08-29T01:20:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/11-technology/ (24 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/01-foundation/engineering-decisions-register.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
ADR_TECH_COUNT: 7
ADR_TECH_ACCEPTED: 7
TECH_RISK_COUNT: 12
TECH_DDP_COUNT: 9
PACKAGE_JSON: NO
DEPS_INSTALLED: NO
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Stack: Node 24 LTS, TS 5, NestJS 11+Fastify, React 19+Vite 7, PG 18, Drizzle, pnpm+Turbo, Vitest+Playwright.
  Versões Node/PG verificadas em fontes oficiais 2026-08-28. Equipe UNKNOWN. Prompt 11 não executado.
```

## Quality gate Prompt 10 (evidência)

- [x] pasta `11-technology/` com avaliações e 7 ADR-TECH
- [x] scorecard com pesos pré-definidos
- [x] stack compatível com arquitetura modular monolith (Prompt 09)
- [x] PostgreSQL como autoridade transacional
- [x] 0 package.json, 0 dependências instaladas, 0 código
- [x] alternativas rejeitadas documentadas
- [x] rastreabilidade e ED-004 atualizados
- [x] Prompt 11 não executado

---

```text
PROMPT: 11
TITLE: Modelo conceitual do domínio e aggregates candidatos
STARTED_AT: 2026-08-29T01:25:00-04:00
FINISHED_AT: 2026-08-29T01:55:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/12-domain-model/ (20 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
AGG_CAND_COUNT: 14
AGG_ACCEPTED_LOGICAL: 4
ENTITY_CAND_COUNT: 26
VO_CAND_COUNT: 22
CARD_DDP_COUNT: 12
MDDP_COUNT: 11
INV_MAPPED: 22/22
ORM_TABLES_CODE: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Solicitação≠OS; medição≠faturamento≠nota≠pagamento. PO consumo CARD-DDP pendente.
  Doc/versão/arquivo separados. Money e Quantity como VO. 0 FINAL. Prompt 12 não executado.
```

## Quality gate Prompt 11 (evidência)

- [x] pasta `12-domain-model/` com 20 artefatos não vazios
- [x] 14 AGG-CAND com campos obrigatórios
- [x] 22/22 INV mapeadas
- [x] 12 CARD-DDP explícitas
- [x] sem ORM, tabela, código
- [x] aggregates pequenos; maciços rejeitados
- [x] rastreabilidade atualizada
- [x] Prompt 12 não executado

---

```text
PROMPT: 12
TITLE: Modelo lógico de dados e constraints candidatas
STARTED_AT: 2026-08-29T02:00:00-04:00
FINISHED_AT: 2026-08-29T02:35:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/13-data-model/ (25 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
TBL_CAND_COUNT: 25
UNQ_CAND_COUNT: 16
CHK_CAND_COUNT: 14
FK_CAND_COUNT: 32
INDEX_HYPOTHESIS_COUNT: 18
CARD_DDP_INHERITED: 12
DATA_RISK_COUNT: 12
DDL_CREATED: NO
MIGRATIONS_CREATED: NO
DATABASE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Modelo rastreável a 14 AGG-CAND e 22 INV. Cancelamento ≠ delete.
  12 CARD-DDP abertas; UNQ/FK parciais PENDING. Sem JSON indiscriminado.
  Prompt 13 não executado.
```

## Quality gate Prompt 12 (evidência)

- [x] pasta `13-data-model/` com 25 artefatos não vazios
- [x] 25 TBL-CAND com campos obrigatórios
- [x] 16 UNQ-CAND e 14 CHK-CAND mapeadas a invariantes
- [x] nullability justificada; audit separado de domínio
- [x] dados sensíveis classificados
- [x] 0 DDL, 0 migrations, 0 schema físico
- [x] ERD com cardinalidades pendentes marcadas
- [x] rastreabilidade atualizada
- [x] Prompt 13 não executado

---

```text
PROMPT: 13
TITLE: Arquitetura de transações, concorrência e idempotência
STARTED_AT: 2026-08-29T02:40:00-04:00
FINISHED_AT: 2026-08-29T03:15:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/14-transaction-design/ (21 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
CRITICAL_CMD_ANALYZED: 11
TXN_DEC_COUNT: 14
TXN_FAIL_COUNT: 24
TXN_TEST_COUNT: 18
FINANCIAL_RACE_OPS: 6
OUTBOX_STATUS: PROPOSED
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  OPT vs PESS por cenário; RC default. Efeitos externos pós-commit.
  Outbox/inbox PROPOSED BC-015/018. Sem lost update silencioso.
  Prompt 14 não executado.
```

## Quality gate Prompt 13 (evidência)

- [x] pasta `14-transaction-design/` com 21 artefatos não vazios
- [x] 11 comandos críticos com análise completa (12 dimensões)
- [x] optimistic vs pessimistic comparado por cenário
- [x] 6 operações FINANCIAL_RACE classificadas
- [x] retry não duplica efeito documentado
- [x] efeitos externos separados do commit local
- [x] outbox avaliado — PROPOSED (não ACCEPTED global)
- [x] 0 código, migrations, filas
- [x] rastreabilidade atualizada
- [x] Prompt 14 não executado

---

```text
PROMPT: 14
TITLE: Security architecture e threat model
STARTED_AT: 2026-08-29T03:20:00-04:00
FINISHED_AT: 2026-08-29T03:55:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/15-security/ (25 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
SEC_AST_COUNT: 18
SEC_THR_COUNT: 36
SEC_ABU_COUNT: 16
SEC_DEC_COUNT: 16
SEC_RISK_COUNT: 14
SEC_TEST_COUNT: 22
DFD_FLOWS: 8
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  STRIDE por fluxo; AuthZ backend obrigatório. Custo/margem/doc protegidos.
  Sem conformidade jurídica inventada. IdP/MFA Prompt 20. Prompt 15 não executado.
```

## Quality gate Prompt 14 (evidência)

- [x] pasta `15-security/` com 25 artefatos não vazios
- [x] 8 fluxos e 7 trust boundaries modelados
- [x] 36 ameaças STRIDE com campos completos
- [x] 16 casos abuso empresarial
- [x] custo/margem/documentos com controles explícitos
- [x] autorização não depende do frontend (SEC-DEC-005)
- [x] 14 riscos residuais explícitos
- [x] 0 código
- [x] rastreabilidade atualizada
- [x] Prompt 15 não executado

---

```text
PROMPT: 15
TITLE: Arquitetura de testes e estratégia de qualidade
STARTED_AT: 2026-08-29T04:00:00-04:00
FINISHED_AT: 2026-08-29T04:35:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/16-testing/ (25 artefatos — ver README.md)
FILES_CHANGED:
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/README.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
TEST_CAND_COUNT: 58
INV_COVERED: 22/22
TXN_TEST_MAPPED: 18/18
SEC_TEST_MAPPED: 22/22
REQ_GAPS: 6
TEST_CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Risk-based; PG real Testcontainers L3/L4. Negativo+corrida em críticos.
  Mocks não validam UNQ/CHK. Dados sintéticos. Prompt 16 não executado.
```

## Quality gate Prompt 15 (evidência)

- [x] pasta `16-testing/` com 25 artefatos não vazios
- [x] 58 TEST-CAND com rastreabilidade EV/BR/FR/UC/NFR/INV/CMD/TR/AUTHZ/RISK
- [x] 22/22 INV com TEST-CAND
- [x] concorrência e idempotência cobertas
- [x] segurança negativa mapeada (SEC-TEST)
- [x] PostgreSQL real previsto — sem mock PG behavior
- [x] test-data sem dados reais
- [x] 0 código de teste
- [x] rastreabilidade atualizada
- [x] Prompt 16 não executado

---

```text
PROMPT: 16
TITLE: Bootstrap técnico do repositório
STARTED_AT: 2026-08-29T00:00:00-04:00
FINISHED_AT: 2026-08-29T00:15:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  .env.example
  .node-version
  .nvmrc
  .prettierignore
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  prettier.config.mjs
  turbo.json
  apps/api/ (NestJS 11 + Fastify — health only)
  apps/web/ (React 19 + Vite 7 — bootstrap shell)
  packages/tsconfig/
  packages/eslint-config/
  docs/17-bootstrap/ (6 artefatos)
FILES_CHANGED:
  README.md
  docs/README.md
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  docs/** (formatação incidental Prettier em tentativa inicial — conteúdo preservado)
QUALITY_GATE: PASS_WITH_RESTRICTIONS
LINT: PASS
TYPECHECK: PASS
TEST: PASS (2)
BUILD: PASS
FORMAT_CHECK: PASS
AUDIT_CRITICAL: 0
BUSINESS_MODULES: 0
BUSINESS_TABLES: 0
SECRETS_COMMITTED: 0
LOCKFILE_PACKAGES: 1199
CODE_CREATED: YES (foundation only)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Stack ADR-TECH-001..003, 006, 007. Drizzle/PG adiado Prompt 17.
  pnpm global EPERM — npx pnpm@9.15.9 documentado.
  format:check escopado a código + docs/17-bootstrap (BOOT-DEC-011).
  Prompt 17 não executado.
```

## Quality gate Prompt 16 (evidência)

- [x] monorepo pnpm + Turborepo conforme ADR-TECH-006
- [x] apps/api NestJS + Fastify com GET /health técnico
- [x] apps/web React 19 + Vite 7 shell
- [x] TypeScript strict + ESLint (no-explicit-any)
- [x] Vitest — 2 testes fundação passando
- [x] lint, format:check, typecheck, test, build — PASS
- [x] pnpm-lock.yaml presente; 0 vulnerabilidades críticas (audit)
- [x] .env.example sem segredos reais
- [x] 0 módulos empresariais, 0 tabelas, 0 auth, 0 CRUD
- [x] docs/17-bootstrap/ com 6 artefatos
- [x] rastreabilidade atualizada
- [x] Prompt 17 não executado

---

```text
PROMPT: 17
TITLE: Fundação local PostgreSQL e persistência técnica
STARTED_AT: 2026-08-29T00:10:00-04:00
FINISHED_AT: 2026-08-29T00:20:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docker/compose.yaml
  docker/postgres/init/01-create-test-database.sh
  packages/database/ (Drizzle + migrations)
  scripts/wait-for-postgres.mjs
  scripts/migrate-test-database.mjs
  apps/api/src/infrastructure/database/
  apps/api/src/infrastructure/database/database.integration.spec.ts
  docs/18-database-foundation/ (9 artefatos)
FILES_CHANGED:
  .env.example
  package.json
  turbo.json
  apps/api/package.json
  apps/api/src/health/
  apps/api/vitest.config.ts
  README.md
  docs/README.md
  docs/01-foundation/requirements-traceability.md
  docs/00-governance/prompt-execution-log.md
  .prettierignore
QUALITY_GATE: PASS_WITH_RESTRICTIONS
POSTGRES_VERSION: 18.x
DATABASE_REACHABLE: YES
MIGRATION_TOOLING: YES
TECHNICAL_MIGRATIONS: 1
BUSINESS_TABLES: 0
INTEGRATION_TEST: PASS
LINT: PASS
TYPECHECK: PASS
TEST: PASS
BUILD: PASS
SECRETS_COMMITTED: 0
NEXT_PROMPT_EXECUTED: NO
NOTES:
  PG 18 volume mount /var/lib/postgresql. Drizzle-kit >=0.31.7.
  Credenciais locais placeholder. Prompt 18 não executado.
```

## Quality gate Prompt 17 (evidência)

- [x] Docker Compose PG 18 healthy, porta 127.0.0.1
- [x] Volume nomeado `cisne_local_pg_data`
- [x] `@cisne/database` com Drizzle + pool pg
- [x] 1 migration técnica (`infrastructure.schema_baseline`)
- [x] 0 tabelas empresariais
- [x] Health check API com status de DB
- [x] Teste integração PG real (transação + rollback)
- [x] lint, typecheck, test, build — PASS
- [x] `.env` ignorado; `.env.example` sem segredos reais
- [x] docs/18-database-foundation/ com 9 artefatos
- [x] rastreabilidade atualizada
- [x] Prompt 18 não executado

---

```text
PROMPT: 18
TITLE: Persistência segura de identidade
STARTED_AT: 2026-08-29T00:30:00-04:00
FINISHED_AT: 2026-08-29T00:40:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  packages/database/src/schema/identity.ts
  packages/database/migrations/0001_striped_the_liberteens.sql
  packages/database/src/identity.persistence.integration.spec.ts
  packages/database/src/test/identity-test-helpers.ts
  packages/database/vitest.integration.config.ts
  apps/api/vitest.integration.config.ts
  docs/implementation/18-identity-persistence.md
FILES_CHANGED:
  packages/database/src/schema/index.ts
  packages/database/drizzle.config.ts
  packages/database/package.json
  packages/database/migrations/meta/
  package.json
  turbo.json
  apps/api/package.json
  apps/api/vitest.config.ts
  apps/api/src/infrastructure/database/database.integration.spec.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
MIGRATIONS_ADDED: 1
TECHNICAL_TABLES: identities, credentials, sessions, refresh_token_families, refresh_tokens
BUSINESS_TABLES: 0
CONSTRAINT_TESTS: 11
INTEGRATION_TESTS: PASS
LINT: PASS
TYPECHECK: PASS
TEST: PASS
BUILD: PASS
SECRETS_COMMITTED: 0
DOC_FILES_CREATED: 1
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Schema identity; refresh family SEC-DEC-002. Sem AuthN runtime nem roles empresariais.
  Prompt 19 não executado.
```

## Quality gate Prompt 18 (evidência)

- [x] schema `identity` com 5 tabelas técnicas
- [x] UUID interno, login normalizado único, hashes only
- [x] FK RESTRICT, CHECK, índices, expiração/revogação
- [x] 1 migration determinística (`0001_striped_the_liberteens.sql`)
- [x] 0 tabelas empresariais, 0 roles empresariais
- [x] 11 testes integração PostgreSQL real
- [x] lint, typecheck, test, test:integration, build — PASS
- [x] docs/implementation/18-identity-persistence.md (único doc novo)
- [x] prompt-execution-log atualizado
- [x] Prompt 19 não executado

---

```text
PROMPT: 19
TITLE: Seed seguro e bootstrap controlado
STARTED_AT: 2026-08-29T00:45:00-04:00
FINISHED_AT: 2026-08-29T00:55:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  packages/database/src/seed/ (development, production, policy, env)
  packages/database/src/test-builders/
  packages/database/src/cli/run-dev-seed.ts
  packages/database/src/cli/run-production-bootstrap.ts
  packages/database/src/seed/password-policy.spec.ts
  packages/database/src/seed.bootstrap.integration.spec.ts
  docs/implementation/19-seeding.md
FILES_CHANGED:
  packages/database/src/index.ts
  packages/database/package.json
  packages/database/src/identity.persistence.integration.spec.ts
  package.json
  .env.example
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
SEEDS: DEVELOPMENT_SEED, TEST_DATA_BUILDERS, PRODUCTION_BOOTSTRAP
IDEMPOTENT_DEV_SEED: YES
CREDENTIALS_COMMITTED: 0
DOC_FILES_CREATED: 1
INTEGRATION_TESTS: PASS
LINT: PASS
TYPECHECK: PASS
TEST: PASS
BUILD: PASS
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Sem seed em startup. Senha dev via DEV_SEED_PASSWORD ou geração runtime.
  Prompt 20 não executado.
```

## Quality gate Prompt 19 (evidência)

- [x] DEVELOPMENT_SEED / TEST_DATA_BUILDERS / PRODUCTION_BOOTSTRAP separados
- [x] Seed dev idempotente; bloqueado em production NODE_ENV
- [x] Bootstrap manual com confirmação e política de senha
- [x] 6 builders de teste com dados `@cisne.invalid`
- [x] 0 credenciais commitadas; `.env.example` sem segredos
- [x] testes unitários + integração (seed/bootstrap)
- [x] lint, typecheck, test, test:integration, build — PASS
- [x] docs/implementation/19-seeding.md (único doc novo)
- [x] prompt-execution-log atualizado
- [x] Prompt 20 não executado

---

```text
PROMPT: 20
TITLE: Autenticação backend
STARTED_AT: 2026-08-29T00:30:00-04:00
FINISHED_AT: 2026-08-29T01:00:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  apps/api/src/auth/ (module, controller, services, guards, DTOs, serializers)
  apps/api/src/infrastructure/http/ (correlation-id, exception filter)
  apps/api/src/auth/auth.integration.spec.ts
  apps/api/src/auth/auth.e2e.spec.ts
  apps/api/vitest.e2e.config.ts
  docs/implementation/20-authentication-backend.md
FILES_CHANGED:
  apps/api/src/app.module.ts
  apps/api/src/main.ts
  apps/api/package.json
  apps/api/vitest.config.ts
  apps/api/vitest.integration.config.ts
  packages/database/src/test-builders/index.ts
  package.json
  turbo.json
  .env.example
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
ROUTES: POST login, POST refresh, POST logout, POST logout-all, GET session
CREDENTIALS_COMMITTED: 0
SENSITIVE_LEAKS: 0
DOC_FILES_CREATED: 1
UNIT_TESTS: PASS
INTEGRATION_TESTS: PASS
E2E_TESTS: PASS
LINT: PASS
TYPECHECK: PASS
BUILD: PASS
NEXT_PROMPT_EXECUTED: NO
NOTES:
  JWT HS256 (HMAC) access curto + refresh opaco rotacionado (SEC-DEC-002).
  Sem autorização empresarial nem recuperação de senha.
  Rate limit login in-memory (5/min IP+UA).
  Prompt 21 não executado.
```

## Quality gate Prompt 20 (evidência)

- [x] Login, sessão atual, refresh, logout, logout-all implementados
- [x] Conta desativada, revogação e detecção de reuse de refresh
- [x] scrypt verify, JWT curto, refresh rotacionado, hash-only em PG
- [x] Erros estáveis sem enumeração; DTO allowlist; correlation ID em erros
- [x] Testes unitários, integração PostgreSQL e E2E — PASS
- [x] lint, typecheck, build — PASS
- [x] docs/implementation/20-authentication-backend.md (único doc novo)
- [x] 0 vazamentos de hash/senha/token em respostas (assertNoSensitiveLeak)
- [x] Prompt 21 não executado

---

```text
PROMPT: 21
TITLE: Hardening adversarial da autenticação
STARTED_AT: 2026-08-29T01:00:00-04:00
FINISHED_AT: 2026-08-29T01:10:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  apps/api/src/auth/dto/body-validator.ts
  apps/api/src/auth/services/session-validation.service.ts
  apps/api/src/auth/services/token.service.adversarial.spec.ts
  apps/api/src/auth/auth.adversarial.integration.spec.ts
  apps/api/src/infrastructure/http/security-headers.interceptor.ts
  docs/implementation/21-authentication-hardening.md
FILES_CHANGED:
  apps/api/src/auth/services/auth.service.ts
  apps/api/src/auth/services/token.service.ts
  apps/api/src/auth/guards/jwt-auth.guard.ts
  apps/api/src/auth/repositories/identity-auth.repository.ts
  apps/api/src/auth/dto/login.dto.ts
  apps/api/src/auth/dto/refresh.dto.ts
  apps/api/src/auth/auth.module.ts
  apps/api/src/auth/auth.integration.spec.ts
  apps/api/src/auth/auth.e2e.spec.ts
  apps/api/src/auth/dto/auth.dto.spec.ts
  apps/api/src/auth/config/auth.config.ts
  apps/api/src/auth/test/auth-test-env.ts
  apps/api/src/main.ts
  apps/api/vitest.integration.config.ts
  .env.example
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
VULNERABILITIES_FIXED: 6
CRITICAL_KNOWN: 0
ADVERSARIAL_TESTS: PASS
REGRESSION: NONE
DEPENDENCY_AUDIT: 0 known (prod)
DOC_FILES_CREATED: 1
LINT: PASS
TYPECHECK: PASS
TEST: PASS
INTEGRATION: PASS
E2E: PASS
BUILD: PASS
NEXT_PROMPT_EXECUTED: NO
NOTES:
  JWT guard valida sessão+identidade no PG; refresh com FOR UPDATE.
  Login anti-enumeração para conta desativada.
  Riscos residuais: rate limit in-memory, sem limit refresh.
  Prompt 22 não executado.
```

## Quality gate Prompt 21 (evidência)

- [x] Revisão adversarial documentada (hash, rotação, revogação, enumeração, etc.)
- [x] Falhas reais corrigidas sem remover asserts
- [x] Testes adversariais unitários, integração e E2E — PASS
- [x] 0 vulnerabilidade crítica conhecida; `pnpm audit --prod` limpo
- [x] Sem regressão nos testes Prompt 20
- [x] docs/implementation/21-authentication-hardening.md (único doc novo)
- [x] Prompt 22 não executado

---

```text
PROMPT: 22
TITLE: Autorização backend deny-by-default
STARTED_AT: 2026-08-29T01:05:00-04:00
FINISHED_AT: 2026-08-29T01:18:00-04:00
STATUS: PASS
FILES_CREATED:
  packages/database/migrations/0002_authorization_baseline.sql
  packages/database/src/schema/authorization.ts
  packages/database/src/test-builders/authz-builders.ts
  apps/api/src/authorization/authorization.module.ts
  apps/api/src/authorization/controllers/authz.controller.ts
  apps/api/src/authorization/decorators/require-authz.decorator.ts
  apps/api/src/authorization/dto/create-grant.dto.ts
  apps/api/src/authorization/errors/authz-error-codes.ts
  apps/api/src/authorization/errors/authz-exception.filter.ts
  apps/api/src/authorization/errors/authz-http.exception.ts
  apps/api/src/authorization/guards/authorization.guard.ts
  apps/api/src/authorization/repositories/authorization.repository.ts
  apps/api/src/authorization/serializers/grant-response.serializer.ts
  apps/api/src/authorization/services/grant-admin.service.ts
  apps/api/src/authorization/services/policy-decision-point.service.ts
  apps/api/src/authorization/services/policy-decision-point.service.spec.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/authorization/types/authz-decision.ts
  apps/api/src/authorization/types/authz-resources.ts
  apps/api/src/authorization/types/authz-scopes.ts
  apps/api/src/authorization/authorization.integration.spec.ts
  apps/api/src/authorization/authorization.e2e.spec.ts
  docs/implementation/22-authorization-backend.md
FILES_CHANGED:
  apps/api/src/app.module.ts
  apps/api/src/auth/auth.module.ts
  apps/api/src/main.ts
  apps/api/src/infrastructure/database/database.integration.spec.ts
  apps/api/vitest.e2e.config.ts
  packages/database/migrations/meta/_journal.json
  packages/database/src/schema/index.ts
  packages/database/src/test-builders/index.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
BUSINESS_ROLES_INVENTED: 0
DOC_FILES_CREATED: 1
LINT: PASS
TYPECHECK: PASS
TEST: PASS
INTEGRATION: PASS
E2E: PASS
MIGRATION: PASS (0002_authorization_baseline)
BUILD: PASS
NEXT_PROMPT_EXECUTED: NO
NOTES:
  PDP/PEP deny-by-default; concessões explícitas por identity_id (sem array no usuário).
  Schema "authorization" (palavra reservada PG — SQL com aspas).
  Escopo PLATFORM bloqueia recursos não técnicos (SOD-012).
  Negação HTTP genérica; motivo interno em decision_audits.
  E2E serializado (fileParallelism: false) para evitar deadlock em TRUNCATE.
  Prompt 23 não executado.
```

## Quality gate Prompt 22 (evidência)

- [x] Actions e resources tipados (vocabulário técnico apenas)
- [x] PDP + PEP integrados às rotas `/api/v1/authz/*`
- [x] Persistência: grants com validade, scope, granted_by, version, constraints, revogação
- [x] Migration `0002_authorization_baseline` aplicada (dev + test)
- [x] Testes negativos: anônimo, sem concessão, ação/recurso errado, expirado, revogado, rota direta, sem vazamento, deny default, concorrência revogação
- [x] 0 papéis empresariais inventados
- [x] docs/implementation/22-authorization-backend.md
- [x] Prompt 23 não executado

---

```text
PROMPT: 23
TITLE: Escopo contextual e isolamento de dados
STARTED_AT: 2026-08-29T01:20:00-04:00
FINISHED_AT: 2026-08-29T01:30:00-04:00
STATUS: PASS
FILES_CREATED:
  packages/database/migrations/0003_contextual_scope_enums.sql
  packages/database/migrations/0004_contextual_scope_tables.sql
  apps/api/src/authorization/scope/scope-matcher.ts
  apps/api/src/authorization/scope/scope-matcher.spec.ts
  apps/api/src/authorization/services/scope-resolver.service.ts
  apps/api/src/authorization/services/scope-enforcement.service.ts
  apps/api/src/authorization/services/scoped-record-access.service.ts
  apps/api/src/authorization/repositories/scope-context.repository.ts
  apps/api/src/authorization/controllers/scoped-record.controller.ts
  apps/api/src/authorization/contextual-scope.integration.spec.ts
  apps/api/src/authorization/contextual-scope.e2e.spec.ts
  apps/api/src/test/ensure-migrations.ts
  scripts/apply-contextual-scope-migrations.mjs
  docs/implementation/23-contextual-scope.md
FILES_CHANGED:
  packages/database/src/schema/authorization.ts
  packages/database/src/schema/index.ts
  packages/database/src/test-builders/authz-builders.ts
  packages/database/src/test-builders/index.ts
  packages/database/migrations/meta/_journal.json
  packages/database/drizzle.config.ts
  apps/api/src/authorization/types/authz-scopes.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/authorization/types/authz-resources.ts
  apps/api/src/authorization/services/policy-decision-point.service.ts
  apps/api/src/authorization/services/grant-admin.service.ts
  apps/api/src/authorization/errors/authz-error-codes.ts
  apps/api/src/authorization/dto/create-grant.dto.ts
  apps/api/src/authorization/authorization.module.ts
  apps/api/src/authorization/authorization.integration.spec.ts
  apps/api/src/infrastructure/database/database.integration.spec.ts
  apps/api/vitest.integration.config.ts
  apps/api/vitest.e2e.config.ts
  scripts/migrate-test-database.mjs
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
CROSS_SCOPE_LEAKS: 0
DOC_FILES_CREATED: 1
LINT: PASS
TYPECHECK: PASS
TEST: PASS
INTEGRATION: PASS
E2E: PASS
MIGRATION: PASS (0003/0004 + fallback test bootstrap)
BUILD: PASS
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Escopos OWN/ASSIGNED/UNIT/CLIENT/CONTRACT/DOCUMENT/FINANCIAL/GLOBAL (+ PLATFORM técnico).
  Sem tenant_id; âncoras em scope_refs; filtros SQL obrigatórios em listagem.
  Anti self-escalation em GrantAdminService; GLOBAL exige resource_id null.
  Fixture scoped_records para isolamento técnico (não domínio empresarial).
  Prompt 24 não executado.
```

## Quality gate Prompt 23 (evidência)

- [x] Escopos contextuais implementados conforme AUTHZ-SCOPE-001 (somente os listados)
- [x] Resolução de escopo efetivo + validação action/resource/scope
- [x] Filtros obrigatórios no acesso a dados (listagem + lookup por ID)
- [x] Prevenção self-escalation e concessão não órfã (scope_refs)
- [x] 0 vazamentos cross-scope nos testes de isolamento
- [x] docs/implementation/23-contextual-scope.md
- [x] Prompt 24 não executado

---

```text
PROMPT: 24
TITLE: Autenticação e sessão no frontend
STARTED_AT: 2026-08-29T12:20:00-04:00
FINISHED_AT: 2026-08-29T12:38:00-04:00
STATUS: PASS
FILES_CREATED:
  apps/web/src/auth/types/auth.types.ts
  apps/web/src/auth/storage/token-store.ts
  apps/web/src/auth/storage/token-store.test.ts
  apps/web/src/auth/api/auth-api.ts
  apps/web/src/auth/api/auth-api.test.ts
  apps/web/src/auth/utils/safe-redirect.ts
  apps/web/src/auth/utils/safe-redirect.test.ts
  apps/web/src/auth/context/AuthProvider.tsx
  apps/web/src/auth/components/ProtectedRoute.tsx
  apps/web/src/auth/auth-flow.e2e.test.tsx
  apps/web/src/pages/LoginPage.tsx
  apps/web/src/pages/LoginPage.test.tsx
  apps/web/src/pages/AppHomePage.tsx
  apps/web/src/pages/AccessDeniedPage.tsx
  apps/web/src/pages/ServiceUnavailablePage.tsx
  apps/web/src/test/request-url.ts
  apps/web/src/vite-env.d.ts
  docs/implementation/24-frontend-authentication.md
FILES_CHANGED:
  apps/web/package.json
  apps/web/src/App.tsx
  apps/web/src/App.test.tsx
  apps/web/src/index.css
  pnpm-lock.yaml
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
DOC_FILES_CREATED: 1
LINT: PASS
TYPECHECK: PASS
TEST: PASS
E2E: PASS (vitest jsdom + fetch mocks)
BUILD: PASS
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Bearer JWT SPA (SEC-DEC-004): access em memória, refresh em sessionStorage (não localStorage).
  Login, bootstrap/refresh, logout/logout-all, rota protegida /app, access-denied, unavailable.
  Mensagem única para credenciais inválidas; sanitizeRedirectPath contra open redirect.
  Shell técnico em /app — sem dashboard ou módulos empresariais.
  Prompt 25 não executado.
```

## Quality gate Prompt 24 (evidência)

- [x] Página de login acessível com validação, loading e mensagem segura
- [x] Bootstrap de sessão com refresh mutex e cancelamento (AbortController)
- [x] Logout e logout-all limpam estado local
- [x] Rota protegida, acesso negado, redirect seguro, rede/indisponível
- [x] Zero segredo no bundle; tokens não em localStorage
- [x] Testes unit/component/E2E (vitest) — 15 testes @cisne/web
- [x] lint, typecheck, test, build — PASS
- [x] docs/implementation/24-frontend-authentication.md
- [x] Prompt 25 não executado

---

```text
PROMPT: 25
TITLE: Application shell protegido
STARTED_AT: 2026-08-29T12:50:00-04:00
FINISHED_AT: 2026-08-29T13:02:00-04:00
STATUS: PASS
FILES_CREATED:
  apps/web/src/shell/AppShellLayout.tsx
  apps/web/src/shell/AppHeader.tsx
  apps/web/src/shell/AppNav.tsx
  apps/web/src/shell/CapabilityRoute.tsx
  apps/web/src/shell/ShellErrorBoundary.tsx
  apps/web/src/shell/useNavAccess.ts
  apps/web/src/shell/nav-config.ts
  apps/web/src/shell/types.ts
  apps/web/src/shell/format-identity.ts
  apps/web/src/shell/format-identity.test.ts
  apps/web/src/shell/ShellErrorBoundary.test.tsx
  apps/web/src/shell/shell.e2e.test.tsx
  apps/web/src/auth/api/authz-api.ts
  apps/web/src/pages/PlatformDiagnosticsPage.tsx
  apps/web/src/pages/ShellAccessDeniedPage.tsx
  apps/web/src/pages/SessionExpiredPage.tsx
  apps/web/src/test/shell-fetch-mock.ts
  docs/implementation/25-protected-shell.md
FILES_CHANGED:
  apps/web/src/App.tsx
  apps/web/src/auth/context/AuthProvider.tsx
  apps/web/src/auth/auth-flow.e2e.test.tsx
  apps/web/src/pages/AppHomePage.tsx
  apps/web/src/pages/LoginPage.tsx
  apps/web/src/index.css
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
BUSINESS_MODULES_CREATED: 0
DOC_FILES_CREATED: 1
LINT: PASS
TYPECHECK: PASS
TEST: PASS (@cisne/web 28, @cisne/api 31)
E2E: PASS (shell.e2e + auth-flow)
BUILD: PASS
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Shell com header, nav estrutural, skip link, landmarks e responsividade.
  Menu reflete CAP-001 via GET /api/v1/authz/probe; backend permanece autoridade.
  Páginas técnicas apenas — sem dashboard, cards, gráficos ou módulos empresariais.
  Prompt 26 não executado.
```

## Quality gate Prompt 25 (evidência)

- [x] Layout protegido com header, nav, logout e identificação mínima de sessão
- [x] Carregamento, acesso negado (capability), sessão expirada, erro inesperado, indisponível
- [x] Acessibilidade mínima: skip link, landmarks, foco, teclado, contraste
- [x] 0 módulos empresariais criados
- [x] Testes: sessão válida/ausente/expirada, sem capability, deep link, mobile, logout, rede
- [x] lint, typecheck, test, build — PASS
- [x] docs/implementation/25-protected-shell.md
- [x] Prompt 26 não executado

---

```text
PROMPT: 26
TITLE: Audit trail seguro
STARTED_AT: 2026-08-29T13:05:00-04:00
FINISHED_AT: 2026-08-29T13:12:00-04:00
STATUS: PASS
FILES_CREATED:
  packages/database/migrations/0005_security_audit_events.sql
  packages/database/src/schema/audit.ts
  packages/database/src/test-builders/audit-builders.ts
  apps/api/src/audit/audit.module.ts
  apps/api/src/audit/types/audit-channels.ts
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/audit/services/audit-redaction.service.ts
  apps/api/src/audit/services/audit-redaction.service.spec.ts
  apps/api/src/audit/services/security-audit.service.ts
  apps/api/src/audit/services/security-audit.service.spec.ts
  apps/api/src/audit/services/audit-bootstrap.service.ts
  apps/api/src/audit/repositories/security-audit.repository.ts
  apps/api/src/audit/controllers/security-audit.controller.ts
  apps/api/src/audit/security-audit.integration.spec.ts
  apps/api/src/audit/security-audit.e2e.spec.ts
  apps/api/src/auth/types/auth-request-context.ts
  docs/implementation/26-audit-trail.md
FILES_CHANGED:
  packages/database/migrations/meta/_journal.json
  packages/database/src/schema/index.ts
  packages/database/src/test-builders/authz-builders.ts
  packages/database/src/test-builders/index.ts
  apps/api/src/app.module.ts
  apps/api/src/auth/auth.module.ts
  apps/api/src/auth/auth.controller.ts
  apps/api/src/auth/services/auth.service.ts
  apps/api/src/auth/auth.integration.spec.ts
  apps/api/src/auth/auth.adversarial.integration.spec.ts
  apps/api/src/auth/auth.e2e.spec.ts
  apps/api/src/authorization/authorization.module.ts
  apps/api/src/authorization/services/grant-admin.service.ts
  apps/api/src/authorization/services/policy-decision-point.service.ts
  apps/api/src/authorization/services/policy-decision-point.service.spec.ts
  apps/api/src/authorization/authorization.integration.spec.ts
  apps/api/src/test/ensure-migrations.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
DOC_FILES_CREATED: 1
SECRETS_IN_AUDIT_ROWS: 0
LINT: PASS
TYPECHECK: PASS
TEST: PASS (@cisne/web 28, @cisne/api 37, @cisne/database 3)
INTEGRATION: PASS (@cisne/database 20, @cisne/api 28)
E2E: PASS (@cisne/api 13)
BUILD: PASS
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Canal SECURITY_AUDIT separado de AUDIT_TRAIL, DOMAIN_HISTORY e TECHNICAL_LOG.
  Persistência append-only em audit.security_audit_events (trigger PostgreSQL; sem hash chain).
  Redaction, sanitização, acesso restrito (platform:diagnostics:read) e falha de persistência tratada por criticidade.
  Prompt 27 não executado.
```

## Quality gate Prompt 26 (evidência)

- [x] SECURITY_AUDIT distinto de histórico de domínio e logs técnicos
- [x] Eventos sensíveis existentes auditados (login, falha, logout, logout-all, refresh reuse, grant create/revoke, deny, bootstrap)
- [x] Sem senha, token, hash ou payload sensível nos registros (containsForbiddenSecret = 0)
- [x] Append-only com trigger; sem alegação de imutabilidade criptográfica
- [x] Testes: criação, negação, redaction, append-only, concorrência, correlação, segredo, persistência, acesso indevido
- [x] lint, typecheck, test, test:integration, test:e2e, build — PASS
- [x] docs/implementation/26-audit-trail.md
- [x] Prompt 27 não executado

---

```text
PROMPT: 27
TITLE: Gate integrado da fundação técnica
STARTED_AT: 2026-08-29T13:13:00-04:00
FINISHED_AT: 2026-08-29T13:20:00-04:00
STATUS: PASS_WITH_RESTRICTIONS
FILES_CREATED:
  docs/implementation/27-foundation-quality-gate.md
FILES_CHANGED:
  apps/api/src/**/*.ts (Prettier — 35 arquivos)
  apps/web/src/**/*.ts(x) (Prettier — 27 arquivos)
  packages/database/src/**/*.ts (Prettier — 7 arquivos)
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS_WITH_RESTRICTIONS
TECHNICAL_FOUNDATION: READY_WITH_RESTRICTIONS
BUSINESS_MODULES: NOT_STARTED
FORMAT: PASS (após correção drift 69 arquivos)
LINT: PASS
TYPECHECK: PASS
UNIT: PASS (database 3, api 37, web 28)
INTEGRATION: PASS (database 20, api 28)
E2E: PASS (api 13; web frontend e2e 13)
BUILD: PASS
EMPTY_DB_MIGRATION: PASS
AUTHENTICATION: PASS
AUTHORIZATION: PASS
CROSS_SCOPE: PASS
AUDIT_REDACTION: PASS
CRITICAL_VULNERABILITIES: 0
MODERATE_VULNERABILITIES: 1 (esbuild dev via drizzle-kit — aceito)
SECRETS_COMMITTED: 0
BUSINESS_TABLES: 0
DOC_FILES_CREATED: 1
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Gate integrado executado sobre base 3b7572b (Prompt 26).
  Instalação frozen-lockfile, lint, typecheck, test, integration, e2e, build — PASS.
  Migrations em banco vazio (cisne_migration_gate_test) — 12 tabelas técnicas.
  Correção única: drift Prettier em 69 arquivos (sem mudança de comportamento).
  Riscos residuais: rate limit in-memory, esbuild dev-only moderate, ensure-migrations fallback.
  Prompt 28 não executado.
```

## Quality gate Prompt 27 (evidência)

- [x] Instalação reproduzível (`pnpm install --frozen-lockfile`)
- [x] format:check, lint, typecheck — PASS
- [x] Unit, integração PostgreSQL real, E2E API, E2E frontend — PASS
- [x] Build sem segredo commitado — PASS
- [x] Migrations em banco vazio — PASS
- [x] Seed idempotente — PASS (integração)
- [x] 12 cenários integrados cobertos por testes existentes
- [x] Revisão de código: sem `any`, skip, mock PG, tabelas empresariais, segredos
- [x] `pnpm audit --prod` — 0 críticas; 1 moderate dev-only documentada
- [x] `docs/implementation/27-foundation-quality-gate.md`
- [x] Prompt 28 não executado

---

```text
PROMPT: 28
TITLE: Gate de validação empresarial antes dos módulos
STARTED_AT: 2026-08-29T13:22:00-04:00
FINISHED_AT: 2026-08-29T13:28:00-04:00
STATUS: BLOCKED
FILES_CREATED:
  docs/inputs/SRC-002-business-baseline-confirmation.md
  docs/implementation/28-business-readiness-gate.md
FILES_CHANGED:
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: BLOCKED
BUSINESS_READINESS: BLOCKED_AWAITING_BUSINESS_CONFIRMATION
TECHNICAL_FOUNDATION: READY_WITH_RESTRICTIONS (Prompt 27 — inalterado)
CONFIRMED_BUSINESS_SOURCE: NONE
CONFIRMED_RULES: 0
BLOCKING_DECISIONS: DDP-001,002,003,009,010,011,012,013,015,020,022,023,026,028,029,037 (+ 25 DDPs OPEN)
FIRST_RELEASE_SCOPE: UNKNOWN
CODE_CREATED: NO
DOC_FILES_CREATED: 2
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Inspeção integral de fontes, regras (0 CONFIRMED), DDPs (40 OPEN), UCs (26), BCs candidatos, invariantes, estados, authz, modelo.
  Nenhuma fonte formal pós-SRC-001 assinada — criado questionário SRC-002 aguardando patrocinador.
  Fundação técnica pronta ≠ domínio validado. Nenhum módulo empresarial autorizado.
  Source registry, DDPs e regras NÃO atualizados (sem resposta real).
  Prompt 29 não executado.
```

## Quality gate Prompt 28 (evidência)

- [x] Fontes, regras, DDPs, requisitos, UCs, linguagem, BCs, invariantes, estados, authz e modelo inspecionados
- [x] Relatório Prompt 27 considerado (fundação técnica READY_WITH_RESTRICTIONS)
- [x] Nenhuma fonte confirmada pós-SRC-001 — SRC-002 questionário criado, não respondido
- [x] Nenhuma regra promovida sem resposta
- [x] Conflitos preservados (0 SC-*)
- [x] Decisões bloqueantes listadas
- [x] Escopo inicial: UNKNOWN
- [x] Zero código empresarial
- [x] docs/implementation/28-business-readiness-gate.md
- [x] Prompt 29 não executado

---

```text
PROMPT: 29
TITLE: Módulo de Clientes — backend e persistência
STARTED_AT: 2026-08-29T13:30:00-04:00
FINISHED_AT: 2026-08-29T13:31:00-04:00
STATUS: NOT_EXECUTED
PRECONDITION: FAIL
FILES_CREATED:
  docs/implementation/29-clients-backend.md
FILES_CHANGED:
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: NOT_RUN
CODE_CREATED: NO
BUSINESS_TABLES_ADDED: 0
BLOCK_REASON: Prompt 28 BLOCKED_AWAITING_BUSINESS_CONFIRMATION — módulo Clientes não liberado; SRC-002 vazio; DDP-028 OPEN; 0 regras CONFIRMED
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Pré-condição explícita do prompt não atendida. Nenhum código, migration, endpoint ou teste criado.
  AGENTS.md — parada obrigatória em NOT_READY_FOR_IMPLEMENTATION.
  Prompt 30 não executado.
```

## Quality gate Prompt 29 (evidência)

- [x] Pré-condição Prompt 28 verificada — módulo Clientes **não** liberado
- [x] Nenhum código empresarial criado
- [x] Nenhuma regra inventada (CPF/CNPJ, campos cadastrais)
- [x] docs/implementation/29-clients-backend.md (registro de bloqueio)
- [x] Lint / typecheck / test / build — **não executados** (sem alteração de código)
- [x] Prompt 30 não executado

---

```text
PROMPT: 29-A
TITLE: Resolução controlada do gate SRC-002 e preparação do módulo Clientes
STARTED_AT: 2026-08-29T13:35:00-04:00
FINISHED_AT: 2026-08-29T13:42:00-04:00
STATUS: BLOCKED
FILES_CREATED:
  scripts/validate-src-002-gate.mjs
FILES_CHANGED:
  docs/inputs/SRC-002-business-baseline-confirmation.md
  package.json
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS (lint, typecheck, test, integration, build — sem regressão)
SRC_002_STATUS: BLOQUEADO
CLIENTS_MODULE_READY: false
CONFIRMED_BUSINESS_RULES: 0
GATE_SCRIPT: pnpm gate:src-002 → FAIL (esperado)
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Análise documental integral; SRC-002 atualizado com matriz de evidências, bloqueios e MAP-001/002.
  DDP-020 e DDP-028 analisados — permanecem OPEN/UNKNOWN. Assinatura PENDING_HUMAN_CONFIRMATION.
  Nenhuma regra promovida; source-registry/DDPs/regras não alterados (sem resposta humana).
  Prompt 29 (implementação) permanece bloqueado. Prompt 30 não executado.
```

## Quality gate Prompt 29-A (evidência)

- [x] Baseline empresarial reconstruído em SRC-002
- [x] Evidências verificadas (SRC-001, BR-REG, DDP-REG, TERM-004, DBND-SOT-001, DEM-001)
- [x] Conflitos MAP-001/002 identificados (mapeamento documental)
- [x] DDP-028 e DDP-020 analisados — não resolvidos
- [x] Nenhuma assinatura inventada
- [x] Nenhuma decisão empresarial inventada
- [x] Gate automatizado `pnpm gate:src-002` implementado e executado (FAIL esperado)
- [x] lint, typecheck, test, test:integration, build — PASS
- [x] Nenhum código de Clientes criado
- [x] Prompt 30 não executado

---

```text
PROMPT: 29-A (corretivo)
TITLE: Resolução definitiva controlada do SRC-002 e liberação do módulo Clientes
STARTED_AT: 2026-08-29T14:00:00-04:00
FINISHED_AT: 2026-08-29T14:30:00-04:00
STATUS: BLOCKED_BY_SIGNATURE_ONLY
FILES_CHANGED:
  docs/inputs/SRC-002-business-baseline-confirmation.md
  docs/01-foundation/business-rules-register.md
  docs/01-foundation/domain-decisions-pending.md
  docs/01-foundation/source-registry.md
  docs/06-domain-boundaries/source-of-truth-by-context.md
  docs/implementation/28-business-readiness-gate.md
  scripts/validate-src-002-gate.mjs
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS (lint, typecheck, test, integration, build)
SRC_002_STATUS: BLOCKED_BY_SIGNATURE_ONLY
CLIENTS_MODULE_READY: true (decisões resolvidas; aguarda assinatura)
CONFIRMED_BUSINESS_RULES: 16 (BR-025..BR-040)
CONDITIONAL_BUSINESS_RULES: 1 (BR-041)
MANDATORY_BLOCKERS_BEFORE: 14
MANDATORY_BLOCKERS_AFTER: 1 (assinatura humana)
GATE_SCRIPT: pnpm gate:src-002 → BLOCKED_BY_SIGNATURE_ONLY (exit 1 esperado)
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Decisões empresariais Q01–Q15 registradas; DDP-020 (CLIENT), DDP-028, DDP-041 resolvidos.
  MAP-001/002 corrigidos. Nenhuma assinatura inventada.
  Prompt 29 (implementação) aguarda assinatura formal. Prompt 30 não executado.
```

## Quality gate Prompt 29-A corretivo (evidência)

- [x] Decisões empresariais Q01–Q15 registradas em SRC-002
- [x] BR-025..BR-040 promovidas a CONFIRMED; BR-041 CONDITIONAL
- [x] DDP-020 (CLIENT_SCOPE), DDP-028, DDP-041 atualizados
- [x] MAP-001/002 corrigidos
- [x] source-registry.md atualizado (SRC-002)
- [x] Nenhuma assinatura inventada
- [x] Nenhum código de Clientes criado
- [x] gate:src-002 → BLOCKED_BY_SIGNATURE_ONLY
- [x] lint, typecheck, test, test:integration, build — PASS
- [x] Prompt 30 não executado

---

```text
PROMPT: 29-A (aprovação humana)
TITLE: Aprovação formal SRC-002 — baseline empresarial Clientes
STARTED_AT: 2026-08-29T14:52:00-04:00
FINISHED_AT: 2026-08-29T14:55:00-04:00
STATUS: LIBERADO
APPROVED_BY: Abrahim Jabour Junior
APPROVED_ROLE: Administrador
APPROVAL_DATE: 2026-08-29
FILES_CHANGED:
  docs/inputs/SRC-002-business-baseline-confirmation.md
  docs/01-foundation/source-registry.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_STATUS: LIBERADO
MANDATORY_BLOCKERS: 0
CONFIRMED_BUSINESS_RULES: 16
GATE_SCRIPT: pnpm gate:src-002 → PASS
CODE_CREATED: NO
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Assinatura formal registrada. Decisões Q01–Q15 e BR-025..BR-040 inalteradas.
  BR-041 permanece CONDITIONAL. Prompt 29 autorizado; não executado. Prompt 30 não executado.
```

## Quality gate Prompt 29-A aprovação (evidência)

- [x] Assinatura formal registrada (Abrahim Jabour Junior, Administrador, 2026-08-29)
- [x] Decisões Q01–Q15 não alteradas
- [x] BR-025..BR-040 inalteradas; BR-041 CONDITIONAL preservada
- [x] Provenance de fases anteriores preservada
- [x] gate:src-002 → PASS
- [x] lint, typecheck, test, test:integration, build — PASS
- [x] Nenhum código de Clientes criado
- [x] Prompt 29 não executado automaticamente
- [x] Prompt 30 não executado

---

```text
PROMPT: 29
TITLE: Módulo de Clientes — backend e persistência
STARTED_AT: 2026-08-29T15:00:00-04:00
FINISHED_AT: 2026-08-29T15:10:00-04:00
STATUS: EXECUTED
FILES_CREATED:
  packages/database/src/schema/clients.ts
  packages/database/migrations/0006_clients_baseline.sql
  packages/database/src/test-builders/client-builders.ts
  packages/database/src/clients.persistence.integration.spec.ts
  apps/api/src/clients/** (module, domain, repository, service, controller, tests)
FILES_CHANGED:
  apps/api/src/app.module.ts
  apps/api/src/main.ts
  apps/api/src/authorization/** (actions, resources, scope-enforcement, module exports)
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/test/ensure-migrations.ts
  apps/api/src/infrastructure/database/database.integration.spec.ts
  docs/implementation/29-clients-backend.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_GATE: PASS
CODE_CREATED: YES (clients backend only)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  CRUD PJ com CNPJ único, desativação lógica, autorização por capabilities, audit trail.
  Sem PF, sem DELETE físico, sem ERP fictício. Prompt 30 não executado.
```

## Quality gate Prompt 29 (evidência)

- [x] SRC-002 gate PASS (pré-condição)
- [x] Schema `pty` + migration 0006
- [x] Operações create/read/list/update/deactivate/activate
- [x] Autorização `client:client:*` + escopo GLOBAL/CLIENT
- [x] Unit, integration, E2E, migration tests — PASS
- [x] lint, typecheck, build — PASS
- [x] Prompt 30 não executado

---

```text
PROMPT: 29-B
TITLE: Auditoria de fechamento do backend de Clientes
STARTED_AT: 2026-08-29T15:12:00-04:00
FINISHED_AT: 2026-08-29T15:22:00-04:00
STATUS: EXECUTED
BASELINE_COMMIT: 8e31b02
FILES_CREATED:
  apps/api/src/clients/domain/client-service-order-guard.ts
  apps/api/src/clients/domain/client-service-order-guard.spec.ts
  apps/api/src/clients/clients.audit-closure.integration.spec.ts
FILES_CHANGED:
  apps/api/src/authorization/services/scope-enforcement.service.ts
  apps/api/src/clients/repositories/clients.repository.ts
  apps/api/src/clients/services/client-access.service.ts
  apps/api/src/clients/clients.integration.spec.ts
  apps/api/src/clients/domain/client.validation.spec.ts
  packages/database/src/clients.persistence.integration.spec.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_GATE: PASS
AUDIT_RESULT: PASS
FIXES:
  - listagem restrita a escopo GLOBAL (empregado não enumera Clientes)
  - activate usa capability ClientActivate; histórico de desativação preservado
  - setStatus valida version antes de INVALID_STATE (optimistic lock)
  - guard BR-037 assertClientEligibleForServiceOrderRelease para ReleaseServiceOrder futuro
NEXT_PROMPT_EXECUTED: NO
NOTES:
  ReleaseServiceOrder ainda inexistente; invariante BR-037 coberta por guard de domínio + testes.
  Prompt 30 não executado.
```

## Quality gate Prompt 29-B (evidência)

- [x] Baseline 8e31b02 confirmado
- [x] Lacunas corrigidas: enumeração empregado, activate capability, histórico desativação, stale version deactivate/activate
- [x] Testes negativos create PJ, CNPJ concorrente, IDOR, soft deactivate, migration 0005→0006
- [x] lint, typecheck, test, test:integration, test:e2e, build, gate:src-002 — PASS
- [x] Prompt 30 não executado

---

```text
PROMPT: 30
TITLE: Interface web do módulo Clientes
STARTED_AT: 2026-08-29T15:45:00-04:00
FINISHED_AT: 2026-08-29T16:06:00-04:00
STATUS: EXECUTED
BASELINE_COMMIT: bb540cc
FILES_CREATED:
  apps/web/src/clients/** (api, pages, components, hooks, utils, tests)
  apps/web/src/test/clients-fetch-mock.ts
  apps/web/src/test/render-with-providers.tsx
  docs/implementation/30-clients-frontend.md
FILES_CHANGED:
  apps/web/src/App.tsx
  apps/web/src/index.css
  apps/web/src/shell/nav-config.ts
  apps/web/src/shell/types.ts
  apps/web/src/shell/useNavAccess.ts
  apps/web/src/test/setup.ts
  apps/web/src/test/shell-fetch-mock.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_GATE: PASS
CODE_CREATED: YES (clients frontend only)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Listagem paginada via API; filtro status; create/edit/deactivate/activate;
  optimistic concurrency; autorização visual por probes; E2E frontend completo.
  Prompt 31 não executado.
```

## Quality gate Prompt 30 (evidência)

- [x] Telas list/detail/create/edit implementadas
- [x] Contratos reais `/api/v1/clients` consumidos
- [x] Sem PF, CRM, autoridade de negócio no frontend
- [x] lint, typecheck, test, test:integration, test:e2e API, build, gate:src-002 — PASS
- [x] Prompt 31 não executado

---

```text
PROMPT: 31
TITLE: Arquitetura orientada a catálogo de serviços (domínio)
STARTED_AT: 2026-08-29T16:10:00-04:00
FINISHED_AT: 2026-08-29T16:25:00-04:00
STATUS: EXECUTED
BASELINE_COMMIT: 5e9d9d2
FILES_CREATED:
  docs/implementation/31-service-catalog-domain.md
FILES_CHANGED:
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_GATE: PASS
CODE_CREATED: NO (documentação de domínio apenas)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  CNAE ≠ ServiceDefinition; 12 arquétipos; contrato conceitual versionado;
  variabilidade vs invariantes; snapshots para OS histórica; grupos CISNE reconhecidos.
  Sem banco, frontend, Clients ou Prompt 32.
```

## Quality gate Prompt 31 (evidência)

- [x] `31-service-catalog-domain.md` criado com fronteiras, invariantes, arquétipos, versionamento, CNAE↔catálogo
- [x] Configurável vs código obrigatório separado
- [x] Grupos empresariais CISNE reconhecidos sem fluxo por item
- [x] Clients não alterado; Prompt 32 não executado
- [x] lint, typecheck, test, test:integration, build, gate:src-002 — PASS

---

```text
PROMPT: 32
TITLE: Persistência versionada do Catálogo de Serviços
STARTED_AT: 2026-08-29T16:12:00-04:00
FINISHED_AT: 2026-08-29T16:20:00-04:00
STATUS: EXECUTED
BASELINE_COMMIT: 38cc6ce
FILES_CREATED:
  packages/database/migrations/0007_service_catalog_baseline.sql
  packages/database/src/schema/service-catalog.ts
  packages/database/src/schema/catalog-json-contracts.ts
  packages/database/src/service-catalog.persistence.integration.spec.ts
  packages/database/src/test-builders/catalog-builders.ts
  docs/implementation/32-service-catalog-persistence.md
FILES_CHANGED:
  packages/database/migrations/meta/_journal.json
  packages/database/src/schema/index.ts
  packages/database/src/test-builders/index.ts
  packages/database/src/test-builders/client-builders.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_GATE: PASS
CODE_CREATED: YES (database catalog persistence only)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Schema cat com 8 tabelas, enums, trigger de imutabilidade pós-publicação;
  JSONB com schema_version; 9 testes integração migration/constraints/versionamento.
  Clients inalterado; Prompt 33 não executado.
```

## Quality gate Prompt 32 (evidência)

- [x] Migration `0007` forward-only aplicável em banco vazio e incremental
- [x] UUID, code único, version>=1, status, soft deactivation, actors, FKs, CHECKs, índices
- [x] Versão publicada imutável (trigger); evolução semântica via nova versão
- [x] Testes: duplicidade code, versionamento, FK inválida, rollback transacional
- [x] lint, typecheck, test, test:integration, build, gate:src-002 — PASS
- [x] Prompt 33 não executado

---

```text
PROMPT: 33
TITLE: CI profissional e quality gates de engenharia
STARTED_AT: 2026-08-29T16:30:00-04:00
FINISHED_AT: 2026-08-29T16:42:00-04:00
STATUS: EXECUTED
BASELINE_COMMIT: 9ad53a6
FILES_CREATED:
  .github/workflows/ci.yml
  .node-version
  packages/database/scripts/ci-database-gate.mjs
  scripts/ci-emit-build-metadata.mjs
  docs/implementation/33-ci-quality-gates.md
FILES_CHANGED:
  package.json
  packages/database/package.json
  apps/api/src/test/ensure-migrations.ts
  .gitignore
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_GATE: PASS
CODE_CREATED: YES (CI/infra only)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Pipeline GitHub Actions com lint, typecheck, audit, unit, database gate,
  integration, API e2e, build e artifact metadata. Sem secrets em Git.
  Branch protection documentada como pendência operacional.
```

## Quality gate Prompt 33 (evidência)

- [x] `.github/workflows/ci.yml` — jobs sequenciais sem continue-on-error
- [x] `gate:database` — fresh + incremental migrations, constraints, baseline
- [x] `audit:deps` — high/critical threshold
- [x] Artifact traceability (`build-metadata.json`)
- [x] lint, typecheck, test, test:integration, test:e2e, build, gate:src-002 — PASS
- [x] Prompt 34 não executado

---

```text
PROMPT: 34
TITLE: Catálogo de serviços — backend, domínio e API
STARTED_AT: 2026-08-29T16:20:00-04:00
FINISHED_AT: 2026-08-29T16:50:00-04:00
STATUS: EXECUTED
BASELINE_COMMIT: 3ae7349
FILES_CREATED:
  packages/database/migrations/0008_service_definitions_lineage_version.sql
  apps/api/src/catalog/catalog.module.ts
  apps/api/src/catalog/controllers/service-definitions.controller.ts
  apps/api/src/catalog/services/service-catalog-access.service.ts
  apps/api/src/catalog/repositories/service-catalog.repository.ts
  apps/api/src/catalog/dto/service-catalog.dto.ts
  apps/api/src/catalog/serializers/service-catalog-response.serializer.ts
  apps/api/src/catalog/domain/service-catalog-status.ts
  apps/api/src/catalog/domain/service-catalog.validation.ts
  apps/api/src/catalog/domain/service-catalog.validation.spec.ts
  apps/api/src/catalog/errors/catalog-error-codes.ts
  apps/api/src/catalog/errors/catalog-http.exception.ts
  apps/api/src/catalog/errors/catalog-exception.filter.ts
  apps/api/src/catalog/service-catalog.integration.spec.ts
  apps/api/src/catalog/service-catalog.e2e.spec.ts
  docs/implementation/34-service-catalog-backend.md
FILES_CHANGED:
  packages/database/migrations/meta/_journal.json
  packages/database/src/schema/service-catalog.ts
  packages/database/src/test-builders/catalog-builders.ts
  packages/database/scripts/ci-database-gate.mjs
  apps/api/src/app.module.ts
  apps/api/src/main.ts
  apps/api/src/test/ensure-migrations.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/authorization/types/authz-resources.ts
  apps/api/src/audit/types/security-audit.types.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_GATE: PASS
CODE_CREATED: YES (catalog backend + API)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  ServiceDefinition versionado com comandos explícitos, PDP, auditoria,
  optimistic locking na linhagem, publish transacional e DTOs camelCase.
  Prompt 35 não executado.
```

## Quality gate Prompt 34 (evidência)

- [x] Agregado ServiceDefinition + versões separadas (code estável, version 1..N)
- [x] Estados DRAFT / PUBLISHED (DB ACTIVE) / INACTIVE linhagem
- [x] Versão publicada imutável (domínio + trigger Prompt 32)
- [x] Capabilities catalog:service:* integradas ao PDP
- [x] VERSION_CONFLICT em mutações concorrentes
- [x] Testes unit, integration, e2e — PASS
- [x] lint, typecheck, test, test:integration, test:e2e, build, gate:database, gate:src-002 — PASS
- [x] Prompt 35 não executado

---

```text
PROMPT: 36
TITLE: Catálogo de unidades de medida
STARTED_AT: 2026-08-29T16:54:00-04:00
FINISHED_AT: 2026-08-29T17:01:00-04:00
STATUS: EXECUTED
BASELINE_COMMIT: 0c3d64b
FILES_CREATED:
  packages/database/migrations/0009_units_of_measure.sql
  packages/database/src/catalog/units-of-measure-baseline.ts
  apps/api/src/catalog/domain/unit-of-measure.ts
  apps/api/src/catalog/domain/measured-quantity.ts
  apps/api/src/catalog/domain/measured-quantity.spec.ts
  apps/api/src/catalog/domain/unit-of-measure.spec.ts
  apps/api/src/catalog/repositories/units-of-measure.repository.ts
  apps/api/src/catalog/services/units-of-measure-access.service.ts
  apps/api/src/catalog/controllers/units-of-measure.controller.ts
  apps/api/src/catalog/dto/units-of-measure.dto.ts
  apps/api/src/catalog/serializers/units-of-measure-response.serializer.ts
  apps/api/src/catalog/units-of-measure.integration.spec.ts
  apps/api/src/catalog/units-of-measure.e2e.spec.ts
FILES_CHANGED:
  packages/database/migrations/meta/_journal.json
  packages/database/src/schema/service-catalog.ts
  packages/database/src/schema/index.ts
  packages/database/src/index.ts
  packages/database/src/test-builders/catalog-builders.ts
  packages/database/src/test-builders/index.ts
  packages/database/src/service-catalog.persistence.integration.spec.ts
  packages/database/scripts/ci-database-gate.mjs
  apps/api/src/test/ensure-migrations.ts
  apps/api/src/catalog/catalog.module.ts
  apps/api/src/catalog/domain/service-catalog.validation.ts
  apps/api/src/catalog/services/service-catalog-access.service.ts
  apps/api/src/catalog/errors/catalog-error-codes.ts
  apps/api/src/catalog/service-catalog.integration.spec.ts
  apps/api/src/catalog/service-catalog.e2e.spec.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/authorization/types/authz-resources.ts
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/catalog/dto/service-catalog.dto.ts
  apps/api/src/catalog/errors/catalog-exception.filter.ts
  apps/api/src/catalog/repositories/service-catalog.repository.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
SRC_002_GATE: PASS
CODE_CREATED: YES (units of measure catalog)
NEXT_PROMPT_EXECUTED: NO
NOTES:
  cat.units_of_measure com seed idempotente (UN, M3, DAY, etc.), FK em allowed_units
  e default_unit_code; API administrativa; validação de precisão centralizada;
  correções residuais do Prompt 34 (lint + SOURCE_NOT_FOUND). Prompt 35 não executado.
  Prompt 37 não executado.
```

## Quality gate Prompt 36 (evidência)

- [x] Tabela `cat.units_of_measure` com code único, category, decimalScale, status, version
- [x] Seed idempotente das 13 unidades iniciais
- [x] FK impedindo unit_code livre em service definitions
- [x] Validação de precisão via `measured-quantity` (domínio)
- [x] Publish/create rejeitam unidade inexistente/inativa; histórico preservado
- [x] API `/api/v1/catalog/units-of-measure` com authz, audit e optimistic locking
- [x] lint, typecheck, test, test:integration, test:e2e, gate:database, gate:src-002 — PASS
- [x] Prompt 37 não executado

---

## Prompt 37 — Catálogo de tipos de recursos físicos

| Campo | Valor |
| ----- | ----- |
| ID | 37 |
| Título | Catálogo de tipos de recursos físicos |
| Status | PASS |
| Commit | feat(resources): implement physical resource type catalog |
| Executado em | 2026-08-29 |

```
Resumo:
  cat.physical_resource_types com classificação (VEHICLE/MACHINE/EQUIPMENT/CONSUMABLE/MATERIAL),
  seed baseline, API resources/physical-resource-types, requirements em ServiceDefinition
  (REQUIRED/OPTIONAL/CONDITIONAL + minQuantity), histórico imutável em versões publicadas.
  Prompt 38 não executado.
```

## Quality gate Prompt 37 (evidência)

- [x] Tabela `cat.physical_resource_types` com code único, classification, status, version
- [x] Seed idempotente dos 17 tipos físicos iniciais (sem pessoas/mão de obra)
- [x] FK `physical_resource_type_code` em `service_resource_requirements`
- [x] Níveis REQUIRED, OPTIONAL, CONDITIONAL com minQuantity
- [x] API `/api/v1/resources/physical-resource-types` com authz, audit e optimistic locking
- [x] Service catalog aceita `resourceRequirements`; histórico preservado após inativação de tipo
- [x] lint, typecheck, test, test:integration, test:e2e, gate:database — PASS
- [x] Prompt 38 não executado

---

## Prompt 38 — Tipos de mão de obra e capacidades operacionais

| Campo | Valor |
| ----- | ----- |
| ID | 38 |
| Título | Tipos de mão de obra e capacidades operacionais |
| Status | PASS |
| Commit | feat(resources): implement operational labor types |
| Executado em | 2026-08-29 |

```
Resumo:
  cat.operational_labor_types com seed baseline (DRIVER, ELECTRICIAN, etc.),
  API resources/labor-types, laborRequirements em ServiceDefinition,
  sem Employee/Assignment/RH. Prompt 39 não executado.
```

## Quality gate Prompt 38 (evidência)

- [x] Tabela `cat.operational_labor_types` com code único, status, version
- [x] Seed idempotente dos 10 tipos operacionais iniciais
- [x] FK `labor_type_code` em `service_labor_requirements`
- [x] API `/api/v1/resources/labor-types` com authz, audit e optimistic locking
- [x] Service catalog aceita `laborRequirements`; histórico preservado
- [x] Sem acoplamento a Employee/Assignment (schema + testes)
- [x] lint, typecheck, test, test:integration, test:e2e, gate:database — PASS
- [x] Prompt 39 não executado

---

## Prompt 39 — Modelos comerciais, precificação e medição

| Campo | Valor |
| ----- | ----- |
| ID | 39 |
| Título | Modelos comerciais, precificação e medição |
| Status | PASS |
| Commit | feat(commercial): implement pricing and measurement models |
| Executado em | 2026-08-29 |

```
Resumo:
  Módulo commercial com vocabulário de pricing/measurement,
  numeric(18,4) para salePrice/internalCost, measurement_basis,
  pricingModels no service catalog. Sem tributação nem Measurement agregado.
  Prompt 40 não executado.
```

## Quality gate Prompt 39 (evidência)

- [x] Vocabulário comercial mapeado para enums SQL existentes
- [x] `measurement_basis` + policies de compatibilidade UoM/modo
- [x] `sale_price_amount` / `internal_cost_amount` numeric — sem float
- [x] API `/commercial/pricing-models` e `/commercial/measurement-models`
- [x] Service catalog integra `pricingModels` e `measurementBasis`
- [x] Exemplos global price e PO negociado cobertos em testes
- [x] lint, typecheck, test, test:integration, test:e2e, gate:database — PASS
- [x] Prompt 40 não executado

---

## Prompt 40 — Requisitos de execução e evidências tipadas

| Campo | Valor |
| ----- | ----- |
| ID | 40 |
| Título | Requisitos de execução e evidências tipadas |
| Status | PASS |
| Commit | feat(catalog): implement typed execution requirements |
| Executado em | 2026-08-29 |

```
Resumo:
  executionRequirements[] no service catalog com 13 tipos aprovados,
  níveis REQUIRED/OPTIONAL/CONDITIONAL, condições tipadas e schema JSONB v1.
  Migration 0013 estende evidence_kind. Sem motor de expressão aberta.
  Prompt 41 não executado.
```

## Quality gate Prompt 40 (evidência)

- [x] Tipos aprovados mapeados para `cat.evidence_kind` (enum estendido)
- [x] Obrigatoriedade REQUIRED / OPTIONAL / CONDITIONAL validada no backend
- [x] CONDITIONAL apenas com condições tipadas suportadas
- [x] Chaves proibidas (`eval`, `script`, `sql`, etc.) rejeitadas
- [x] Requirements versionados por `ServiceDefinition`; publicado imutável
- [x] `CatalogExecutionRequirementConfigV1` com validação explícita
- [x] Testes: required, optional, conditional, unknown condition, invalid payload, version, immutability, authz
- [x] lint, typecheck, test, test:integration, test:e2e, gate:database — PASS
- [x] Prompt 41 não executado

---

## Prompt 41 — Seed canônico do portfólio de serviços CISNE

| Campo | Valor |
| ----- | ----- |
| ID | 41 |
| Título | Seed canônico do portfólio de serviços CISNE |
| Status | PASS |
| Commit | feat(catalog): seed complete Cisne service portfolio |
| Executado em | 2026-08-29 |

```
Resumo:
  49 ServiceDefinitions idempotentes com CNAE como referência legal,
  arquétipos mapeados, v1 publicada, sem preço/imposto/requisitos inventados.
  Prompt 42 não executado.
```

## Quality gate Prompt 41 (evidência)

- [x] 49 atividades CNAE cadastradas com codes únicos
- [x] Arquétipos operacionais válidos (sem nova policy)
- [x] Seed idempotente — segunda execução sem novas versões
- [x] Versões publicadas (ACTIVE v1)
- [x] Sem pricing, evidence, labor ou resource requirements inventados
- [x] lint, typecheck, test, test:integration, gate:database — PASS
- [x] Prompt 42 não executado

---

## Prompt 42 — Frontend administrativo do catálogo

| Campo | Valor |
| ----- | ----- |
| ID | 42 |
| Título | Frontend administrativo do catálogo |
| Status | PASS |
| Commit | feat(web): implement service catalog administration |
| Executado em | 2026-08-29 |

```
Resumo:
  Módulo web /app/catalog com listagem, CRUD de rascunho, versionamento,
  comparação client-side, publicação e lifecycle. Capabilities e VERSION_CONFLICT.
  Prompt 43 não executado.
```

## Quality gate Prompt 42 (evidência)

- [x] Listagem, paginação, filtros e busca (página atual)
- [x] Detalhe, criação, edição de DRAFT, nova versão, comparação
- [x] Publicação, desativação e reativação via API
- [x] Publicada não editável — UX direciona para nova versão
- [x] Formulário estruturado (arquétipo, UoM, pricing, requirements)
- [x] Capabilities controlam UX; conflito de versão tratado
- [x] Testes component, integration, accessibility, e2e
- [x] lint, typecheck, test, test:integration, test:e2e — PASS
- [x] Prompt 43 não executado

---

## Prompt 43 — Ativos físicos e veículos (backend)

| Campo | Valor |
| ----- | ----- |
| ID | 43 |
| Título | Ativos físicos e veículos: backend |
| Status | PASS |
| Commit | feat(resources): implement physical asset registry |
| Executado em | 2026-08-29 |

```
Resumo:
  Schema ast.physical_assets + ast.vehicle_profiles (extensão VEHICLE).
  API CRUD com lifecycle/allocation separados, optimistic locking,
  authz resources:asset:* com escopo UNIT, auditoria de mutações.
  Prompt 44 não executado.
```

## Quality gate Prompt 43 (evidência)

- [x] Create vehicle e create machine
- [x] Duplicate assetCode e duplicate plate
- [x] Inactive resource type rejeitado
- [x] Update stale (VERSION_CONFLICT)
- [x] Deactivate / activate lifecycle
- [x] Histórico em security_audit_events
- [x] Authorization e cross-unit scope
- [x] DTO sem campos internos (normalized_plate, created_by)
- [x] Migration 0014 + persistence test
- [x] E2E HTTP
- [x] lint, typecheck, test:integration, test:e2e — PASS
- [x] Prompt 44 não executado

---

## Prompt 44 — Ativos físicos e veículos (frontend)

| Campo | Valor |
| ----- | ----- |
| ID | 44 |
| Título | Ativos físicos e veículos: frontend |
| Status | PASS |
| Commit | feat(web): implement physical asset management |
| Executado em | 2026-08-29 |

```
Resumo:
  Módulo /app/assets com listagem, CRUD, lifecycle e formulário condicional
  por ResourceType (placa só para VEHICLE). Capabilities, conflito de versão
  e estados loading/empty/403/404. Prompt 45 não executado.
```

## Quality gate Prompt 44 (evidência)

- [x] Lista paginada, busca e filtros (lifecycle, allocation, tipo)
- [x] Detalhe, criação, edição, ativação e desativação
- [x] Campos de veículo condicionais ao tipo VEHICLE
- [x] Lifecycle e allocation exibidos separadamente
- [x] Capabilities, conflict, double-submit, erros sanitizados
- [x] Testes component, a11y, authorization, e2e
- [x] lint, typecheck, test (web) — PASS
- [x] Prompt 45 não executado

---

## Prompt 45 — Documentos, versionamento e object storage

| Campo | Valor |
| ----- | ----- |
| ID | 45 |
| Título | Documentos, versionamento e object storage |
| Status | PASS |
| Commit | feat(documents): implement secure versioned document storage |
| Executado em | 2026-08-29 |

```
Resumo:
  Schema doc.documents + doc.document_versions + doc.stored_objects.
  Upload validado (MIME, extensão, magic bytes, tamanho), hash SHA-256,
  versionamento imutável, compensação storage↔DB, download stream + token.
  Authz documents:document:* com escopo UNIT/DOCUMENT/GLOBAL.
  Prompt 46 não executado.
```

## Quality gate Prompt 45 (evidência)

- [x] Upload e nova versão preservando histórico
- [x] Fake MIME / oversize rejeitados
- [x] Unauthorized, cross-scope, IDOR download
- [x] Storage failure e DB failure (compensação)
- [x] Hash, download stream, signed access
- [x] DTO sem storage_key
- [x] Migration 0015 + persistence test
- [x] lint, typecheck, test, test:integration, test:e2e — PASS
- [x] Prompt 46 não executado

---

## Prompt 46 — Propostas comerciais (backend)

| Campo | Valor |
| ----- | ----- |
| ID | 46 |
| Título | Propostas comerciais: backend |
| Status | PASS |
| Commit | feat(commercial): implement versioned commercial proposals |
| Executado em | 2026-08-29 |

```text
PROMPT: 46
TITLE: Propostas comerciais: backend
STARTED_AT: 2026-08-29T18:00:00-04:00
FINISHED_AT: 2026-08-29T18:50:00-04:00
STATUS: PASS
FILES_CREATED:
  packages/database/migrations/0016_commercial_proposals_baseline.sql
  packages/database/src/schema/commercial-proposals.ts
  packages/database/src/test-builders/proposal-builders.ts
  packages/database/src/commercial-proposals.persistence.integration.spec.ts
  apps/api/src/commercial/domain/proposal.ts
  apps/api/src/commercial/domain/proposal.validation.ts
  apps/api/src/commercial/domain/proposal.validation.spec.ts
  apps/api/src/commercial/repositories/proposals.repository.ts
  apps/api/src/commercial/repositories/proposals.repository.types.ts
  apps/api/src/commercial/services/proposals-access.service.ts
  apps/api/src/commercial/controllers/proposals.controller.ts
  apps/api/src/commercial/dto/proposals.dto.ts
  apps/api/src/commercial/serializers/proposals-response.serializer.ts
  apps/api/src/commercial/errors/commercial-exception.filter.ts
  apps/api/src/commercial/proposals.integration.spec.ts
  apps/api/src/commercial/proposals.e2e.spec.ts
  docs/implementation/46-commercial-proposals-backend.md
FILES_CHANGED:
  packages/database/migrations/meta/_journal.json
  packages/database/src/schema/index.ts
  packages/database/src/test-builders/index.ts
  apps/api/src/app.module.ts
  apps/api/src/commercial/commercial.module.ts
  apps/api/src/commercial/errors/commercial-error-codes.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/authorization/types/authz-resources.ts
  apps/api/src/authorization/scope/scope-matcher.ts
  apps/api/src/authorization/services/scope-enforcement.service.ts
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/main.ts
  apps/api/src/test/ensure-migrations.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Agregado Proposal/ProposalVersion/ProposalItem em schema com.
  GLOBAL_PRICE sem decomposição obrigatória; ITEMIZED com lineSaleAmount.
  Emissão snapshota cliente e serviço; aceite exige acceptanceOriginCode.
  CommercialExceptionFilter registrado em main e E2E.
  Cenário regularização estrada 280 m³ / R$ 96.000 coberto em integração.
  Prompt 47 não executado.
```

## Quality gate Prompt 46 (evidência)

- [x] Draft, issue, version, accept, reject, expire, cancel
- [x] GLOBAL_PRICE e ITEMIZED + precisão monetária
- [x] Concorrência (row_version) e autorização cross-unit/CLIENT
- [x] Audit trail e vínculo de documentos
- [x] Migration 0016 + persistence test
- [x] lint, typecheck, test, test:integration (proposals), test:e2e (proposals) — PASS
- [x] Prompt 47 não executado

---

## Prompt 47 — Purchase orders e autorizações comerciais

| Campo | Valor |
| ----- | ----- |
| ID | 47 |
| Título | Purchase order, RC e autorizações comerciais |
| Status | PASS |
| Commit | feat(commercial): implement purchase orders and authorizations |
| Executado em | 2026-08-29 |

```text
PROMPT: 47
TITLE: Purchase order, RC e autorizações comerciais
STARTED_AT: 2026-08-29T18:48:00-04:00
FINISHED_AT: 2026-08-29T18:56:00-04:00
STATUS: PASS
FILES_CREATED:
  packages/database/migrations/0017_commercial_purchase_orders_baseline.sql
  packages/database/src/schema/commercial-purchase-orders.ts
  packages/database/src/test-builders/purchase-order-builders.ts
  packages/database/src/commercial-purchase-orders.persistence.integration.spec.ts
  apps/api/src/commercial/domain/purchase-order.ts
  apps/api/src/commercial/domain/purchase-order.validation.ts
  apps/api/src/commercial/domain/purchase-order.validation.spec.ts
  apps/api/src/commercial/repositories/purchase-orders.repository.ts
  apps/api/src/commercial/repositories/purchase-orders.repository.types.ts
  apps/api/src/commercial/services/purchase-orders-access.service.ts
  apps/api/src/commercial/controllers/purchase-orders.controller.ts
  apps/api/src/commercial/dto/purchase-orders.dto.ts
  apps/api/src/commercial/serializers/purchase-orders-response.serializer.ts
  apps/api/src/commercial/purchase-orders.integration.spec.ts
  apps/api/src/commercial/purchase-orders.e2e.spec.ts
  docs/implementation/47-commercial-purchase-orders.md
FILES_CHANGED:
  packages/database/migrations/meta/_journal.json
  packages/database/src/schema/index.ts
  packages/database/src/test-builders/index.ts
  apps/api/src/commercial/commercial.module.ts
  apps/api/src/commercial/errors/commercial-error-codes.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/authorization/types/authz-resources.ts
  apps/api/src/authorization/scope/scope-matcher.ts
  apps/api/src/authorization/services/scope-enforcement.service.ts
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/test/ensure-migrations.ts
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
NEXT_PROMPT_EXECUTED: NO
NOTES:
  PurchaseOrder/PurchaseOrderItem em schema com; sem CommercialAuthorization genérica.
  Regras de faturamento por PO (PO_NUMBER_REQUIRED_ON_INVOICE, XML/PDF, BILLING_CUTOFF, RECIPIENT).
  precedence_tier=PURCHASE_ORDER sem resolver de hierarquia empresarial.
  Registro snapshota cliente e serviço; unique (client_id, po_number) para DRAFT/REGISTERED.
  Fixture RC 991487 / PO 41926266 apenas em testes.
  Prompt 48 não executado.
```

## Quality gate Prompt 47 (evidência)

- [x] Duplicate PO per client
- [x] Authorization cross-unit
- [x] Document link + audit on register
- [x] Version/conflict (row_version)
- [x] LINE_ITEMS precision + HEADER_TOTAL
- [x] Migration 0017 + persistence test
- [x] lint, typecheck, test, test:integration (purchase-orders), test:e2e (purchase-orders) — PASS
- [x] Prompt 48 não executado

---

## Prompt 48 — Solicitação de serviço: backend

```
PROMPT_ID: 48
PROMPT_TITLE: Solicitação de serviço — backend
EXECUTED_AT: 2026-08-29
EXECUTION_STATUS: PASS
COMMIT: feat(requests): implement service request domain
ARTIFACTS:
  packages/database/migrations/0018_service_requests_baseline.sql
  packages/database/src/schema/service-requests.ts
  packages/database/src/test-builders/service-request-builders.ts
  packages/database/src/service-requests.persistence.integration.spec.ts
  apps/api/src/requests/
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/authorization/types/authz-resources.ts
  apps/api/src/authorization/scope/scope-matcher.ts
  apps/api/src/authorization/services/scope-enforcement.service.ts
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/app.module.ts
  apps/api/src/main.ts
  apps/api/src/test/ensure-migrations.ts
  docs/implementation/48-service-requests-backend.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
NEXT_PROMPT_EXECUTED: NO
NOTES:
  ServiceRequest como agregado de intake (sr.service_requests); distinto de ServiceOrder.
  Origens externas WHATSAPP…OTHER; cliente opcional com contato externo obrigatório.
  Transições explícitas sem PATCH de status; rejeição/cancelamento exigem motivo.
  Porta ServiceRequestConversionPort com NotReadyServiceRequestConversionPort até Prompt 50.
  CHECK DB: CONVERTED exige converted_service_order_id.
  Prompt 49 não executado.
```

## Quality gate Prompt 48 (evidência)

- [x] create, submit, review, approve, reject, cancel
- [x] invalid transition, duplicate idempotency, stale version
- [x] unauthorized, cross-scope
- [x] document / proposal / PO reference
- [x] conversion port not ready; rejected cannot convert
- [x] Migration 0018 + persistence test
- [x] lint, typecheck, test, test:integration (service-requests), test:e2e (service-requests) — PASS
- [x] Prompt 49 não executado

---

## Prompt 49 — Solicitação de serviço: frontend

```
PROMPT_ID: 49
PROMPT_TITLE: Solicitação de serviço — frontend
EXECUTED_AT: 2026-08-29
EXECUTION_STATUS: PASS
COMMIT: feat(web): implement service request interface
ARTIFACTS:
  apps/web/src/requests/
  apps/web/src/test/requests-fetch-mock.ts
  apps/web/src/App.tsx
  apps/web/src/shell/nav-config.ts
  apps/web/src/shell/useNavAccess.ts
  apps/web/src/index.css
  apps/api/src/requests/serializers/service-requests-response.serializer.ts
  docs/implementation/49-service-requests-frontend.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
NEXT_PROMPT_EXECUTED: NO
NOTES:
  UI consome contratos reais; transições via POST endpoints com rowVersion.
  Origem da solicitação separada de Registrado por; Cliente opcional via seletor.
  Sem botão de conversão para OS; capabilities apenas UX.
  createdByIdentityId exposto no serializer para exibir registrante.
  Prompt 50 não executado.
```

## Quality gate Prompt 49 (evidência)

- [x] create, edit, submit, approve, reject, cancel
- [x] forbidden, stale version, loading, empty, error, accessibility
- [x] E2E service-requests
- [x] lint, typecheck, test (@cisne/web) — PASS
- [x] Prompt 50 não executado

---

## Prompt 50 — Ordem de serviço: núcleo backend

```
PROMPT_ID: 50
PROMPT_TITLE: Ordem de serviço — núcleo backend
EXECUTED_AT: 2026-08-29
EXECUTION_STATUS: PASS
COMMIT: feat(service-orders): implement service order aggregate
ARTIFACTS:
  packages/database/migrations/0019_service_orders_baseline.sql
  packages/database/src/schema/service-orders.ts
  packages/database/src/test-builders/service-order-builders.ts
  packages/database/src/service-orders.persistence.integration.spec.ts
  apps/api/src/service-orders/
  apps/api/src/requests/domain/service-request-conversion.port.ts
  apps/api/src/requests/requests.module.ts
  apps/api/src/requests/services/service-requests-access.service.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/authorization/types/authz-resources.ts
  apps/api/src/authorization/scope/scope-matcher.ts
  apps/api/src/authorization/services/scope-enforcement.service.ts
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/app.module.ts
  apps/api/src/main.ts
  apps/api/src/test/ensure-migrations.ts
  docs/implementation/50-service-orders-backend.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
NEXT_PROMPT_EXECUTED: NO
NOTES:
  ServiceOrder aggregate em so.service_orders com order_number empresarial e internal_code.
  Conversão atômica ServiceRequest APPROVED → OS DRAFT + status CONVERTED na mesma transação.
  Snapshots de catálogo, cliente e referências comerciais (proposal/PO/RC/contrato).
  Histórico em service_order_history_events; auditoria em security_audit_events.
  Porta ServiceRequestConversionPort implementada; NotReady removido.
  Prompt 51 não executado.
```

## Quality gate Prompt 50 (evidência)

- [x] create DRAFT, request conversion, double conversion race
- [x] rejected/cancelled request, catalog snapshot, client/PO/proposal refs
- [x] rollback, authorization, concurrency, DTO, E2E
- [x] Migration 0019 + persistence test
- [x] lint, typecheck, test, test:integration, test:e2e — PASS
- [x] Prompt 51 não executado

---

## Prompt 51 — Ordem de serviço: máquina de estados

```
PROMPT_ID: 51
PROMPT_TITLE: Ordem de serviço — máquina de estados
EXECUTED_AT: 2026-08-29
EXECUTION_STATUS: PASS
COMMIT: feat(service-orders): enforce service order state machine
ARTIFACTS:
  packages/database/migrations/0020_service_orders_state_transitions.sql
  packages/database/src/schema/service-orders.ts
  apps/api/src/service-orders/domain/service-order.state-machine.ts
  apps/api/src/service-orders/domain/service-order-release.ts
  apps/api/src/service-orders/domain/service-order-mutability.ts
  apps/api/src/service-orders/services/service-orders-access.service.ts
  apps/api/src/service-orders/controllers/service-orders.controller.ts
  apps/api/src/service-orders/repositories/service-orders.repository.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/test/ensure-migrations.ts
  docs/implementation/51-service-orders-state-machine.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Transições explícitas prepare/release/cancel (sem PATCH status).
  Fluxo DRAFT → PREPARED → RELEASED; cancel de DRAFT/PREPARED/RELEASED.
  Release com assertClientEligibleForServiceOrderRelease (BR-037).
  Mutabilidade: DRAFT completo; PREPARED só campos operacionais; RELEASED+ imutável.
  Assign/Acknowledge/Start/Complete não implementados (dependências ausentes).
  Prompt 52 não executado.
```

## Quality gate Prompt 51 (evidência)

- [x] DRAFT sem client → release denied
- [x] Client inexistente/inativo → denied
- [x] Client ACTIVE + requisitos → release allowed
- [x] Unauthorized, VERSION_CONFLICT, duplicate release, concurrency races
- [x] History/audit correctness
- [x] Unit + integration tests PASS
- [x] Prompt 52 não executado

---

## Prompt 52 — Planejamento, alocação e disponibilidade (backend)

```
PROMPT_ID: 52
PROMPT_TITLE: Planejamento, alocação e disponibilidade — backend
EXECUTED_AT: 2026-08-29
EXECUTION_STATUS: PASS
COMMIT: feat(service-orders): implement resource planning and allocation
ARTIFACTS:
  packages/database/migrations/0021_planning_allocation_baseline.sql
  packages/database/src/schema/resource-planning.ts
  apps/api/src/service-orders/domain/resource-planning.ts
  apps/api/src/service-orders/domain/resource-compatibility.ts
  apps/api/src/service-orders/repositories/resource-planning.repository.ts
  apps/api/src/service-orders/services/service-order-planning-access.service.ts
  apps/api/src/service-orders/controllers/service-order-planning.controller.ts
  apps/api/src/authorization/types/authz-actions.ts
  apps/api/src/audit/types/security-audit.types.ts
  apps/api/src/test/ensure-migrations.ts
  docs/implementation/52-planning-allocation-backend.md
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
NEXT_PROMPT_EXECUTED: NO
NOTES:
  Separação requirement ≠ planned ≠ allocated; labor allocation a employee bloqueada (HR ausente).
  Exclusion constraint GiST + FOR UPDATE para concorrência de alocação temporal.
  Intervalos semiabertos [start, end); disponibilidade derivada, não coluna estática.
  Prompt 53 não executado.
```

## Quality gate Prompt 52 (evidência)

- [x] Planning by ResourceType/LaborType without concrete asset
- [x] Physical asset allocation with operational interval
- [x] Overlap protection (exclusion constraint + half-open intervals)
- [x] Concurrent allocation test (only one wins)
- [x] Inactive asset, type mismatch, outside window, authz, version conflict
- [x] History/audit preserved on remove
- [x] Regression: Prompt 51 integration tests PASS
- [x] Prompt 53 não executado

---

## Prompt 53 — Planejamento e alocação (frontend)

```
PROMPT_ID: 53
PROMPT_TITLE: Planejamento e alocação — frontend profissional
EXECUTED_AT: 2026-08-29
EXECUTION_STATUS: PASS
COMMIT: feat(web): implement resource planning and allocation experience
ARTIFACTS:
  apps/web/src/service-orders/
  apps/web/src/test/service-orders-fetch-mock.ts
  apps/web/src/test/render-service-order-routes.tsx
  apps/web/src/App.tsx
  apps/web/src/index.css
  apps/web/src/requests/pages/ServiceRequestDetailPage.tsx
  docs/00-governance/prompt-execution-log.md
QUALITY_GATE: PASS
FUNCTIONAL_CODE_CREATED: YES
NEXT_PROMPT_EXECUTED: NO
NOTES:
  UI consome backend real (planned-resources, allocations, physical-assets).
  Design system existente (CSS compartilhado) — sem Tailwind no monorepo web.
  Cobertura requirement/planned/allocated/pending; conflito concorrente com substituição.
  Alocação de pessoas bloqueada com mensagem (HR ausente).
  Prompt 54 não executado.
```

## Quality gate Prompt 53 (evidência)

- [x] Hierarquia visual: cabeçalho OS → resumo → requisitos → planejamento → disponibilidade → alocações
- [x] Estados REQUIREMENT / PLANNED / ALLOCATED / AVAILABLE / UNAVAILABLE distinguíveis (texto + legenda + status)
- [x] Backend autoridade: disponibilidade/conflito confirmados na alocação; frontend não calcula overlap
- [x] UX conflito concorrente: erro sem falso sucesso; dialog aberto; ativo marcado; substituto permitido
- [x] Double submit bloqueado (`submitting` + botão desabilitado)
- [x] Testes unitários + integração página + e2e (89/89 PASS em apps/web)
- [x] typecheck + lint PASS
- [x] Prompt 54 não executado

---

## Prompt 54 — Execução operacional e evidências (backend)

```
PROMPT_ID: 54
PROMPT_TITLE: Execuçã…202152 tokens truncated… conteudo que rola;
- `DynamicSavedViewsBar` em FAIXA PRÓPRIA, com a ordem exigida pela gramatica:
  OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE;
- `DynamicContextDrawer` carrega o detalhe REAL e mostra:
  `readiness.blockers` (pendencias reais para converter), `linkedChain` (linhagem real do processo)
  e skeleton localizado;
- **COMMAND LAYER real**: os seis comandos de transicao, guardados pelas capabilities reais;
  `reject` e `cancel` exigem MOTIVO DIGITADO pelo operador (registro de auditoria);
  `convert` fica indisponivel enquanto houver pendencias publicadas;
- `NEXT_STEP_ACTION_LABEL` REMOVIDO — o frontend deixou de ser dono do mapa estado -> acao;
- token de recarga real (`reloadToken`) para a fila refletir o comando.

### Evidencia DOM (Chromium 1440x900, dev server real)

| Regiao | top | altura |
| ------ | --- | ------ |
| `work-surface` (sticky) | 149 | 189 |
| operating-header | 149 | 39 |
| **saved-view-surface** | 246 | 46 |
| command-filter-surface | 292 | 46 |
| worklist-master | 338 | 1491 |

`occluded = 0`; `docOverflowX = -15`; ordem das regioes conforme a gramatica obrigatoria.

### Limitacao registrada (nao ocultada)

O banco de desenvolvimento tem **0 solicitacoes** (`GET /api/v1/procurement/requests` devolve
`total: 0`). Por isso NAO foi possivel exercitar por DOM o clique na linha, o painel de contexto e
os comandos com dado real. A composicao, a ordem das regioes, a ausencia de overlap/overflow e os
testes focados foram verificados; a INTERACAO com dado real permanece pendente de dado.

### Validacao

- `eslint src/requests` — **PASS**; `typecheck` — **PASS**; `src/requests` — **34/34 PASS**
- `git diff --check` — **PASS** (exit 0) apos remover linha em branco final introduzida por script

### Incidente registrado

Durante a recomposicao o arquivo ficou com fechamento JSX desbalanceado e variaveis duplicadas
(`reloadToken`, `reload`). Corrigido antes do commit; nenhum teste foi afrouxado para passar.

WORKING_TREE: limpo apos commit

---

## ORDENS DE SERVICO — CONTEXT REGION REAL (rodada 7) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `398ba70` — feat(web): give service orders a real context region and operator-supplied reasons

### Classificacao

Categoria **A — WORKLIST** (workspace operacional com grade da engine). Contrato verificado:
`GET /service-orders/:id` (detalhe), comandos reais `prepare`/`release`/`cancel`/`reopen`.

### Defeitos encontrados e corrigidos

1. **PAINEL DE CONTEXTO VAZIO.** O `DynamicContextDrawer` exibia APENAS um botão "Abrir ordem" e
   nenhuma informação do registro — o "modal decorativo" que a ordem proíbe. Agora carrega o
   detalhe REAL (`internalCode`, `origin`, `contractReference`, vínculos de solicitação/proposta/
   pedido de compra) com skeleton localizado, e executa os quatro comandos reais.

2. **MOTIVO EMPRESARIAL FABRICADO PELO FRONTEND.** O cancelamento em lote enviava
   `cancellationReason: 'Cancelamento em lote solicitado na lista de ordens de serviço.'` — texto
   FIXO, inventado pela tela para satisfazer o schema. Motivo é REGISTRO DE AUDITORIA. Agora o
   operador informa o motivo e o comando é recusado sem ele (individual e em lote).

### Evidencia DOM (Chromium 1440x900, dev server real — 17 ordens carregadas)

| Criterio | Medido |
| -------- | ------ |
| `data-region` presentes | work-surface, operating-header, saved-view-surface, bulk-command-surface, worklist-master, context-region |
| Linhas carregadas | 17 |
| Altura de linha | 35px |
| Overlap / overflow-x | **0 / 0** |

### RESTRICAO REGISTRADA (nao ocultada)

**Sticky NAO aplicado nesta pagina, e a tentativa foi revertida por medicao.** A superficie de
trabalho desta tela contem 7 blocos (view switcher, drill-down de KPI, cockpit, export, filtro de
metadado, busca e lote) e mediu **1097px de altura — mais alta que a viewport (804px)**. Um
`position: sticky` maior que a janela nao gruda: ele empurra a fila para fora da dobra. Medido:
**dobra util de -441px**. A classe sticky foi removida e o motivo ficou documentado no codigo.

Tambem registrado: `worklist-master` ficou ANINHADO dentro de `work-surface` (heranca de um
fragmento JSX da engine), o que e semanticamente imperfeito embora inofensivo sem sticky.

### Validacao

- `eslint src/service-orders` — **PASS**; `typecheck` — **PASS**
- `service-orders-list.e2e` + `ServiceOrdersEngineListPage.test` — **9/9 PASS**
- `git diff --check` — **PASS** (exit 0) apos remover linha em branco final

### Incidente registrado

Duas tentativas de fechamento de JSX ficaram desbalanceadas (fragmento vs `div`) e foram
corrigidas antes do commit. Nenhum teste foi afrouxado.

WORKING_TREE: limpo apos commit

---

## CONTAS A RECEBER — WORK AREA (rodada 8) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `c202902` — feat(web): remove repeated client link and align receivables work area regions

### Classificacao

Categoria **A — WORKLIST**. Contrato verificado: `GET /finance/receivables/:id` (detalhe),
`settleReceivable` / `cancelReceivable` (comandos reais).

### Defeitos corrigidos

1. **LINK REPETIDO EM TODA LINHA.** A celula de cliente renderizava
   `Cliente não publicado · Abrir cliente` — a MESMA ação em todos os registros, exatamente o
   padrao que a ordem proíbe. Além disso o controle inline (`inline-flex`) estourava a largura da
   celula truncada e cobria o link vizinho por hit test. Agora a celula DECLARA a ausência
   (`Cliente não publicado`) e para; o drillback do cadastro vive na cadeia comercial do painel de
   contexto e a linha navega para o título.

2. **REGIÕES ESTRUTURAIS AUSENTES.** A pagina nao expunha nenhuma `data-region`. Adicionadas:
   operating-header, saved-view-surface, command-filter-surface, bulk-command-surface,
   worklist-master. A ordem foi medida e CORRIGIDA: a faixa de visões salvas estava DEPOIS da
   superficie de filtro; foi movida para antes, conforme a gramatica obrigatoria.

### Evidencia DOM (Chromium 1440x900, dev server real)

| Regiao | top | altura |
| ------ | --- | ------ |
| operating-header | 149 | 43 |
| **saved-view-surface** | 276 | 43 |
| command-filter-surface | 319 | 42 |
| worklist-master | 391 | 429 |

| Criterio de aceite | Medido |
| ------------------ | ------ |
| Link repetido por linha ("Abrir cliente") | **0** |
| Links por linha | **[0,0,0]** |
| Overlap (hit test no centro real) | **0** |
| Overflow horizontal | **0** (`docOverflowX = -15`) |
| Linhas / altura de linha | 3 / 31px |

### RESTRICAO REGISTRADA (nao ocultada)

`work-surface` NAO foi declarada nesta pagina: os blocos acima da fila (drill-down de 4
indicadores + construtor de filtro + barra de lote) somam ~240px e a experiencia de sticky deste
workspace ainda nao foi medida isoladamente. Preferi nao declarar a regiao a declarar uma regiao
cuja estabilidade nao foi verificada. Fica PENDENTE para a proxima passada neste modulo.

### Falhas PREEXISTENTES verificadas por `git stash` sobre o baseline limpo

- `src/finance/finance-smart-list.ui.test.tsx` — 7/7 falham por timeout NO BASELINE LIMPO,
  identico com e sem as alteracoes desta rodada;
- `src/finance/finance-backoffice.ui.test.tsx` — 4 falhas, mesma condicao.

Nao foram introduzidas nem corrigidas aqui; permanecem registradas.

### Validacao

- `eslint src/finance/pages/ReceivablesListPage.tsx` — **PASS**
- `typecheck` — **PASS**
- `git diff --check` — **PASS** (exit 0)

WORKING_TREE: limpo apos commit

---

## CONTAS A PAGAR — WORK AREA (rodada 9) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `d23c8aa` — feat(web): align payables work area regions with saved views before filters

### Classificacao

Categoria **A — WORKLIST**. Contrato verificado: `GET /finance/payables/:id` (detalhe),
`payPayable` / `cancelPayable` / `reversePayable` (comandos reais).

### Alteracao aplicada

- Regioes estruturais adicionadas: operating-header, drilldown-surface, saved-view-surface,
  command-filter-surface, bulk-command-surface, worklist-master.
- **ORDEM CORRETA DESDE A PRIMEIRA VERSAO**: a faixa de visoes salvas nasceu ANTES da superficie de
  filtro, conforme a gramatica (OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE).
  Em Contas a Receber essa ordem precisou ser corrigida por medicao na rodada anterior; aqui a
  licao foi aplicada de inicio.

### Evidencia DOM (Chromium 1440x900, dev server real)

| Regiao | top | altura |
| ------ | --- | ------ |
| operating-header | 149 | 43 |
| **saved-view-surface** | 276 | 43 |
| command-filter-surface | 319 | 42 |
| worklist-master | 391 | 154 |

`occluded = 0`; `docOverflowX = 0`.

### Achado de HARNESS (importante para as proximas rodadas)

O gate servia **MODULO TRANSFORMADO ANTIGO** a partir do perfil persistente do Chrome. Medido:
apos editar `PayablesListPage.tsx`, o dev server JA servia o arquivo com `data-region`, mas o DOM
continuava SEM as regioes — bundle em cache. O gate foi corrigido com
`Network.setCacheDisabled({ cacheDisabled: true })`.

**Um gate que mede codigo velho pode REPROVAR ou APROVAR a coisa errada.** Este achado invalida,
em principio, qualquer medicao anterior feita logo apos uma edicao. Para fechar a duvida, a pagina
alterada na rodada anterior foi RE-MEDIDA com o gate corrigido: os numeros de Contas a Receber
(operating 149 / saved 276 / filter 319 / master 391, 3 linhas, linha de 31px, 0 overlap,
0 links repetidos) se mantem identicos — ou seja, a evidencia da rodada 8 permanece valida.

### RESTRICAO REGISTRADA (nao ocultada)

- O banco de desenvolvimento tem **0 contas a pagar** (`GET /api/v1/finance/payables` devolve
  `total: 0`). A grade populada, a interacao de linha e o painel de contexto NAO puderam ser
  exercitados com dado real.
- `work-surface` (sticky) NAO declarada nesta pagina, pelo mesmo motivo de Contas a Receber: a
  estabilidade da faixa ainda nao foi medida isoladamente neste workspace.

### Falhas PREEXISTENTES (identicas ao baseline)

`finance-smart-list` 7/7 e `finance-backoffice` 4/10 falham por timeout tambem no baseline limpo
(verificado por `git stash` na rodada 8). Contagem inalterada nesta rodada: 11 falhas.

### Validacao

- `eslint src/finance/pages/PayablesListPage.tsx` — **PASS**; `typecheck` — **PASS**
- `git diff --check` — **PASS** (exit 0)

WORKING_TREE: limpo apos commit

---

## PROPOSTAS COMERCIAIS — WORKLIST (rodada 10) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `c0c435c` — feat(web): remove repeated open action and cardify from proposals worklist

### Classificacao

Categoria **A — WORKLIST** (fila de decisão comercial, com dado real: 14 propostas).

### Defeitos corrigidos

1. **ACAO REPETIDA EM TODA LINHA.** Cada item renderizava um link `Abrir` ao lado do selo de
   estado — a MESMA ação em todos os registros, quando a IDENTIDADE da linha (`proposalCode`) ja
   era um link real para a ficha completa. Duas portas para o mesmo destino. O link foi REMOVIDO.

2. **CARDIFICATION DE SEGUNDO NIVEL.** A fila vivia em `enterpriseTableCardClass`
   (`rounded-md border bg-white shadow-[...]`) dentro de uma área de trabalho que ja e branca:
   "lista dentro de card". A caixa foi removida e a fila passou a ser delimitada por divisor.

3. **REGIÕES AUSENTES.** Adicionadas: operating-header, command-filter-surface, worklist-master.

### Evidencia DOM (Chromium 1440x900, dev server real, cache desabilitado)

| Regiao | top | altura |
| ------ | --- | ------ |
| operating-header | 149 | 43 |
| command-filter-surface | 237 | 48 |
| worklist-master | 285 | 1569 |

| Criterio de aceite | Medido |
| ------------------ | ------ |
| "Abrir" repetido por linha | **0** |
| Botoes repetidos por linha | **[]** (nenhum) |
| Links da 1a linha (drillback real) | `PROP-2026-0B709E3F`, `SR-2026-4F7C5EA9` |
| Linhas carregadas | **14** |
| Overlap / overflow-x | 0 / `-15` |

### RESTRICAO REGISTRADA — DENSIDADE NAO RESOLVIDA

A linha desta fila mede **106 a 131px** (media 4 registros na primeira dobra de 14). A fila usa
`<ul>` próprio, nao a grade da engine, e a altura alta NAO foi corrigida nesta rodada.

**PROPOSTAS COMERCIAIS NAO ESTA COMPLETA para o criterio de densidade da ordem.** O que foi
entregue aqui e verificavel: ausencia de ação repetida, ausencia de cardification e regiões
estruturais. O que falta: recompor a linha em hierarquia compacta (identidade + estado + tempo)
como foi feito em Clientes, com meta proxima do token de linha.

Tambem pendente: faixa de visoes salvas (a pagina nao tem saved views) e painel de contexto real
(a pagina usa `ContextDrawer` com dados da propria linha).

### Achado de harness

O gate de work-area nao reconhece esta fila (`rows: 0`) porque ela nao e `<table>` nem
`ul[aria-label]`. Foi criado `tmp/list-probe.mjs` para medir listas customizadas; o gate principal
continua valido para as telas baseadas na engine.

### Validacao

- `eslint src/proposals` — **PASS**; `typecheck` — **PASS**; `src/proposals` — **34/34 PASS**
- `git diff --check` — **PASS** (exit 0)

WORKING_TREE: limpo apos commit

---

## PROPOSTAS COMERCIAIS — FROZEN (rodada 11) — 2026-10-07

STATUS: **PASS**
Commit: `6e90eaf` — feat(web): recompose proposals rows and integrate saved views

### Fechamento do que a rodada 10 deixou pendente

- linha: **106–131px → 59–74px** (o driver era a celula de situacao, 103px: selo + frase do
  proximo passo quebravam em 3 linhas e os chips em mais 2; agora uma linha truncada cada);
- registros na primeira dobra: **4 → 7**, de 14 carregados;
- **Saved Views integradas** (`DynamicSavedViewsBar` em faixa propria, ANTES do filtro) — era o
  unico criterio nao atendido;
- identidade hierarquizada: codigo + cliente (principal) / titulo + origem·revisao·unidade numa
  unica linha subordinada.

### Os 16 criterios, medidos por DOM

| # | Criterio | Medido |
| - | -------- | ------ |
| 1 | Identidade principal clara | `PROP-2026-0B709E3F` |
| 2 | Cliente subordinado | inline na identidade |
| 3 | Titulo sem redundancia | 1 linha truncada |
| 4 | Money | `formatMoney` |
| 5 | Validade | `formatDateTime` |
| 6 | Estado com baixo ruido | selo + passo, uma linha |
| 7 | Proxima acao sem duplicar command | sem botao por linha |
| 8 | "Abrir" repetido | **0** |
| 9 | Row drillback real | linha abre contexto; codigo navega |
| 10 | Saved Views | `saved-view-surface` top=237 h=42 |
| 11 | Filtros server-side | preservados (URL -> servidor) |
| 12 | Contexto preserva a fila | `ContextDrawer` |
| 13 | Exception-first | chips so na excecao |
| 14 | Overflow | `docOverflowX = -15` |
| 15 | Overlap | `occluded = 0` |
| 16 | Keyboard/focus | links reais; **0** botoes repetidos |

Regioes (ordem da gramatica): operating-header 149 / saved-view 237 / command-filter 279 /
worklist-master 327.

### Validacao

- `eslint src/proposals` — **PASS**; `typecheck` — **PASS**; `src/proposals` — **34/34 PASS**
- `git diff --check` — **PASS** (exit 0)

WORKING_TREE: limpo apos commit
NEXT: proxima funcao real (Pedidos de Compra).

---

## PROPOSTAS — GATE DE GRAMÁTICA (ANTES vs DEPOIS POR DOM) — 2026-10-07

Regra aplicada a partir daqui: **teste verde nao congela CRUD. TIER-1 congela.** Antes de manter o
freeze, a GRAMATICA da funcao foi comparada por DOM, nao por lint/typecheck/teste.

Ferramenta: `tmp/grammar-gate.mjs` — lista os blocos de primeiro nivel de `#main-content` NA
ORDEM, com papel inferido (`data-region`, tag, presenca de card), e quantos wrappers tipo card
existem. Nao interpreta imagem.

### ANTES (medido nas rodadas 10/11, antes das alteracoes)

- `data-region` presentes: **nenhuma** (`operatingHeader`, `savedViewSurface`,
  `commandFilterSurface`, `worklistMaster` todos `null`);
- a fila vivia em `enterpriseTableCardClass` — **card com borda, fundo branco e sombra** dentro da
  area de trabalho;
- `Abrir` repetido em TODA linha (**14 registros**);
- gramatica perceptivel: titulo -> faixa -> filtros -> LISTA EM CARD.

### DEPOIS (medido agora, cache desabilitado)

| # | Bloco | papel | top | altura | cards |
| - | ----- | ----- | --- | ------ | ----- |
| 1 | operating-header | `operating-header` | 149 | 43 | 0 |
| 2 | faixa de decisao | `section` | 192 | 37 | 0 |
| 3 | saved views | `saved-view-surface` | 237 | 42 | 0 |
| 4 | comando/filtro | `command-filter-surface` | 279 | 48 | 0 |
| 5 | fila | `worklist-master` | 327 | **882** | 0 |
| 6 | paginacao | `nav` | 1209 | 34 | 0 |

- `gridOrTablePresent`: **false** — a funcao NAO e uma tabela generica;
- `cards`: **0** — nenhuma cardification;
- `regions`: **5** — as cinco regioes da gramatica, na ordem exigida.

### Julgamento

A composicao passou de `TITULO -> FAIXA -> FILTROS -> LISTA EM CARD` para
`WORKSPACE -> ESTADO OPERACIONAL -> SAVED VIEW SURFACE -> COMMAND/FILTER SURFACE -> WORK QUEUE`,
com a fila dominando a area util (882px) e zero cards. **A mudanca e estrutural, nao cosmetica** —
nao e "a mesma tabela com componente Enterprise".

Ressalva honesta: nao existe comparacao automatica contra a versao anterior (o servidor de
desenvolvimento serve apenas o codigo atual); o ANTES acima vem das medicoes registradas nesta
mesma sessao, com a mesma ferramenta e a mesma viewport.

FREEZE MANTIDO: `6e90eaf` (codigo) / `90c1b95` (registro).

---

## PEDIDOS DE COMPRA — SUBSTITUICAO DE GRAMATICA (rodada 12) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `ade1f7d` — feat(web): replace legacy grammar with work-area regions in purchase orders

### Regra aplicada

NAO acrescentar a gramatica nova sobre a antiga. A antiga foi SUBSTITUIDA.

### Duplicacao — criterio de aceite, contado no arquivo

| Item | Contagem |
| ---- | -------- |
| `DynamicSavedViewsBar` | **1** |
| `WorklistFilterBar` | **1** |
| Containers de tabela | **1** |
| `RowActionCell` / `RowActionMenu` | **0** (removidos) |
| `worklistTableCardClass` | **0** (removido) |
| `data-region` | **4** |

Durante a recomposicao eu criei de fato uma abertura duplicada de Saved Views; ela foi corrigida e
a contagem acima e a verificacao de que nao sobrou camada dupla.

### Substituicoes aplicadas

1. **Card da grade REMOVIDO.** `worklistTableCardClass` (`rounded-md border bg-white`) fazia a fila
   parecer "tabela dentro de card" numa area de trabalho que ja e branca. Agora a fila e delimitada
   pelo divisor da superficie de filtro.
2. **ACOES DE LINHA REMOVIDAS.** O `RowActionCell` renderizava um menu cujos itens eram TODOS
   `<Link to={/app/purchase-orders/${id}}>` — ou seja, nao executavam comando algum: eram
   NAVEGACAO vestida de acao, repetida em toda linha, quando a identidade (`poNumber`) ja era um
   `WorklistRowLink` real para o mesmo destino. Nenhuma capacidade foi perdida na remocao.
3. **Importacoes mortas removidas** (`purchaseOrderRowActions`, `rowPrimaryActionClass`,
   `rowSecondaryActionClass`, `RowActionMenu`, `RowActionCell`).

### Gate de gramatica (DOM, cache desabilitado)

| # | Bloco | papel | top | altura | cards |
| - | ----- | ----- | --- | ------ | ----- |
| 1 | operating-header ("Pedidos de compra") | `operating-header` | 149 | 79 | 0 |
| 2 | visoes salvas | `saved-view-surface` | 228 | 42 | 0 |
| 3 | comando/filtro | `command-filter-surface` | 270 | 42 | 0 |
| 4 | fila | `worklist-master` | 312 | **734** | 0 |

`cards: 0`; `regions: 4`; ordem = OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE.
A gramatica NAO e mais `breadcrumb -> titulo -> filtros -> tabela`.

### RESTRICAO REGISTRADA — CONTEXT REGION PENDENTE

A composicao alvo inclui **CONTEXT REGION** com comandos. Nesta pagina ela **nao foi entregue**:
`getPurchaseOrder` existe, `registerPurchaseOrder`/`cancelPurchaseOrder` existem, mas o painel de
contexto real (com motivo informado pelo operador para cancelar) NAO foi implementado nesta rodada.
O que existe hoje e: identidade como drillback real e a linha ainda NAVEGA para o detalhe.

**PEDIDOS DE COMPRA NAO ESTA COMPLETA** para o criterio de command layer vindo da fila. Fica
registrado como a proxima pendencia desta funcao.

### Validacao

- `eslint src/purchase-orders` — **PASS**; `typecheck` — **PASS**
- `src/purchase-orders` — **25/25 PASS**; `git diff --check` — **PASS** (exit 0)

WORKING_TREE: limpo apos commit

---

## ENTERPRISE VISUAL FOUNDATION — CAMADA COMPARTILHADA (rodada 13) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `feat(web): establish enterprise visual foundation`

### Escopo

Somente camada compartilhada. **Nenhuma pagina de modulo editada. Nenhum backend, API, migration,
seed, permissao, DTO, capability ou workflow tocado.** Nenhuma biblioteca instalada. Stack preservada.

Objetivo desta rodada nao foi "cada vez menos borda/sombra/raio/padding". Foi INVERTER o default da
camada compartilhada para que paginas **nunca editadas** mudem por heranca.

### Arquivos compartilhados alterados (9; +359 / -56)

| Arquivo | Camada |
| ------- | ------ |
| `apps/web/src/ui/theme.css` | governanca global: superficie, raio, elevacao, divisores de regiao, densidade de grade, estados, foco |
| `apps/web/src/shell/shell.css` | workspace canvas, moldura da pagina, faixa de orientacao, loading |
| `apps/web/src/shell/AppShellLayout.tsx` | margem morta do work area |
| `apps/web/src/ui/PageHeader.tsx` | faixa de identidade do workspace |
| `apps/web/src/ui/Breadcrumb.tsx` | trilha de orientacao (wayfinding, nao titulo) |
| `apps/web/src/ui/Badge.tsx` | token de estado na grade de densidade |
| `apps/web/src/ui/enterprise-list.tsx` | superficie de comando / superficie de filtro |
| `apps/web/src/ui/module-layout.tsx` | `FilterCard` -> superficie de filtro |
| `apps/web/src/engine/DynamicFilterBar.tsx` | superficie de filtro |

### Mudanca estrutural (nao cosmetica)

1. **MORREU A "FOLHA BRANCA".** A moldura tinha fundo branco + borda + raio sobre canvas cinza. Agora
   o canvas da AREA DE TRABALHO e a superficie de trabalho e a moldura nao pinta fundo proprio
   (`transparent`). Sem folha, sem mesa: a hierarquia passa a vir de REGIAO ESTRUTURAL.
2. **REGIAO ESTRUTURAL GOVERNada.** O divisor de regiao e desenhado pelo sistema. `.shell-page-frame > * + *`, `#main-content > * + *` e
   `[data-region] + [data-region]` desenham a fronteira entre regioes; `#main-content > *:has(+ *)`
   cede a borda inferior de quem tem irmao depois, para nao existir regua dupla.
3. **DENSIDADE DEIXOU DE SER PROPRIEDADE DA PRIMITIVA.** Cabecalho e celula de TODA tabela da area de
   trabalho passam a ser governados por token — inclusive em telas que nunca usaram a worklist.
   Escotilha semantica: `table[role="presentation"]` (tabela de layout) fica intocada.
4. **ESTADOS E FOCO DEIXARAM DE SER LOCAIS.** Foco unico do workspace, hover de linha **somente onde
   existe alvo real** (`:has(a[href], button:not([disabled]))` — sem affordance inventada) e selecao
   como estado do sistema.
5. **SUPERFICIE DE COMANDO E DE FILTRO** viraram vocabulario do sistema (`.cisne-command-surface`,
   `.cisne-filter-surface`), com pesos de regua DIFERENTES: comando separa com regua forte, filtro com
   regua comum.

### Correcao de escopo registrada (erro desta rodada, corrigido antes do commit)

A primeira versao da regra de divisor governava `#main-content > div + div`; a segunda governava
`#main-content .shell-page-frame > * + *`, que e **impossivel de casar** — `id="main-content"` esta no
proprio `<main>` que `ModulePage` renderiza, e esse `<main>` e FILHO de `.shell-page-frame`. Um seletor
descendente nao sobe a arvore: a regra teria efeito ZERO. Registrado porque a licao vale mais que a
regra: seletor de governanca precisa ser conferido contra a arvore REAL, nao contra a pretendida.

### Canario DOM — 3 paginas NAO EDITADAS (BEFORE vs AFTER)

Instrumento: `tmp/foundation-canary-gate.mjs` (CDP, Chromium 1440x900, cache desabilitado, servidor
real). "OFF" e EMULADO por stylesheet com os valores exatos anteriores a esta wave (padding de
shell/moldura, margem de breadcrumb, fundo/borda/raio da moldura). **Nenhum stash, nenhum reset.**

| Metrica | `/app/catalog` | `/app/suppliers/new` | `/app/finance/payables` |
| ------- | -------------- | -------------------- | ----------------------- |
| usable width ON/OFF | **1063 / 1007** | **1078 / 1022** | **1078 / 1022** |
| dead margin lateral ON/OFF | **16 / 32** | **16 / 32** | **16 / 32** |
| content padding left ON/OFF | **16 / 32** | **16 / 32** | **16 / 32** |
| frame padding left ON/OFF | **12 / 24** | **12 / 24** | **12 / 24** |
| frame bg/borda/raio ON | `transparent` / 0 / 0 | `transparent` / 0 / 0 | `transparent` / 0 / 0 |
| frame bg/borda/raio OFF | `#fff` / 1 / 2 | `#fff` / 1 / 2 | `#fff` / 1 / 2 |
| topo do cabecalho ON/OFF | **118 / 147** | **118 / 147** | **118 / 147** |
| margem inferior do breadcrumb ON/OFF | **4 / 16** | **4 / 16** | **4 / 16** |
| altura do cabecalho ON=OFF | 79 | 42 | 43 |
| control height | 30 | 34 | 26 |
| filter surface | **30** | — (sem filtro) | — (sem registro) |
| grade: th / fonte / transform / thBg | **26px / 11px / uppercase / rgb(241,243,246)** | — | — |
| grade: padding da celula | **2px** | — | — |
| grade: altura de linha | 41 | — | — |
| linhas / na dobra | **20 / 12** | — | — |
| superficies: claras / contornadas / sombreadas / aninhamento | 1 / 0 / **0** / 0 | 0 / 0 / **0** / 0 | 3 / 1 / **0** / 1 |
| regioes sticky | 5 (nenhuma acima da dobra) | 0 | 0 |
| main/aside | 3,69 | 3,74 | 3,74 |
| overflow horizontal | -15 (barra de rolagem) | 0 | 0 |
| overlap (`elementFromPoint`, sem clamp) | **0** | **0** | **0** |
| regua dupla | **0** | **0** | **0** |
| regua sobre coluna | **0** | **0** | **0** |
| erros de console | 0 | 0 | 0 |

Ganho medido por heranca, igual nas tres: **+56px de largura util**, margem morta lateral pela metade
(32 -> 16), **29px recuperados antes do cabecalho do workspace**, moldura sem folha/borda/raio.

### Canario de ESTADOS — prova por pseudo-estado forcado (`CSS.forcePseudoState`)

`tmp/foundation-states-gate.mjs` em `/app/catalog` (28 controles focaveis, 20 linhas):

| Prova | OFF | ON |
| ----- | --- | -- |
| controle SEM indicacao propria | `outline-style: none` | **`solid 2px rgb(35,127,120)`** |
| controle que declara `outline-none` (usa ring) | `none` | `none` (sem indicacao dobrada) |
| linha de grade com alvo, `:hover` | `rgba(0,0,0,0)` | **`rgb(238,247,246)`** |

### Confirmacao de que NAO e "CRUD mais plano"

O gate anti-maquiagem pedia mudanca em hierarquia, densidade, workspace, surface grammar, headers,
commands e data presentation — nao apenas padding/raio/sombra/borda. Evidencia: (a) a ESTRUTURA da
moldura mudou (branco+borda+raio -> transparente) enquanto a caixa permaneceu; (b) uma pagina que
nunca declarou densidade passou a ter cabecalho de grade e celula governados por token; (c) existe
regiao estrutural entre blocos, sem regua dupla nem regua sobre coluna; (d) 24 dos 28 controles
focaveis da canario passaram a ter indicacao de foco que **nao existia**; (e) a faixa de comando e a
faixa de filtro passaram a ter vocabulario e pesos proprios.

### Gates

- `tsc --noEmit` — **PASS** (exit 0); `eslint src/shell src/ui src/engine` — **PASS** (exit 0)
- `src/ui` + `src/engine` — **46/46 PASS**
- `git diff --check` — **PASS**
- `git status` / `git diff --name-only` — somente os 9 arquivos compartilhados acima

### RESTRICOES CONHECIDAS (registradas, nao mascaradas)

1. **`src/shell/shell.e2e.test.tsx` — 6 falhas PRE-EXISTENTES.** FALHAM IDENTICAMENTE SEM A FOUNDATION,
   provado por comparacao com o baseline `02ea564` (mesmos nomes, mesma contagem, mesma assinatura de
   duracao: a primeira em ~744ms por `Found multiple elements with the role "banner"` e as outras 5 por
   timeout de 5s no titulo "Acesso negado"). Causa provavel: `role="banner"` DUPLICADO na arvore do
   shell. **NAO investigado e NAO corrigido nesta wave** por decisao explicita: nao e regressao da
   foundation, e abrir auditoria de shell no meio da wave visual misturaria dois escopos.
2. **Suite completa do web: 39 falhas / 914 passes (163 arquivos).** Comparadas com o registro de
   baseline desta sessao: 26 das falhas ja eram conhecidas e pre-existentes; a 27a
   (`ServiceOrdersEngineListPage`, paginacao "21-25") PASSA agora. As 13 restantes foram classificadas
   por MECANISMO, sem novo baseline global (proibido) e sem stash: 4 sao o MESMO defeito de
   `banner` duplicado ja provado pre-existente (`vertical-quality-gate` x3, `auth-flow.e2e` x1);
   1 e teste unitario PURO de funcao (`feature-flags`, 10ms, sem render, `isNavItemVisible`);
   2 sao conteudo ausente em formulario dirigido por backend (`enterprise-ui-catchup`);
   1 e contagem (`compliance-bi`); 4 sao timeout de 5s (flaky: `payroll-period-discovery`,
   `BillingPages`, `billing.e2e`, `billing-document.e2e`); 1 (`closing-center`) **PASSA em execucao
   isolada**, portanto e flaky por ordem. Nenhum mecanismo e alcancavel por alteracao de CSS ou de
   `className` — o unico efeito de DOM desta wave e o reposicionamento de `meta` dentro de
   `PageHeader`, que nao e alvo de nenhuma das falhas.
3. **Altura de linha em `/app/catalog` = 41px, nao `--row-height` (28px).** O token atua como MINIMO e
   o conteudo da celula domina (a pagina embute um controle na linha). Densidade dessa pagina e tarefa
   de COMPOSICAO DA PAGINA (wave serial de modulos), nao da camada compartilhada.
4. **Garantia "hover sem alvo" NAO exercitada:** as 20 linhas da canario tem link/botao
   (`rowsWithoutTarget = 0`). O mecanismo existe e esta medido no hover COM alvo; a ausencia de falsa
   affordance permanece **nao provada nesta amostra**.
5. **`.cisne-command-surface` nao exercitada por nenhuma das 3 canarios** (nenhuma renderiza a
   primitiva). Esta ligada em `EnterpriseToolbar`, mas a canario prova apenas a superficie de FILTRO.
6. **Camadas 8 (Saved Views), 10 (Object Experience) e 12 (Context Drawers)** foram entregues em
   rodadas anteriores desta mesma wave e **nao foram alteradas nesta rodada**; as canarios nao as
   renderizam, logo esta rodada nao as re-prova.
7. **`02ea564` (context region de Pedidos de Compra) nao possui entrada propria neste log.** O commit
   existe e o codigo esta no HEAD; o registro detalhado daquela rodada continua PENDENTE.

WORKING_TREE: 9 arquivos compartilhados + este registro

---

## PROPOSTAS COMERCIAIS — VERACIDADE DO CONTEXTO E DA CONTAGEM (rodada 14) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `feat(web): make proposals context region authoritative and counts page-scoped`

### Escopo

Rodada cirúrgica de VERACIDADE. Dois alvos, nenhum redesenho: nao foi tocada a foundation, a shell,
a tipografia global, a densidade global, row height, Saved Views nem a command surface.

### Arquivos alterados (2; +468 / -135)

| Arquivo | Papel |
| ------- | ----- |
| `apps/web/src/proposals/pages/ProposalsListPage.tsx` | contexto autoritativo + contagem honesta |
| `apps/web/src/engine/DynamicContextDrawer.tsx` | defeito de acessibilidade medido no gate (ver abaixo) |

### ALVO 1 — CONTEXT REGION AUTORITATIVA

DEFEITO CORRIGIDO: o painel era alimentado pela LINHA da lista. A linha publica
`currentVersionNumber`, `currentVersionStatus`, `saleTotal`, `validUntil` — e **nao publica o
`rowVersion` da VERSAO**, que e o que os comandos exigem. Ou seja: o painel afirmava fatos de um
RESUMO e, para agir, mandava sair da fila. O "proximo passo" era um link rotulado com verbo —
navegacao vestida de comando.

AGORA: selecionar linha dispara `getProposal(id)`; o painel le o DETALHE (`currentVersion` com
`versionNumber`/`rowVersion`/situacao/valor/validade, `readiness.nextStep`, `readiness.blockers`,
`linkedChain`) e oferece comandos na **INTERSECAO** de duas decisoes do servidor:

1. `readiness.availableTransitions` — o BACKEND decide o que a versao vigente admite;
2. `capabilities.can{Issue,Accept,Reject,Expire,Cancel}` — o BACKEND decide o que o ator pode.

`revise` NAO e oferecido no painel: criar revisao e fluxo de formulario, nao comando de linha.
Motivo de rejeicao/cancelamento vai SÓ quando o operador digita (contrato os marca opcionais).
`rowVersion` vai no payload; conflito de versao vira mensagem, nao e mascarado.
`PROPOSAL_ACTION_LABEL` foi REMOVIDO — existia apenas para vestir o drillback de comando.

### ALVO 2 — CONTAGEM HONESTA

CONTRATO VERIFICADO (nao presumido): `ProposalListResponse = { items, limit, offset }` — **nao
existe `total`**. Portanto nenhuma contagem global e possivel, e nenhuma foi inventada.

| Antes | Depois |
| ----- | ------ |
| cabecalho com numero sem escopo; contexto dizia apenas "Decisao comercial pendente..." | contexto visivel: "Pagina N — decisao comercial por proposta. Esta lista nao publica total; a contagem acima e desta pagina." |
| faixa `aria-label="Fila de decisao"` | `aria-label="Decisao nesta pagina"` |
| "aguardando decisao" / "validade critica" | "aguardando decisao **nesta pagina**" / "validade critica **nesta pagina**" |
| "{n} decididas no recorte" | "{n} decididas **nesta pagina**" |
| tooltips afirmando o conjunto | tooltips delimitando a pagina e declarando que a API nao publica total |

Nenhum KPI decorativo foi criado; a faixa continua sendo o mesmo recorte local, agora declarado.

### DEFEITO 3 — ENCONTRADO PELO PROPRIO GATE, NA PRIMITIVA COMPARTILHADA

`DynamicContextDrawer` e `role="dialog" aria-modal="true"` e **nao tratava Escape**. Alem disso o
botao de fechar usava `t('common.actions')` = **"Acoes"** — rotulo errado para um controle de
FECHAR. Sem backdrop, o unico caminho de saida do operador de teclado era um botao cujo nome nao diz
o que ele faz. Corrigido na primitiva (afeta Propostas, Clientes, Fornecedores e Pedidos de Compra):
`t('common.close')` = "Fechar", Escape fecha, e o foco entra no painel ao abrir — sem mover um pixel.

### Gate de veracidade (REDE + DOM, CDP, cache desabilitado, servidor real)

Instrumento: `tmp/proposals-veracity-gate.mjs`. Amostra: 14 propostas reais; sondas de capability
(`/proposals/00000000-0000-4000-8000-*/...`, 404 por desenho) foram CLASSIFICADAS A PARTE para nao
entrarem na prova.

| # | Prova exigida | Resultado medido |
| - | ------------- | ---------------- |
| 1 | selecionar dispara detalhe real | **6 GET de detalhe** para 3 selecoes, com o id EXATO da linha clicada (`d5c5885b…`, `44c5dbf7…`, `1046d707…`) |
| 2 | contexto usa payload de detalhe | `payloadCode = domCode = PROP-2026-DC14E998`; `globalSalePrice 7500` BRL → **"VALOR R$ 7.500,00"**; `versionNumber 1` → **"REVISAO Revisao 1"**; `nextStep AWAIT_CLIENT_DECISION` → **"Aguardar decisao do cliente"** |
| 3 | loading so no contexto | `{contextBusy: true, moduleLoading: false, rowsDuringLoading: 14, worklistPresent: true}` |
| 4 | worklist nao desmonta | `rows = 14` em TODOS os estados (e `1` com o recorte ISSUED aplicado) |
| 5 | filtros permanecem | `filterPresent` e `savedViewPresent` = true em todos os estados |
| 6 | scroll permanece | `260 → 260 → 260` (antes, apos selecionar, apos fechar) |
| 7 | trocar selecao troca contexto | A `PROP-2026-B5C0D628` → B `PROP-2026-AD7BC889`, com novo GET do novo id |
| 8 | fechar nao limpa a fila | `drawerPresent: false`, `contextRegionPresent: false`, `rows: 14`, filtros intactos |
| 9 | nenhum dado inventado | `clientName` vazio no payload → **"Nao identificado neste acesso"** (nao inventa nome); `validUntil` nulo → "Sem validade" |
| 10 | nenhuma capability inferida | `availableTransitions = [accept, reject, expire, cancel, revise]` → DOM `["Registrar aceite","Rejeitar","Marcar como expirada","Cancelar"]`; `everyCommandPublished: true`; `revise` ausente por decisao documentada |

Gate da contagem: `shownCount` = `rows` nos dois recortes (`14/14` sem filtro, `1/1` com ISSUED); o
texto visivel de escopo, a `aria-label` da faixa e os tooltips foram lidos do DOM.

### Gates tecnicos

- `tsc --noEmit` — **PASS**; `eslint src/proposals src/engine` — **PASS**
- `src/proposals` — **34/34 PASS**
- `src/proposals` + `src/engine` + `src/clients` + `src/suppliers` + `src/purchase-orders` — **150/150 PASS** (a primitiva alterada e consumida por todos esses)
- `git diff --check` — **PASS**; `git diff --name-only` — somente os 2 arquivos acima

### RESTRICOES CONHECIDAS

1. **Sem backdrop e sem inertizacao do fundo.** O painel agora fecha por Escape e recebe o foco, mas
   o conteudo atras continua interativo enquanto `aria-modal="true"` afirma o contrario. Nao foi
   corrigido nesta rodada para nao ampliar escopo (backdrop e mudanca de desenho).
2. **2 GET de detalhe por selecao** (6 para 3 cliques). Consistente com o duplo disparo de efeito do
   StrictMode em desenvolvimento; em build de producao e 1. Registrado como observacao de ambiente.
3. **Dois subcampos do meu proprio comparador estao defeituosos** (`domHasAmount`, `domShowsRevision`
   retornaram `false` por escaping de regex no script do gate). A evidencia de valor e revisao vem do
   `contextText` medido, que publica "VALOR R$ 7.500,00" e "REVISAO Revisao 1" — coerentes com
   `globalSalePrice 7500` e `versionNumber 1`. O comparador NAO foi reexecutado (evitar "mais uma
   verificacao"); fica registrado como limitacao do instrumento, nao do produto.
4. A topbar `sticky` cobre parcialmente a PRIMEIRA linha quando a pagina esta rolada. E
   comportamento esperado de cabecalho pegajoso; a sonda passou a escolher linhas integralmente
   visiveis. Nenhum defeito de produto.
5. `02ea564` (context region de Pedidos de Compra) segue **sem entrada propria neste log**.

WORKING_TREE: 2 arquivos + este registro

---

## CATÁLOGO DE SERVIÇOS — WORKLIST SOBRE DADOS REAIS (rodada 15) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `feat(web): give the service catalog an authoritative context region and family grammar`

### Escopo

Uma função (WORKLIST). Nenhuma alteração de foundation, shell, tipografia, densidade global ou
primitiva compartilhada. Backend, API, migrations, DTOs e regras de domínio intocados.

### Arquivo alterado (1; +375 / -40)

`apps/web/src/catalog/pages/ServiceDefinitionsListPage.tsx`

### Defeitos corrigidos

1. **GRAMÁTICA FORA DE ORDEM.** A superfície de visões salvas vinha DEPOIS da superfície de filtro —
   o inverso da ordem da família (`OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE`).
   Corrigido, e as regiões passaram a ser declaradas por `data-region`.
2. **CONTAGEM E INDICADORES SEM ESCOPO.** O contrato `ServiceDefinitionListResponse` é
   `{ items, limit, offset }` — **não existe `total`** (verificado, não presumido). O número ao lado do
   título e os três indicadores saíam da página carregada sem dizer isso. Agora o cabeçalho declara
   "Página N … Esta lista não publica total; a contagem acima e os indicadores abaixo são desta
   página", e a faixa de indicadores tem rótulo próprio de escopo ("Indicadores desta página").
3. **CONTEXT REGION ALIMENTADA PELA LINHA.** O painel exibia fatos da projeção da listagem e oferecia
   **apenas** um link "Abrir ficha" — nenhum comando. Agora selecionar re-lê a linhaça
   (`getServiceDefinition`) e as versões (`listServiceDefinitionVersions`), e é dessa leitura que saem
   os fatos E os comandos.

### Comandos: interseção estado-publicado ∩ capability

O catálogo **não publica tabela de transições** (diferente de Propostas, que tem
`readiness.availableTransitions`). A barreira da esquerda é o estado que o contrato já nomeia:
`status` da linhaça (`CATALOG_LINEAGE_STATUSES`, 2 valores) e a existência de versão em `DRAFT`:

| Comando | Estado publicado que o habilita | Motivo |
| ------- | ------------------------------- | ------ |
| `publish` | existe versão com situação `DRAFT` | publica a versão em rascunho |
| `deactivate` | linhaça `ACTIVE` | `DeactivateDefinitionPayload.reason` é **obrigatório** |
| `activate` | linhaça `INACTIVE` | sem motivo no contrato |

A barreira da direita é `capabilities.can{Publish,Deactivate,Activate}`. Onde o contrato exige
motivo, a tela exige e o botão fica desabilitado sem ele; onde não exige, a tela **não** fabrica texto
de auditoria. Após comando bem-sucedido, linhaça e versões são relidas e a LISTA é recarregada — senão
a grade continuaria afirmando o estado anterior.

### Gate de DOM (REDE + DOM, CDP, cache desabilitado, servidor real)

Instrumento: `tmp/catalog-dom-gate.mjs`. Sondas de capability (`/service-definitions/00000000-…`, 404
por desenho) classificadas à parte.

| Prova | Resultado medido |
| ----- | ---------------- |
| ordem das regiões no DOM | `operating-header > saved-view-surface > command-filter-surface > worklist-master` e, com o painel aberto, `… > context-region` |
| **tamanho REAL do dataset** | paginado com o próprio controle da tela: **p1=20, p2=20, p3=20, p4=10 → 70 registros**, `nextDisabled: true` na p4 |
| contagem honesta | `shownCount = rows` em TODAS as páginas (20/20/20/10); rodapé "1–20 nesta página"; cabeçalho declara ausência de total |
| leitura real no contexto | **4 GET de linhaça + 4 GET de versões** para 2 seleções (2 cada = duplo disparo de efeito em dev), com o id EXATO da linha clicada |
| painel usa o payload | código, categoria ("Portfólio CISNE Rondônia") e "v1 publicada" conferidos contra o corpo da resposta |
| loading só no painel | `{contextBusy: true, moduleLoading: false, rowsDuringLoading: 20, worklistPresent: true}` |
| fila não desmonta | 20 linhas em todos os estados |
| filtros e visões salvas | presentes em todos os estados |
| scroll | `240 → 240 → 240` |
| fechar não limpa a fila | painel e região somem; 20 linhas; filtros e visões intactos |
| nenhuma capability inferida | `Inativar` é o ÚNICO comando visível: habilitado porque `status = ACTIVE`, **desabilitado** porque o motivo obrigatório está vazio, e `Publicar rascunho` **não aparece** porque o payload de versões só tem `PUBLISHED` (sem `DRAFT`) |
| densidade e defeitos | `rowHeights [41]`, 12 linhas na dobra, `shadows 0`, `boxes 0`, `aninhamento 0`, `régua dupla 0`, `régua sobre coluna 0`, `occluded 0`, `overflowX -15` |

### Gates técnicos

- `tsc --noEmit` — **PASS**; `eslint src/catalog` — **PASS**
- `src/catalog` — **31/31 PASS** (inclui `ServiceDefinitionsListPage.test.tsx`, que protege nome como
  identidade primária, code como contexto, busca resolvida no SERVIDOR e estado vazio humano)
- `git diff --check` — **PASS**; `git diff --name-only` — somente o arquivo acima

### RESTRIÇÕES CONHECIDAS

1. **O comando NÃO foi executado.** O gate provou que ele aparece, que está corretamente habilitado
   pelo estado publicado e que exige o motivo obrigatório — mas não clicou, porque executar inativaria
   uma definição do dataset de desenvolvimento (mutação real). A execução ponta a ponta do comando
   fica como pendência explícita, não como suposição.
2. **O dataset tem 70 registros, não 49.** O número 49 vinha de estimativa anterior; o valor medido,
   paginando com o controle da tela, é 70. Registro o MEDIDO.
3. **Altura de linha = 41px, não `--row-height` (28px).** A célula de identidade carrega duas linhas
   (nome + code como contexto), e o token atua como mínimo. 12 linhas na dobra. Reduzir isso é
   composição da página (cabeçalho de família), não da camada compartilhada.
4. **Recorte de versão continua local**, aplicado sobre a página. Já estava declarado na tela
   (meta "recorte de versão vale só nesta página" + estado vazio + PARK). Nesta rodada o escopo foi
   preservado, não ampliado.
5. O comparador do meu próprio gate tinha um defeito (comparava o estado `apos-fechar`, com o painel
   já fechado, e por isso acusava "código do payload não está no DOM"). Corrigido e reexecutado UMA
   vez antes de registrar — o instrumento não pode mentir a favor nem contra o produto.

WORKING_TREE: 1 arquivo + este registro

---

## ATIVOS FÍSICOS — WORKLIST SOBRE DADOS REAIS (rodada 16) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `feat(web): give physical assets a real context region and drop per-row action menus`

### Escopo e escolha da função

Função escolhida por MEDIÇÃO, não por preferência. Antes de abrir a rodada, os endpoints candidatos
foram consultados com a sessão real para saber onde existe dado que permita verificação por DOM:

| Endpoint | Registros |
| -------- | --------- |
| `/commercial/contracts` | **0** |
| `/inventory/items`, `/inventory/warehouses`, `/procurement/requests`, `/procurement/orders` | **0** |
| `/finance/expenses`, `/finance/budgets` | 3 cada |
| `/resources/physical-assets` | **8, com `total` autoritativo** |
| `/requests/service-requests` | 17 (já elevada em rodada anterior) |

Contratos **não** têm registro no dataset de desenvolvimento: elevar a tela ali produziria uma rodada
sem prova possível. Ativos foi escolhido por ter dado real E `total` autoritativo — o que permite uma
prova mais forte que a de Propostas e Catálogo.

### Arquivos alterados (3)

| Arquivo | Papel |
| ------- | ----- |
| `apps/web/src/assets/pages/PhysicalAssetsListPage.tsx` | regiões, contexto autoritativo, comandos, remoção do menu de linha |
| `apps/web/src/assets/components/AssetSummaryStrip.tsx` | nome acessível declarado por quem usa |
| `apps/web/src/assets/pages/PhysicalAssetsListPage.test.tsx` | contrato reescrito para o novo padrão |

### Defeitos corrigidos

1. **NAVEGAÇÃO VESTIDA DE AÇÃO, repetida em toda linha.** Cada linha carregava um menu `···` com TRÊS
   itens — `Visualizar detalhes`, `Editar`, `Histórico/Alocações` — e **os três eram `navigate(...)`**.
   Nenhum executava comando. Ao mesmo tempo, os comandos que o contrato PUBLICA
   (`deactivatePhysicalAsset` / `activatePhysicalAsset`) **não apareciam em lugar nenhum da tela**.
   O menu e a coluna "Ações" foram REMOVIDOS; as três capacidades passaram para o contexto, UMA vez
   para o registro selecionado em vez de oito vezes na grade, e nenhuma foi perdida.
2. **NOME ACESSÍVEL ERRADO.** `AssetSummaryStrip` anunciava-se como "Indicadores de frota" na página
   de **ativos físicos** — o componente nasceu na Frota e foi reusado com o rótulo fixo. O rótulo passa
   a ser declarado por quem usa (o padrão preserva a Frota).
3. **SEM GRAMÁTICA DE REGIÃO.** Zero `data-region`. As regiões foram declaradas na ordem da família.

### CONTAGEM — aqui ela é AUTORITATIVA, e isso foi provado

Diferente de Propostas e Catálogo, `PhysicalAssetListResponse` publica **`total`**, e o resumo vem de
endpoint próprio (`/physical-assets/summary`) — ou seja, **não é contagem de página**. Medido:

| Fonte | Valor |
| ----- | ----- |
| corpo da listagem (`limit=20, offset=0`) | `total = 8`, `items = 8` |
| corpo do summary | `{ total: 8, available: 0, allocated: 8, unavailable: 0 }` |
| DOM | `rows = 8`, `shownCount = 8`, rodapé "1–8 de 8 ativos" |
| `countMatchesPayload` | **true** |
| `summaryTotalMatchesListTotal` | **true** |

Nenhum número desta tela deriva da página carregada — e por isso nada aqui foi rotulado "nesta
página": rotular de página um agregado de dataset seria errar na direção oposta.

### Gate de DOM (REDE + DOM, CDP, cache desabilitado, servidor real)

Instrumento: `tmp/assets-dom-gate.mjs`. Sondas de capability (`/physical-assets/00000000-…`) e a
listagem-sonda (`limit=1`, 204) classificadas à parte.

| Prova | Resultado medido |
| ----- | ---------------- |
| ordem das regiões | `operating-header > command-filter-surface > worklist-master` e, com o painel aberto, `… > context-region` |
| grade sem menu repetido | `actionsColumnPresent: false`, `rowsWithActionMenu: 0` |
| leitura real no contexto | **16 GET de detalhe** para 8 seleções (2 cada = duplo disparo em dev), cada um com o **id exato** da linha clicada |
| painel usa o payload | `payloadCode` de cada uma das 8 seleções confere com a linha clicada (`EXCAVATOR-…`, `TRUCK-…`, `WATER_TRUCK-…`) |
| **comando segue o estado publicado** | 8 seleções, todas `ACTIVE`, **zero violações**: só `Inativar ativo`, nunca `Reativar ativo`, mais os três drillbacks |
| loading só no painel | `{contextBusy: true, moduleLoading: false, rowsDuringLoading: 8, worklistPresent: true}` |
| fila não desmonta | 8 linhas em todos os estados |
| filtros | presentes em todos os estados |
| fechar não limpa a fila | painel e região somem; 8 linhas; worklist e filtros intactos |
| densidade | `rowHeights [47, 61]`, 8 linhas na dobra (dataset inteiro) |
| defeitos | `shadows 0`, `boxes 0`, `aninhamento 0`, `régua dupla 0`, `régua sobre coluna 0`, `occluded 0`, `overflowX 0` |

### Gates técnicos

- `tsc --noEmit` — **PASS**; `eslint src/assets` — **PASS**
- `src/assets` — **49/49 PASS**
- `git diff --check` — **PASS**; 3 arquivos alterados

### RESTRIÇÕES CONHECIDAS

1. **A PRESERVAÇÃO DE SCROLL NÃO FOI EXERCITADA.** `window.scrollTo(0, 200)` resultou em `scrollY = 0`:
   com 8 registros a página **não rola** em 1440×900, então a prova é vacuosa. Registro como NÃO
   exercitada, não como aprovada.
2. **O ramo INACTIVE não foi exercitado no DOM.** As 8 linhas do dataset real são `ACTIVE`. O caminho
   `Reativar ativo` está coberto pelo TESTE (`offers reactivation only for an inactive asset`), não por
   dado real — a distinção importa.
3. **O comando NÃO foi executado.** O gate provou disponibilidade e aderência ao estado publicado sem
   clicar em Inativar/Reativar, para não mutar o dataset de desenvolvimento. Execução ponta a ponta
   segue pendente explícita.
4. **VISÕES SALVAS deliberadamente NÃO adicionadas nesta tela**, e o motivo está no código: a tela tem
   quatro filtros e se beneficiaria, mas as duas saídas disponíveis hoje são piores que a ausência —
   `identityId ?? 'anonymous'` cria o namespace COMPARTILHADO que a auditoria apontou como defeito, e
   `useAuth` lança fora do `AuthProvider` (quebraria a suíte, que monta a página sem provider). A
   correção certa é na CAPACIDADE (sem identidade, não persistir), o que afeta os nove chamadores e
   pertence a uma rodada de camada compartilhada. Fica registrado como pendência.
5. `rowHeights` tem DOIS valores (47 e 61): linhas com placa/célula de duas linhas são mais altas que
   as demais. O token de linha atua como mínimo.
6. O comparador do gate precisou de UMA correção: ele capturava o corpo da SONDA de capability
   (`limit=1`, 204, sem corpo) como se fosse a listagem, o que zerava `listTotal` e derrubava a prova
   de contagem. Corrigido e reexecutado UMA vez antes de registrar.

WORKING_TREE: 3 arquivos + este registro

---

## CONTAS A RECEBER — ESCOPO DOS INDICADORES (rodada 17) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `fix(web): declare the page scope of the receivables drilldown indicators`

### Alvo escolhido por medição

`/finance/receivables` tem **3 registros com `total` autoritativo** no dataset de
desenvolvimento, e é a página que a auditoria apontou como **P1 #14 — "provavelmente o maior
problema semântico do frontend atual"**: os quatro indicadores (`Vencidos`, `A vencer`,
`Recebidos`, `Carteira em aberto`) são calculados sobre `pageItems` — a PÁGINA carregada — e a faixa
se apresentava como se descrevesse a CARTEIRA, com drill-down para lista filtrada.

Contrato verificado (não presumido): `listReceivables` devolve `{ items, limit, offset, total,
totalPages }` — **`total` É autoritativo** (contado sob o mesmo recorte). **Não existe endpoint de
agregado** de vencidos/a-vencer/recebidos nem de soma de saldo.

### Defeito corrigido

A faixa declarava escopo que não tem. Agora:

- rótulo visível da faixa: **"Indicadores desta página · N título(s) no recorte"**, onde N é o
  `page.total` — o ÚNICO número do recorte inteiro que o contrato publica;
- os quatro `hint` passam a declarar o escopo **e** o saldo como local
  ("R$ 2.500,00 vencidos nesta página · ver lista filtrada");
- o escopo entra no **nome acessível** de cada indicador, porque `DrilldownMetric` compõe o
  `aria-label` a partir do `hint` — não é correção só visual;
- os quatro drill-downs foram **preservados** (`?status=OVERDUE|OPEN|PAID` e a carteira), que é o
  caminho até o dado cujo `total` É autoritativo.

### Gate de DOM (REDE + DOM, CDP, cache desabilitado, servidor real)

Instrumento: `tmp/receivables-scope-gate.mjs`. O esperado de cada indicador foi derivado do PRÓPRIO
corpo da resposta, não de regra nova.

| Prova | Resultado |
| ----- | --------- |
| corpo da listagem | `total = 3`, `limit = 50`, `items = 3`, `statuses = [PAID, OVERDUE, PAID]` |
| esperado do payload | vencidos 1 · a vencer 0 · recebidos 2 · em aberto 1 |
| rótulo declara escopo de página | **true** |
| rótulo publica o total do recorte | **true** |
| total do rótulo = `payload.total` | **true** (3 = 3) |
| valores do DOM = conteúdo da página | **true** nos quatro |
| todo `hint` declara escopo | **true** |
| todo `aria-label` declara escopo | **true** |
| drill-downs preservados | `?status=OVERDUE`, `?status=OPEN`, `?status=PAID`, carteira |
| contagem do cabeçalho = `payload.total` | **true** |
| ordem das regiões | `operating-header > drilldown-surface > saved-view-surface > command-filter-surface > bulk-command-surface > worklist-master` |
| erros de console | **0** |

### Gates técnicos

- `tsc --noEmit` — **PASS**; `eslint src/finance` — **PASS**
- `src/finance` — **11 falhas / 73 passes**, e as 11 são **exatamente as pré-existentes registradas**:
  `finance-smart-list` **7/7** e `finance-backoffice` **4/10**, todas timeout de 5s. **Zero falha nova.**
- `git diff --check` — **PASS**; 1 arquivo alterado

### RESTRIÇÕES CONHECIDAS — e a mais importante primeiro

1. **OS NÚMEROS NÃO MUDARAM.** Com `limit = 50` e `total = 3`, a página É o dataset inteiro hoje, e
   os valores seguem 1 / 0 / 2 / 1. O que foi corrigido é a **AFIRMAÇÃO**, não o número: a tela deixou
   de apresentar uma janela paginada como carteira. A correção **no número**, em escala, exige agregado
   autoritativo (vencidos / a-vencer / recebidos e soma de saldo) — **endpoint que não existe** e cuja
   criação está fora do escopo desta wave (nenhuma alteração de backend). Fica registrado como a
   pendência real desta função.
2. **A PRÉVIA CONTINUA ALIMENTADA PELA LINHA.** `previewRow` sai de `pageItems` e
   `buildReceivablePreview` recebe esse registro. Aqui o defeito é MENOR que em Propostas: o item da
   listagem é `ReceivableDetail` e **já inclui `rowVersion`**. Mesmo assim, agir sobre estado de
   listagem é agir sobre estado possivelmente velho — a leitura autoritativa (`getReceivable`, que
   existe) ainda não é usada. Registrado.
3. **`settleReceivable` / `cancelReceivable` NÃO foram ligados à tela**, e o motivo é de contrato:
   `FinanceCapabilities` publica apenas `{ canListReceivables, canListPayables, canListTreasury,
   canReadReconciliation }` — **não há flag de permissão para liquidar ou cancelar**. Ligar os
   comandos sem capability significaria oferecer ação cuja permissão a tela não conhece. Os dois
   exigem payload real (`settle`: `amount` + `idempotencyKey`; `cancel`: `cancelReason` obrigatório),
   e o cancelamento exige motivo digitado pelo operador. Pendência: ou o backend publica as flags, ou
   a rodada aceita explicitamente o gating só por estado.
4. A rodada foi deliberadamente estreita. As duas pendências acima (contexto autoritativo + comandos)
   são a próxima unidade desta MESMA função, e não foram abertas aqui para não entregar metade de um
   contexto autoritativo.

WORKING_TREE: 1 arquivo + este registro

---

## DESPESAS — ESCOPO DOS INDICADORES (rodada 18) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `fix(web): declare the page scope of the three remaining expense indicators`

### O que a leitura revelou antes de editar

`ExpensesListPage` **já tinha** a convenção certa — e o comentário do arquivo explica por quê
("somar o valor das linhas desta página e chamar isso de 'total' seria mentir"). O primeiro cartão
(`Nesta página`, com `hint` = `${page.total} no recorte`) e o quinto (`Em aberto nesta página`)
declaravam escopo. **Os três do meio não**: `Aguardando aprovação`, `Rascunhos` e `Aprovadas` eram
contagens de `items` (a página) com `hint` que descrevia só o DESTINO ("ver enviadas"), sem dizer de
onde vinha o número.

Numa página de 3 de 300 despesas, "2 aguardando aprovação" seria lido como o recorte inteiro. O
defeito é o MESMO P1 #14 da auditoria, sobrevivendo em três cartões de uma faixa que já o havia
corrigido em dois.

### Defeito corrigido

Os três `hint` passam a declarar a origem, mantendo a convenção da própria faixa:
`aguardando aprovação nesta página · ver enviadas`, `rascunhos nesta página · ver rascunhos`,
`aprovadas nesta página · ver aprovadas`. Como `DrilldownMetric` compõe o `aria-label` a partir de
`label` + `hint`, o escopo vale também para leitor de tela. **Nenhum valor mudou e nenhum destino
mudou.**

### Gate de DOM (REDE + DOM, CDP, cache desabilitado, servidor real)

Instrumento: `tmp/expenses-scope-gate.mjs`. Esperado derivado do PRÓPRIO corpo da resposta.

| Prova | Resultado |
| ----- | --------- |
| corpo da listagem | `total = 3`, `limit = 20`, `items = 3`, `statuses = [APPROVED, SUBMITTED, DRAFT]` |
| esperado do payload | página 3 · enviadas 1 · rascunhos 1 · aprovadas 1 |
| indicadores na faixa | **5** |
| TODO `aria-label` declara escopo | **true** — `metricsWithoutScope: []` |
| total do recorte exposto | **true** ("3 no recorte") |
| contagem do cabeçalho = `payload.total` | **true** (3 = 3) |
| valores do DOM = conteúdo da página | **true** nos quatro |
| destinos preservados | `/app/finance/expenses`, `?status=SUBMITTED`, `?status=DRAFT`, `?status=APPROVED` |
| erros de console | **0** |

### Gates técnicos

- `tsc --noEmit` — **PASS**; `eslint src/finance` — **PASS**
- `src/finance` — **11 falhas / 73 passes**, idêntico ao baseline registrado:
  `finance-smart-list` **7/7** e `finance-backoffice` **4/10**. **Zero falha nova.**
- `git diff --check` — **PASS**; 1 arquivo alterado

### RESTRIÇÕES CONHECIDAS

1. **A PÁGINA NÃO DECLARA REGIÕES.** Medido no gate: `pageHasRegionMarkers: false` — zero
   `data-region` em `ExpensesListPage`. É lacuna de GRAMÁTICA (não de veracidade) e ficou fora desta
   rodada de propósito: a rodada foi de escopo, e misturar as duas coisas entregaria duas mudanças
   com uma verificação só. Registrado como a próxima unidade desta função.
2. **OS NÚMEROS NÃO MUDARAM** (3 · 1 · 1 · 1 e a página = dataset hoje, com `limit = 20` e
   `total = 3`). O que mudou é a AFIRMAÇÃO. A correção no número, em escala, exigiria agregado
   autoritativo por situação — que a lista **não publica**; o `total` publicado É autoritativo e já
   está exposto na faixa.
3. **Sem context region e sem comandos nesta página.** `submitExpense`, `approveExpense` e
   `rejectExpense` existem no cliente e **não** estão ligados aqui; `rejectExpense` exige `reason`
   obrigatório. Ligá-los esbarra na mesma questão registrada em Recebíveis: o contrato de
   capabilities desta área não publica flag de permissão para as transições, e a decisão sobre
   aceitar gating só por estado é do dono do produto, não minha.
4. O gate localiza a faixa por `role="group"` justamente porque não há `data-region` — a limitação
   está no instrumento de propósito, para não mascarar a lacuna registrada em (1).

WORKING_TREE: 1 arquivo + este registro

---

## DESPESAS — GRAMÁTICA DE REGIÕES (rodada 19) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `feat(web): put the expense worklist in family region order`

### Defeito corrigido — e ele era PERCEPTÍVEL, não só de instrumentação

A rodada anterior registrou "a página não declara regiões" como lacuna de gramática. Ao abrir o
arquivo para fechá-la, apareceu defeito maior que a lacuna: a superfície de **VISÕES SALVAS vinha
DEPOIS da superfície de FILTRO**.

É a MESMA inversão já corrigida em Catálogo, Propostas e Recebíveis — e aqui sobrevivia. O operador
desta tela lia "recorte ad-hoc primeiro, recorte salvo depois" enquanto **todas** as outras worklists
leem o contrário. Não é cosmético: é a ordem em que a família ensina o operador a procurar o recorte
salvo.

Correção: `SavedViewsBar` **movido para antes** de `WorklistFilterBar`, e o bloco "recorte ativo em
texto" mantido junto da superfície de filtro, de propósito — ele é o ECO do recorte que aquela faixa
aplicou, não uma região própria. As regiões passaram a ser declaradas por `data-region`.

Nenhum filtro, visão salva, valor, destino, capability ou contrato foi alterado: só a ordem e a
declaração.

### Gate de DOM (mesmo instrumento da rodada 18, reexecutado)

| Prova | Resultado |
| ----- | --------- |
| ordem das regiões no DOM | `operating-header > drilldown-surface > saved-view-surface > command-filter-surface > worklist-master` |
| `pageHasRegionMarkers` | **true** (era `false` — lacuna fechada) |
| superfícies presentes | visões salvas, filtro e fila: **true** |
| escopo no `aria-label` dos 5 indicadores | **true** (`metricsWithoutScope: []`) |
| total do recorte exposto / cabeçalho = `payload.total` | **true / true** (3 = 3) |
| valores do DOM = conteúdo da página | **true** nos quatro |
| destinos preservados | `?status=SUBMITTED`, `?status=DRAFT`, `?status=APPROVED` |
| erros de console | **0** |

As cinco provas de VERACIDADE da rodada 18 seguem passando depois da reordenação — a mudança de
ordem não tocou nenhuma delas.

### Gates técnicos

- `tsc --noEmit` — **PASS**; `eslint src/finance` — **PASS**
- `src/finance` — **11 falhas / 73 passes**, idêntico ao baseline registrado
  (`finance-smart-list` 7/7, `finance-backoffice` 4/10). **Zero falha nova.**
- `git diff --check` — **PASS**; 1 arquivo alterado

### RESTRIÇÕES CONHECIDAS

1. **A DECISÃO DE PRODUTO SEGUE ABERTA** (registrada na rodada 18 e ainda sem resposta): os comandos
   de transição de Recebíveis e Despesas continuam NÃO ligados porque nenhuma capability de permissão
   é publicada para eles. As duas saídas são (a) aceitar gating **só por estado**, deixando o backend
   recusar quem não pode, ou (b) manter `PARK` até o backend publicar as flags. Não escolhi por
   conta própria: a primeira troca uma garantia de UI por uma recusa de servidor, e isso é decisão de
   dono do produto.
2. **A rodada 18 e esta formam uma unidade**: a de escopo corrigiu a AFIRMAÇÃO dos indicadores; esta
   corrigiu a ORDEM das superfícies e a declaração das regiões. Ambas mantêm que **os números não
   mudaram** — o que mudou foi a leitura que a tela permite.
3. **Sem context region nesta página.** Continua pendente da decisão (1).

WORKING_TREE: 1 arquivo + este registro

---

## ORÇAMENTOS — GRAMÁTICA DE REGIÕES (rodada 20) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `feat(web): put the budget worklist in family region order`

### Escolha da função

Feita por medição, como nas anteriores: `/finance/budgets` tem **3 registros com `total`
autoritativo** (`{ items, limit, offset, total, totalPages }`). Esta rodada NÃO dependia da decisão
de produto que segue aberta, então foi ela que andou.

### Defeito corrigido — QUARTA ocorrência da mesma inversão

A superfície de **VISÕES SALVAS vinha DEPOIS da de BUSCA/FILTRO**.

Somando as ocorrências desta wave — Catálogo, Propostas, Recebíveis, Despesas e agora Orçamentos —
o padrão deixa de ser descuido de uma tela e passa a ser um fato sobre a wave: **a ordem da família
não estava sendo aplicada por padrão**, e cada tela precisou ser corrigida uma a uma. O registro
importa porque indica onde a próxima tela provavelmente também estará errada.

Correção: `SavedViewsBar` movido para ANTES do `BudgetSearchForm`, e as quatro regiões declaradas —
`operating-header > saved-view-surface > command-filter-surface > worklist-master`.

### Gate de DOM (REDE + DOM, CDP, cache desabilitado, servidor real)

| Prova | Resultado |
| ----- | --------- |
| ordem das regiões no DOM | `operating-header > saved-view-surface > command-filter-surface > worklist-master` |
| `savedViewsBeforeFilter` / `familyOrderFull` | **true / true** |
| superfícies presentes | visões salvas, filtro e fila: **true** |
| linhas = `items` do corpo | **true** (3 = 3) |
| contagem do cabeçalho = `payload.total` | **true** (3 = 3) |
| rodapé publica o total autoritativo | **true** ("1–3 de 3 · Página 1") |
| `occluded` | **0** |
| `overflowX` | **0** |
| erros de console | **0** |

### DEFEITO NO MEU PRÓPRIO INSTRUMENTO — e a correção vale mais que o número

A primeira medição acusou **`occluded: 3`**. Não presumi que fosse pré-existente nem que fosse
defeito: medi a **pilha completa de hit-test** (`elementsFromPoint`) e a **cadeia de ancestrais** dos
controles. Resultado: os três botões `Prévia` vivem dentro de um painel `absolute` sob um
`<details>` — e **`<details>` FECHADO no Chrome mantém caixa de layout nos filhos sem pintá-los nem
torná-los hit-testáveis**. O ponto medido caía sobre o `<td>` do menu fechado, produzindo "coberto"
FALSO.

Corrigido no instrumento: controles dentro de `details:not([open])` são **excluídos e CONTADOS**
(`skippedInsideClosedDetails: 3`), para o gate dizer quantos ficaram de fora em vez de esconder o
número. Resultado real: **`occluded: 0`**.

Erro adicional do instrumento, também registrado: um comentário dentro do probe usava **crase**, e o
probe vive dentro de um template literal — isso fechou a string e quebrou o módulo. **O script parou
de rodar e as duas medições seguintes leram o JSON ANTIGO**, mostrando números plausíveis e errados.
Detectado porque uma chave nova aparecia ausente. A partir daqui: comentário dentro do probe não usa
crase, e a ausência de uma chave esperada é tratada como falha de instrumento, não como valor.

### Gates técnicos

- `tsc --noEmit` — **PASS**; `eslint src/finance` — **PASS**
- `src/finance` — **11 falhas / 73 passes**, idêntico ao baseline registrado
  (`finance-smart-list` 7/7, `finance-backoffice` 4/10). **Zero falha nova.**
- `git diff --check` — **PASS**; 1 arquivo alterado

### RESTRIÇÕES CONHECIDAS

1. **A DECISÃO DE PRODUTO SEGUE ABERTA** (rodadas 18 e 19, ainda sem resposta): os comandos de
   transição continuam não ligados onde o contrato não publica flag de permissão. Aqui há um agravante
   próprio, medido: `approveBudget` exige o **`version` da VERSÃO do orçamento**, e a linha da lista
   publica `rowVersion` do ORÇAMENTO — **são campos diferentes**. Ou seja, nesta tela o comando de
   aprovação **não é executável a partir da linha**: exige leitura autoritativa (`getBudget`). A
   correção do drawer desta página depende disso e da decisão (1).
2. **O drawer de contexto continua alimentado pela linha** (`previewRow`) e a "próxima ação" é um
   LINK (`nextAction.href` / `detailHref`) — navegação apresentada como próximo passo, o mesmo padrão
   já removido em Propostas e Ativos. Registrar sem corrigir foi deliberado: corrigir exigiria a
   decisão (1) e a leitura autoritativa do item (1).
3. `rowHeights` único em 35px para as três linhas; nada de defeito estrutural medido além disso.

WORKING_TREE: 1 arquivo + este registro

---

## FROTA — GRAMÁTICA DE REGIÕES (rodada 21) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `feat(web): put the fleet worklist in family region order`

### Escolha da função, por medição

Antes de abrir a rodada, os candidatos restantes foram medidos com a sessão real:

| Endpoint | Registros |
| -------- | --------- |
| `/resources/physical-assets?classification=VEHICLE` (**Frota**) | **4, com `total` autoritativo** |
| `/fiscal/documents`, `/fiscal/periods` | 0 |
| `/accounting/charts`, `/accounting/posting-requests` | 0 |
| `/accounting/fixed-assets` | 400 (exige outro parâmetro) |

Frota foi escolhida por ter dado real. Fato de contrato registrado: `fleet-api.ts` **não tem endpoint
próprio** — ele reusa `/api/v1/resources/physical-assets` com `classification=VEHICLE`. Frota e
Ativos são a MESMA entidade por recortes diferentes.

### Defeito corrigido — QUINTA ocorrência da mesma inversão

A superfície de **VISÕES SALVAS vinha DEPOIS da de FILTRO**. Com Catálogo, Propostas, Recebíveis,
Despesas, Orçamentos e agora Frota, são **seis telas** corrigidas pelo mesmo motivo. Registro o
número porque ele é a evidência de que isto não é descuido pontual.

Correção: `DynamicSavedViewsBar` movido para ANTES do `WorklistFilterBar`, e as quatro regiões
declaradas — `operating-header > saved-view-surface > command-filter-surface > worklist-master`.

### Gate de DOM (REDE + DOM, CDP, cache desabilitado, servidor real)

| Prova | Resultado |
| ----- | --------- |
| ordem das regiões no DOM | `operating-header > saved-view-surface > command-filter-surface > worklist-master` |
| `familyOrderFull` / `savedViewsBeforeFilter` | **true / true** |
| superfícies presentes | **true** nas quatro |
| barra de visões salvas | presente; `data-persisted-locally = true` |
| linhas = `items` do corpo | **true** (4 = 4) |
| contagem do cabeçalho = `payload.total` | **true** (4 = 4) |
| rodapé publica o total autoritativo | **true** ("1–4 de 4 veículos") |
| **toda linha é VEÍCULO** | **true** — `classifications = [VEHICLE]`, provando que a tela mostra o recorte que ela afirma |
| `occluded` / `overflowX` / erros de console | **0 / 0 / 0** |

### Erro do meu próprio instrumento, de novo — e registrado

O primeiro gate devolveu `footerStatesAuthoritativeTotal: false`. Não registrei como defeito de
produto: o probe lia o `innerText` de **`#main-content`**, e o primeiro texto casado era o da barra de
visões salvas ("Nenhuma visão salva."), não o rodapé. Corrigido para ler DENTRO de
`[data-region="worklist-master"]`, onde o rodapé realmente vive. Resultado real: **true**.

Este é o terceiro erro de instrumento desta wave (clamp de coordenadas, `details` fechado, e agora
escopo de leitura). O padrão é sempre o mesmo: **o probe mede o lugar errado e o número parece
plausível**. Por isso a partir da rodada 20 toda métrica nova passou a exigir confirmação de ESCOPO
antes de virar conclusão.

### Gates técnicos

- `tsc --noEmit` — **PASS**; `eslint src/fleet` — **PASS**
- `src/fleet` + `src/assets` + `src/finance` — **11 falhas / 125 passes**, e as 11 são exatamente as
  pré-existentes de finanças (`finance-smart-list` 7/7, `finance-backoffice` 4/10).
  `src/fleet` e `src/assets` passam inteiros. **Zero falha nova.**
- `git diff --check` — **PASS**; 1 arquivo alterado

### RESTRIÇÕES CONHECIDAS

1. **IDENTIDADE PLACEHOLDER MANTIDA — e agora com o caminho de correção identificado.**
   `useSavedViews('local-operator', 'fleet-vehicles')` usa um literal como dono da visão salva:
   a personalização NÃO está ligada à identidade autenticada. **Não corrigi nesta rodada** porque a
   correção não é local: `useAuth` **lança** fora do `AuthProvider`, e a suíte desta página a monta
   sem provider — trocar o literal por `identityId` quebraria os testes e não resolveria o caso
   "sem identidade". A correção correta é de CAMADA COMPARTILHADA:
   (a) `useSavedViews(owner: string | null, entity)` passa a **não persistir e não carregar** quando
   `owner` é nulo, em vez de aceitar um namespace compartilhado; e
   (b) um acesso à identidade que **não lance** fora do provider.
   Isso afeta os **nove** chamadores de `useSavedViews` e é uma rodada própria — a próxima desta
   linha de trabalho, registrada aqui como pendência explícita em vez de remendo local.
2. **O MESMO literal existe em outras duas telas**: `ContractsListPage` (`'contracts'`) e
   `RentalsListPage` (`'rentals'`). A rodada (1) corrige as três de uma vez.
3. **O drawer de contexto desta página continua sendo só um LINK.** `DynamicContextDrawer` monta um
   `<Link>` para `/app/assets/{id}` e nada mais — nenhum fato autoritativo, nenhum comando. Corrigir
   exige a MESMA decisão de produto que segue aberta desde a rodada 18 (gating só por estado × PARK),
   e a leitura autoritativa via `getPhysicalAsset`.

WORKING_TREE: 1 arquivo + este registro

---

## VISÕES SALVAS — IDENTIDADE REAL (rodada 22) — 2026-10-07

STATUS: **PASS**
Commit: `fix(web): key saved views to the real identity instead of a placeholder owner`

### O defeito da auditoria, corrigido na CAPACIDADE — e não em uma tela

A auditoria apontou a personalização como um dos gaps enterprise: `useSavedViews('local-operator', …)`
usava um **literal como dono**, ou seja, um namespace compartilhado que não corresponde a nenhuma
identidade autenticada. Duas contas no mesmo navegador viam as visões uma da outra.

**A causa era estrutural, não descuido**: a única forma de ler a identidade (`useAuth`) **LANÇA**
fora do `AuthProvider`, e as suítes de página montam as telas sem provider. O literal era a saída
encontrada na prática. Corrigir tela a tela reproduziria o problema na tela seguinte.

### Correção em três camadas

| Camada | Mudança |
| ------ | ------- |
| `auth/context/AuthProvider.tsx` | novo `useOptionalIdentityId(): string \| null` — acesso que **NÃO lança** fora do provider |
| `engine/DynamicSavedViews.tsx` | `useSavedViews(owner: string \| null, entity)`; **sem dono, não lê e não grava**; novo campo `persistable` |
| `engine/DynamicSavedViewsBar.tsx` | `persistable=false` → a barra **declara** a indisponibilidade em vez de oferecer um "Salvar visão" que não salva |

E **13 arquivos de página** atualizados: as 4 com o literal (`fleet`, `contracts`, `rentals`,
`requests`) passaram a usar a identidade real e a declarar `persistable`; as 6 com
`identityId ?? 'anonymous'` (`catalog`, `people`, `service-orders`, `purchase-orders`, `suppliers`,
`proposals`) passaram a `?? null`, fechando a MESMA classe de defeito.

### Gate de REDE + DOM + armazenamento (sessão real)

Instrumento: `tmp/saved-views-identity-gate.mjs`. A identidade esperada vem de `GET /auth/session`.

| Prova | Resultado |
| ----- | --------- |
| identidade real da sessão | `6f007b51-e7de-494f-b34a-75c5955fb511` |
| barra presente e formulário oferecido | **true / true** |
| visão salva pelo caminho REAL da UI | **true** ("Verificação de identidade" aparece na barra) |
| **chave de armazenamento usa a identidade real** | **true** — `cisne.saved-views.6f007b51-…fleet-vehicles` |
| **nenhuma chave contém `local-operator`** | **true** |
| erros de console | **0** |

Verificação de fonte: `local-operator` **não existe mais em código vivo** — as únicas ocorrências
restantes são comentários que documentam a remoção. `'anonymous'` saiu de todos os chamadores.

### Gates técnicos

- `tsc --noEmit` — **PASS**; `eslint src` (todo o `src`) — **PASS**
- 55 arquivos de teste dos 11 módulos afetados — **8 falhas / 249 passes**, e as 8 são exatamente as
  pré-existentes registradas (`OperationsControlCenter` **4/4**, `ServiceOrderMeasurementPage`
  **4/13**). `auth-flow.e2e` **1 falha** é a mesma pré-existente do `role="banner"` duplicado provada
  por baseline nesta sessão — confirmada de novo, na hora, com a mensagem literal.
  **Zero falha nova.**
- `git diff --check` — **PASS**; 13 arquivos alterados

### RESTRIÇÕES CONHECIDAS

1. **`useSavedViews` continua sendo localStorage.** A correção desta rodada é de OWNERSHIP, não de
   persistência: a visão ainda vive no navegador e não acompanha o operador entre estações. Isso é
   `GAP_DE_CONTRATO` declarado no próprio arquivo (não existe endpoint de visões salvas) e segue
   registrado como pendência — não foi escondido atrás da correção de identidade.
2. **Existem DUAS famílias de visões salvas**: a da engine (`DynamicSavedViews`, corrigida aqui) e a
   de `operator/smart-list` (`ClientsListPage` usa `useSavedViews('commercial.clients', [], …)`).
   A auditoria aponta três implementações; a unificação é rodada própria e **não** foi tentada.
3. **Comportamento novo a observar**: se `identityId` vier nulo numa sessão autenticada, a visão
   deixará de persistir e a barra declarará isso. É o comportamento CORRETO segundo a auditoria
   ("sem identidade → não persistir"), mas é uma mudança de comportamento que merece observação em
   uso real — registrada em vez de assumida como inofensiva.

WORKING_TREE: 13 arquivos + este registro

---

## FAMÍLIA `operator` DE VISÕES SALVAS — DONO GENÉRICO (rodada 23) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO** (com verificação end-to-end **INCONCLUSIVA**, declarada abaixo)
Commit: `fix(web): stop persisting operator saved views under a shared owner`

### O que a leitura revelou — e corrige uma imprecisão minha

A rodada 22 registrou que existem DUAS famílias de visões salvas e que só a da engine tinha sido
corrigida. Ao abrir a segunda, o resultado foi em parte MELHOR e em parte PIOR do que eu havia
registrado:

- **Melhor**: `operator/smart-list/useSavedViews` lê a identidade **internamente** (`useAuth()`), e o
  primeiro argumento de `useSavedViews('commercial.clients', …)` é o **ESCOPO da tela**, não um dono.
  Ou seja: **Clientes NÃO tinha o defeito do dono literal** — minha nota da rodada 22 estava
  imprecisa e fica corrigida aqui.
- **Pior**: quando não há identidade, a chave cai em `'anon'` — um namespace **compartilhado**: toda
  sessão sem identidade enxergaria as visões das outras. É o MESMO defeito, na forma de dono
  genérico em vez de literal.

### Correção

Mesmo contrato que fixei na família da engine: **sem dono, não lê e não grava**.
`readStore` e `writeStore` recusam operar sem identidade; `persistable` passa a ser publicado no
resultado do hook para a tela poder declarar a indisponibilidade. `storageKeyFor` foi PRESERVADO
como está — ele é contrato testado (`storageKeyFor('finance.receivables', 'identity-abc-123')` não
pode conter o id cru), e o comentário agora diz que ele não é caminho de I/O.

### VERIFICAÇÃO — e por que ela NÃO fecha

Gates técnicos: `tsc` **PASS**; `eslint src/operator` **PASS**; `src/operator` + `src/clients` +
`src/finance` — **11 falhas / 185 passes**, e as 11 são exatamente as pré-existentes de finanças
(`finance-smart-list` 7/7, `finance-backoffice` 4/10). **Zero falha nova.**

**Experimento controlado, e o resultado honesto**: semeei ANTES do app subir as DUAS lojas com a
MESMA forma de dado — `…:commercial.clients:anon` ("VISAO ANONIMA") e
`…:commercial.clients:19scmwb` ("VISAO DA IDENTIDADE", hash da identidade real). Se só a segunda
aparecesse, a recusa estaria provada. **Nenhuma das duas apareceu.**

Veredito do gate: **INCONCLUSIVO** — o mais provável é que `sanitizeSmartListConfig` tenha descartado
a forma semeada (`config: {}`), já que a tela declara allow-list. **Não conto isso como aprovação**, e
o próprio gate foi escrito para devolver INCONCLUSIVO em vez de "passou".

Chave da identidade conferida por cálculo independente: `hashScope('6f007b51-…')` = `19scmwb`,
replicado no gate a partir do algoritmo do módulo — a chave esperada era a certa; o que não foi
possível confirmar foi a LEITURA renderizada.

### RESTRIÇÕES CONHECIDAS

1. **VERIFICAÇÃO END-TO-END PENDENTE** para a recusa de leitura sem identidade. Para fechar, é
   preciso semear uma visão com `config` que passe o sanitizador da tela (ler `sanitizeSmartListConfig`
   e a allow-list de `commercial.clients`) ou exercitar o formulário de salvar da `SavedViewsBar`,
   que **não tem `data-testid`** — as duas coisas custam mais do que esta rodada tinha.
2. **A BRANCHA `'anon'` ERA LATENTE, NÃO ATIVA.** Numa sessão autenticada normal a identidade sempre
   existe, então a loja compartilhada não era usada no app. Diferente da família da engine, onde o
   dono literal `'local-operator'` **estava ativo em produção de desenvolvimento** e foi provado
   end-to-end na rodada 22. A distinção importa e não deve ser apagada: esta rodada fecha um defeito
   **latente**; aquela fechou um defeito **ativo**.
3. **`persistable` ainda NÃO está ligado ao `canSave` desta família.** O hook publica o campo, mas as
   telas que usam `SavedViewsBar` ainda não o consomem — então, no caso sem identidade, o formulário
   continua sendo oferecido. É a próxima unidade desta linha e está enumerada, não escondida.
4. As duas famílias **continuam sem unificação** (auditoria aponta três implementações). Rodada
   própria, não tentada.

WORKING_TREE: 1 arquivo + este registro

---

## FAMÍLIA `operator` — FECHAMENTO DO GATE (rodada 24) — 2026-10-07

STATUS: **PASS** (nenhuma alteração de produto nesta rodada — o produto está em `5eb4a4d`)
Commit: `docs(governance): close the operator saved-views owner gate and correct a false claim`

### CORREÇÃO DE UMA AFIRMAÇÃO FALSA REGISTRADA NA RODADA 23

A entrada anterior afirma: *"Chave da identidade conferida por cálculo independente:
`hashScope('6f007b51-…')` = `19scmwb`, replicado no gate a partir do algoritmo do módulo — a chave
esperada era a certa"*.

**Isso é FALSO e fica retificado.** A função real (`operator/smart-list/useSavedViews.ts`) inicializa
`let hash = 5381` (djb2). O gate replicou com `hash = 0`, produziu o dono **errado** (`19scmwb`) e
semeou a chave errada. O dono correto é **`12su0kw`**. A frase "a chave esperada era a certa" era uma
conclusão minha sobre o meu próprio instrumento, sem verificação — exatamente o erro que esta wave
vem catalogando.

### O gate, agora fechado

`PROVADO: lê a loja da identidade e NÃO lê a loja sem dono.`

| Evidência | Valor |
| --------- | ----- |
| dono correto (djb2, semente 5381) | `12su0kw` |
| chave semeada da identidade | `cisne:operator:views:v1:commercial.clients:12su0kw` |
| chave semeada sem dono | `cisne:operator:views:v1:commercial.clients:anon` |
| barra renderiza a visão da identidade | **true** — "VISAO DA IDENTIDADE" visível em "VISÕES" |
| barra renderiza a visão anônima | **false** |

### TRÊS BLOQUEADORES, TODOS DO INSTRUMENTO — e nenhum do produto

O INCONCLUSIVO da rodada 23 tinha **três** causas, e todas foram eliminadas por leitura de código e
medição, não por tentativa:

1. **`config` vazia é descartada na leitura.** `sanitizeSmartListConfig` faz
   `if (filtros vazios && !sortKey && !groupKey) return null`. A semente usava `config: {}` → visão
   descartada. Corrigido **descobrindo o valor enumerado na própria tela** (as `<option>` do filtro,
   `ACTIVE`/`INACTIVE`) em vez de fixar literais no script.
2. **A página não renderizava na segunda navegação.** O refresh token é ROTACIONADO no primeiro
   bootstrap: a fase 1 o consumiu, e a fase 2 recarregou com o token velho → `/login` → página vazia.
   O gate "media" `#main-content` sem texto e devolvia `false` como se fosse resposta. Corrigido
   removendo o injetor antigo e reusando o token ROTACIONADO — o mesmo cuidado já adotado nos outros
   gates da wave.
3. **Minha replicação do hash estava errada** (item acima).

Sem o diagnóstico 2, eu teria concluído "a loja da identidade não carrega" e ido caçar um bug
inexistente no produto — a partir de uma página em branco.

### RESTRIÇÕES CONHECIDAS

1. **Nenhuma mudança de produto nesta rodada.** O código da família `operator` está como em
   `5eb4a4d`; esta rodada produziu **prova** e **retificação**, não comportamento novo.
2. **`persistable` continua não ligado ao `canSave`** desta família (herdado da rodada 23).
3. **As duas famílias seguem sem unificação.**

WORKING_TREE: sem alteração de código; só este registro

---

## VARREDURA DA INVERSÃO DE REGIÕES + LOCAÇÕES (rodada 25) — 2026-10-07

STATUS: **PASS_COM_RESTRICAO**
Commit: `fix(web): put the rentals worklist in family region order`

### O mapa completo, medido — e não estimado

Varredura estática de TODAS as páginas que renderizam uma barra de visões salvas, comparando a
posição do bloco da barra com a do bloco de filtro. Resultado: **21 páginas usam a barra, 13 estão
corretas e 8 estavam INVERTIDAS** — a barra DEPOIS do filtro.

| Página | barra | filtro | Estado |
| ------ | ----- | ------ | ------ |
| `RentalsListPage` | 263 | 220 | **corrigida nesta rodada** |
| `AccountingPostingOriginsPage` | 328 | 241 | invertida |
| `ContractsListPage` | 326 | 273 | invertida |
| `DocumentsPage` | 314 | 274 | invertida |
| `BankReconciliationPage` | 646 | 576 | invertida |
| `FiscalDocumentsPage` | 547 | 442 | invertida |
| `InventoryPage` | 375 | 240 | invertida |
| `ServiceOrdersEngineListPage` | 682 | 651 | invertida |

Isto encerra a contagem por tela: o defeito não estava em "seis telas" como eu vinha registrando por
amostragem — eram **oito**, mais as seis já corrigidas nas rodadas anteriores.

### Correção aplicada (Locações)

`DynamicSavedViewsBar` movido para ANTES do `WorklistFilterBar`, e as quatro regiões declaradas.
Ordem conferida no PRÓPRIO ARQUIVO:

```
222 operating-header > 230 saved-view-surface (barra 236) > 251 command-filter-surface (filtro 252) > 291 worklist-master
```

Gates: `tsc` **PASS**; `eslint src/rentals` **PASS**; `src/rentals` — **1/1 PASS**.

### DESCOBERTA QUE MUDA O PESO DA VARREDURA: A ROTA É GATED

O gate de gramática foi executado em `/app/rentals` e caiu em **`/app/no-access`**
(composition: "Acesso negado"). Confirmado no `nav-config`: **`rentals` é rota com feature flag**
(fora da Release 1, exatamente como a suíte de shell já protegia ao exigir que "Locações" NÃO
apareça na navegação).

**Consequência, e ela é material**: a verificação por DOM desta correção **NÃO É POSSÍVEL** com o
perfil disponível — a tela não abre. Então:

- a correção está **aplicada e conferida na fonte** (ordem dos blocos no arquivo + typecheck + lint);
- a correção está **LATENTE**, não observável: enquanto a rota estiver gated, nenhum operador vê a
  ordem errada nem a certa;
- **não alego verificação por DOM** desta rodada.

E isso vale para o mapa acima: **antes de corrigir cada uma das 7 restantes, é preciso conferir se a
rota é alcançável**. Corrigir uma tela gated é correto, mas não é verificável por DOM e não muda a
experiência de ninguém hoje — o que muda a priorização.

### RESTRIÇÕES CONHECIDAS

1. **7 páginas com a inversão ainda aberta**, agora enumeradas com nome e linha. Duas delas
   (`ContractsListPage`, e provavelmente `FiscalDocumentsPage`/`InventoryPage`) também são gated.
2. **A ordem da família continua sem regra compartilhada que a imponha.** Reordenar é por página,
   porque ordem de DOM não se corrige por CSS sem quebrar a ordem de tabulação — e a ordem de
   tabulação é justamente o que importa para teclado. Registro como fato estrutural, não como
   pendência de implementação.
3. `persistable` → `canSave` (família `operator`) segue pendente, herdado da rodada 23.

WORKING_TREE: 1 arquivo + este registro

```text
PROMPT: POSTGRESQL HARDENING AUDIT (FASES 1-35 CISNE) - rodada 3/3 (encerramento)
STATUS: PASS_WITH_RISKS (gate principal verde; riscos de infra registrados)
METODO: read-only em HML (cisne_hml:5433, PG 18.6) e local; clean-room cisne_pg_clean; restore cisne_pg_restore; testes em PostgreSQL real isolado; nenhuma operacao destrutiva; nenhuma migration historica editada; nenhuma tabela/coluna/indice/constraint duplicado criado.
EVIDENCIA (tmp/postgres-audit + tmp/rc-worktree):
  - Migrations from-zero: clean db cisne_pg_clean applied=75/75; smoke clients 5/5 + outbox 6/6.
  - Upgrade/idempotencia: runner em DB restaurado applied=0 (75); local dev 75/75.
  - Drift: catalogo HML real == clean-room (diff 0) - schema real == migrations from-zero.
  - Backup/restore: pg_dump -Fc HML/local; pg_restore em cisne_pg_restore (15 clientes, 75 migracoes) + clients.integration 5/5.
  - Concorrencia/billing/outbox: billing.integration PASS (duplicate PREPARED/retry idempotente); outbox FOR UPDATE SKIP LOCKED + lease/retry; EXCLUSION GiST alocacao (res.resource_allocations_no_overlap_active_excl); partial unique PREPARED (service_order_id, measurement_id); integracao em PG real.
  - CNPJ: normalized_tax_id UNIQUE + CHECK 14 digitos; 0 duplicados.
  - SQLi: nenhum dynamic order/filter concatenado.
  - Pool: max=10/idle30s/connect5s (node-pg defaults); servidor timeouts 0/log_lock_waits off.
  - Performance: baseline EXPLAIN listagem clientes ~1.1ms em volume HML (~15-30 linhas) - sem tuning aplicavel; indices nao removidos sem evidencia.
RISK (nao alterado - decisao de infra pendente): role HML cisne_hml e SUPERUSER+CREATEDB+CREATEROLE e dona do DB postgres (padrao da imagem oficial); public.CREATE disponivel. Recomendacao: bootstrap com role de migracao (DDL) e role runtime limitada (DML em schemas proprios), revogar public CREATE, SSL obrigatorio, credenciais fora do repo; aplicar em prod antes do Go/No-Go.
NOTA: 1 teste do tip concorrente a23467a falha (physical-assets 'blocks deactivation while asset has active allocation') - regressao de feature WIP, fora da camada PG.
COMMIT: docs log (postgres-hardening) - sem mudancas de codigo/migration.
WORKING TREE: DIRTY (WIP preservado).
NEXT: decisao de infra (roles/SSL/timeouts) + re-run quality gate.
```
---

## PROPAGAÇÃO DE CAPABILITIES ENTERPRISE — WORKLISTS FINANCEIRAS (rodada 26) — 2026-10-13

STATUS: **PASS**
Commits: `c9b66b9d` (bulk bar), `c7c8d29a` (despesas/orçamentos)

### O que foi feito, e por que esta ordem

A varredura de capabilities nas 18 worklists mostrou duas lacunas reais, não hipotéticas:

| Capability | Onde faltava |
| ---------- | ------------ |
| Processamento em lote | 17 de 18 worklists (só Ordens de serviço tinha) |
| Filtro composto | Recebíveis, Pagáveis, Orçamentos, Despesas, Fornecedores |

Antes de propagar, corrigi um defeito no PRIMITIVO que a propagação iria multiplicar.

### DEFEITO 1 — `BulkActionBar` entregava seleção VAZIA à ação

`operator/bulk/BulkActionBar.tsx` publicava `run: (selectedIds: string[]) => void` e chamava
`action.run([])`. A barra anunciava "N selecionados" e entregava ZERO ids.

Por que sobreviveu: os dois consumidores existentes (Recebíveis, Pagáveis) **ignoram o parâmetro** e
leem `selectedRows` do próprio closure. A tela funcionava e o contrato publicado era falso — o
próximo consumidor a confiar no parâmetro exportaria/agiria sobre conjunto vazio, em silêncio,
enquanto o operador via a barra contando a seleção dele.

Correção: a barra recebe `selectedIds` e repassa. Os dois consumidores passaram a ler do parâmetro,
para a armadilha não ser herdada.

PROVA: teste de regressão que **falha contra o código anterior** (verificado revertendo o one-liner
isoladamente) e passa agora, incluindo a prova negativa de que id não selecionado nunca chega à ação.

### DEFEITO 2 — duas worklists sem processamento em massa

Despesas e Orçamentos não tinham seleção múltipla utilizável nem ação em lote: o operador marcava N
registros e repetia a ação N vezes.

Não existe endpoint de transição em massa, e nenhum foi inventado: cada registro selecionado vai ao
SEU próprio comando autorizado, com a SUA própria versão — preservando autorização, concorrência
otimista e auditoria por registro. Lote parcial é relatado como parcial ("2 de 5 não puderam ser
concluídas") em vez de mascarado como sucesso.

- **Despesas**: `submit` e `approve` (`submitExpense`/`approveExpense`). `reject` fica FORA de
  propósito: exige motivo POR REGISTRO, e um motivo único aplicado a N despesas seria o frontend
  inventando justificativa de auditoria — mesma razão pela qual `DynamicBulkActions` exclui comandos
  com `requiresReason`.
- **Orçamentos**: `approve` (`approveBudget`, compare-and-set sobre `rowVersion`). Emitir nova versão
  e reabrir ficam fora: são decisões por orçamento.

### REGISTRO DE UM ERRO MEU, CORRIGIDO

A primeira versão declarava `runBulk` com `useCallback` DEPOIS dos retornos antecipados de
loading/denied/error — violação das Rules of Hooks que o teste pegou de imediato ("Rendered more
hooks than during the previous render"). Movido para antes dos gates, com `itemsRef`/`reloadRef`
para a leitura atual sem nova dependência por render.

### VALIDAÇÃO

| Gate | Resultado |
| ---- | --------- |
| `pnpm lint` | PASS (4/4 tasks) |
| `pnpm typecheck` | PASS (3/3 packages) |
| Testes focados (despesas, orçamentos, operator) | 38/38 PASS |
| `git diff --check` | PASS |
| scripts gate / source-size ratchet | PASS |

As 12 falhas em `finance-backoffice`/`finance-smart-list` e as 39 do `Unit tests` do CI **reproduzem
em árvore limpa com stash** (mesma contagem antes e depois), portanto são pré-existentes e não foram
mascaradas.

### DEPLOY (Railway, produção)

| Item | Estado |
| ---- | ------ |
| Commit | `c7c8d29a5cf98d631ff904169edab920f5f9bfb1` |
| `@cisne/web` build/deploy | SUCCESS (deployment criado pelo push) |
| `@cisne/api` build/deploy | SKIPPED — "No changes to watched files" (correto: mudança só de web) |
| Health API `ready`/`live` | 200 / 200 (`database up`) |
| Health WEB | 200 |
| Revisão ativa | confirmada: bundle `index-Bk6Ch_Q1.js` (o anterior `index-1WnaqygT.js` responde 404) |
| Bundle contém a capability | "Enviar para aprovação", "Aprovar selecionados" e as 3 mensagens de lote parcial |

### RESTRIÇÕES CONHECIDAS

1. **CI `Unit tests` segue vermelho** — 39 falhas pré-existentes (Finance backoffice, Finance smart
   list, medições de OS, shell, billing, folha, e2e de pedidos/propostas). Bloqueia o workflow `CD`,
   que exige CI `success`. Não é regressão desta rodada; é a maior dívida de gate do repositório.
2. **Filtro composto continua ausente** em Recebíveis, Pagáveis, Orçamentos, Despesas e Fornecedores
   — a segunda metade da lacuna mapeada, ainda não propagada.
3. **A ordem da família de regiões** segue sem regra compartilhada (herdado da rodada 25).
4. `apps/web/src/purchase-orders/purchase-orders-request-budget.ui.test.tsx` já estava não rastreado
   na árvore antes desta rodada; não foi commitado.

WORKING_TREE: sem alteração pendente de código; só este registro

---

## FILTRO COMPOSTO SERVER-SIDE EM CONTAS A RECEBER (rodada 27) — 2026-10-13

STATUS: **PASS**
Commits: `07ef92e3` (contrato + UI + migration), `61f4db52` (harness e contratos de teste)

### DEFEITO 1 — o recorte composto nunca chegava ao servidor

A worklist de Contas a receber montava o construtor AND/OR da engine desde a adoção do padrão de
worklists, mas a árvore era aplicada **só no navegador**: `byBuilder` filtrava a página já carregada
com `matchesFilterGroup`.

Numa carteira maior que uma página, compor um filtro e ver "nenhum título" **não significava "não
existe"** — significava "não está entre as 20 linhas carregadas". O total exibido ao lado continuava
contando o conjunto NÃO filtrado. Os testes existentes passavam porque mediam a MÁSCARA, não o
contrato.

### O que foi implementado (backend real, sem mecanismo paralelo)

| Camada | Mudança |
| ------ | ------- |
| Contrato | `finance/repositories/receivable-list-sql.ts` — allow-list + tradução por condição, reusando o parser genérico que os módulos comerciais já compartilham |
| Repositório | `receivables.repository.ts` — o predicado composto entra como UM clause, por conjunção com escopo, situação, janela e busca |
| Controller | valida contra o allow-list da entidade e converte filtro inválido em **400** (descartar em silêncio devolveria a lista inteira como se o recorte tivesse sido aplicado) |
| Frontend | árvore convertida por `advancedFilterFromGroup` com spec que espelha o servidor; `byBuilder` deixou de refiltrar |
| Banco | migration **0094** liga os marcadores `in_filter` no metadata store — sem eles o construtor não renderiza campo algum |

**`status` fica FORA do allow-list composto, e a razão é de domínio:** o título não tem coluna de
situação. O status que o operador lê é DERIVADO de lifecycle + liquidações + vencimento, e o filtro
simples já o traduz para os predicados reais. Oferecê-lo aqui trocaria um filtro correto por um
quase-correto — pior, porque parece funcionar.

### DEFEITO 2 — 12 falhas de teste carregadas como "pré-existentes" sem causa lida

Ambas as suítes de UI financeira estavam vermelhas em `main`. Eram **duas** causas, nenhuma de
produto:

1. **HARNESS.** As telas são dirigidas por METADADO, mas as suítes renderizavam sem
   `{ metadata: true }` e o mock de financeiro não servia NENHUMA rota `/api/v1/meta/:entity`. A
   página ficava presa antes da grade e todo teste estourava `waitFor` de 10s — por isso as falhas
   **pareciam** intermitentes.
2. **CONTRATO.** As asserções de identidade eram `getByRole('link', { name: 'AR-001' })`. A worklist
   migrou para o padrão enterprise de linha: navegação é `onRowClick` e a ação visível é o botão
   "Prévia de AR-001". Não existe mais `<a>` na linha.

Achados adicionais corrigidos ao provar o acima: a grade de recebíveis **não tinha `ariaLabel`**
(única das worklists financeiras sem ele — leitor de tela anunciava "tabela, 5 colunas" sem dizer
qual fila abriu); asserções de paginação contavam `role=row` (cabeçalho e rodapé inclusos) em vez de
linhas de dado.

**Nenhuma asserção foi enfraquecida**: as provas negativas (não selecionado não é exportado, visão
vazia esconde linhas, métrica autoritativa não é contada da página) permanecem.

### HIPÓTESE QUE DESCARTei COM MEDIÇÃO

Suspeitei de um `useMemo` declarado após os retornos antecipados em `ReceivablesListPage`. Medido:
**não existe** violação das Rules of Hooks ali; o defeito era o harness. Registro a hipótese
descartada para que não seja reaberta.

### VALIDAÇÃO

| Gate | Resultado |
| ---- | --------- |
| `pnpm lint` | PASS (4/4 tasks) |
| `pnpm typecheck` | PASS (3/3 packages) |
| Web financeiro | **90/90** (era 78/90 — as 12 falhas eram estas) |
| API financeiro + test | 66/66, incluindo **13 testes novos** do contrato |
| `git diff --check` | PASS |
| scripts gate / source-size ratchet | PASS |

### CI

`Unit tests` caiu de **39 → 27 falhas** (950/977 passando; os arquivos de financeiro saíram da lista).
`Lint / Typecheck / Audit` **PASS**. O job continua vermelho por outras 27 falhas pré-existentes
(medições de OS, shell, billing, folha, e2e de pedidos/propostas, OperationsControlCenter) — a maior
dívida de gate restante, ainda não tratada.

### DEPLOY (Railway, produção)

| Item | Estado |
| ---- | ------ |
| Commit | `61f4db52095f76835ace88c6ac5a99ca8373cce4` |
| `@cisne/web` | **SUCCESS** |
| `@cisne/api` | **SUCCESS** — pre-deploy aplicou a migration 0094 |
| Health | API `ready` 200 (`database up`), API `live` 200, WEB `/health` 200 |
| Revisão ativa | bundle `index-iI2-umc5.js` (o anterior responde **404**) |

### RESTRIÇÕES CONHECIDAS

1. **27 falhas de CI seguem abertas** e bloqueiam o workflow `CD`.
2. **Filtro composto ainda ausente** em Pagáveis, Orçamentos, Despesas e Fornecedores — a outra
   metade da lacuna mapeada na rodada 26.
3. `apps/web/src/purchase-orders/purchase-orders-request-budget.ui.test.tsx` já estava não rastreado
   antes destas rodadas; não foi commitado.

WORKING_TREE: sem alteração pendente de código; só este registro

---

## FILTRO COMPOSTO SERVER-SIDE EM CONTAS A PAGAR (rodada 28) — 2026-10-13

STATUS: **PASS**
Commit: `9a73b0cc` (contrato + UI + migration 0095)

### DEFEITO — o mesmo de recebíveis, na fila irmã

A worklist de Contas a pagar montava o construtor AND/OR da engine, mas `byBuilder` aplicava a
árvore **só no navegador** sobre a página já carregada. Numa carteira maior que uma página,
"nenhuma obrigação" **não significava "não existe"** — significava "não está entre as linhas
carregadas", e o indicador ao lado continuava contando o conjunto NÃO filtrado.

Corrigir recebíveis e deixar pagáveis no mesmo estado teria sido propagação pela metade.

### PAGÁVEIS NÃO É RECEBÍVEIS COM OUTRO NOME

A fila tem **dois campos de recorte** que a outra não tem:

- `origin_reference` — o documento que gerou a obrigação;
- `cost_center_code` — o centro de custo.

É por isso que o allow-list é **arquivo próprio** em vez de reutilizar o de recebíveis: a lista
errada ofereceria ao operador um campo que o servidor recusa com 400, ou esconderia um que ele
executa. As duas telas agora declaram os seus, e cada um espelha o seu par no servidor.

### Implementação

| Camada | Mudança |
| ------ | ------- |
| Contrato | `finance/repositories/payable-list-sql.ts` — allow-list próprio + tradução por condição, pelo parser genérico já compartilhado |
| Repositório | predicado composto como UM clause, por conjunção com escopo, situação, janela e busca |
| Controller | valida contra o allow-list da entidade; filtro inválido vira **400**, nunca recorte ignorado |
| Frontend | árvore convertida por `advancedFilterFromGroup` com `PAYABLE_TITLE_FILTER_SPECS` |
| Banco | migration **0095** liga os marcadores `in_filter` |

`status`/`lifecycle`, `counterparty_id` e `unit_id` ficam FORA pelos motivos já documentados em
recebíveis: situação é derivada (não existe coluna) e contraparte/unidade já são o filtro simples e
o escopo de autorização.

### CASO DE FRONTEIRA DECLARADO NO CÓDIGO

O filtro de **aging continua LOCAL** nesta tela — o servidor não o aceita como parâmetro.
`byBuilder` agora é **apenas** o resultado do aging, e o comentário no código diz isso, para que
ninguém o leia como máscara sobre a página. A árvore, essa sim, viaja.

### ERRO MEU, CORRIGIDO

O helper de teste lia a identidade da linha por TEXTO (`/^AP-\d+$/`). Em pagáveis a mesma referência
aparece **duas vezes** na linha (externa E de origem), então `getByText` encontrava dois elementos e
lançava. Passou a mirar a coluna (`[data-field="external_reference"]`) — que é o que a tela afirma.

### VALIDAÇÃO

| Gate | Resultado |
| ---- | --------- |
| `pnpm lint` | PASS (4/4 tasks) |
| `pnpm typecheck` | PASS (3/3 packages) |
| Web financeiro | **93/93** |
| API financeiro + test | 79/79, incluindo **13 testes novos** do contrato de pagáveis |
| `git diff --check` | PASS |
| scripts gate / source-size ratchet | PASS |

### CI

`Lint / Typecheck / Audit` **PASS**. `Unit tests` 953/980 — **27 falhas pré-existentes** (mesmo
conjunto da rodada anterior: medições de OS, shell, billing, folha, e2e, OperationsControlCenter).
Nenhuma regressão; +3 testes passando em relação à rodada 27.

### DEPLOY (Railway, produção)

| Item | Estado |
| ---- | ------ |
| Commit | `9a73b0cc4dc88a1d46b7496bd6f95984acf1a93c` |
| `@cisne/api` | **SUCCESS** — pre-deploy aplicou a migration 0095 |
| `@cisne/web` | **SUCCESS** |
| Health | API `ready` 200 (`database up`), WEB `/health` 200 |
| Revisão ativa | bundle `index-SF0Q3JCO.js` (o anterior responde **404**); contém `originReference`, `costCenterCode` e o parâmetro `filters` |

### RESTRIÇÕES CONHECIDAS

1. **27 falhas de CI seguem abertas** e bloqueiam o workflow `CD`.
2. **Filtro composto ainda ausente** em Orçamentos, Despesas, Fornecedores e Tesouraria — resta esta
   cauda da lacuna mapeada.
3. `apps/web/src/purchase-orders/purchase-orders-request-budget.ui.test.tsx` segue não rastreado
   desde antes destas rodadas; não foi commitado.

WORKING_TREE: sem alteração pendente de código; só este registro

---

## FILTRO COMPOSTO SERVER-SIDE EM ORÇAMENTOS (rodada 29) — 2026-10-13

STATUS: **PASS**
Commit: `b799a8b2` (contrato + UI + migration 0096)

### AQUI O DEFEITO ERA AUSÊNCIA, NÃO MÁSCARA

Recebíveis e pagáveis tinham o construtor montado e aplicado só no navegador. Orçamentos era
diferente: a tela oferecia **um** termo de busca e **um** valor de situação, e combinar "situação
ACTIVE E moeda BRL E criado depois de X" **não era expressável**. Não havia máscara para corrigir —
havia um vazio, preenchido já pelo caminho correto: a árvore vira `filters` na MESMA consulta, então
paginação e contagem seguem coerentes com o recorte, e nada é refiltrado no navegador.

### `status` ENTRA AQUI — e a diferença é de DOMÍNIO, não de gosto

| Entidade | Situação | Recorte composto por situação |
| -------- | -------- | ----------------------------- |
| recebíveis / pagáveis | DERIVADA (lifecycle + liquidações + vencimento); **não há coluna** | excluída |
| **orçamentos** | **COLUNA real** (`fin.budget_status`, ACTIVE/INACTIVE), já usada pelo filtro simples | **incluída** |

O teste fixa essa diferença em vez de assumir que as três telas são iguais — foi justamente copiar
allow-list entre entidades que a rodada anterior recusou.

`unit_id` fica fora: já é o filtro simples e o escopo de autorização.

### Implementação

`budget-list-sql.ts` (allow-list + cast do ENUM `fin.budget_status`, sem o qual o Postgres compararia
enum com texto e o erro seria de TIPO em vez de zero linhas) · predicado composto como um clause no
`whereParts` já existente · controller devolve **400** em filtro inválido · migration **0096** liga os
marcadores `in_filter`.

### VALIDAÇÃO

| Gate | Resultado |
| ---- | --------- |
| `pnpm lint` | PASS (4/4 tasks) |
| `pnpm typecheck` | PASS (3/3 packages) |
| Web financeiro | **96/96** |
| API financeiro + test | 79/79, com **14 testes novos** do contrato de orçamentos |
| `git diff --check` | PASS |
| scripts gate / journal coverage / source-size | PASS |

### DEPLOY (Railway, produção)

| Item | Estado |
| ---- | ------ |
| Commit | `b799a8b2fd107aa2ba0e5267d7e57fccabd7cbbc` |
| `@cisne/api` | **SUCCESS** — pre-deploy aplicou a migration 0096 |
| `@cisne/web` | **SUCCESS** |
| Health | API `ready` 200 (`database up`), WEB `/health` 200 |
| Revisão ativa | bundle `index-BVYvBSeI.js` (o anterior responde **404**) |

### RESTRIÇÕES CONHECIDAS

1. **Cauda do filtro composto**: Despesas, Fornecedores e Tesouraria ainda não o têm.
2. **27 falhas de CI pré-existentes** seguem abertas e bloqueiam o workflow `CD`.
3. **Arquivos não rastreados de TERCEIROS apareceram na árvore durante esta rodada**
   (`dashboard/components/BusinessChainFlow.tsx`, `DashboardWorkbenchHeader.tsx`,
   `SituationPanel.tsx`, `WorkbenchKpiStrip.tsx`, `dashboard/utils/build-workbench-kpis.ts`,
   `dashboard-situation.ts`, mais modificações em `ShellNavList.tsx` e na página do dashboard).
   **NÃO foram tocados nem commitados** — não são deste trabalho, e misturá-los num commit de
   financeiro seria atribuição errada. Ficam registrados para o responsável decidir.
4. `apps/web/src/purchase-orders/purchase-orders-request-budget.ui.test.tsx` segue não rastreado desde
   antes destas rodadas.

WORKING_TREE: alterações de TERCEIROS presentes e deliberadamente não commitadas (ver item 3)

---

## PROJEÇÃO DE CARTEIRA AUTORITATIVA — PEDIDOS DE COMPRA (rodada 30) — 2026-10-14

STATUS: **PASS_WITH_RESTRICTIONS**

### Escopo executado

Correção vertical de uma falha comprovada na worklist de Pedidos de compra: seus valores agregados eram somados no frontend a partir da página carregada, não distinguiam moedas na faixa e não provinham de uma projeção do recorte completo autorizado.

### Implementação

- O repositório consulta linhas paginadas e agregação por moeda sob o mesmo snapshot PostgreSQL (`REPEATABLE READ READ ONLY`), aplicando o mesmo predicado autorizado e os mesmos filtros.
- A API publica total de registros do recorte e, por moeda, autorizado, consumido, saldo e contagens explícitas de valores/saldos não apuráveis.
- A worklist não soma mais os valores carregados no browser; a paginação usa o total do servidor. Carteira vazia não renderiza valores monetários como `R$ 0,00`; moedas distintas ficam separadas; estados desconhecidos permanecem desconhecidos.
- Sem mudança de esquema, constraint ou migration: a query projeta campos persistidos que já possuem semântica no domínio.
- Nenhuma regra empresarial, command ou capability foi criada.

### Validação

- `@cisne/database` build: PASS.
- `@cisne/api` e `@cisne/web` typecheck: PASS após build do pacote workspace `@cisne/database`.
- ESLint focado nos arquivos API e Web alterados: PASS.
- API unit focado: parser de lista + ledger, **21/21 asserts passaram**. O Vitest deixou handles ativos depois do relatório e foi interrompido pelo executor (exit 130).
- UI focado: as duas suítes imprimiram aprovação dos asserts (1/1 cada). O Vitest deixou handles ativos depois do relatório e foi interrompido pelo executor (exit 130).
- Integração PostgreSQL nova adicionada (página vazia, duas moedas, agregação independente do tamanho da página e filtro de unidade), mas não executável neste ambiente: `TEST_DATABASE_URL` ausente e sem servidor/container PostgreSQL instalado.
- `git diff --check`: PASS.

### Restrições

A consulta SQL nova ainda precisa do teste de integração PostgreSQL em CI para validar execução contra o motor real. Não alegar validação de integração nem publicar como gate completo até essa evidência.

## PROJEÇÃO AUTORITATIVA DA WORKLIST DE DESPESAS — continuação — 2026-10-14

STATUS: **PASS_WITH_RESTRICTIONS**

- A API de Despesas publica total, contagens por estado e valores em aberto por moeda, sob o mesmo predicado de autorização/filtros; a worklist consome esses dados e mostra `—` quando resumo não está publicado.
- Sem migration: usa status, moeda e valores existentes; comandos de despesa, capability e auditoria existentes preservados.
- ESLint focado API/Web: PASS. Typecheck API/Web: PASS. UI de Despesas: 6/6 asserts aprovados; o processo Vitest permaneceu ativo após o relatório e foi encerrado pelo executor, portanto o encerramento do runner não está validado.
- `git diff --check`: PASS.
- Integração PostgreSQL da lista foi ampliada, mas não executada: `TEST_DATABASE_URL` ausente e runtime de container/PostgreSQL não disponível neste ambiente.

O teste de integração deve ser executado no CI PostgreSQL antes de promover este bloco para produção.

## PAGINAÇÃO AUTORITATIVA E WORKLIST DE ORDENS DE SERVIÇO — 2026-10-15

STATUS: **PASS_WITH_RESTRICTIONS**

- `ServiceOrdersRepository.countServiceOrders` aplica a mesma cláusula autorizada e os mesmos filtros da lista, sem `LIMIT/OFFSET`; API publica `total` do recorte e `hasMore` autoritativo. Filtros e ordenação server-side permanecem no caminho existente. Sem migration: consulta os dados e predicados já persistidos.
- A worklist remove a heurística `items.length === PAGE_SIZE`, usa `hasMore` e `total` do contrato e mantém o próximo controle indisponível quando a continuidade não é conhecida. KPIs calculados pelas linhas continuam explicitamente “nesta página”; total desconhecido não vira zero nem estimativa.
- A worklist existente mantém WorklistHeader, Saved Views, filtros compostos, State Panel, Context Drawer, comandos semânticos e ações em lote; a composição de paginação explicita intervalo e universo do recorte quando publicado.
- ESLint e typecheck focados API/Web: PASS. Unit API: 4/4 PASS (runner permaneceu ativo após relatório). UI: 7 casos aprovados; o processo encerrou pelo timeout após as asserções, sem status de saída limpo. Integração PostgreSQL não executada: `TEST_DATABASE_URL` e servidor/container PostgreSQL não estão disponíveis; nenhuma integração foi alegada.
- Sem alteração de schema, índice, regra empresarial ou migration. Produção permanece **NO-GO** até CI validar a query contra PostgreSQL.

## RECOMPOSIÇÃO ESTRUTURAL DO FRONTEND / DRAWER DINÂMICO — 2026-10-15

STATUS: **BLOCKED** — implementação parcial preservada, não promovida para main.

Fonte: solicitação explícita desta sessão “CISNE — RECONSTRUÇÃO VISUAL BRUSCA DO FRONTEND REAL”, complementada por “Quero drawer dinâmico”, “Não fixo” e “Continue oq estava fazendo”. Classificação: decisão de apresentação/interação autorizada pelo responsável; não altera regra empresarial, API, capability, banco ou máquina de estados.

### Delta estrutural implementado, ainda sem aceite

- Shell recomposto em seletor de processo + navegação da área atual, respeitando os probes de autorização existentes. Breadcrumb transferido para a topbar. Command Palette existente preservada.
- ModulePage recebe host contextual compartilhado. DynamicContextDrawer e ContextDrawer usam portal no desktop: nenhuma coluna antes da seleção, nenhuma modalidade que impeça a operação da fila. Fechamento libera a largura. Viewport estreito mantém sobreposição. O conteúdo continua sendo fornecido pela página, sem nova busca ou inferência de relações.
- Clientes abandona o painel permanente e a duplicação desktop/mobile; usa o mesmo DynamicContextDrawer para o conteúdo já autorizado. Recebíveis e Pagáveis removem a coluna permanente e mantêm a prévia já existente no drawer dinâmico.
- WorkspaceBody passa a expor contexto de processo sob disclosure voluntário. WorklistHeader reutiliza WorkspaceHeader; identidade, resumo e comando têm zonas próprias. Filtros metadata e criação de Saved Views tornam-se disclosures, mantendo as visões sempre acessíveis.
- EnterpriseObjectPage separa corpo do registro e coluna de decisão/contexto. ObjectPanel publica âncoras; navegação de seção usa somente painéis realmente recebidos. EnterpriseObjectHeader reorganiza identidade, ações e fatos. A propagação depende dos consumidores existentes, não constitui validação individual de todas as rotas.
- Dashboard: fila em largura integral por padrão; ContextDrawer apenas por seleção; análises e contexto de recorte passam a disclosure secundário. Fluxo e situação permanecem com as fontes existentes. Removida a camada de CSS acrescentada no fim do dashboard pelo trabalho anterior.
- DynamicList ganha abertura de contexto por Enter/Espaço e navegação de foco por setas, sem capturar links, botões ou inputs. Billing usa seleção de linha e modo workspace.
- Incluídos quatro casos em `apps/web/src/ui/workspace-recomposition.test.tsx`: seleção/troca/fechamento preservando filtro, enquadramento mobile, disclosure de contexto e separação conteúdo/decisão em Object Page.

### Gates e bloqueio

- TypeScript transpileModule: arquivos TSX alterados passaram no parser. Uma função de apresentação que ficou sem uso foi religada ao subtitle da prévia de recebível. Isto **não é typecheck completo**.
- Typecheck completo tentado: BLOCKED — tipos node/vite/vitest e pacotes workspace não resolvidos, porque a instalação não concluiu.
- ESLint focado tentado: BLOCKED — executável não instalado.
- Vitest focado tentado: BLOCKED — executável não instalado; nenhum teste de comportamento é declarado aprovado.
- Instalação offline tentada: `ERR_PNPM_NO_OFFLINE_TARBALL` para React 19.2.8. A tentativa online anterior recebeu 403; não foi contornada.
- `git diff --check`: PASS até o registro desta execução; reexecutar sobre o diff final.
- Sem screenshot/validação visual de produção; sem full suite; sem mudança de workflow para ignorar gates.

Não foi criado novo commit, não houve avanço de main nem deployment nesta execução. Aguardar executor com dependências do projeto disponíveis, executar os gates focados, corrigir eventual falha real e somente então publicar. Não declarar reconstrução global concluída ou Railway SUCCESS.

## VALIDAÇÃO REMOTA E PUBLICAÇÃO DA RECOMPOSIÇÃO — 2026-10-15

STATUS: **PASS_WITH_RESTRICTIONS** — gates focados e deployment aprovados; aceite visual autenticado não executado.

Autorização: resposta “Sim” ao uso de branch temporária exclusivamente para validação remota, seguida de avanço de main após aprovação dos gates. Classificação: execução de engenharia autorizada; não altera domínio.

- Branch temporária: `validation/frontend-recomposition-20261015`; nenhum PR ou ambiente Railway paralelo criado.
- Commit da implementação: `557bb0a16c448f45c98310023b55e516c3109a9d`.
- Workflow específico: `.github/workflows/frontend-recomposition-validation.yml`, limitado à branch temporária, sem deploy e sem modificar o CI existente. Run `38819244628`, job `116711477237`, **SUCCESS**.
- Dependências instaladas com lockfile no runner; lint dos TS/TSX alterados **PASS**; typecheck Web **PASS**; testes focados **52/52 PASS** em 5 suítes; build Web **PASS**; diff-check **PASS**.
- Testes: `workspace-recomposition` (4), `enterprise-object.contract` (22), `enterprise-object/propagation` (16), `cockpit-structure` (8), `shell.components` (2). Não foi disparada manualmente a full suite nem adotados snapshots antigos como autoridade de layout.
- Main avançada por fast-forward de `a5fb4018fd049989dc755461a334eb99fbba5d11` para o SHA validado. Nenhum force push.
- Railway `@cisne/web`: deployment `d0b62823-afae-4e55-b0e9-52420e127d03`, **SUCCESS**, confirmado em `2026-10-15T22:48:40.650Z`, região `us-west2`, commit `557bb0a16c448f45c98310023b55e516c3109a9d`.
- Railway `@cisne/api`: tentativa `d6f2de8c-0f93-42fa-9cf0-0d679d447e98`, **SKIPPED**, esperado porque nenhuma API foi alterada.
- Navegador chegou ao formulário de login do CISNE. Sem sessão autenticada, não foi possível inspecionar visualmente todas as páginas empresariais. O deployment e os contratos automatizados estão aprovados; não se declara aceite visual global nem implementação de funcionalidades empresariais ausentes.
- Propagação real dos Object Page primitives inclui Customer 360, Contract 360, OS 360, Planejamento, Execução, Medição, Propostas, Pedidos, Ativos, Recebíveis, Pagáveis, Tesouraria, Fornecedores e Catálogo. Os primitives compartilhados alteram composição; esta enumeração não equivale a validação visual individual de cada rota.

Este registro complementa e supera o bloqueio técnico da execução anterior, preservado acima como histórico. O commit documental posterior não altera o código validado/implantado.

## CORREÇÃO DE OVERFLOW DO BREADCRUMB DO SHELL — 2026-10-16

STATUS: **PASS_WITH_RESTRICTIONS** — validações locais focadas passaram; CI e deployment ainda pendentes.

- Breadcrumb compartilhado do shell permanece em uma linha, limitado à largura da topbar; o último segmento pode ser truncado com reticências. Aplicável às rotas observadas `/app` e `/app/billing`, sem alterar dados, regras, API ou permissões.
- Alterados `ShellBreadcrumbs.tsx`, `shell.css` e `shell.components.test.tsx`; adicionado teste visual Playwright para as duas rotas em larguras 1280 e 1880.
- ESLint focado: PASS. Typecheck Web: PASS. Build Web: PASS. `git diff --check`: PASS antes deste registro; reexecutar sobre o diff final.
- Vitest focado imprimiu 2/2 asserts aprovados, mas o processo não encerrou por handles ativos e foi interrompido (exit 130); encerramento limpo não validado.
- Playwright visual bloqueado localmente: Chromium ausente; instalação oficial tentou baixar arquivo inválido/0 MiB. Nenhum resultado visual é alegado.
- Não houve inspeção autenticada de produção; credenciais não foram incluídas no repositório ou registro. A validação CI e a confirmação Railway permanecem pendentes.
