# SM-CAND-002 — SERVICE_ORDER

| Campo    | Valor                                            |
| -------- | ------------------------------------------------ |
| ID       | SM-CAND-002                                      |
| Ciclo    | SERVICE_ORDER                                    |
| BC owner | BC-CAND-006                                      |
| Fonte    | SRC-001 (EV-039, EV-042, EV-044, EV-045, EV-046) |
| Status   | PARTIALLY_SUPPORTED                              |

> **Nota de sincronização documental — 2026-08-28 (sessão atual).**
> Este documento foi confrontado com `apps/api/src/service-orders/domain/service-order.state-machine.ts`.
> A implementação usa **transições nomeadas por comando** (`prepare`, `release`, `start`, `pause`,
> `resume`, `complete`, `cancel`) e **nomes de estado em inglês**. Este documento registra nomes em
> português. A correspondência está na seção "Correspondência doc ↔ código".
> Divergências encontradas estão registradas nas seções "PAUSED", "Reabertura" e "Divergência de
> cancelamento". Nenhuma classificação anterior foi apagada; alterações estão anotadas com data.

## Diagrama candidato

```text
[RASCUNHO] --preparar--> [PREPARADA] --liberar--> [LIBERADA] --iniciar exec--> [EM_EXECUCAO] --concluir--> [CONCLUIDA]*
     |                      |              |
     +--cancelar?----------+--------------+--cancelar?--> [CANCELADA]*
```

## Separações obrigatórias

| Conceito              | Tratamento                | Não confundir com       |
| --------------------- | ------------------------- | ----------------------- |
| Liberação             | STATE-CAND-008 LIBERADA   | Atribuição              |
| Atribuição            | Evento DE-005 + timestamp | Estado OS               |
| Visualização          | DE-006 AUDIT_ONLY         | Aceite                  |
| Aceite/ACK            | CMD-007 / timestamp       | Estado OS               |
| Conclusão operacional | STATE-CAND-010            | Encerramento financeiro |
| Cancelamento          | STATE-CAND-011            | Exclusão física         |

## Estados

### STATE-CAND-006 — RASCUNHO

| Campo     | Valor                                                         |
| --------- | ------------------------------------------------------------- |
| Nome      | Rascunho                                                      |
| Definição | OS criada, conteúdo incompleto ou não validado para liberação |
| Fonte     | EV-042, CMD-003                                               |
| Entrada   | Conversão ou criação direta candidata                         |
| Saída     | Preparar (CMD-004)                                            |
| Terminal  | Não                                                           |
| Status    | CANDIDATE                                                     |

### STATE-CAND-007 — PREPARADA

| Campo     | Valor                                               |
| --------- | --------------------------------------------------- |
| Nome      | Preparada                                           |
| Definição | Conteúdo mínimo para liberação candidato satisfeito |
| Fonte     | CMD-004, INV-002 parcial                            |
| Saída     | Liberar (CMD-005)                                   |
| Status    | CANDIDATE                                           |

### STATE-CAND-008 — LIBERADA

| Campo             | Valor                                                    |
| ----------------- | -------------------------------------------------------- |
| Nome              | Liberada                                                 |
| Definição         | Autorização empresarial para execução concedida          |
| Fonte             | EV-039, CMD-005, DE-004                                  |
| Operações         | Atribuir (CMD-006), planejar/alocar, iniciar execução    |
| Efeito financeiro | Habilita cadeia medição/faturamento futura (não garante) |
| Status            | CANDIDATE                                                |

### STATE-CAND-009 — EM_EXECUCAO

| Campo     | Valor                                                            |
| --------- | ---------------------------------------------------------------- |
| Nome      | Em execução                                                      |
| Definição | Trabalho operacional iniciado na OS                              |
| Fonte     | EV-044, CMD-008, DE-009                                          |
| Nota      | Atribuição prévia candidata (PRED-003) mas **não** é este estado |
| Saída     | Concluir (CMD-010)                                               |
| Status    | CANDIDATE                                                        |

### STATE-CAND-010 — CONCLUIDA

| Campo       | Valor                              |
| ----------- | ---------------------------------- |
| Nome        | Concluída                          |
| Definição   | Encerramento operacional da OS     |
| Fonte       | EV-045, CMD-010, DE-011            |
| Terminal    | Sim (candidato)                    |
| Reversível  | DDP-005 / CMD-012 — não confirmado |
| Não implica | Medição aprovada, nota, pagamento  |
| Status      | CANDIDATE                          |

### STATE-CAND-011 — CANCELADA

