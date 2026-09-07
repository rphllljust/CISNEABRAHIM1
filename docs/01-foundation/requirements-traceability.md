# Requirements traceability matrix

| Campo        | Valor                                                                                |
| ------------ | ------------------------------------------------------------------------------------ |
| Document ID  | RTM-001                                                                              |
| Policy       | [`../00-governance/traceability-policy.md`](../00-governance/traceability-policy.md) |
| Last updated | 2026-09-03 (SRC-008 autoridade operacional; PILOT EXIT READINESS snapshot) |
| Rule         | Colunas inaplicáveis = `TBD`. Proibido inventar para completar.                      |

Cadeia:

```text
SOURCE → EVIDENCE → BUSINESS RULE → FUNCTIONAL REQUIREMENT → NON-FUNCTIONAL REQUIREMENT → QUALITY SCENARIO → USE CASE → DOMAIN MODEL → ARCHITECTURE DECISION → IMPLEMENTATION → TEST → ACCEPTANCE
```

## Matriz atual

| SOURCE            | EVIDENCE                        | BUSINESS RULE               | FR                                           | UC                                   | DOMAIN MODEL | ADR           | IMPLEMENTATION | TEST  | ACCEPTANCE                                     |
| ----------------- | ------------------------------- | --------------------------- | -------------------------------------------- | ------------------------------------ | ------------ | ------------- | -------------- | ----- | ---------------------------------------------- |
| SRC-000           | Texto do Prompt 00 (governança) | — (não operacional)         | `TBD`                                        | `TBD`                                | `TBD`        | ED-001–ED-004 | Nenhuma        | N/A   | Quality gates Prompt 00                        |
| SRC-000           | Menção a solicitações e OS      | BR-001 `CANDIDATE`          | FR-008, FR-009                               | UC-005                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-010, AC-011, AC-012                         |
| SRC-001           | EV-028                          | BR-001 `CANDIDATE`          | FR-008, FR-009                               | UC-005                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-010, AC-011, AC-012                         |
| SRC-000 / SRC-001 | EV-055, EV-056                  | BR-002 `CANDIDATE`          | FR-029, FR-034                               | UC-017, UC-020                       | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-034, AC-040                                 |
| SRC-000 / SRC-001 | EV-002, EV-003                  | BR-003 `CANDIDATE`          | — (restrição de escopo)                      | —                                    | `TBD`        | `TBD`         | `TBD`          | `TBD` | —                                              |
| SRC-001           | EV-027, EV-028                  | BR-004 `CANDIDATE`          | FR-001, FR-008                               | UC-001                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-001, AC-002, AC-010                         |
| SRC-001           | EV-031, EV-032                  | BR-005 `PENDING_VALIDATION` | FR-002                                       | UC-001                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-003                                         |
| SRC-001           | EV-013, EV-036–EV-039           | BR-006 `CANDIDATE`          | FR-009, FR-010, FR-014, FR-017               | UC-005, UC-006, UC-008, UC-010       | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-011, AC-012, AC-013, AC-018, AC-019, AC-022 |
| SRC-001           | EV-042                          | BR-007 `CANDIDATE`          | FR-011                                       | UC-006                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-014, AC-015                                 |
| SRC-001           | EV-058, EV-059                  | BR-008 `CANDIDATE`          | FR-012, FR-029, FR-030, FR-033               | UC-017, UC-019                       | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-016, AC-034, AC-035, AC-039                 |
| SRC-001           | EV-062, EV-063                  | BR-009 `CANDIDATE`          | FR-034, FR-035, FR-036, FR-037               | UC-020, UC-021, UC-022               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-040, AC-041, AC-042, AC-043                 |
| SRC-001           | EV-064, EV-065                  | BR-010 `CANDIDATE`          | FR-027, FR-039                               | UC-016, UC-023                       | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-032, AC-045                                 |
| SRC-001           | EV-049–EV-051                   | BR-011 `CANDIDATE`          | FR-013, FR-024, FR-025                       | UC-007, UC-015                       | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-017, AC-029, AC-030                         |
| SRC-001           | EV-054, EV-055                  | BR-012 `CANDIDATE`          | FR-013, FR-023, FR-026                       | UC-007, UC-015                       | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-017, AC-028, AC-031                         |
| SRC-001           | EV-057, EV-058                  | BR-013 `CANDIDATE`          | FR-031                                       | UC-018                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-036                                         |
| SRC-001           | EV-074                          | BR-014 `CANDIDATE`          | FR-038                                       | UC-023                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-044                                         |
| SRC-001           | EV-081                          | BR-015 `CANDIDATE`          | FR-039                                       | UC-023                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-045                                         |
| SRC-001           | EV-082                          | BR-016 `CANDIDATE`          | FR-041, FR-042                               | UC-025                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-047, AC-048, AC-049, AC-050                 |
| SRC-001           | EV-053                          | BR-017 `CANDIDATE`          | FR-025, FR-028                               | UC-015                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-030, AC-033                                 |
| SRC-001           | EV-061                          | BR-018 `CANDIDATE`          | FR-031, FR-032                               | UC-018                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-036, AC-037, AC-038                         |
| SRC-001           | EV-078                          | BR-019 `CANDIDATE`          | FR-015, FR-016                               | UC-009                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-020, AC-021                                 |
| SRC-001           | EV-080, EV-082                  | BR-020 `CANDIDATE`          | FR-042                                       | UC-025                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-049, AC-050                                 |
| SRC-001           | EV-084                          | BR-021 `PENDING_VALIDATION` | FR-015, FR-016                               | UC-009                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-020, AC-021                                 |
| SRC-001           | EV-075, EV-076                  | BR-022 `CANDIDATE`          | RPT-REQ-001..012 (transversal)               | UC-026                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | —                                              |
| SRC-001           | EV-078                          | BR-023 `CANDIDATE`          | FR-022, FR-032                               | UC-014                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-027, AC-037, AC-038, AC-051                 |
| SRC-001           | EV-012–EV-026                   | BR-024 `CANDIDATE`          | FR-001, FR-003–FR-007, FR-018–FR-021, FR-040 | UC-001–UC-004, UC-010–UC-013, UC-024 | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-001–AC-009, AC-023–AC-026, AC-046, AC-052   |
| SRC-001           | EV-041                          | BR-025 `CANDIDATE`          | FR-010                                       | UC-006                               | `TBD`        | `TBD`         | `TBD`          | `TBD` | AC-013                                         |

Registro completo de evidências: [`../02-source-analysis/atomic-evidence-register.md`](../02-source-analysis/atomic-evidence-register.md) (84 entradas).

Fontes primárias (`NOT_PROVIDED`): sem linhas adicionais.

## Resumo Prompt 02

