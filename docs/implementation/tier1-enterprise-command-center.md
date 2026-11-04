# CISNE Enterprise — Central empresarial transversal

## Origem e decisão

Implementação original solicitada pelo responsável do projeto em 03/11/2026: aumentar substancialmente a experiência ERP do CISNE combinando padrões de SAP Fiori (navegação orientada ao objeto/processo), Microsoft Dynamics 365 (workspaces e filas acionáveis) e ERPNext (continuidade Service-to-Cash). Esta implementação **não copia código proprietário**, não altera regras de domínio e não declara nenhuma transação encerrada por apresentar uma trilha de navegação.

## Fonte de dados e fronteiras

- Autoridade de pendências: API existente GET /api/v1/work-inbox; a lista global publica \`total\`, \`byDomain\`, \`unavailableDomains\`, sem agregações adicionais na UI.
- Seleção de domínio e natureza: nova solicitação com parâmetros \`domain\` e \`kind\`; valor de \`total\` acompanha o recorte, não é derivado da página. Os filtros permanecem no URL.
- Ação de uma linha: somente \`targetRoute\` e \`actionLabel\` publicados pela API; links são restritos a rotas internas /app.
- Atalhos de módulos: filtrados pelo mapa de acesso da navegação existente; endpoints e ações empresariais continuam exigindo PDP, escopo e permissão no backend.
- Processo interdepartamental: roteamento estático para módulos já publicados; **não** é máquina de estados, trilha de auditoria nem comprovação de transações econômicas.
- A falta de permissão, indisponibilidade de um domínio e falhas de leitura são explicitamente distintas de fila vazia.

## Interfaces afetadas

1. /app/workspaces — Central Empresarial: composição responsiva em 6 áreas, leitura de pendências, fila acionável por departamento, filtros servidor, painel de módulos autorizados e trilha Service-to-Cash.
2. /app — acesso direto pela página inicial operacional.
3. /app/workspaces/{dominio} — barra persistente de navegação interdepartamental nos workspaces Comercial, Operações, Fiscal, Contabilidade e Suprimentos.
4. /app/finance — barra idêntica na central financeira, sem substituir as leituras financeiras autoritativas.
5. Shell — entrada "Central empresarial" e breadcrumb sem nova navegação paralela.

## Limites e riscos

- Nenhum endpoint novo, tabela, grant, regra contábil, quantidade, métrica financeira ou transição de estado inventados.
- O índice apresenta amostras de no máximo oito itens e informa total de recorte; paginação completa continua em /app/work-inbox.
- Contagens globais podem estar incompletas. Não transformar \`unavailableDomains\` em zero; painel e filtros sinalizam leitura parcial.
- Acesso a módulo e ações permanece autoritativo no backend e na política de navegação.
- Testes/aceite exigem CI Vitest + lint/typecheck + API E2E + visual critical/full, HML isolada, merge autorizado, GHCR imutável, Coolify, smoke autenticado/browser e TLS.
- Produção e aceite de negócio são estados independentes; só registrar sucesso quando verificado em SHA idêntico.

## Rastreabilidade

- Solicitação: mudança expressa do responsável em 03/11/2026; programa ERP Tier 1 #212/#191.
- Contrato reutilizado: \`apps/web/src/work-inbox/api/work-inbox-api.ts\` e \`workspaces/domain-workspaces.ts\`.
- Implementação: \`WorkspacesIndexPage.tsx\`, \`EnterpriseJourneyBar.tsx\`, DomainWorkspacePage, FinanceOverviewPage, OperationalDashboardPage e nav-config.
- Prova automatizada: \`workspaces.ui.test.tsx\` (contagem real por domínio, recorte servidor, contexto de negação e leitura parcial).
- Aceite de negócio: pendente até evidência empresarial; não inferir de CI.