| Campo     | Valor                                            |
| --------- | ------------------------------------------------ |
| Nome      | Cancelada                                        |
| Definição | OS invalidada antes ou durante ciclo operacional |
| Fonte     | EV-046, CMD-011, DE-012                          |
| Terminal  | Sim (candidato)                                  |
| DDPs      | DDP-004                                          |
| Status    | CANDIDATE                                        |

## Estados avaliados e rejeitados / pendentes

> Histórico preservado: a coluna "Decisão" reflete o registro do Prompt 07. As linhas marcadas com
> **[sincronizado 2026-08-28]** receberam apenas nota de rodapé; nenhum texto original foi apagado.

| Candidato    | Decisão                                                     |
| ------------ | ----------------------------------------------------------- |
| Atribuída    | **Rejeitado como estado** — usar evento/timestamp (DDP-032) |
| Pausada      | Sem evidência SRC-001 — PENDING_SOURCE_VALIDATION — **[sincronizado 2026-08-28]** |
| Interrompida | Sem evidência — SDD-002                                     |
| Encerrada    | Distinto de concluída sem fonte — não adotado               |
| Reaberta     | DDP-005 — não inventar estado até decisão                   |

**[sincronizado 2026-08-28] — nota sobre "Pausada":** o texto original acima permanece válido
(sem evidência SRC-001). Acrescenta-se o fato de que `PAUSED` **foi implementado** em código
(`pause`/`resume`, coberto por `service-order-execution.integration.spec.ts`), enquanto
`STATE-CAND-052` segue `REJECTED` e `SDD-003` segue `OPEN`. Trata-se de **conflito de fonte**
entre implementação e governança, não de confirmação de requisito. Detalhes na seção "PAUSED".

## Transições

TR-CAND-006..015 em [state-transition-register.md](./state-transition-register.md).

### Matriz de transições por comando (implementada)

Fonte: `apps/api/src/service-orders/domain/service-order.state-machine.ts` — constante `TRANSITIONS`.
Classificação: **Interpretação de engenharia** (leitura do código), não requisito confirmado.

| Comando (código) | De (código)                          | Para (código) | Estado doc origem → destino       | TR-CAND |
| ---------------- | ------------------------------------ | ------------- | --------------------------------- | ------- |
| `prepare`        | `DRAFT`                              | `PREPARED`    | RASCUNHO → PREPARADA              | 006     |
| `release`        | `PREPARED`                           | `RELEASED`    | PREPARADA → LIBERADA              | 007     |
| `cancel`         | `DRAFT`, `PREPARED`, `RELEASED`      | `CANCELLED`   | RASCUNHO/PREPARADA/LIBERADA → CANCELADA | 011 (ver divergência) |
| `start`          | `RELEASED`                           | `IN_EXECUTION`| LIBERADA → EM_EXECUCAO            | 009     |
| `pause`          | `IN_EXECUTION`                       | `PAUSED`      | EM_EXECUCAO → PAUSADA             | — (não registrada) |
| `resume`         | `PAUSED`                             | `IN_EXECUTION`| PAUSADA → EM_EXECUCAO             | — (não registrada) |
| `complete`       | `IN_EXECUTION`                       | `COMPLETED`   | EM_EXECUCAO → CONCLUIDA           | 010     |

Comandos de **atribuição** (`CMD-006`) e **ACK** (`CMD-007`) permanecem sem mudança de estado
(TR-CAND-008, TR-CAND-014) — a implementação não os trata como transição, o que **confirma** a
separação registrada na seção "Separações obrigatórias".

Predicados auxiliares implementados no mesmo arquivo:

| Símbolo                      | Comportamento                                                    |
| ---------------------------- | ---------------------------------------------------------------- |
| `canTransition`              | Predicado booleano; não lança                                     |
| `isTerminalServiceOrderStatus` | `COMPLETED` e `CANCELLED` são terminais                        |
| `ServiceOrderStateError`     | Erro tipado com código `INVALID_STATE_TRANSITION`                 |
| `assertReopenJustification`  | Motivo obrigatório; código `REOPEN_JUSTIFICATION_REQUIRED`        |
| `resolveReopenStatus`        | Ver seção "Reabertura"                                            |

### PAUSED — implementado sem lastro de fonte (divergência registrada)

Fato (código): `PAUSED` existe em `so.service_order_status`
(`packages/database/src/schema/service-orders.ts`) e os comandos `pause`/`resume` estão
implementados e cobertos por `service-order-execution.integration.spec.ts`.

Governança vigente (não revertida por esta sincronização):

| Registro                     | Classificação atual                                          |
| ---------------------------- | ------------------------------------------------------------ |
| `STATE-CAND-052 — PAUSADA`   | **REJECTED** — `execution-state-machine.md`                   |
| `SDD-003 — PAUSA em execução`| **OPEN** — `state-decisions-pending.md`                       |
| Linha "Pausada" (tabela abaixo) | `PENDING_SOURCE_VALIDATION` — *sem evidência SRC-001*      |

