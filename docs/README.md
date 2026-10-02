# Documentação — SISTEMA CISNE RONDÔNIA

Índice da baseline documental. Fase atual: **IMPLEMENTATION (pré-produção)**. Código de domínio empresarial: **STARTED** — API e web com fluxos operacionais; **produção NO-GO** até evidência em `readiness-evidence.json`.

## Como usar esta pasta

1. Governança (`00-governance/`) define como o trabalho é feito.
2. Fundação (`01-foundation/`) registra o que se sabe, o que falta e o que está pendente.
3. `inputs/` recebe fontes empresariais. SRC-001 disponível desde Prompt 00.1; analisado no Prompt 01.
4. `02-source-analysis/` contém decomposição atômica e análises do Prompt 01.
5. `03-requirements/` contém requisitos funcionais e casos de uso do Prompt 02.
6. `04-quality-attributes/` contém requisitos não funcionais do Prompt 03.
7. `05-ubiquitous-language/` contém glossário e linguagem ubíqua do Prompt 04.
8. `06-domain-boundaries/` contém subdomínios e bounded contexts candidatos do Prompt 05.
9. `07-domain-behavior/` contém invariantes, comandos e eventos candidatos do Prompt 06.
10. `08-state-machines/` contém máquinas de estado empresariais candidatas do Prompt 07.
11. `09-authorization/` contém autorização empresarial e segregação do Prompt 08.
12. `10-architecture/` contém drivers, opções e ADRs fundamentais do Prompt 09.
13. `11-technology/` contém seleção de stack e ADRs tecnológicos do Prompt 10.
14. `12-domain-model/` contém modelo conceitual e aggregates candidatos do Prompt 11.
15. `13-data-model/` contém modelo lógico relacional e constraints candidatas do Prompt 12.
16. `14-transaction-design/` contém transações, concorrência e idempotência do Prompt 13.
17. `15-security/` contém threat model e arquitetura de segurança do Prompt 14.
18. `16-testing/` contém arquitetura de testes e estratégia de qualidade do Prompt 15.
19. `17-bootstrap/` contém fundação técnica do monorepo do Prompt 16.
20. `18-database-foundation/` contém PostgreSQL local e Drizzle do Prompt 17.
21. `templates/` define a forma dos registros futuros.

Agentes devem seguir [`../AGENTS.md`](../AGENTS.md) e o protocolo em [`00-governance/execution-protocol.md`](00-governance/execution-protocol.md).

Documento de funcionalidade real e justificativa de investimento (sem valores monetários), para leitura comercial: [`proposta-valor-funcionalidade.md`](proposta-valor-funcionalidade.md).

## 00-governance

| Arquivo                                                              | Conteúdo                          |
| -------------------------------------------------------------------- | --------------------------------- |
| [project-charter.md](00-governance/project-charter.md)               | Carta do projeto                  |
| [execution-protocol.md](00-governance/execution-protocol.md)         | Protocolo de execução dos prompts |
| [engineering-principles.md](00-governance/engineering-principles.md) | Princípios de engenharia          |
| [change-governance.md](00-governance/change-governance.md)           | Governança de mudança e commits   |
| [traceability-policy.md](00-governance/traceability-policy.md)       | Política de rastreabilidade       |
| [definition-of-ready.md](00-governance/definition-of-ready.md)       | Definition of Ready               |
| [definition-of-done.md](00-governance/definition-of-done.md)         | Definition of Done                |
| [quality-gates.md](00-governance/quality-gates.md)                   | Quality gates                     |
| [prompt-roadmap.md](00-governance/prompt-roadmap.md)                 | Roadmap preliminar de prompts     |
| [prompt-execution-log.md](00-governance/prompt-execution-log.md)     | Registro de execução              |
| [prompt-pack-erp-nativo.md](00-governance/prompt-pack-erp-nativo.md) | Pacote ERP-N (NOT_STARTED)        |

## 01-foundation