| Métrica                    | Valor                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Requisitos funcionais (FR) | 42 (FR-001..FR-042)                                                                                          |
| Casos de uso (UC)          | 26 (UC-001..UC-026)                                                                                          |
| Critérios de aceite (AC)   | 52 (AC-001..AC-052)                                                                                          |
| Regras CONFIRMED           | **0**                                                                                                        |
| BR com FR vinculado        | 24 de 25 (BR-003 = restrição de escopo sem FR dedicado)                                                      |
| Status dominante dos FRs   | `PENDING_SOURCE_VALIDATION` (27), `PENDING_BUSINESS_DECISION` (15)                                           |
| Artefatos adicionais       | VR-022, AUTH-REQ-020, DR-028, DOC-REQ-014, NOTIF-REQ-010, INT-REQ-008, RPT-REQ-012, EX-018, RQ-QUESTION-025  |
| Índice completo            | [`../03-requirements/README.md`](../03-requirements/README.md)                                               |
| Relatório de completude    | [`../03-requirements/prompt-02-completeness-report.md`](../03-requirements/prompt-02-completeness-report.md) |

Implementação, modelo de domínio, ADR operacionais e testes: **não iniciados** (Prompt 04+).

## Resumo Prompt 03

| Métrica                           | Valor                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Requisitos não funcionais (NFR)   | 40 (NFR-001..NFR-040)                                                                                                    |
| Cenários de qualidade (QA-SC)     | 28 (QA-SC-001..QA-SC-028)                                                                                                |
| Requisitos de segurança (SEC-REQ) | 24                                                                                                                       |
| Questões abertas NFR (NFNQ)       | 18                                                                                                                       |
| NFR CONFIRMED                     | **0**                                                                                                                    |
| NFR com target numérico           | **0**                                                                                                                    |
| RPO / RTO                         | TARGET_NOT_DEFINED (DDP-016)                                                                                             |
| Índice completo                   | [`../04-quality-attributes/README.md`](../04-quality-attributes/README.md)                                               |
| Relatório de completude           | [`../04-quality-attributes/prompt-03-completeness-report.md`](../04-quality-attributes/prompt-03-completeness-report.md) |

### Amostra NFR na matriz

| SOURCE  | EVIDENCE | FR     | NFR              | QA-SC     | RISK     | DDP     |
| ------- | -------- | ------ | ---------------- | --------- | -------- | ------- |
| SRC-001 | EV-079   | FR-022 | NFR-001, NFR-006 | QA-SC-001 | RISK-003 | DDP-037 |
| SRC-001 | EV-028   | FR-009 | NFR-003          | QA-SC-003 | RISK-004 | DDP-002 |
| SRC-001 | EV-061   | FR-032 | NFR-008          | QA-SC-008 | RISK-020 | DDP-030 |
| SRC-001 | EV-083   | —      | NFR-025..028     | QA-SC-021 | RISK-011 | DDP-016 |
| SRC-001 | EV-077   | FR-030 | NFR-012          | QA-SC-012 | RISK-010 | DDP-014 |

Matriz completa: [`../04-quality-attributes/nfr-risk-traceability.md`](../04-quality-attributes/nfr-risk-traceability.md).

## Resumo Prompt 04

| Métrica                          | Valor                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Termos de glossário (TERM)       | 48 (TERM-001..TERM-048)                                                                                                    |
| CONFIRMED                        | **0**                                                                                                                      |
| ACCEPTED_FOR_DOCUMENTATION       | 24                                                                                                                         |
| AMBIGUOUS                        | 18                                                                                                                         |
| PENDING_BUSINESS_DECISION        | 6                                                                                                                          |
| Questões abertas glossário (GLQ) | 12                                                                                                                         |
| Índice                           | [`../05-ubiquitous-language/README.md`](../05-ubiquitous-language/README.md)                                               |
| Relatório                        | [`../05-ubiquitous-language/prompt-04-completeness-report.md`](../05-ubiquitous-language/prompt-04-completeness-report.md) |
| Auditoria                        | [`../05-ubiquitous-language/language-consistency-audit.md`](../05-ubiquitous-language/language-consistency-audit.md)       |

Cadeia estendida: `SOURCE → EVIDENCE → TERM → BR → FR → NFR → UC → DDP → FUTURE TEST (TBD)`.

## Resumo Prompt 05

| Métrica                               | Valor                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Subdomínios (SUBD)                    | 12 (SUBD-001..SUBD-012)                                                                                                |
| Bounded contexts candidatos (BC-CAND) | 18 (BC-CAND-001..018)                                                                                                  |
| CORE_CANDIDATE (subdomínio)           | 4                                                                                                                      |
| Capacidades mapeadas                  | 27/27                                                                                                                  |
| Decisões fronteira (DBND)             | 12                                                                                                                     |
| Microserviços / implementação         | **0**                                                                                                                  |
| Índice                                | [`../06-domain-boundaries/README.md`](../06-domain-boundaries/README.md)                                               |
| Relatório                             | [`../06-domain-boundaries/prompt-05-completeness-report.md`](../06-domain-boundaries/prompt-05-completeness-report.md) |

Cadeia Prompt 05:

```text
CAPABILITY → SUBDOMAIN → BOUNDED CONTEXT CANDIDATE
BR / FR / UC → CONTEXT OWNER
DATA → AUTHORITATIVE CONTEXT
COMMAND / EVENT → CONTEXT OWNER
```

Matriz CAP→BC: [`../06-domain-boundaries/capability-to-context-matrix.md`](../06-domain-boundaries/capability-to-context-matrix.md).

## Resumo Prompt 06

| Métrica                          | Valor                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Invariantes (INV)                | 22 (INV-001..INV-022)                                                                                              |
| Comandos (CMD)                   | 22 (CMD-001..CMD-022)                                                                                              |
| Eventos domínio (DE)             | 20 (DE-001..DE-020)                                                                                                |
| Rejeições (REJ)                  | 18                                                                                                                 |
| Predicados (PRED)                | 12                                                                                                                 |
| INV CONFIRMED                    | **0**                                                                                                              |
| Aggregates / estados definitivos | **0**                                                                                                              |
| Índice                           | [`../07-domain-behavior/README.md`](../07-domain-behavior/README.md)                                               |
| Relatório                        | [`../07-domain-behavior/prompt-06-completeness-report.md`](../07-domain-behavior/prompt-06-completeness-report.md) |

Cadeia Prompt 06:

```text
EV → BR → FR/UC → INV → CMD → DE / REJ
```

## Resumo Prompt 07

