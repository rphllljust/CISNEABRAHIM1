# Registro de execução — CISNE

## 2026-11-05 — MASTER 010: correção global de interface, integração e maturidade operacional

- **Ordem de origem:** MASTER 010 fornecido pelo patrocinador em 2026-11-05.
- **Estado:** `IN_PROGRESS`; `NO-GO`; sem aprovação de merge, publicação ou operação.
- **Base de inspeção:** `f9147c8396f8795e03dfc931f3557a65e0fbaa40` (`main` na coleta). PR #238 já estava merged; não reabrir nem supor gates do PR como aprovação desta etapa.
- **Branch isolada:** `fix/master-010-filter-layout-state`.
- **Inventário estático:** 137 declarações, 136 caminhos únicos, 130 caminhos `/app`. Duas rotas com investigação de código e correções; 134 ainda sem inspeção registrada nesta rodada.
- **Causa comprovada em código:** barras de filtros densas com pouco espaço, mínimos rígidos em lookup; `hasActiveFilters` ignorando status, pesquisa, datas e condição avançada; limpar filtros não removia de modo confiável `clientId` na lista de contratos; pedido de compra permitia resposta antiga sobrepor resultado novo.
- **Arquivos alterados:** `apps/web/src/ui/workspace-frame.tsx`, `enterprise-list.tsx`, `theme.css`, `contracts/pages/ContractsListPage.tsx`, `purchase-orders/pages/PurchaseOrdersListPage.tsx`. Novos testes `workspace-frame.test.tsx`, `worklist-filter-state.test.ts`.
- **Prova disponível:** inspeção de código e commits GitHub; teste unitário incluído como código, **execução ainda não comprovada**.
- **Gates obrigatórios:** lint `PENDING`, typecheck `PENDING`, unit `PENDING`, PostgreSQL `PENDING`, API E2E `PENDING`, Playwright `PENDING`, Visual Full `PENDING`, HML `PENDING`, reconciliação real `PENDING`.
- **Critério para concluir:** cobrir as 136 rotas distintas conforme inventário e os estados relevantes; agregar evidência de backend/banco quando houver defeitos de dados; aprovação nominal do responsável; merge, publicação GHCR/Coolify e smoke somente após os gates.
- **Rastreamento:** [Inventário e pendências](master-010-route-inventory.md) e [Matriz](../CISNE_FINISH_MATRIX.md).

