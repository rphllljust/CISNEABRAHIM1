# Pacote de execução — UAT/UX manual e início do piloto (RC-R1-003)

| Campo | Valor |
|---|---|
| Document ID | UAT-RC003-001 |
| Status | **PRONTO PARA EXECUÇÃO** — nenhum veredito atribuído |
| RC | `6ffacd1f425b63428bd0b95d122daf4534c06a09` |
| Digest | `sha256:2ed465b784e6d7d4358b09bfdf4c4bb6b686e5e2642429a8f9006db8f9699502` |
| Automação equivalente | `apps/api/src/uat/uat-business.integration.spec.ts` — **5/5 PASS** |

## O que a automação já prova (e o que ela não prova)

`uat-business.integration.spec.ts` passa 5/5 neste RC:

- `Locação de equipamento (escavadeira)`
- `Transporte de carga municipal`
- `Obra/serviço composto (terraplenagem + apoio)`
- `enforces profile visibility and separation of duties`
- `computes UAT verdict APPROVED when scenarios and profiles pass with no open blockers`

Isso prova o **fluxo de negócio via API**. Não prova o que o UAT/UX manual existe para medir: se um
operador humano consegue operar as telas. O gate distingue os dois e exige o segundo
(`manualUatUx.status`), e essa distinção não deve ser contornada.

## Instrumento de execução

`docs/16-testing/uat-ux-session-checklist.json` — 54 itens:

| Cenário | Dimensões avaliadas | Viewports |
|---|---|---|
| `locacao` — Locação de equipamento (escavadeira) | clareza das telas, erros, mobile | desktop, mobile |
| `transporte` — Transporte de carga municipal | clareza das telas, erros, mobile | desktop, mobile |
| `obra_composto` — Obra/serviço composto | clareza das telas, erros, mobile | desktop, mobile |

Critérios de UX por cenário (`docs/16-testing/uat-ux-scenarios.json`):

1. Login e chegada ao painel em < 60s
2. Criar solicitação sem campos ambíguos
3. Fluxo OS → execução compreensível
4. Mensagens de erro acionáveis
5. Formulários críticos usáveis em mobile

## Campos que só uma sessão real preenche

`readiness-evidence.json` → `manualUatUx`:

| Campo | Situação |
|---|---|
| `status` | `NOT_STARTED` → deve virar `PASSED` ou `PASSED_WITH_OBSERVATIONS` |
| `sessionId` | `null` — identificador da sessão executada |
| `performedBy` | `null` — operador humano real |
| `performedAt` | `null` |
| `environment` | `null` — ambiente onde rodou |
| `releaseCandidate` | deve apontar para este RC |
| `scenarios[]` | veredito por cenário |
| `issuesFound[]` / `blockingIssues[]` | achados; BLOCKER impede GO |
| `approval` | aprovação do responsável |

Precedente no repositório: `UAT-UX-F132B3A9`, executada por Monica Perez Badra Jabour (Administrador 2)
em `pilot-hml`, sem blockers.

## Início do piloto

`readiness-evidence.json` → `pilot`:

| Campo | Situação |
|---|---|
| `phase` | `NOT_STARTED` → `ACTIVE` |
| `startedAt` | `null` |
| `environment` | `null` |
| `releaseCandidate` | deve apontar para este RC |
| `startEvent.authorizedBy` | `null` — **autoridade empresarial** |
| `minObservationDays` | `14` — não negociável |

Limites já definidos em `docs/19-operations/pilot-program.md`:

| Controle | Padrão |
|---|---|
| Usuários | 5 (`PILOT_MAX_USERS`) |
| OS ativas | 10 (`PILOT_MAX_ACTIVE_SERVICE_ORDERS`) |
| Volume semanal | 15 (`PILOT_VOLUME_CAP_PER_WEEK`) |
| Serviços | RENTAL, TRANSPORT, CIVIL_WORK |
| Migração em massa | proibida (`PILOT_MIGRATE_ALL_LEGACY_DATA=true` é vedado) |

## Sequência de execução

1. **Publicar o RC** no ambiente de piloto com as flags `FEATURE_MODULE_*` ausentes (= desligadas).
2. **Registrar o start event** com `startedAt`, `environment`, `releaseCandidate`, `authorizedBy`.
3. **Executar as 54 verificações** com o operador; registrar `sessionId`, `performedBy`, `performedAt`.
4. **Rodar 14 dias** de observação. Incidentes BLOCKER/CRITICAL zerados.
5. **Gravar snapshot operacional** (erro, latência, worker, faturamento, alocação).
6. **Autorizar saída** do piloto (`exitAuthorizedBy` + `exitAuthorizedAt`).
7. **Reavaliar** o gate.

## Regra de não antecipação

O gate recusa evidência prematura por código (`assertEvidenceNotPrematurelyCompleted`): declarar
`PASSED` antes do evento real reprova como `READINESS_EVIDENCE_MISMATCH`. Este documento **não**
preenche veredito algum — ele entrega o instrumento.

O caminho crítico é o calendário: **14 dias** após o start event, com nenhum BLOCKER aberto. Nenhuma
quantidade de trabalho de engenharia encurta isso.
