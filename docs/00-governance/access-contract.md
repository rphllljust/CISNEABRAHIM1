# ACCESS CONTRACT — classificação das superfícies (2026-09-27)

Registro da auditoria autenticada (BIG WAVE 04E). Objetivo: **mapear** por que cada superfície
responde como responde e **classificar** cada caso, sem conceder permissão para "fazer
funcionar" e sem hardcodar perfil.

## Cadeia completa

```
perfil -> grants efetivos -> escopo de unidade -> feature flag (release) -> nav guard
       -> route guard -> capability do backend
```

O backend é a fronteira. O front **não** decide autorização: ele apenas deixa de prometer o que
o backend nega (fail-closed).

## Achados

| Superfície | Comportamento medido | Classificação | Evidência |
| --- | --- | --- | --- |
| `/app/finance/reconciliation` | 403 para a conta OWNER; item de menu **oculto** | **INTENCIONAL e consistente** | `listStatements` exige concessão ativa `finance:reconciliation:read` sobre `finance:treasury`; sem concessão lança acesso negado. O nav item carrega `accessCheck: 'finance-reconciliation-read'` e não aparece. Ctrl+K já havia PARKADO os comandos dessa tela por falta de filtro real. |
| `/app/closing` | acessível | **COMPORTAMENTO ACIDENTAL — corrigido por decisão** | A rota estava fora do release gate enquanto o menu a escondia pelo flag `accounting`. Ver "Decisão 1". |
| `/app/accounting/*` | `no-access` ("não faz parte da Release 1") | **INTENCIONAL** | Release scope fechado; testes de shell afirmam o bloqueio fail-closed. |
| `/app/fiscal/*`, `/app/procurement`, `/app/payroll`, `/app/inventory`, `/app/suppliers` | `no-access` ("não faz parte da Release 1") | **INTENCIONAL** | Idem. |
| `/app/work-inbox` | acessível; só mostra trabalho autorizado | **INTENCIONAL** | Read model agrega fontes que reutilizam o serviço de acesso do próprio domínio. |

**Não houve correção de grant.** Nenhuma concessão foi criada, alterada ou ampliada para
satisfazer a auditoria, e nada foi hardcodado por perfil.

## Decisão 1 — Central de fechamento é superfície transversal

A prontidão de fechamento agrega contas a receber, contas a pagar, tesouraria, conciliação,
fiscal e contábil para uma unidade e competência. Ela **não pertence a um único domínio**, então
não carrega `gatedModuleId` do contábil e passa a estar declarada como módulo próprio no
`module-registry` (`closing`).

Consequência assumida: o menu e a rota passam a contar a mesma história — a autorização é
decidida por capability (`accounting:journal:read`) no backend, e a superfície deixa de depender
do flag do módulo contábil para existir.

Registro da própria verificação de integridade: a primeira versão da entrada declarava também
`/api/v1/accounting/periods` e foi **recusada** por `MODULE_REGISTRY_ENDPOINT_GATE_MISMATCH` —
"módulo não-gated não declara rota sob gate alheio". A rota de competências permanece com o
módulo contábil.

## Decisão 2 — Fronteira com o Alert Center

| Superfície | Papel |
| --- | --- |
| **Alert Center** | Notificação/evento: o que aconteceu, com política de avaliação, transição de estado e persistência própria. |
| **Central de trabalho** | Trabalho acionável: o que exige ação agora, com motivo e rota de resolução. Somente leitura, sem estado próprio. |

A fila **lê** alertas como uma das fontes; não é uma segunda caixa de notificações. Não há
duplicação de comportamento: o que existe nos dois lados é a mesma origem de dado consumida com
propósitos diferentes.

## Dívida de autorização conhecida (fora desta onda)

O reconhecimento anterior registrou que as listas de `finance:expense:list`, `procurement:*` e
`suppliers` aplicam **gate de presença de concessão sem predicado de unidade** (fail-open).
Consequência: uma concessão com escopo de unidade A passa no gate da lista e pode devolver
linhas de B. Isso é dívida **do domínio dono**, não da fila de trabalho, e precisa ser corrigida
onde o escopo é aplicado — não na superfície que consome.

Qualquer fonte futura que reutilize esses serviços de lista herda o problema. As fontes atuais
da Central de trabalho foram escritas para **não** depender desse caminho sem verificação
explícita de escopo.