| Métrica                         | Valor                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Máquinas candidatas (SM-CAND)   | 10                                                                                                               |
| Estados candidatos (STATE-CAND) | 52                                                                                                               |
| Transições candidatas (TR-CAND) | 48                                                                                                               |
| Guardas (GUARD)                 | 28                                                                                                               |
| Transições inválidas (INV-TR)   | 22                                                                                                               |
| Dependências cruzadas (XLC)     | 14                                                                                                               |
| SM definitivas                  | **0**                                                                                                            |
| Código / enum / script          | **0**                                                                                                            |
| Índice                          | [`../08-state-machines/README.md`](../08-state-machines/README.md)                                               |
| Relatório                       | [`../08-state-machines/prompt-07-completeness-report.md`](../08-state-machines/prompt-07-completeness-report.md) |

Cadeia Prompt 07:

```text
INV → CMD → DE → SM-CAND → STATE-CAND → TR-CAND → GUARD
```

## Resumo Prompt 08

| Métrica                       | Valor                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Atores (ACT)                  | 12                                                                                                             |
| Papéis candidatos (ROLE-CAND) | 16                                                                                                             |
| Regras autorização (AUTHZ)    | 42                                                                                                             |
| Segregação (SOD)              | 12                                                                                                             |
| Ações sensíveis               | 28                                                                                                             |
| Decisões pendentes (ADP)      | 14                                                                                                             |
| Roles técnicas / código       | **0**                                                                                                          |
| Índice                        | [`../09-authorization/README.md`](../09-authorization/README.md)                                               |
| Relatório                     | [`../09-authorization/prompt-08-completeness-report.md`](../09-authorization/prompt-08-completeness-report.md) |

Cadeia Prompt 08:

```text
ACT → ROLE-CAND → AUTHZ → CMD/TR → SOD → DENY → SEC-REQ
```

## Resumo Prompt 09

| Métrica                          | Valor                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Drivers arquiteturais (ARCH-DRV) | 22                                                                                                           |
| ADRs                             | 6 (2 ACCEPTED, 4 PROPOSED)                                                                                   |
| Riscos arquiteturais (ARCH-RISK) | 14                                                                                                           |
| Decisões pendentes (ARCH-DDP)    | 12                                                                                                           |
| Estilo candidato                 | Modular monolith                                                                                             |
| Framework / código               | **0**                                                                                                        |
| Índice                           | [`../10-architecture/README.md`](../10-architecture/README.md)                                               |
| Relatório                        | [`../10-architecture/prompt-09-completeness-report.md`](../10-architecture/prompt-09-completeness-report.md) |

Cadeia Prompt 09:

```text
NFR/SEC/RISK → ARCH-DRV → OPTIONS → ADR → LOGICAL ARCH → BC MODULES
```

## Resumo Prompt 10

| Métrica                        | Valor                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| ADR-TECH                       | 7 (todos ACCEPTED)                                                                                       |
| Drivers scorecard              | 11 critérios                                                                                             |
| TECH-RISK                      | 12                                                                                                       |
| TECH-DDP                       | 9                                                                                                        |
| package.json / deps instaladas | **0**                                                                                                    |
| Índice                         | [`../11-technology/README.md`](../11-technology/README.md)                                               |
| Relatório                      | [`../11-technology/prompt-10-completeness-report.md`](../11-technology/prompt-10-completeness-report.md) |

Stack documentada:

```text
Node 24 LTS · TypeScript 5 · NestJS 11 · React 19 · Vite 7 · PostgreSQL 18 · Drizzle · pnpm · Turborepo · Vitest · Playwright
```

Cadeia Prompt 10:

```text
ARCH-DRV → SCORECARD → ADR-TECH → COMPATIBILITY / VERSION-POLICY
```

## Resumo Prompt 11

| Métrica                             | Valor                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Aggregates candidatos (AGG-CAND)    | 14                                                                                                           |
| ACCEPTED_FOR_LOGICAL_MODELING       | 4                                                                                                            |
| Entidades (ENTITY-CAND)             | 26                                                                                                           |
| Value objects (VO-CAND)             | 22                                                                                                           |
| Cardinalidades pendentes (CARD-DDP) | 12                                                                                                           |
| Invariantes mapeadas                | 22/22                                                                                                        |
| ORM / tabelas / código              | **0**                                                                                                        |
| Índice                              | [`../12-domain-model/README.md`](../12-domain-model/README.md)                                               |
| Relatório                           | [`../12-domain-model/prompt-11-completeness-report.md`](../12-domain-model/prompt-11-completeness-report.md) |

Cadeia Prompt 11:

```text
TERM → ENTITY/VO → AGG-CAND → INV → CMD → SM-CAND
```

## Resumo Prompt 12

| Métrica                             | Valor                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Tabelas candidatas (TBL-CAND)       | 25                                                                                                       |
| Unicidade candidata (UNQ-CAND)      | 16                                                                                                       |
| Check constraints (CHK-CAND)        | 14                                                                                                       |
| FK candidatas                       | 32                                                                                                       |
| INDEX_HYPOTHESIS                    | 18                                                                                                       |
| Cardinalidades pendentes (CARD-DDP) | 12 (herdadas)                                                                                            |
| Riscos (DATA-RISK)                  | 12                                                                                                       |
| DDL / migrations / banco            | **0**                                                                                                    |
| Índice                              | [`../13-data-model/README.md`](../13-data-model/README.md)                                               |
| Relatório                           | [`../13-data-model/prompt-12-completeness-report.md`](../13-data-model/prompt-12-completeness-report.md) |

Cadeia Prompt 12:

```text
AGG-CAND → TBL-CAND → UNQ/CHK/FK → INV → INDEX_HYPOTHESIS
```

## Resumo Prompt 13

| Métrica                          | Valor                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Comandos críticos analisados     | 11                                                                                                                       |
| Decisões transacionais (TXN-DEC) | 14                                                                                                                       |
| Cenários falha (TXN-FAIL)        | 24                                                                                                                       |
| Cenários teste (TXN-TEST)        | 18                                                                                                                       |
| Operações FINANCIAL_RACE         | 6                                                                                                                        |
| Outbox                           | PROPOSED (não ACCEPTED)                                                                                                  |
| Código / migrations / filas      | **0**                                                                                                                    |
| Índice                           | [`../14-transaction-design/README.md`](../14-transaction-design/README.md)                                               |
| Relatório                        | [`../14-transaction-design/prompt-13-completeness-report.md`](../14-transaction-design/prompt-13-completeness-report.md) |

Cadeia Prompt 13:

```text
CMD → boundary → isolation/lock → idempotency → external effect → reconcile
```

## Resumo Prompt 14

