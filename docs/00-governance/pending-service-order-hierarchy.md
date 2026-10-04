# DECISÃO PENDENTE — hierarquia entre Ordens de Serviço

| Campo          | Valor                                                             |
| -------------- | ----------------------------------------------------------------- |
| Data           | 2026-10-02                                                        |
| Origem         | Sessão **Track 1-B (backend)** — fechamento dos gaps da Engine V4  |
| Classificação  | **Decisão pendente** — não é fato empresarial nem requisito confirmado |
| Status         | `PENDING`                                                         |
| Bloqueia       | 3 testes E2E de árvore (`test.fixme` em `v4-layout-views.journey.spec.ts`) |

## O que foi pedido

O renderizador de ÁRVORE da engine V4 (`DynamicTree`) está implementado, correto e provado nos
caminhos que não dependem de hierarquia real: ausência de `parentField` degrada com mensagem,
hierarquia degenerada não trava a página, e nó sem pai presente vira raiz em vez de sumir.

O que falta é **dado**: `so.service_orders` não tem coluna auto-referente. Medido:

    $ docker exec cisne_local_postgres psql -U cisne_local_dev -d cisne_local_dev -t -A -c       "select count(*) from information_schema.columns
         where table_schema='so' and table_name='service_orders'
           and column_name in ('parent_id','parent_service_order_id','parent_order_id');"
    0

Sem `parent`, qualquer `parentField` declarado no metadado aponta para um valor que não é
identidade de outro nó: a árvore degenera em raízes planas, sem ramo, sem filho, sem órfão.

## A busca por fonte — e o resultado

Buscado, antes de qualquer decisão de schema:

    grep -rn "OS-mãe|OS mãe|guarda-chuva|subordina|hierarquia de OS|parent|OS pai|agrupamento de OS" docs/

| Local                                    | Resultado |
| ---------------------------------------- | --------- |
| `docs/inputs/` (SRC-001..SRC-009, UAT-UX) | **nenhuma ocorrência** |
| `docs/01-foundation/`                     | **nenhuma ocorrência** |
| `docs/03-requirements/`                   | **nenhuma ocorrência** |
| `docs/07-domain-behavior/`                | **nenhuma ocorrência** |
| `docs/08-state-machines/`                 | **nenhuma ocorrência** |
| `docs/12-domain-model/`                   | 1 ocorrência, **não aplicável** (ver abaixo) |

A única ocorrência está em `docs/12-domain-model/aggregate-root-analysis.md`, nas linhas 19–31.
Ela trata de **raiz de agregado** — "Itens planejados não vivem sem OS", "Itens e consumo
subordinados ao PO", "Versões filhas" — ou seja, a relação entre uma OS e seus ITENS. Não diz
nada sobre uma OS poder ser filha de outra OS. **Não é fonte para hierarquia OS↔OS.**

Também verificado: nenhuma tabela em `so.*`, `fin.*` ou `pty.*` tem coluna com `parent` no nome.

**Conclusão: NENHUMA fonte registrada declara hierarquia entre Ordens de Serviço.**

## Por que a coluna NÃO foi criada

Hierarquia de OS é **plausível** — contratos guarda-chuva e OS-mãe são comuns em operações de
campo. Mas plausível não é fonte. Criar `parent_service_order_id` em `so.service_orders` seria:

1. **Interpretação de engenharia apresentada como regra** — viola o AGENTS.md, que proíbe
   marcar regra empresarial como `CONFIRMED` sem fonte.
2. **Modelagem de negócio decidida por conveniência técnica** — se uma OS pode ter OS-pai, isso
   muda ciclo de vida, faturamento, medição e autorização. Não é decisão de infraestrutura.
3. **Custo de reversão alto** — uma coluna auto-referente com dados reais não se remove sem
   migração de dados e revisão de todas as telas que a leiam.

O `DynamicTree` **não fica bloqueado por isso**: ele é genérico e funciona no dia em que a
coluna existir, sem uma linha de TypeScript alterada — é exatamente a tese de views-como-dados.

## O que destrava

1. **Fonte identificada** — um SRC ou BR que declare que uma OS pode ser subordinada a outra,
   com o eixo (contrato? OS-mãe? agrupamento operacional?) e a cardinalidade.
2. **Decisão do responsável** registrada — se o negócio quiser a hierarquia sem documento de
   origem, a decisão precisa ser explicitada e datada neste arquivo, com autor.

Com qualquer dos dois, a migration é direta:

```sql
ALTER TABLE so.service_orders
  ADD COLUMN parent_service_order_id uuid NULL REFERENCES so.service_orders(id);
CREATE INDEX ... ON so.service_orders (parent_service_order_id);
CONSTRAINT ... CHECK (id <> parent_service_order_id)   -- auto-referência direta
```

Ciclo indireto (A→B→A) não precisa de CHECK: o `buildTree` da engine é iterativo, marca nós
alcançados e promove ramos cíclicos a raiz em vez de estourar a pilha — comportamento já
provável e provado.

## Estado enquanto pendente

- 3 testes em `test.fixme`, com o motivo escrito no próprio spec:
  `'requires parent_id field — schema gap, next session'`.
- A view `tree` **existe** no metadata store para `service-orders` e é renderizável (migration
  `0088_metadata_views_v4`), com hierarquia de um nível por `unit_id`.
- Nenhuma coluna criada. Nenhuma regra marcada `CONFIRMED`. Nenhum dado inventado.
