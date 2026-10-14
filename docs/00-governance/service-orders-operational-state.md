# ESTADO OPERACIONAL — Ordens de Serviço em produção

| Campo          | Valor                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Data           | 2026-10-02                                                             |
| Origem         | Wave de Ordens de Serviço (Missão B) — commits `4d163b20`, `0562f6fd`, `e54218c1` |
| Classificação  | **Fato empresarial medido** (produção) + **Bloqueio declarado**         |
| Ambiente       | Railway `lucky-wonder` / `production` — API `cisneapi-production`, Web `cisneweb-production-db99` |
| Verificado em  | bundle `index-DGLHBQKq.js`                                              |

## O que está COMPROVADO funcionando em produção

| Capacidade                              | Evidência                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Login do ator real                      | `POST /api/v1/auth/login` → 200                                              |
| Rota de criação `/app/service-orders/new` | deep link → 200, shell + bundle; marcador `so-create-submit` presente        |
| Rota de ficha `/app/service-orders/:id`   | deep link → 200, shell + bundle (abre após refresh)                         |
| Rotas de planejamento/medição/execução    | deep link → 200, shell + bundle                                             |
| Worklist `/app/service-orders`            | deep link → 200; marcador `service-orders-refused-views` presente            |
| Contrato de criação exercido no SERVIDOR  | `SERVICE_REQUEST` recusada na criação; `PROPOSAL` exige `proposalId`         |
| Bloqueio de unidade declarado na tela     | marcador `so-create-no-unit` no bundle publicado                            |

Scripts de verificação: `tmp/verify-spa-deeplinks.mjs`, `tmp/validate-os-create.mjs`.

## O que NÃO está comprovado — e por quê

**Não existe nenhuma Ordem de Serviço em produção, e nenhuma unidade operacional autorizada.**

Medido:

    GET /api/v1/requests/service-requests/operational-units  →  {"items": []}

A cadeia:

1. O endpoint lê `authorization.scope_refs` filtrando `scope_type = Unit`
   (`scope-context.repository.listUnitScopeRefs`).
2. Nenhuma unidade está registrada nesse escopo para o ator real.
3. O servidor EXIGE `unitId` na criação e recusa unidade fora do escopo
   (`service-orders-reference-validation`: `assertUnitRegistered`).
4. `so.service_orders.unit_id` é `text NOT NULL` **sem FK** para tabela de unidade —
   **não existe tabela `units` neste schema**. A única fonte autoritativa de unidade é o
   próprio `operational-units`.

**Consequência: não existe valor digitável que satisfaça a regra.** O bloqueio é de ESCOPO
concedido, não de formulário. Registrar uma unidade em produção exigiria escolher um
identificador de unidade — e nenhuma fonte registrada declara qual unidade a empresa possui.
Inventá-la violaria a proibição permanente de inventar dado empresarial.

## Critério §78 — status honesto

O §78 declara Ordens de Serviço incompletas enquanto a cadeia real não fecha. Estado por item:

| Item do §78                                    | Status                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `[Nova OS]` cria OS real                       | **BLOQUEADO por dado** — falta unidade autorizada no escopo        |
| Abre após refresh                              | **PASS** — deep link serve o SPA para todas as rotas de OS         |
| A worklist localiza a OS                       | **PASS** — literal `id` pesquisado e listado (implementado e testado) |
| Comandos respeitam capacidades                  | **PASS** — `prepare/release/cancel/reopen` com `rowVersion` e motivo |
| Nenhuma view falsa permanece exposta           | **PASS** — `tree` recusada por eixo inexistente, motivo declarado  |

Ou seja: **4 de 5 itens fechados. O item 1 está bloqueado por dado, não por código.**

Os itens marcados PASS foram provados por teste automatizado e por medição do bundle publicado.
O item 1 **não foi** provado ponta a ponta em produção, porque não há unidade para selecionar.
Registrar "OS criada em produção" sem essa prova seria declaração sem evidência.

## O que destrava

1. **Fonte identificada** que declare qual(is) unidade(s) operacional(is) a empresa possui, com
   o identificador correspondente.
2. Com a fonte, `POST /api/v1/requests/service-requests/operational-units` com `{"refId": "..."}`
   registra a unidade no escopo, e então `tmp/validate-os-create.mjs` executa a cadeia completa:
   cria, recarrega por id, localiza na worklist, busca por número, e cancela a OS de validação.

Alternativa sem fonte: decisão explícita e datada do responsável autorizando o identificador a
usar. Sem uma das duas, **nenhum dado é inventado**.
