# ERP Tier 1 — Matriz de aceite integrada

Base: main @ 5f183706b81d09dec84ea06f2fdceb72e6d416fb

Esta frente trata os sete objetivos como uma única transformação integrada. Nenhum objetivo será marcado como 100% sem evidência funcional, automatizada e operacional.

## Objetivos de negócio

| Objetivo | Evidência obrigatória para 100% |
| --- | --- |
| Workspaces empresariais | Workspaces por área com contexto, fila, indicadores, comandos e exceções reais |
| Visões 360° | Cliente, contrato, OS, pessoa, ativo e fornecedor com estado, vínculos, documentos, histórico e próxima ação |
| Cadeia transacional | Solicitação → Proposta → Contrato → OS → Medição → Aceite → Faturamento → Recebível → Tesouraria → Contabilidade → Fechamento |
| KPIs reais | Read models publicados, origem rastreável, filtros coerentes e drill-down para documentos |
| Regras contábeis | Eventos econômicos, regras versionadas, subledger, idempotência e reprocessamento auditável |
| Fechamento e reconciliação | Saldos reconciliados, exceções identificáveis e fechamento com evidência |
| Work Inbox e navegação | Prioridade, SLA, responsável, dependências, exceções e navegação cruzada consistente |

## Gates obrigatórios

1. testes unitários e de contrato;
2. integração PostgreSQL;
3. E2E/Chromium;
4. CI completo;
5. HML;
6. merge;
7. deploy;
8. validação autenticada em produção.

## Regra de conclusão

O percentual só avança com evidência. A frente não poderá ser declarada concluída se houver tela decorativa, KPI inventado, regra contábil sem fonte, fluxo não persistido ou gate de produção pendente.
