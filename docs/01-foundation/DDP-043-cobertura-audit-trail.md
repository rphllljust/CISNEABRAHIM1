# DDP-043 — Cobertura do canal AUDIT_TRAIL para writes sem correlação

| Campo                        | Valor                                        |
| ---------------------------- | -------------------------------------------- |
| ID                           | DDP-043                                      |
| Status                       | `OPEN`                                       |
| Classificação                | `PENDING_BUSINESS_DECISION`                  |
| Bloqueia implementação?      | Não — o canal atual é consistente            |
| Data                         | 2026-10-01                                   |
| Origem                       | B1.5 — integração do canal AUDIT_TRAIL       |
| Registro canônico            | [`../01-foundation/domain-decisions-pending.md`](../01-foundation/domain-decisions-pending.md) |

## Contexto

O canal `AUDIT_TRAIL` (tabela `audit.audit_logs`) foi implementado em B1 e passou a ser
alimentado pelas escritas de Ordem de Serviço em B1.5.

Em B1.5, a gravação foi vinculada à **presença de `correlationId`** na chamada. A decisão foi
consciente e está registrada em `ADR-007`: a trilha é de **requisição rastreada**, não de toda
escrita interna.

Consequência: escritas originadas de processos automáticos **não** geram linha em
`audit_logs`:

| Origem da escrita                       | Gera linha? |
| --------------------------------------- | ----------- |
| Requisição HTTP autenticada             | Sim         |
| Jobs em background                      | Não         |
| Seeds (`db:seed:*`)                     | Não         |
| Migrações                               | Não         |
| Conversão de solicitação (service request) | Não      |
| Processos em lote                       | Não         |

## Questão

`AUDIT_TRAIL` cobre apenas **ações humanas rastreáveis** (via HTTP), ou também **escritas
automáticas** do sistema?

Esta é uma pergunta **empresarial**, não técnica: depende de qual nível de rastreabilidade a
operação exige para processos automáticos.

## Opções consideradas

### Opção A — Manter como está

`AUDIT_TRAIL` = ação humana rastreável. Escritas internas permanecem fora da trilha.

- **A favor:** trilha limpa; cada linha tem um responsável humano identificável; zero
  alteração de código.
- **Contra:** ausência de rastreabilidade para operações em lote e jobs noturnos.

### Opção B — `correlationId` sintético para jobs e seeds

Gerar identificador sintético (ex.: `job:<uuid>`) e propagar aos processos internos.

- **A favor:** uniformidade; uma única trilha; reaproveita a infraestrutura existente.
- **Contra:** mistura origem humana e origem sistema na mesma tabela, sem coluna que as
  distinga — dificulta auditoria que precise separar as duas.

### Opção C — Canal separado `SYSTEM_AUDIT`

Criar canal dedicado para escritas internas, mantendo `AUDIT_TRAIL` exclusivo de ação humana.

- **A favor:** separação limpa de responsabilidades; alinhado ao padrão de canais distintos
  já adotado em `AUDIT_CHANNELS`.
- **Contra:** exige novo schema, nova política, nova migration e nova instrumentação.

## Impacto

| Opção | Impacto principal                                                          |
| ----- | -------------------------------------------------------------------------- |
| A     | Falta de rastreabilidade de operações em lote e jobs noturnos              |
| B     | Uniformidade, porém mistura origem humana e origem sistema                 |
| C     | Separação limpa, porém maior custo de implementação e manutenção           |

## Recomendação de engenharia

A opção **C** separa responsabilidades de forma mais limpa e é coerente com a política de
canais distintos. **Não é decisão tomada.** A escolha depende de requisito empresarial de
auditoria sobre processos automáticos, ainda não fornecido.

## Restrições

- **Não implementar nenhuma opção** até decisão com fonte registrada (`AGENTS.md` regras 12
  e 24).
- O comportamento atual é **consistente e testado**; não há defeito a corrigir — há uma
  decisão de escopo em aberto.
- Qualquer implementação futura exige migration, o que por si exige autorização própria.

## Referências cruzadas

- `ADR-007` — auditoria transacional vive no repositório (menciona esta limitação como
  consequência negativa aceita).
- `B1` — infraestrutura do canal (`audit-trail.types.ts`, `audit.service.ts`, migration 0082).
- `B1.5` — integração em service-orders; Caso C (rollback) e Caso F (cadeia) do spec.
- `apps/api/src/audit/types/audit-channels.ts` — os 4 canais declarados.
- `docs/00-governance/prompt-execution-log.md` — histórico de execução.
