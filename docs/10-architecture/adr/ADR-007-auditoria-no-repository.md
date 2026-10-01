# ADR-007 — Auditoria transacional vive no repositório, não no service

| Campo  | Valor                                     |
| ------ | ----------------------------------------- |
| ID     | ADR-007                                   |
| Status | **ACCEPTED**                              |
| Data   | 2026-10-01                                |
| Origem | B1.5 — integração do canal AUDIT_TRAIL    |
| Escopo | `apps/api/src/service-orders/`            |

## Contexto

O canal `AUDIT_TRAIL` (tabela `audit.audit_logs`) foi criado em B1 e passou a ser alimentado
pelas escritas de Ordem de Serviço em B1.5. Restava decidir **onde**, na arquitetura do
backend, a linha de auditoria é gravada.

Fatos verificados no código:

1. A camada de domínio (`apps/api/src/service-orders/domain/`) é pura e intocável.
2. `ServiceOrdersRepository.create` e `.transition` abrem e fecham a transação internamente:
   `pool().connect()` → `BEGIN` → `COMMIT`/`ROLLBACK` → `client.release()`, com **24 pontos**
   de `COMMIT`/`ROLLBACK` no arquivo, incluindo retornos antecipados
   (`'VERSION_CONFLICT'`, `'INVALID_STATE'`) que fazem `ROLLBACK` antes do `return`.
3. `ServiceOrdersAccessService` **não possui** `DatabaseService` nem pool injetados — não tem
   com que abrir uma transação própria.
4. Existem **4 pontos de escrita**: `create`, `transition` (`release`), `transition` (`reopen`)
   e `transition` (demais comandos).
5. Requisito de aceite: transição inválida **não pode deixar rastro** em `audit_logs`.

## Decisão

A linha de auditoria é gravada **dentro da transação que o repositório já abre**,
imediatamente antes do `COMMIT`. O `AuditService.registrar(entry, tx)` recebe o `PoolClient`
interno do repositório. A atomicidade é herdada da transação de negócio: se a mutação falhar,
a linha de auditoria desaparece com ela.

`AuditService` é **dependência obrigatória** do `ServiceOrdersRepository` — não há
`@Optional()`. A ausência do serviço quebra a compilação em vez de produzir auditoria
silenciosamente ausente.

## Alternativas consideradas

### A) Auditoria no service, via interceptor AOP (`@Auditable` + NestInterceptor)

**REJEITADA.** Um interceptor NestJS executa **fora** da transação do repositório, que é
aberta e fechada dentro do próprio método. Consequência: uma transição inválida seria
gravada na trilha antes do rollback — deixando rastro de uma operação que **não aconteceu**.
Isso viola diretamente o requisito de aceite do Caso C. AOP também não tem acesso ao
`PoolClient` da transação de negócio.

### B) Refatorar os repositórios para aceitar `client?: PoolClient` externo

**REJEITADA.** Exigiria dividir `create` e `transition` em orquestrador e executor, e remover
os `ROLLBACK` internos dos caminhos de retorno antecipado — transferindo a responsabilidade
transacional para o service. É a "refatoração grande" explicitamente fora de escopo, sobre
uma camada de persistência de ~844 linhas com 24 pontos de controle transacional e suíte de
integração em produção. Risco desproporcional ao ganho.

### C) Auditoria dentro da transação existente do repositório — **ACEITA**

Atomicidade garantida sem mover a fronteira transacional; rollback cobre a transição
inválida; zero alteração em `domain/`. Custo: acoplamento do repositório ao `AuditService`.

## Consequências

### Positivas

- **Atomicidade real**: audit e mutação commitam ou revertem juntos (provado pelo Caso C).
- **Rastreabilidade em cadeia**: `dados_novos` de um comando é o `dados_antigos` do seguinte
  (provado pelo Caso F: `prepare` → `release`).
- **Zero refatoração** da fronteira transacional e **zero alteração** em `domain/`.
- Injeção obrigatória: falha explícita de configuração em vez de auditoria ausente.

### Negativas

- **Acoplamento**: o repositório conhece o `AuditService`. Aceito porque a trilha de auditoria
  é requisito transversal de persistência, não regra de negócio.
- **Cobertura parcial**: a trilha só grava quando há `correlationId`. Escritas internas
  (jobs, seeds, migrações, conversão de solicitação) **não** geram linha. Limitação
  registrada e endereçada em `DDP-027` — **não resolvida por este ADR**.
- A instrumentação precisa ser repetida por repositório, à medida que outros módulos adotem
  o canal. Não há mecanismo automático de cobertura.

## Referências

- B1 — infraestrutura do canal `AUDIT_TRAIL` (`audit.service.ts`, `audit-trail.types.ts`,
  migration `0082`, `audit-trail.integration.spec.ts`, 7/7 PASS).
- B1.5 — integração em service-orders (`service-order-audit.integration.spec.ts`, 7/7 PASS;
  regressão 118/118 PASS).
- Caso C do spec — transição inválida não deixa rastro (rollback cobre).
- Caso F do spec — cadeia `prepare` → `release` preserva rastreabilidade.
- `DDP-027` — cobertura do canal para writes sem correlação (OPEN).
- `docs/13-data-model/column-semantics.md` — classificação RESTRICTED/FINANCIAL dos campos
  que **não** entram no jsonb da trilha.
- `AGENTS.md` regras 10 e 12.