| Métrica                     | Valor                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Ativos (SEC-AST)            | 18                                                                                                   |
| Ameaças STRIDE (SEC-THR)    | 36                                                                                                   |
| Casos de abuso (SEC-ABU)    | 16                                                                                                   |
| Decisões (SEC-DEC)          | 16                                                                                                   |
| Riscos residuais (SEC-RISK) | 14                                                                                                   |
| Cenários teste (SEC-TEST)   | 22                                                                                                   |
| Fluxos modelados            | 8                                                                                                    |
| Código                      | **0**                                                                                                |
| Índice                      | [`../15-security/README.md`](../15-security/README.md)                                               |
| Relatório                   | [`../15-security/prompt-14-completeness-report.md`](../15-security/prompt-14-completeness-report.md) |

Cadeia Prompt 14:

```text
SEC-AST → boundary → STRIDE → SEC-CTL → SEC-TEST → SEC-RISK residual
```

## Resumo Prompt 15

| Métrica           | Valor                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| TEST-CAND         | 58                                                                                                 |
| INV cobertos      | 22/22                                                                                              |
| TXN-TEST mapeados | 18/18                                                                                              |
| SEC-TEST mapeados | 22/22                                                                                              |
| Gaps requisitos   | 6                                                                                                  |
| Código de teste   | **0**                                                                                              |
| Índice            | [`../16-testing/README.md`](../16-testing/README.md)                                               |
| Relatório         | [`../16-testing/prompt-15-completeness-report.md`](../16-testing/prompt-15-completeness-report.md) |

Cadeia Prompt 15:

```text
RISK/INV → TEST-CAND → nível (L1|L3|L4|L6) → gate CI
```

## Resumo Prompt 16

| Métrica              | Valor                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Apps scaffold        | 2 (`@cisne/api`, `@cisne/web`)                                                                       |
| Pacotes compartilhados | 2 (`@cisne/tsconfig`, `@cisne/eslint-config`)                                                      |
| Endpoint técnico     | `GET /health`                                                                                        |
| Testes fundação      | 2                                                                                                    |
| Módulos empresariais | **0**                                                                                                |
| Tabelas empresariais | **0**                                                                                                |
| ADRs implementados   | ADR-TECH-001, 002, 003, 006, 007                                                                     |
| ADRs adiados        | ADR-TECH-004, 005 (Prompt 17)                                                                        |
| Índice               | [`../17-bootstrap/`](../17-bootstrap/)                                                               |
| Relatório            | [`../17-bootstrap/prompt-16-completeness-report.md`](../17-bootstrap/prompt-16-completeness-report.md) |

Cadeia Prompt 16:

```text
ADR-TECH → monorepo → lint/typecheck/test/build → health técnico → (sem domínio)
```

## Resumo Prompt 17

| Métrica              | Valor                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| PostgreSQL           | 18.x (Docker local)                                                                                        |
| ORM / migrations     | Drizzle + drizzle-kit                                                                                      |
| Pacote               | `@cisne/database`                                                                                        |
| Migrations técnicas  | 1                                                                                                          |
| Tabelas empresariais | **0**                                                                                                      |
| Health DB            | `GET /health` → `database.status`                                                                          |
| Índice               | [`../18-database-foundation/README.md`](../18-database-foundation/README.md)                              |
| Relatório            | [`../18-database-foundation/prompt-17-completeness-report.md`](../18-database-foundation/prompt-17-completeness-report.md) |

Cadeia Prompt 17:

```text
ADR-TECH-004/005 → Docker PG → Drizzle migrate → health + integração → (sem domínio)
```

## Release 1 — escopo fechado (2026-09-02)

| SOURCE                         | EVIDENCE                                      | BUSINESS RULE        | IMPLEMENTATION                         | TEST                                      | ACCEPTANCE                          |
| ------------------------------ | --------------------------------------------- | -------------------- | -------------------------------------- | ----------------------------------------- | ----------------------------------- |
| Prompt autorizado 2026-09-02   | R1-SCOPE-001; DDP-026 ANSWERED (fatia R1)     | BR-026 (clientes PJ) | flags fail-closed + guard API + nav    | feature-flags.spec; release-scope.guard   | módulos R1 visíveis; demais 403     |
| SRC-002 Q01                    | Clientes PJ no R1                             | BR-026 CONFIRMED     | clientes permanece IN_RELEASE_1        | suítes clientes existentes                | sem CRM/ERP                         |
| DDP-023                        | BillingDocument ≠ FiscalDocument              | — (distinção)        | faturamento interno; fiscal flag off   | billing-document-preview; feature-flags   | copy e 403 fiscal                   |

Registro: [`release-1-closed-scope.md`](release-1-closed-scope.md). ED-005. Não amplia FR/UC.

## Correção das suítes unitárias — 2026-09-02

Classificação: **correção de engenharia e de evidência de teste**. Nenhuma regra empresarial nova foi criada ou confirmada.

| ORIGEM | DISTINÇÃO / DECISÃO | IMPLEMENTAÇÃO AFETADA | TESTE / GATE | RESULTADO |
| ------ | ------------------- | --------------------- | ------------ | --------- |
| DDP-023; R1-SCOPE-001 | `BillingDocument` interno ≠ documento fiscal oficial | título `Faturamento interno` e asserção E2E correspondente | `billing.e2e.test.tsx`; regressão web | 349/349 PASS |
| ED-005 | Flags de módulos fora da Release 1 permanecem fail-closed | remoção de type assertion redundante, sem mudança de lógica | `feature-flags.test.ts`; lint e typecheck web | PASS |
| ADR-TECH-007 | Vitest protege regras; ESLint/TypeScript compõem o gate | narrowing nativo de `error.code` no teste de posting | lint e typecheck API | PASS |

Evidência unitária consolidada: API 736/736, database 21/21 e web 349/349; total 1.106/1.106. A suíte de integração PostgreSQL em execução separada não integra esta evidência unitária.

## Validação cirúrgica de integração — 2026-09-02

Classificação: **evidência de engenharia**, sem alteração de implementação e sem nova confirmação empresarial.

| ESCOPO VALIDADO | TESTE / GATE | RESULTADO |
| --------------- | ------------ | --------- |
| Integridade empresarial, forecast de caixa, tesouraria e infraestrutura PostgreSQL | 4 arquivos de integração, 17 cenários | 17/17 PASS |
| Regras unitárias de tesouraria | `treasury.spec.ts` | 6/6 PASS |
| Nove arquivos pendentes da correção de integração | ESLint direcionado; typecheck API; `git diff --check` | PASS |

As nove alterações de implementação já existentes foram apenas inspecionadas e preservadas; esta validação não as classifica como nova regra empresarial.

## Debug cirúrgico do forecast — 2026-09-02

Classificação: **correção de engenharia de teste**. O contrato produtivo de abertura de conta foi preservado; nenhuma regra empresarial nova foi criada.