**Conflito de fonte registrado:** a implementação introduziu `PAUSED` como estado de OS enquanto
`SDD-003` permanece `OPEN` e `STATE-CAND-052` permanece `REJECTED`. Este documento **não** promove
`PAUSED` a requisito confirmado: a fonte empresarial (SRC-001) continua ausente. O termo
`IMPLEMENTED_PENDING_SOURCE_EVIDENCE` descreve o código, **não** substitui a classificação de
rastreabilidade e **não** reverte a rejeição. Reverter `SDD-003` exige decisão autorizada e fonte,
conforme `AGENTS.md` regra 12.

> Histórico de classificação (sem apagamento):
> - até 2026-08-28: `PENDING_SOURCE_VALIDATION` (Prompt 07) — inalterado na tabela de pendentes.
> - 2026-08-28 (sessão atual): acrescentada esta seção e as duas transições na matriz acima,
>   com nota de conflito. Status de governança **preservado**.

### Reabertura — implementada sem DDP-005 resolvido

Fonte: `resolveReopenStatus`, `assertReopenJustification` em
`apps/api/src/service-orders/domain/service-order.state-machine.ts`, e
`reopen` em `apps/api/src/service-orders/services/service-orders-access.service.ts`.
Classificação: **Interpretação de engenharia** — comportamento implementado, decisão não autorizada.

| Situação atual (código) | Destino resolvido (código)                  | Regra                                                       |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `CANCELLED`             | `status_before_cancel`                      | Reabre para o estado anterior ao cancelamento                |
| `COMPLETED`             | `IN_EXECUTION`                              | Reabre para execução                                         |
| outro                   | —                                           | `INVALID_STATE_TRANSITION`                                   |

Colunas de suporte (não criam estado `REOPENED`):

| Coluna (tabela `so.service_orders`) | Uso                                                       |
| ----------------------------------- | --------------------------------------------------------- |
| `status_before_cancel`              | Estado anterior ao cancelamento — destino da reabertura    |
| `status_before_reopen`              | Estado anterior à reabertura — preserva histórico          |
| `reopened_at` / `reopened_by_identity_id` / `reopen_reason` | Evidência da reabertura          |
| `cancelled_at` / `cancelled_by_identity_id` / `cancellation_reason` | Evidência do cancelamento |

**Decisão pendente (não resolvida por esta sincronização):**

| Registro   | Classificação | Efeito                                                        |
| ---------- | ------------- | ------------------------------------------------------------- |
| `DDP-005`  | Pendente      | Define se reabertura é permitida                               |
| `SDD-R01`  | `OPEN`        | "CMD-012 permitido após CONCLUIDA?"                            |

`cancellation-and-reopening-analysis.md` determina: *"Reabertura sem DDP-005 **não** modelada como
transição confirmada."* A implementação **existe**, mas permanece **não confirmada** quanto à
regra empresarial. Este documento registra o comportamento observado, sem conferir-lhe status
`CONFIRMED`.

### Divergência de cancelamento (conflito de fonte)

| Fonte                                     | Estados de origem permitidos para cancelar             |
| ----------------------------------------- | ------------------------------------------------------ |
| Código (`TRANSITIONS.cancel`)             | `DRAFT`, `PREPARED`, `RELEASED`                          |
| `TR-CAND-011` (registro de transições)    | RASCUNHO / PREPARADA / LIBERADA / **EM_EXECUCAO**         |

Evidência de qual lado descreve o comportamento real: o teste
`service-orders.integration.spec.ts` chama-se
`'cancels from DRAFT and RELEASED with history and security audit'` e cobre exatamente `DRAFT` e
`RELEASED`. Conclusão: **o código está correto e `TR-CAND-011` está incorreto** ao incluir
`EM_EXECUCAO`. O registro é preservado como está, com esta nota de conflito; a correção de
`TR-CAND-011` não foi aplicada nesta sessão (escopo documental limitado).

### Correspondência doc ↔ código (nomes de estado)

Adicionada nesta sincronização — não existia antes.

| Doc (português) | Código / banco (inglês) | STATE-CAND |
| --------------- | ----------------------- | ---------- |
| Rascunho        | `DRAFT`                 | 006        |
| Preparada       | `PREPARED`              | 007        |
| Liberada        | `RELEASED`              | 008        |
| Em execução     | `IN_EXECUTION`          | 009        |
| Concluída       | `COMPLETED`             | 010        |
| Cancelada       | `CANCELLED`             | 011        |
| Pausada         | `PAUSED`                | 052 — `REJECTED` (SDD-003) |