| Arquivo                                                                              | Conteúdo                        |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| [source-registry.md](01-foundation/source-registry.md)                               | Registro de fontes              |
| [business-context.md](01-foundation/business-context.md)                             | Contexto empresarial preliminar |
| [scope-register.md](01-foundation/scope-register.md)                                 | Registro de escopo              |
| [release-1-closed-scope.md](01-foundation/release-1-closed-scope.md)                 | Escopo fechado da Release 1     |
| [stakeholders-register.md](01-foundation/stakeholders-register.md)                   | Partes interessadas             |
| [business-rules-register.md](01-foundation/business-rules-register.md)               | Regras de negócio               |
| [domain-decisions-pending.md](01-foundation/domain-decisions-pending.md)             | Decisões de domínio pendentes   |
| [engineering-decisions-register.md](01-foundation/engineering-decisions-register.md) | Decisões de engenharia          |
| [source-conflicts.md](01-foundation/source-conflicts.md)                             | Conflitos de fonte              |
| [risk-register.md](01-foundation/risk-register.md)                                   | Registro de riscos              |
| [requirements-traceability.md](01-foundation/requirements-traceability.md)           | Matriz de rastreabilidade       |

## 02-source-analysis

Análise atômica e temática das fontes (Prompt 01). Índice: [02-source-analysis/README.md](02-source-analysis/README.md).

| Arquivo                                                                                 | Conteúdo                    |
| --------------------------------------------------------------------------------------- | --------------------------- |
| [atomic-evidence-register.md](02-source-analysis/atomic-evidence-register.md)           | 84 evidências EV-001–EV-084 |
| [source-assessment.md](02-source-analysis/source-assessment.md)                         | Avaliação SRC-000 e SRC-001 |
| [prompt-01-completeness-report.md](02-source-analysis/prompt-01-completeness-report.md) | Relatório de completude     |

## 03-requirements

Requisitos funcionais e casos de uso (Prompt 02). Índice: [03-requirements/README.md](03-requirements/README.md).

| Arquivo                                                                                    | Conteúdo                  |
| ------------------------------------------------------------------------------------------ | ------------------------- |
| [functional-requirements-register.md](03-requirements/functional-requirements-register.md) | 42 FRs FR-001..FR-042     |
| [use-case-catalog.md](03-requirements/use-case-catalog.md)                                 | 26 UCs UC-001..UC-026     |
| [acceptance-criteria-catalog.md](03-requirements/acceptance-criteria-catalog.md)           | 52 ACs AC-001..AC-052     |
| [business-capability-map.md](03-requirements/business-capability-map.md)                   | 27 capacidades candidatas |
| [prompt-02-completeness-report.md](03-requirements/prompt-02-completeness-report.md)       | Relatório de completude   |

## 04-quality-attributes

Requisitos não funcionais e cenários de qualidade (Prompt 03). Índice: [04-quality-attributes/README.md](04-quality-attributes/README.md).

| Arquivo                                                                                                  | Conteúdo                         |
| -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [nfr-method.md](04-quality-attributes/nfr-method.md)                                                     | Método e classificação NFR       |
| [non-functional-requirements-register.md](04-quality-attributes/non-functional-requirements-register.md) | 40 NFRs NFR-001..NFR-040         |
| [quality-attribute-scenarios.md](04-quality-attributes/quality-attribute-scenarios.md)                   | 28 cenários QA-SC-001..QA-SC-028 |
| [security-requirements.md](04-quality-attributes/security-requirements.md)                               | 24 SEC-REQ                       |
| [service-level-objectives-pending.md](04-quality-attributes/service-level-objectives-pending.md)         | SLOs pendentes (sem valores)     |
| [nfr-risk-traceability.md](04-quality-attributes/nfr-risk-traceability.md)                               | Rastreabilidade NFR ↔ risco      |
| [prompt-03-completeness-report.md](04-quality-attributes/prompt-03-completeness-report.md)               | Relatório de completude          |

## 05-ubiquitous-language

Glossário e linguagem ubíqua (Prompt 04). Índice: [05-ubiquitous-language/README.md](05-ubiquitous-language/README.md).

| Arquivo                                                                                     | Conteúdo                     |
| ------------------------------------------------------------------------------------------- | ---------------------------- |
| [language-method.md](05-ubiquitous-language/language-method.md)                             | Método e classes semânticas  |
| [ubiquitous-language-register.md](05-ubiquitous-language/ubiquitous-language-register.md)   | 48 termos TERM-001..TERM-048 |
| [business-verbs-catalog.md](05-ubiquitous-language/business-verbs-catalog.md)               | Verbos empresariais          |
| [business-nouns-catalog.md](05-ubiquitous-language/business-nouns-catalog.md)               | Substantivos empresariais    |
| [state-event-command-semantics.md](05-ubiquitous-language/state-event-command-semantics.md) | Estado, evento, comando      |
| [language-consistency-audit.md](05-ubiquitous-language/language-consistency-audit.md)       | Auditoria terminológica      |
| [prompt-04-completeness-report.md](05-ubiquitous-language/prompt-04-completeness-report.md) | Relatório de completude      |