| ORIGEM | CAUSA | CORREÇÃO | TESTE / GATE | RESULTADO |
| ------ | ----- | -------- | ------------ | --------- |
| ADR-003; registro `CASH FLOW FORECAST` | fixture precisava de movimento realizado anterior ao `asOf`, mas a tentativa inicial ampliava a entrada pública de abertura de conta com `openingOccurredAt` | fixture passou a usar `postMovement` com origem `MANUAL_AUTHORIZED` e `occurredAt`, contrato já existente | forecast + treasury integration | 11/11 PASS |
| ADR-TECH-007 | pools e módulos de testes precisavam encerrar entre arquivos serializados | teardown explícito no harness/serializer, sem alteração funcional | enterprise integrity + database integration | 6/6 PASS |
| Estratégia L1/L3 | regressão de domínio financeiro | unit forecast + treasury; lint; typecheck; diff check | 9/9 PASS; gates PASS |

Resultado estrutural: zero arquivo funcional alterado em `apps/api/src/finance`; somente teste e harness permanecem no diff desta correção.

## Debug completo de integração — 2026-09-02

Classificação: **correção de engenharia**. Interpretação: `asOf` do forecast é data civil UTC, igual a `asCashForecastIsoDate` e ao recorte de conciliação bancária. Nenhuma regra empresarial nova foi confirmada.

| ORIGEM | CAUSA | CORREÇÃO | TESTE / GATE | RESULTADO |
| ------ | ----- | -------- | ------------ | --------- |
| registro `CASH FLOW FORECAST`; evidência terminal 101420 | `openingAmount` persiste `occurred_at = now()`; `asOf` histórico exclui o crédito e o saldo realizado fica `0` | recorte `(occurred_at AT TIME ZONE 'UTC')::date`; regressão opening-now vs crédito datado | `cash-flow-forecast.integration.spec.ts` 4/4; unit 3/3; treasury 8/8 | PASS |
| schema `pty` (`clients.ts`, `suppliers.ts`); evidência terminal 101420 | allowlist do probe ainda era só clientes; `supplier_addresses` e demais `supplier_*` falhavam o `toContain` | conjunto exato das 7 tabelas `pty` | `database.integration.spec.ts` 4/4 | PASS |
| ADR-TECH-007; evidência terminal 101421 | `afterAll` chamava `endTrackedTestDatabasePools` inexistente | confirmação: serializer em HEAD só encerra o pool do lock; 34 suítes eram o mesmo TypeError | enterprise integrity 3/3; serializer sem a chamada | PASS |

## Validação da suíte de integração e flake de outbox — 2026-09-02

Classificação: **correção de isolamento de teste**. O poller produtivo do outbox permanece enabled-unless-false. Nenhuma regra empresarial nova.

| ORIGEM | CAUSA | CORREÇÃO | TESTE / GATE | RESULTADO |
| ------ | ----- | -------- | ------------ | --------- |
| outbox transactional; evidência suíte 79 arquivos | `module.init()` ligava `OutboxPublisherWorkerService`, que disputava `claimPending` com o `publishBatch` do teste e deixava `PROCESSING` | `OUTBOX_PUBLISHER_ENABLED=false` no describe de chaos; stop + restore no afterAll | chaos-recovery + transactional-outbox, 3× 20/20 | PASS |
| débito da etapa anterior | suíte cheia não tinha sido reexecutada após o debug de forecast/pty | reexecução 79 arquivos | 78/79; única falha = flake acima | evidência usada para o debug |

## Reexecução da suíte de integração após isolamento do poller — 2026-09-03

Classificação: **evidência de engenharia**. Nenhuma alteração de implementação nesta etapa.

| ESCOPO VALIDADO | TESTE / GATE | RESULTADO |
| --------------- | ------------ | --------- |
| Suíte de integração API após isolamento do poller de outbox | 79 arquivos, 617 cenários | 79/79 PASS; 617/617 PASS; 2237.73s; exit 0 |

## Debug fullstack do backoffice financeiro — 2026-09-03

Classificação: **correção de engenharia de UI**. Frontend não é boundary de segurança. Nenhuma regra empresarial nova.

| ORIGEM | CAUSA | CORREÇÃO | TESTE / GATE | RESULTADO |
| ------ | ----- | -------- | ------------ | --------- |
| ADR-TECH-007; UI finance | `MoneyActionForm` liberava `inflight` no `finally` após 409; segundo clique no diálogo reenviava settle | lock permanece em `version_conflict` até cancelar/recarregar; `confirmDisabled` | `finance-backoffice.ui.test.tsx` 3× 9/9; `financial-ui.test.ts` 3× 2/2 | PASS |
| suítes unitárias pós-integração | regressão estática/unitária | reexecução sem alteração de domínio | API 736/736; database 21/21; web 348/349 antes da correção | PASS com 1 falha isolada e corrigida |

## Boundary de double POST financeiro — 2026-09-03

Classificação: **evidência de engenharia**. Nenhuma alteração de implementação. Frontend não é boundary.

| ORIGEM | CAUSA | CORREÇÃO | TESTE / GATE | RESULTADO |
| ------ | ----- | -------- | ------------ | --------- |
| settle/pay; incidente UI de double-submit | replay existente usava `rowVersion` já incrementado; o double POST real reenvia a versão original | specs com a mesma `idempotency_key` + `rowVersion` original, sequencial e concorrente | receivables 13/13; payables 15/15 | PASS |

## SRC-003 — cadastro da operadora — 2026-09-03

Classificação: **fato empresarial declarado**. Não é regra `CONFIRMED`. Não fecha DDP-023 residual. Não autoriza emissão oficial nem exit do piloto.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| SRC-003 | CNPJ 11.897.171/0001-81; razão social + EPP; situação Ativa; abertura 05/05/2010; Porto Velho - RO; e-mail e telefone | — (não operacional isoladamente; confirma identidade SRC-002) | nenhum código alterado | N/A | registro em `source-registry.md`; sem gateway SEFAZ |
| SRC-002 ∩ SRC-003 | mesmo CNPJ da operadora | BR-032 (CISNE ≠ Client) permanece | emitente interno já usava este CNPJ | N/A | operadora não cadastrada como Client |

## SRC-004 — sistema centralizado sem ERP — 2026-09-03

Classificação: **fato empresarial / decisão**. Recorte: sem conexão ERP; CISNE centralizado. Não fecha DDP-023 residual. Não autoriza emissão oficial nem exit do piloto.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| SRC-004 | texto verbatim do responsável: sem ERP; sistema centralizado | BR-042 `CONFIRMED` | nenhum código alterado; ACL ERP permanece desligada | N/A | registro em `source-registry.md`; SC-001 `RESOLVED` |
| SRC-002 Q04 ∩ SRC-004 | SoT híbrido / ERP opcional futuro vs sem conexão | BR-030 e BR-031 permanecem; parte ERP futuro substituída | `externalErpId` defensivo, nunca PK | N/A | DDP-014 recorte ERP `REJECTED`; DDP-020 reforçado |

