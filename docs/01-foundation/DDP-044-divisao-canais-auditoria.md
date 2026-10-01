# DDP-044 — Divisão entre audit_logs e security_audit_events

| Campo                        | Valor                                        |
| ---------------------------- | -------------------------------------------- |
| ID                           | DDP-044                                      |
| Status                       | `OPEN`                                       |
| Classificação                | `PENDING_BUSINESS_DECISION`                  |
| Bloqueia implementação?      | Sim — para instrumentação de acesso negado   |
| Data                         | 2026-10-01                                   |
| Origem                       | B2 / Tarefa 0 — auditoria de cobertura RBAC  |
| Registro canônico            | [`../01-foundation/domain-decisions-pending.md`](../01-foundation/domain-decisions-pending.md) |

## Contexto

Fatos verificados, sem inferência:

- B1 criou `audit.audit_logs` (canal `AUDIT_TRAIL`).
- B1.5 alimenta `audit_logs` com `CREATE` e `TRANSITION` de service-orders.
- O PDP (`PolicyDecisionPointService`) grava decisões de autorização em
  `audit.security_audit_events`, chamado com `{ audit: true }` a partir dos serviços de domínio
  (ex.: `service-orders-access.authz.ts`).
- **Não existe regra explícita** sobre onde registrar **negações** de ações de domínio — por
  exemplo, um usuário que tenta cancelar uma OS fora do seu escopo autorizado.
- `AUDIT_CHANNELS` (`apps/api/src/audit/types/audit-channels.ts`) declara **4 canais**:
  `AUDIT_TRAIL`, `DOMAIN_HISTORY`, `SECURITY_AUDIT`, `TECHNICAL_LOG`.
- Existem hoje **dois canais implementados**: `AUDIT_TRAIL` (audit_logs) e `SECURITY_AUDIT`
  (security_audit_events).

Consequência observada: uma negação de ação de domínio é registrada como **decisão de
autorização** em `security_audit_events`, mas **não** aparece em `audit_logs`. A pergunta
"quem tentou cancelar a OS-42 e foi negado?" não é respondível pelo canal de auditoria de
domínio.

**Classificação:** Fato (código verificado em B2/Tarefa 0).

## Question

Onde registrar negações de ações de domínio (tentativa de executar comando em recurso fora do
escopo autorizado)?

## Options considered

### Opção A — Apenas em `security_audit_events` (comportamento atual)

- **Prós:** não duplica; mantém a semântica de decisão de autorização; zero alteração de código.
- **Contras:** "quem tentou cancelar a OS-42 e falhou?" não é respondível em `audit_logs`.

### Opção B — Apenas em `audit_logs` (migrar a gravação do PDP)

- **Prós:** centraliza a auditoria no domínio; a pergunta de domínio passa a ser respondível.
- **Contras:** perde a semântica de decisão de autorização; `security_audit_events` perde a
  cobertura de negações.

### Opção C — Ambos os canais, com `correlation_id` comum

- **Prós:** responde as duas perguntas; permite rastreabilidade cruzada entre os canais.
- **Contras:** dupla escrita por negação; risco de divergência entre canais se uma das gravações
  falhar; infla o banco.

## Impacto se não decidido

- Implementar instrumentação de acesso negado sem regra de canal viola `AGENTS.md` regra 12
  (não converter decisão pendente em decisão tomada).
- A cobertura de auditoria de negações permanece **indeterminada**: não há como afirmar se o
  sistema atende ou não a um requisito de rastreabilidade de tentativas negadas.
- Qualquer ADR subsequente sobre canais de auditoria fica bloqueado por esta decisão.

## Answer

(não preenchida — status `OPEN`)

## Referências cruzadas

- `ADR-007` — auditoria transacional vive no repositório (ACCEPTED).
- `DDP-043` — cobertura do canal AUDIT_TRAIL para writes sem correlação (OPEN).
- `B1` — criação de `audit.audit_logs` e do canal `AUDIT_TRAIL`.
- `B1.5` — integração de `audit_logs` em service-orders.
- `B2 / Tarefa 0` — auditoria de cobertura RBAC que originou esta questão.
- `docs/00-governance/prompt-execution-log.md` — registro de execução.
