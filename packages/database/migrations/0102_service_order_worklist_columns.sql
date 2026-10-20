-- ORDEM DE SERVIÇO — METADATA DA WORKLIST: colunas que decidem primeiro.
--
-- PROBLEMA MEDIDO (produção, 1440x900):
--
--   A listagem renderizava 11 colunas em 1150px. As larguras reais ficaram:
--
--     Número da OS     129.7
--     Código interno   134.3   (conteúdo transbordava: scrollWidth 295)
--     Situação          87.3
--     Unidade           84.0   (scrollWidth 119)
--     Origem            77.9
--     Criada em         98.2   (scrollWidth 139)
--     Cliente           88.5   (scrollWidth 333 -> transbordava 244px)
--     Aging            140.5
--     Dias em atraso   153.2
--     Ações            124.3
--
--   A coluna que IDENTIFICA COM QUEM o trabalho acontece — "Cliente" — recebia 88.5px e
--   transbordava 244px, enquanto "Aging" e "Dias em atraso" recebiam, juntas, 294px para
--   exibir "—" e "0". O orçamento de largura estava invertido em relação à decisão.
--
-- DECISÃO — o que a ordem FAZ, não o que é esteticamente agradável:
--
--   Toda coluna precisa responder "sobre o que eu decido?" ou "o que eu faço agora?".
--
--   * `order_number`   identifica a OS. Fica.
--   * `status`         situação operacional. Fica.
--   * `unit_id`        unidade que responde pela execução. Fica.
--   * `origin`         de onde o trabalho veio (solicitação/proposta/PO/direta). Fica.
--
--   * `internal_code`  SAI da lista. É chave técnica de integração, não informação de decisão;
--                      o operador já tem o `order_number`, que é o identificador que o cliente
--                      cita. Continua publicado pelo contrato e permanece no formulário — quem
--                      integra sistema continua alcançando o código, só não no meio da fila.
--
--   * `created_at`     SAI da lista. Data de criação não decide trabalho. O eixo temporal que
--                      importa nesta entidade é o PRAZO (`deadline_at`), que a lista já usa como
--                      `agingField`; repetir a criação ao lado dele ocupava espaço sem orientar
--                      a ação.
--
--   A coluna "Cliente" chega por `ownerField` (posição e largura próprias no `DynamicList`), e
--   "Aging" por `agingField` — nenhuma das duas vem desta lista de colunas. Ao remover as duas
--   colunas secundárias, a engine distribui as quatro restantes + cliente + aging + ações num
--   espaço por linha que deixa de estrangular o cliente.
--
--   Por que não desligar o aging: `deadline_at` é dado operacional real e é o único eixo de
--   prazo que o backend publica. Quando ausente, o adaptador entrega vazio e a coluna mostra
--   travessão — ausência honesta, não zero inventado.
--
--   Informação que saiu da fila NÃO foi apagada do produto: `internal_code` continua no
--   formulário (`inForm: true`) e no contrato; `created_at` continua no detalhe e na ordenação.
--
-- NENHUMA coluna nova foi inventada. Nenhum campo, contrato ou autorização foi alterado:
-- esta migration reescreve APENAS `meta.views.layout` da view `list` de `service-orders`,
-- que é exatamente o ponto de configuração que a engine lê (`listColumns(schema)`).

UPDATE "meta"."views" v
SET layout = '{"columns":["order_number","status","unit_id","origin"]}'::jsonb
FROM "meta"."entities" e
WHERE v.entity_id = e.id
  AND e.name = 'service-orders'
  AND v.view_type = 'list';