## SRC-005/SRC-006 — consultas cadastrais federal e estadual — 2026-09-03

Classificação: **fatos cadastrais em snapshots fornecidos**. Não são requisitos fiscais normativos e não autorizam emissão oficial nem exit do piloto.

| SOURCE | EVIDENCE | BUSINESS RULE / DECISION | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------------------ | -------------- | ---- | ---------- |
| SRC-005, páginas 1–3 | CNPJ, nome empresarial, EPP como porte, abertura, endereço, contato, situação ATIVA, 1 CNAE principal + 48 secundários | Nenhuma regra nova; corrobora identidade SRC-002/SRC-003 | Catálogo de 49 CNAEs já coincidia; nenhuma ampliação de escopo | `cisne-service-portfolio-baseline.spec.ts` | Conjunto cadastral confrontado; autenticidade não reconsultada on-line |
| SRC-006, páginas 1–2 | IE, NIRE, endereço, status estadual, início estadual, regime exibido e mesmos 49 CNAEs | DDP-023 permanece `PARTIALLY_ANSWERED`; RISK-025 `OPEN` | Nenhum cálculo tributário ou gateway ativado | N/A | Campos vazios não tratados como ausência; anomalias de renderização registradas |
| SRC-005 ∩ SRC-006 | Rua dos Farrapos, 5000, São Francisco, CEP 76813-284 | Fato cadastral corroborado | Configuração do emitente de faturamento interno corrigida; disclaimer não fiscal preservado | testes direcionados de billing API/web | Documento interno exibe endereço cadastral sem se declarar fiscal |
| SRC-006, página 1 | Situação NF-e `NÃO CREDENCIADO` em 03/09/2026 | DDP-023 residual `OPEN`; RISK-012/RISK-025; SRC-007 / BR-043 | `FEATURE_MODULE_FISCAL` e gateway permanecem desligados | gate de feature flags/readiness | Produção continua `NO-GO`; nenhuma inferência sobre NFS-e |

## SRC-007 — gates de transmissão NF-e, autorização e legendas DANFE — 2026-09-03

Classificação: **fato empresarial / decisão**. Recorte: credenciamento, protocolo SEFAZ e legendas. Não fecha DDP-023 residual tributário. Não autoriza emissão oficial nem exit do piloto.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| SRC-007 | texto verbatim: transmissão `BLOCKED` sem credenciamento aprovado | BR-043 `CONFIRMED` | `Src006FiscalCredentialing` fail-closed; `assertFiscalTransmissionAllowed` antes do gateway | `fiscal-credentialing.spec`; `fiscal.integration` transmission blocked | `FEATURE_MODULE_FISCAL` permanece off; SRC-006 `NÃO CREDENCIADO` |
| SRC-007 | texto verbatim: sem protocolo SEFAZ, `fiscalStatus` ≠ `AUTHORIZED` e DANFE oficial `BLOCKED` | BR-044 `CONFIRMED` | `assertOfficialAuthorizationAllowed` antes de persistir `AUTHORIZED` | `fiscal.integration` refuse AUTHORIZED without protocol | DDP-023 residual tributário `OPEN` |
| SRC-007 | legendas DRAFT / HOMOLOGAÇÃO / PRODUÇÃO somente após autorização oficial | BR-045 `CONFIRMED` | `validityLegend` + `officialDanfe` no serializer e na UI gated | unit + `fiscal-backoffice.ui.test` | rascunho `SEM VALIDADE FISCAL`; DANFE oficial `BLOCKED` no default |
| SRC-006 ∩ SRC-007 | `NÃO CREDENCIADO` + transmissão exige credenciamento aprovado | BR-043 aplica o snapshot | gateway permanece unconfigured | N/A | nenhum `SC-*`; transmissão atual `BLOCKED` |

## Alinhamento SRC-002 com fontes posteriores — 2026-09-03

Classificação: **alinhamento documental**. Preencheu apenas células do questionário que já tinham fonte autorizada. Não inventou tipo de OS, gatilho de faturamento, maker-checker, PO nem medição. Não autoriza go-live.

| SOURCE | EVIDENCE | BUSINESS RULE / DECISION | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------------------ | -------------- | ---- | ---------- |
| DDP-026 | fatia R1 e verticais dedicadas fora | SRC-002 §2 e §20 alinhados | nenhum código alterado | N/A | módulos dedicados locação/transporte `OUT_OF_RELEASE_1` |
| DDP-020 + SRC-004 | CISNE SoT centralizado | SRC-002 §19 OS/PO/medição/documentos `CONFIRMED` CISNE | nenhum código alterado | N/A | pagamento/WhatsApp/NF oficial residuais explícitos |
| DDP-023 + SRC-007 + SRC-006 | Billing interno ≠ NF oficial; gates; `NÃO CREDENCIADO` | SRC-002 §14/§15 | nenhum código alterado | N/A | `FEATURE_MODULE_FISCAL` desligado; produção `NO-GO` |

## SRC-008 — autoridade operacional — 2026-09-03

Classificação: **fato empresarial / decisão**. Recorte: autoridade máxima equivalente, solicitação≠OS, máquina de estados/reabertura, PO configurável, medição real, desacoplamento de faturamento. Não fecha DDP-001 nem residual tributário de DDP-023. Não autoriza go-live.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| SRC-008 | duas autoridades máximas equivalentes; backend; sem SoD obrigatória entre elas | BR-046 `CONFIRMED` | capabilities `OPERATIONAL_AUTHORITY_ACTIONS`; grants UAT `control_admin`; PDP sem nomes | unit `operational-authority.spec`; integração deny third-party | DDP-015 parcial; DDP-022 `ANSWERED` |
| SRC-008 | solicitação ≠ OS; 1→N; WhatsApp = origem | BR-047 `CONFIRMED` | conversão adicional; unique OS×request removido | request reject sem OS; 2ª conversão | DDP-002/021 parciais |
| SRC-008 | estados, cancelamento sem apagar, reabertura com justificativa | BR-048 `CONFIRMED` | `POST .../reopen`; `status_before_cancel`; audit fields | reopen com/sem justificativa; cancel auditado | DDP-003/004/005 parciais |
| SRC-008 | PO não global; estouro bloqueado; override auditado | BR-049 `CONFIRMED` | `purchase_order_requirement`; `authorized_overrun_amount` | saldo suficiente; exceed; override | DDP-009 parcial |
| SRC-008 | medição = executado; recusa preservada; R1 mesma pessoa pode aprovar | BR-050 `CONFIRMED` | SoD R1 no-op; `resubmit` | reject+resubmit; same-person approve | DDP-010 parcial |
| SRC-008 | direito a faturar ≠ billing interno ≠ fiscal | BR-051 `CONFIRMED` | `billing_entitlement_policy`; measurement_id nullable | bloqueio sem medição aprovada; preço fixo | DDP-011 parcial; DDP-023 residual `OPEN` |

