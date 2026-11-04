# ERP-N-00 — Inventário honesto do núcleo empresarial

Data: 2026-11-04  
Repositório: rphllljust/CISNEABRAHIM1  
Branch: erp-n00-tier1-increment  
Base observada: main @ 63ab934b1644ba92930e0e60afb6dfae90a9cb09

## Método

Este inventário separa:

- **Existente observado**: capacidade visível no frontend publicado ou declarada na estrutura do repositório.
- **Parcial**: existe estrutura, rota ou fluxo, mas a comprovação transacional está incompleta.
- **Não comprovado**: não foi possível confirmar operação ponta a ponta nesta etapa.
- **Pendente de fonte**: regra empresarial que não pode ser inventada.

## Capacidades observadas

| Capacidade | Classificação | Evidência atual | Próxima lacuna |
| --- | --- | --- | --- |
| Shell autenticado e navegação por domínio | Existente observado | Sidebar com áreas Comercial, Operações, Financeiro, Fiscal, Controladoria, Suprimentos, Pessoas e Relatórios | Aplicar contexto por persona |
| Central de Operações | Parcial | Período, unidades, filtros, fila e atalhos | KPIs e tarefas reais por processo |
| Work Inbox | Parcial | Fila, exceção, atraso, busca e reprocessamento | SLA, dependências, responsável e evidência |
| Clientes | Parcial | Rota de Clientes publicada | Cliente 360, vínculos e comandos |
| Solicitações | Parcial | Rota e etapa do fluxo publicadas | Estado, aprovação e transição |
| Propostas | Parcial | Rota publicada | Versões, aprovação, validade e conversão |
| Contratos | Parcial | Rota publicada | Obrigações, saldo, aditivos e vigência |
| Ordens de serviço | Parcial | Rota e fluxo operacional publicados | OS 360, custos, medição, aceite e margem |
| Frota e ativos | Parcial | Rotas publicadas | Cadastro mestre compartilhado e histórico |
| Pessoas | Parcial | Rota publicada | Contexto operacional, alocação e permissões |
| Documentos | Parcial | Rota publicada | GED transversal, versões e vínculos |
| Financeiro | Parcial | Rotas de receber, pagar, tesouraria, conciliação, despesas e orçamento | Fluxo econômico integrado |
| Fiscal | Parcial | Rotas fiscais publicadas | Evidência de apuração e obrigações |
| Contabilidade | Parcial | Rotas de lançamentos, diário, razão, DRE, balanço e fechamento | Regras publicadas, subledger e reconciliação |
| Suprimentos e estoque | Parcial | Fornecedores, compras e estoque publicados | Procure-to-pay e impacto no custo |
| Indicadores operacionais | Insuficiente | Recorte atual sem indicador publicado | Read models e métricas reais |
| Reprocessamento contábil | Parcial | Exceção com ação de reprocessar | Regra contábil e resultado auditável |

## Evidência de falha atual

A Central de Operações exibiu:

- documento: pagamento de 1500.0000;
- contexto: INVENTORY_MOVEMENT;
- status: FAILED;
- tentativa: 10;
- erro: ACCOUNTING_RULE_NOT_CONFIGURED;
- ação disponível: Reprocessar contabilização.

A causa deve ser tratada no backend e na configuração de regras. Não será mascarada no frontend.

## Gramática Tier 1 alvo

Cada objeto prioritário deverá possuir:

1. cabeçalho com identidade, estado e contexto;
2. comandos autorizados pelo backend;
3. abas de dados, processo, documentos, relacionamentos e auditoria;
4. timeline de eventos;
5. responsável, prazo, SLA e dependências;
6. valores planejados, realizados e impacto econômico;
7. próximos passos;
8. drill-down para documentos de origem.

## Ordem de implementação

1. contratos compartilhados de estado, comandos, auditoria e relacionamentos;
2. Object Page 360 para Cliente, Contrato e OS;
3. Workspaces de Comercial, Operações e Financeiro;
4. fluxo OS → Medição → Aceite → Faturamento;
5. regras contábeis e subledger sem inventar plano de contas;
6. KPIs com origem rastreável;
7. testes focados, E2E e integração PostgreSQL;
8. revisão, PR e gates de publicação.

## Critérios de parada

Este documento não declara produção pronta. A etapa só poderá avançar após:

- contratos e escopo revisados;
- implementação correspondente registrada;
- testes aplicáveis executados;
- rastreabilidade atualizada;
- falhas e restrições documentadas.