## 06-domain-boundaries

Subdomínios e bounded contexts candidatos (Prompt 05). Índice: [06-domain-boundaries/README.md](06-domain-boundaries/README.md).

| Arquivo                                                                                   | Conteúdo                     |
| ----------------------------------------------------------------------------------------- | ---------------------------- |
| [subdomain-classification.md](06-domain-boundaries/subdomain-classification.md)           | 12 subdomínios SUBD-001..012 |
| [bounded-context-candidates.md](06-domain-boundaries/bounded-context-candidates.md)       | 18 BC-CAND-001..018          |
| [context-map.md](06-domain-boundaries/context-map.md)                                     | Mapa de contextos            |
| [cross-context-workflows.md](06-domain-boundaries/cross-context-workflows.md)             | Fluxos transversais          |
| [modular-monolith-assessment.md](06-domain-boundaries/modular-monolith-assessment.md)     | Avaliação modular monolith   |
| [prompt-05-completeness-report.md](06-domain-boundaries/prompt-05-completeness-report.md) | Relatório de completude      |

## 07-domain-behavior

Comportamento de domínio candidato (Prompt 06). Índice: [07-domain-behavior/README.md](07-domain-behavior/README.md).

| Arquivo                                                                                 | Conteúdo            |
| --------------------------------------------------------------------------------------- | ------------------- |
| [invariant-register.md](07-domain-behavior/invariant-register.md)                       | 22 INV-001..INV-022 |
| [command-register.md](07-domain-behavior/command-register.md)                           | 22 CMD-001..CMD-022 |
| [domain-event-register.md](07-domain-behavior/domain-event-register.md)                 | 20 DE-001..DE-020   |
| [rejection-reason-catalog.md](07-domain-behavior/rejection-reason-catalog.md)           | 18 REJ              |
| [behavior-traceability.md](07-domain-behavior/behavior-traceability.md)                 | Cadeia EV→DE        |
| [prompt-06-completeness-report.md](07-domain-behavior/prompt-06-completeness-report.md) | Relatório           |

## 08-state-machines

Máquinas de estado empresariais candidatas (Prompt 07). Índice: [08-state-machines/README.md](08-state-machines/README.md).

| Arquivo                                                                                | Conteúdo              |
| -------------------------------------------------------------------------------------- | --------------------- |
| [service-order-state-machine.md](08-state-machines/service-order-state-machine.md)     | SM-CAND-002           |
| [state-transition-register.md](08-state-machines/state-transition-register.md)         | 48 TR-CAND            |
| [transition-guard-register.md](08-state-machines/transition-guard-register.md)         | 28 GUARD              |
| [state-event-timestamp-matrix.md](08-state-machines/state-event-timestamp-matrix.md)   | STATE/EVENT/TIMESTAMP |
| [cross-lifecycle-dependencies.md](08-state-machines/cross-lifecycle-dependencies.md)   | 14 XLC                |
| [prompt-07-completeness-report.md](08-state-machines/prompt-07-completeness-report.md) | Relatório             |

## 09-authorization

Autorização empresarial e segregação (Prompt 08). Índice: [09-authorization/README.md](09-authorization/README.md).

| Arquivo                                                                               | Conteúdo          |
| ------------------------------------------------------------------------------------- | ----------------- |
| [actor-register.md](09-authorization/actor-register.md)                               | 12 ACT            |
| [business-role-candidates.md](09-authorization/business-role-candidates.md)           | 16 ROLE-CAND      |
| [command-authorization-matrix.md](09-authorization/command-authorization-matrix.md)   | CMD × autorização |
| [segregation-of-duties-matrix.md](09-authorization/segregation-of-duties-matrix.md)   | 12 SOD            |
| [sensitive-data-access-matrix.md](09-authorization/sensitive-data-access-matrix.md)   | Dados restritos   |
| [prompt-08-completeness-report.md](09-authorization/prompt-08-completeness-report.md) | Relatório         |