## Fechamento técnico dos núcleos operacionais — 2026-09-03

Classificação: **interpretação de engenharia** sobre regras já confirmadas. Não inventou campo comercial, renovação, SLA, ANTT, fiscal ou aceite do cliente. Não autoriza go-live.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| SRC-002 / BR-033, BR-034, BR-036 | cliente sem exclusão física; AuthZ backend; inativação | BR-033/034/036 | listagem por grant Client; `purchase_order_requirement` via API existente; `requireActive` | clients unit/integration/audit-closure | exclusão física continua ausente; inativação preferida |
| SRC-008 / BR-037, BR-046 | cliente ACTIVE na OS; autoridade operacional | BR-037/046 | `assertClientActive` na criação/atualização da OS; PDP classifica deny operacional como `SECURITY_CRITICAL` | SO create inactive; `operational-authority.spec` | intake sem cliente permanece permitido |
| SRC-008 / BR-047 | solicitação ≠ OS implícita | BR-047 | submit exige demanda mínima; convert exige grant | submit vazio; convert sem AuthZ | nenhuma OS implícita |
| modelo comercial existente | totais e quantidade | sem regra comercial nova | qty > 0; qty×preço=linha em proposta/PO | `proposal.validation.spec` | margem/desconto/imposto permanecem OPEN |
| DDP-026 | contratos/locação/transporte fora da R1 | DDP-026 | HTTP contratos continua fail-closed; operacional resolve referência quando existir | contracts integration | EXPIRED automático, renovação e ANTT permanecem OPEN |
| SRC-007 / DDP-023 | billing interno ≠ fiscal | BR-043..045 | `FEATURE_MODULE_FISCAL` fail-closed | `feature-flags.spec` | nenhuma autorização fiscal simulada |

## SOD hardening — 2026-09-03

Classificação: **interpretação de engenharia** (ED-006). Prompt 08 SOD-001..012 permanece CANDIDATE/PENDING. Nenhuma regra empresarial nova `CONFIRMED`. SRC-008 / BR-046 / BR-050 continuam a permitir as duas autoridades equivalentes na OS e na medição.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Pedido autorizado SOD HARDENING; Prompt 08 AUTHZ-SOD-001 | catálogo por capability/papel, sem nomes | SOD documental CANDIDATE; ED-006 | `SodEnforcementService` + matriz role/capability/scope | unit SOD; integração enforcement; HTTP e2e bypass | SOD: PASS; CRITICAL CONFLICTS: 0; AUTHORIZATION BYPASS: 0 |
| SRC-008 | BR-046 / BR-050 | CONFIRMED (exceção) | pares OS create/release e medição submit/approve ausentes do catálogo SOD | `sodDutyConflictsWithOperationalAuthority` | não aplicar maker-checker operacional |

## ENTERPRISE UI CATCH-UP — 2026-09-03

Classificação: **interpretação de engenharia**. Completa telas para endpoints backend já existentes nos módulos priorizados. Não inventa listagem onde a API não lista. Não recalcula dinheiro, imposto, folha ou custeio no navegador. Não liga `FEATURE_MODULE_*`. Nenhuma regra empresarial nova `CONFIRMED`. FIFO/média, fórmulas oficiais de folha e alíquotas fiscais permanecem `UNDECIDED` / residual DDP-023.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Pedido autorizado ENTERPRISE UI CATCH-UP; ED-005 | backend financeiro/fiscal/contábil/estoque/folha/compras/fornecedores/frota já existia | nenhuma BR nova; módulos fora da R1 continuam fail-closed | rotas `/app/finance/expenses|budgets|forecast`, períodos/obrigações fiscais, imobilizado, fornecedores, compras (incl. nota e conferência tripla), estoque, folha; cobrança no título a receber; lookup-by-id | `enterprise-ui-catchup.ui.test.tsx`; `feature-flags.test.ts`; `shell.e2e.test.tsx`; `FleetListPage.test.tsx` | UI COVERAGE: PASS; BACKEND WITHOUT REQUIRED UI: 0; BROKEN ROUTES: 0; CRITICAL UX DEFECTS: 0 |
| ED-005 | flags exatamente `true` | fail-closed | `GATED_WEB_PATH_PREFIXES` inclui inventory/payroll/procurement/suppliers; API `three-way-matches` passa a ser procurement | deep links `/app/inventory` etc. redirecionam para no-access; `matchGatedApiPath('/api/v1/three-way-matches/1')` | flags não foram ligadas; produção permanece NO-GO |

## PILOT EXIT READINESS — 2026-09-03

Classificação: **interpretação de engenharia**. Não encerra o piloto. Não fabrica evidência de HTTP de 14 dias. Não aplica waiver. Nenhuma regra empresarial nova `CONFIRMED`. Produção permanece NO-GO.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Pedido autorizado PILOT EXIT READINESS; OPS-PILOT-001 | `readiness-evidence.json` phase OBSERVATION; snapshot `2026-09-03T08:48:54.530Z` | nenhuma BR nova | `readiness:pilot-snapshot` append-only; HTTP live só via env explícita | `pilot-observation.spec.ts`; `readiness-gate.spec.ts` | ENGINEERING READY: YES; PILOT COMPLETE: NO; EXIT READY: NO |
| Janela 14d `2026-08-30T22:28:40.517Z` → `2026-09-13T22:28:40.517Z` | gate `PILOT_OBSERVATION_WINDOW_NOT_COMPLETED` | — | datas não alteradas; waiver null | `pnpm readiness:gate` | PILOT_STATUS = OBSERVATION |

## PRE-PRODUCTION CORRECTION GATE — 2026-09-03

Classificação: **interpretação de engenharia**. Nenhuma feature nova. Nenhuma regra empresarial nova `CONFIRMED`. A janela aberta de 14 dias do piloto não é falha de engenharia. Produção permanece NO-GO. `FEATURE_MODULE_*` não foi ligado globalmente.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Pedido autorizado PRE-PRODUCTION CORRECTION GATE | SoD, AuthZ negativa, bypass HTTP, UI, security, E2E empresarial | nenhuma BR nova | correções de teste/harness; invariante FIXED_PRICE sem `measurementItemId`; CLI `commitSha ?? null` | API E2E 23/64; integração 80/636; unit API 186/769; web 91/363 | SOD: PASS; UI: PASS; SECURITY: PASS; ENTERPRISE E2E: PASS; CRITICAL DEFECTS: 0 |
| ReleaseScopeGuard fail-closed | `people.e2e` 403 sem flag | ED-005 | flag `FEATURE_MODULE_PEOPLE=true` só no `beforeAll` do e2e; restore no `afterAll` | `people.e2e.spec.ts` 2/2 | módulo People continua gated fora do teste |
| OPS-PILOT-001; janela 14d | `readiness:engineering` READY; `readiness:gate` NO-GO | — | datas e waiver inalterados | `PILOT_OBSERVATION_WINDOW_NOT_COMPLETED` | ENGINEERING: READY; PRODUCTION: NO_GO |

