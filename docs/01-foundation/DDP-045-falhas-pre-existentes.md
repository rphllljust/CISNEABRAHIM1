# DDP-045 — Correção das 4 falhas pré-existentes fora do escopo B3

| Campo                   | Valor                                                                     |
| ----------------------- | ------------------------------------------------------------------------- |
| ID                      | DDP-045                                                                   |
| Status                  | `OPEN`                                                                    |
| Classificação           | `PENDING_BUSINESS_DECISION`                                               |
| Bloqueia implementação? | Não para observabilidade (fechada) — sim para declarar CI verde           |
| Data                    | 2026-10-01                                                                |
| Origem                  | B3 / Fase 0 e B3-R / Fase 0 — reprodução isolada das 4 falhas             |
| Registro canônico       | [`../01-foundation/domain-decisions-pending.md`](../01-foundation/domain-decisions-pending.md) |

## Contexto

Fatos verificados, sem inferência:

- A sessão B3 (observabilidade) provou, por `git stash` das próprias alterações e re-execução no
  baseline `82f72c6`, que **4 falhas existiam antes dela**. Não são regressão de B3.
- Na sessão B3-R as 4 falhas foram **reproduzidas isoladamente**, com saída literal capturada, e
  cada causa raiz foi verificada no código e no histórico do Git.
- A suíte unitária da API fica em **1167 passed / 4 failed (1171)**, portanto o **CI não fica verde**.

### As 4 falhas, com causa raiz verificada

| #   | Spec                                                                   | Falha                                                                                                           | Classificação                                            |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `apps/api/src/test/ensure-migrations-journal-coverage.spec.ts`          | `journal tags without a coverage block in ensure-migrations.ts: 0082_audit_trail_logs`                            | GATE FALHO (gate correto; migration incompleta)          |
| 2   | `apps/api/src/service-orders/domain/operational-eligibility.spec.ts`    | `expected 'BLOCKED' to be 'REVIEW_REQUIRED'`                                                                      | DATA-SENSÍVEL (time-bomb; domínio correto, teste venceu) |
| 3   | `apps/api/src/work-inbox/sources/finance.source.spec.ts` (×2)           | `TypeError: Cannot read properties of undefined (reading 'map')` em `finance.source.ts:70` e `:88`               | REGRESSÃO REAL (de `fd262dc`, não de B3)                 |

**Detalhamento por spec:**

**(1)** A migration `0082_audit_trail_logs` (produzida no ciclo de auditoria, commits `d4550f5` e
`57e3c1e`) entrou no `_journal.json` sem o bloco de cobertura correspondente em
`ensure-migrations.ts`. O gate recusa sincronizar o journal nessa condição, porque
`syncDrizzleJournal` gravaria as migrations como aplicadas sem prova de que seu efeito existe — e o
migrator as pularia para sempre. **O gate está certo; a migration é que ficou incompleta.**
Evidência: 1 falha de 4 testes no arquivo.

**(2)** `operational-eligibility.spec.ts:60-63` passa `nextDueAt: '2026-09-30'` mas **omite o
parâmetro `asOf`**, ao contrário do bloco irmão nas linhas 54-57, que o fornece explicitamente
(`asOf: new Date('2026-09-15T12:00:00.000Z')`). Sem `asOf`, a avaliação usa o **relógio real**. Em
2026-10-01 o vencimento `2026-09-30` já passou, então o domínio decide `BLOCKED` — corretamente. O
valor `REVIEW_REQUIRED` era correto apenas enquanto "hoje" fosse anterior a 30/09. **O domínio está
certo; o teste apodreceu.** Evidência: 1 falha de 7 testes.

**(3)** `fd262dc` (2026-09-28, `fix(finance): paginate titles in SQL with authorized scope and list
gate`) mudou `list()` para devolver envelope paginado `{ items: [...] }`, mas **não atualizou o
spec** (criado em `caffc18`, 2026-09-27), que continua mockando
`list: vi.fn().mockResolvedValue([receivable()])` — um array cru. Em produção,
`finance.source.ts:63` e `:81` fazem `rows = page.items`, que agora é `undefined`; as linhas 70 e 88
então chamam `.map` sobre `undefined`. Confirmado por `git merge-base --is-ancestor fd262dc HEAD`
→ exit 0. **Dívida de 28/09, anterior a B3.** Evidência: 2 falhas de 14 testes — as outras 12
passam porque exercitam `toPayableWorkItem`/`toReceivableWorkItem` diretamente (funções puras), sem
atravessar `collect()`.

### Bloqueio de escopo reconhecido

A correção de (2) exige `apps/api/src/service-orders/domain/` e a de (3) exige `apps/api/**` —
ambos fora do escopo autorizado das sessões B3 e B3-R. **Nenhuma correção foi tentada**, conforme a
restrição de não corrigir as falhas nesta fase.

**Classificação:** Fato (reprodução isolada com saída literal; causa raiz verificada em código e
histórico Git, sessão B3-R).

## Question

Como tratar as 4 falhas pré-existentes?

## Options considered

### Opção A — Corrigir em sessão dedicada, prioridade alta, antes de B4

- **Prós:** CI volta a verde antes de acumular mais trabalho; dívida não se propaga para B4.
- **Contras:** bloqueia B4 por 1 sessão.

### Opção B — Corrigir em sessão dedicada, prioridade média, depois de B4

- **Prós:** B4 não é bloqueado.
- **Contras:** dívida acumula; CI permanece não-verde durante B4, e novas falhas ficam
  indistinguíveis destas 4.

### Opção C — Investigar origem (commits anteriores) antes de decidir

- **Prós:** decisão informada sobre quando e como a dívida entrou.
- **Contras:** exige arqueologia de `git log`. Parcialmente já feita em B3-R: a origem de (2) e (3)
  está identificada (`fd262dc` para (3); ausência de `asOf` no próprio spec para (2)); restaria
  apenas a origem de (1).

### Opção D — Aceitar como dívida de longo prazo, com waiver formal

- **Prós:** nenhum custo imediato.
- **Contras:** governança aceita incerteza declarada; CI permanece não-verde.

## Impacto

- **A** — bloqueia B4 por 1 sessão.
- **B** — dívida acumula, CI não fica verde.
- **C** — exige arqueologia de `git log`.
- **D** — governança aceita incerteza declarada.

## Answer

_(vazio — aguardando decisão)_

**Sem recomendação de engenharia.** As 4 opções acima são registro, não escolha. Não implementar
nenhuma opção até fonte.