## 10-architecture

Drivers, opções e ADRs fundamentais (Prompt 09). Índice: [10-architecture/README.md](10-architecture/README.md).

| Arquivo                                                                              | Conteúdo              |
| ------------------------------------------------------------------------------------ | --------------------- |
| [architecture-drivers.md](10-architecture/architecture-drivers.md)                   | 22 ARCH-DRV           |
| [architecture-options-analysis.md](10-architecture/architecture-options-analysis.md) | Comparação de estilos |
| [logical-architecture.md](10-architecture/logical-architecture.md)                   | Visão lógica          |
| [adr-index.md](10-architecture/adr-index.md)                                         | 6 ADRs                |
| [prompt-09-completeness-report.md](10-architecture/prompt-09-completeness-report.md) | Relatório             |

## 11-technology

Seleção de stack (Prompt 10). Índice: [11-technology/README.md](11-technology/README.md).

| Arquivo                                                                            | Conteúdo            |
| ---------------------------------------------------------------------------------- | ------------------- |
| [decision-scorecard.md](11-technology/decision-scorecard.md)                       | Scorecard ponderado |
| [version-policy.md](11-technology/version-policy.md)                               | Versões e política  |
| [compatibility-matrix.md](11-technology/compatibility-matrix.md)                   | Compatibilidade     |
| [adr/](11-technology/adr/)                                                         | ADR-TECH-001..007   |
| [prompt-10-completeness-report.md](11-technology/prompt-10-completeness-report.md) | Relatório           |

## 12-domain-model

Modelo conceitual e aggregates (Prompt 11). Índice: [12-domain-model/README.md](12-domain-model/README.md).

| Arquivo                                                                              | Conteúdo        |
| ------------------------------------------------------------------------------------ | --------------- |
| [conceptual-domain-model.md](12-domain-model/conceptual-domain-model.md)             | Visão + Mermaid |
| [aggregate-candidates.md](12-domain-model/aggregate-candidates.md)                   | 14 AGG-CAND     |
| [aggregate-invariant-matrix.md](12-domain-model/aggregate-invariant-matrix.md)       | INV × AGG       |
| [cardinality-decisions-pending.md](12-domain-model/cardinality-decisions-pending.md) | 12 CARD-DDP     |
| [prompt-11-completeness-report.md](12-domain-model/prompt-11-completeness-report.md) | Relatório       |

## 13-data-model

Modelo lógico relacional e constraints candidatas (Prompt 12). Índice: [13-data-model/README.md](13-data-model/README.md).

| Arquivo                                                                            | Conteúdo      |
| ---------------------------------------------------------------------------------- | ------------- |
| [table-candidates.md](13-data-model/table-candidates.md)                           | 25 TBL-CAND   |
| [uniqueness-constraints.md](13-data-model/uniqueness-constraints.md)               | 16 UNQ-CAND   |
| [check-constraints.md](13-data-model/check-constraints.md)                         | 14 CHK-CAND   |
| [erd-candidate.md](13-data-model/erd-candidate.md)                                 | ERD Mermaid   |
| [unresolved-cardinalities.md](13-data-model/unresolved-cardinalities.md)           | CARD-DDP → FK |
| [prompt-12-completeness-report.md](13-data-model/prompt-12-completeness-report.md) | Relatório     |

## 14-transaction-design

Transações, concorrência e idempotência (Prompt 13). Índice: [14-transaction-design/README.md](14-transaction-design/README.md).

| Arquivo                                                                                    | Conteúdo                    |
| ------------------------------------------------------------------------------------------ | --------------------------- |
| [use-case-transaction-matrix.md](14-transaction-design/use-case-transaction-matrix.md)     | Análise por comando crítico |
| [transaction-decisions.md](14-transaction-design/transaction-decisions.md)                 | 14 TXN-DEC                  |
| [outbox-pattern-assessment.md](14-transaction-design/outbox-pattern-assessment.md)         | Outbox PROPOSED             |
| [financial-race-analysis.md](14-transaction-design/financial-race-analysis.md)             | FINANCIAL_RACE              |
| [prompt-13-completeness-report.md](14-transaction-design/prompt-13-completeness-report.md) | Relatório                   |