## PILOT PATH HARDENING — 2026-09-03

Classificação: **interpretação de engenharia**. Fecha lacunas operacionais do caminho de produção (HML, snapshot, DR) sem ERP, sem fiscal e sem go-live. Nenhuma regra empresarial nova `CONFIRMED`.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Pedido autorizado “resolver lacunas para produção”; OPS-PILOT-001 | snapshot `2026-09-03T15:47:50.565Z`; HML schemas 29 | nenhuma BR nova | snapshot usa `PILOT_DATABASE_URL`/HML; HTTP live via metrics ou smoke timed; `ensure-migrations` aplica 0000–0002 em DB vazio | `pilot-observation.spec.ts` 8/8; smoke HML PASS | worker HML=0; HTTP n=14 registrado; serie 14d continua ausente |
| Prompt 85 | `apps/api/.backup/dr-drill-validate/status/latest.json` | — | `application_host_loss` isolado em `cisne_local_test` | DR PASS | nao e restore postgres de perda total |
| SRC-004 | ERP permanece rejeitado | BR-042 | nenhum adapter ERP ligado | — | FEATURE_MODULE_FISCAL off; Prompt 93 nao executado |

## HML PILOT OPERATOR — 2026-09-03

Classificação: **interpretação de engenharia**. Operação do piloto no HML. Nenhuma regra empresarial nova `CONFIRMED`. Produção permanece NO-GO.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Pedido autorizado trabalhar piloto no HML; OPS-HML-001; OPS-PILOT-001 | bootstrap sem papéis; smoke 403 em listas | nenhuma BR nova | `hml:grant-pilot-operator`; listagens no perfil `control_admin`; smoke exige 200 | `hml-pilot-operator.spec.ts` 2/2; `hml-smoke.spec.ts` 4/4; smoke live 11/11 | 77 grants em HML; listas 200; nested 404 sem OS |
| Snapshot `2026-09-03T16:46:03.644Z` | HTTP n=31 errorRate=0.355 p95=251ms | — | fase/datas/waiver inalterados | `readiness:pilot-snapshot` | EXIT READY: NO; PRODUCTION: NO-GO |

## HML SYNTHETIC SEED — 2026-09-03

Classificação: **interpretação de engenharia**. Massa operacional sintética no HML. Nenhuma regra empresarial nova `CONFIRMED`. Produção permanece NO-GO.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Pedido autorizado semear HML; OPS-HML-001 | `seed:synthetic` JSON 15/15 | nenhuma BR nova | seed HML com janela contratada no `planResource` de locação; compensação alinhada ao schema | smoke live 11/11 (nested 200) | clients 15; OS 9; measurements 5; billing 3 |
| Snapshot `2026-09-03T19:07:16.475Z` | HTTP n=46 errorRate≈0.239 p95=191ms; worker_pending=47 NOTIFICATION | — | fase/datas/waiver inalterados | `readiness:pilot-snapshot` | EXIT READY: NO; PRODUCTION: NO-GO |

## BACKOFFICE MATURITY HARDENING — 2026-09-03

Classificação: **interpretação de engenharia**. Fecha o furo de tesouraria na matriz e grava BR-043..045 no backend. Não liga `FEATURE_MODULE_*`. Não inventa alíquota, FIFO, fórmula de folha nem credenciamento. Produção permanece NO-GO.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Scorecard financeiro 7.0; ED-006 | transferência tesouraria sem matriz | nenhuma BR nova; SOD CANDIDATE | `SOD_DUTIES.TreasuryTransfer` / `TreasuryReverse` no opener/ator original | `treasury.integration` 9/9; SOD 6/6 | opener não transfere; checker distinto |
| SRC-006 ∩ SRC-007 | `NÃO CREDENCIADO` | BR-043..045 `CONFIRMED` | port default SRC-006; submit bloqueia; AUTHORIZED exige protocolo; legendas na resposta/UI gated | `fiscal-credentialing.spec` 4/4; `fiscal.integration` 6/6; `fiscal-accounting` 9/9 | Fiscal produto permanece 4.0; flag off |
| ED-005 | ledger/estoque/folha/compras fora da R1 | — | nenhuma exposição nova; custeio e folha oficial permanecem `UNDECIDED` | — | scores 7.0 / 6.2 de superfície R1 inalterados |

## INTEGRAÇÃO LOCAL (rede local) back ↔ banco ↔ front — 2026-09-07

Classificação: **interpretação de engenharia / operações**. Subiu o stack local (PostgreSQL + API + Web) acessível na LAN e corrigiu derivações reais de integração (schema de banco × código; grants de dev). Nenhuma regra empresarial nova `CONFIRMED`. Produção permanece NO-GO.

| SOURCE | EVIDENCE | BUSINESS RULE | IMPLEMENTATION | TEST | ACCEPTANCE |
| ------ | -------- | ------------- | -------------- | ---- | ---------- |
| Pedido do responsável (“suba na rede local e integre back/banco/front”); FRONT-BACK-ALIGN-001 | `GET /api/v1/clients` → 500 `purchase_order_requirement does not exist`; journal local registrava migrations 0070–0073 como aplicadas sem o DDL (arquivos editados após apply) | nenhuma BR nova | reset local documentado (DB-RESET-001) em dev+test; migrations 76/76 reaplicadas; guard p/ banco novo + probes de efeito 0070–0073 em `syncDrizzleJournal` (`scripts/lib/database-test-env.mjs`); `pg` resolvido do pacote em `wait-for-postgres.mjs`; resource types de grants do dev-login alinhados ao catálogo authz (`scripts/repair-dev-login.mjs`) | `db:migrate` dev+test idempotente; health/ready 200; varredura de endpoints por módulo | clients/contracts/people 200 (eram 500/403); API `:3000` e Web `:5173` bindados em `0.0.0.0` (LAN `192.168.1.89`); proxy e CORS 200 |
| seeds oficiais do repo | dev-operator + UAT vertical (2 cenários) | — | `auth:repair:dev-login`; `scripts/seed-dev-demo-data.mjs` | login HTTP 200; dashboards executivo/operacional com dados | 2 clientes; 2 OS; 2 medições; 2 billing records; emissão de documento exige registry de emissor (`OWN_COMPANY_*`), não inventado |