## 15-security

Threat model e segurança (Prompt 14). Índice: [15-security/README.md](15-security/README.md).

| Arquivo                                                                          | Conteúdo      |
| -------------------------------------------------------------------------------- | ------------- |
| [threat-model-stride.md](15-security/threat-model-stride.md)                     | 36 SEC-THR    |
| [abuse-case-catalog.md](15-security/abuse-case-catalog.md)                       | 16 SEC-ABU    |
| [authorization-architecture.md](15-security/authorization-architecture.md)       | AuthZ backend |
| [security-decisions.md](15-security/security-decisions.md)                       | 16 SEC-DEC    |
| [residual-risks.md](15-security/residual-risks.md)                               | 14 SEC-RISK   |
| [prompt-14-completeness-report.md](15-security/prompt-14-completeness-report.md) | Relatório     |

## 16-testing

Arquitetura de testes (Prompt 15). Índice: [16-testing/README.md](16-testing/README.md).

| Arquivo                                                                         | Conteúdo     |
| ------------------------------------------------------------------------------- | ------------ |
| [requirement-test-traceability.md](16-testing/requirement-test-traceability.md) | 58 TEST-CAND |
| [quality-gates-pipeline.md](16-testing/quality-gates-pipeline.md)               | Gates CI     |
| [concurrency-tests.md](16-testing/concurrency-tests.md)                         | Corridas     |
| [database-constraint-tests.md](16-testing/database-constraint-tests.md)         | PG real      |
| [prompt-15-completeness-report.md](16-testing/prompt-15-completeness-report.md) | Relatório    |

## 17-bootstrap

Fundação técnica do monorepo (Prompt 16). Índice implícito em cada arquivo abaixo.

| Arquivo                                                                                    | Conteúdo                    |
| ------------------------------------------------------------------------------------------ | --------------------------- |
| [environment-prerequisites.md](17-bootstrap/environment-prerequisites.md)                | Node, pnpm, versões ADR     |
| [repository-structure.md](17-bootstrap/repository-structure.md)                            | Layout apps/packages        |
| [local-development.md](17-bootstrap/local-development.md)                                | Execução local              |
| [command-reference.md](17-bootstrap/command-reference.md)                                | Scripts raiz e pacotes      |
| [bootstrap-decisions.md](17-bootstrap/bootstrap-decisions.md)                              | BOOT-DEC-001..011           |
| [prompt-16-completeness-report.md](17-bootstrap/prompt-16-completeness-report.md)          | Relatório de completude     |

## 18-database-foundation

PostgreSQL local e persistência técnica (Prompt 17). Índice: [18-database-foundation/README.md](18-database-foundation/README.md).

| Arquivo                                                                                           | Conteúdo                |
| ------------------------------------------------------------------------------------------------- | ----------------------- |
| [local-postgresql.md](18-database-foundation/local-postgresql.md)                               | Docker Compose PG 18    |
| [connection-management.md](18-database-foundation/connection-management.md)                       | Pool `@cisne/database`  |
| [environment-variables.md](18-database-foundation/environment-variables.md)                     | `.env.example`          |
| [migration-workflow.md](18-database-foundation/migration-workflow.md)                           | drizzle-kit             |
| [safe-reset-procedure.md](18-database-foundation/safe-reset-procedure.md)                       | Reset volume local      |
| [prompt-17-completeness-report.md](18-database-foundation/prompt-17-completeness-report.md)     | Relatório               |

## inputs

Área segura para inclusão futura de fontes. Ver [inputs/README.md](inputs/README.md).

## templates

| Arquivo                                                                        | Uso                    |
| ------------------------------------------------------------------------------ | ---------------------- |
| [source-template.md](templates/source-template.md)                             | Nova fonte             |
| [business-rule-template.md](templates/business-rule-template.md)               | Nova regra             |
| [domain-decision-template.md](templates/domain-decision-template.md)           | Decisão de domínio     |
| [engineering-decision-template.md](templates/engineering-decision-template.md) | Decisão de engenharia  |
| [source-conflict-template.md](templates/source-conflict-template.md)           | Conflito de fonte      |
| [risk-template.md](templates/risk-template.md)                                 | Risco                  |
| [prompt-completion-template.md](templates/prompt-completion-template.md)       | Encerramento de prompt |
