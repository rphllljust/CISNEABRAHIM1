# CISNE MASTER 015 — entrega aditiva e verificável (v2)

## Preservação absoluta do ERP existente
Não sobrescrever telas, módulos, endpoints, hooks, migrations, políticas PDP ou fluxos de OS já implantados. Não criar OS fictícia, não forçar `status`, não aplicar mocks e não redesenhar o ERP. Cada mudança adicional deve ocorrer em nova branch/PR, com `git diff` restrito, CI e rollback. O único objetivo é disponibilizar a integração Apache Superset **real e visível** no CISNE sem regressão.

## Diagnóstico do estado de partida (06/11/2026)
- A `main` em `8651157cb8180fbe19583abe0c179e72e6757f58` contém broker NestJS + rota React `/app/reports/embedded` + catálogo de oito famílias. Não há evidência de dashboards Superset provisionados.
- Deploy técnico API/Web/Worker no Coolify para esse SHA terminou com sucesso e passou smoke e navegador 20/20. O Browser Gate empresarial falhou por falta de OS concluída com workbench elegível; isso não cancela automaticamente o deploy.
- O menu `BI e indicadores` só é adicionado ao bundle quando `VITE_ENABLE_SUPERSET_BI=true`; o build de produção não define essa variável. A API bloqueia o recurso se `SUPERSET_EMBED_ENABLED` não for `true`.
- A infraestrutura `infra/superset/compose.coolify.yaml` é apenas uma definição de serviço SEPARADO. Não comprova instância funcional, datasets, credenciais, papéis, RLS ou UUIDs reais.

## Fases sequenciais obrigatórias
**00 — Baseline:** registrar SHA, screenshots da web atual, lista de menus e flags existentes. Congelar os módulos verdes; sem alterações de produção nesta etapa.
**01 — HML Superset real:** provisionar serviço novo no projeto HML Coolify (metadata PostgreSQL, Redis, TLS, domínio, secrets, network e volumes). Verificar driver PostgreSQL e comandos de inicialização na imagem real antes de usar o Compose. Criar administração e conta serviço guest-token de privilégio mínimo. Gate: `/health`, init, logs, UUID/URL reais e backup.
**02 — Banco analítico e RLS:** executar o novo `sql/00-preflight-source-schema.sql` em HML antes de revisar/aplicar `01-read-views.sql`. Rodar os gates SQL 02–04 de LOGIN somente leitura. Criar somente datasets físicos com `unit_id`; impedir acesso Guest a SQL Lab, queries virtuais e relações não auditadas. `security_barrier` não equivale a RLS. Gate: duas contas/unidades REAIS, 403 para unidade não autorizada e isolamento de caches e refresh dos tokens.
**03 — Dashboards verificáveis:** começar por OS e Frota/Ativos; adicionar Contratos/Medições se dados e agregações forem reconciliados. Cada painel requer UUID verdadeiro, dataset existente, números iguais aos relatórios nativos, filtros corretos e teste de vazio ≠ erro. As outras famílias só serão ativadas quando prontas, sem painéis falsos ou inventados.
**04 — Integração visível:** reutilizar a rota, shell, autenticação e SDK existentes. Depois de HML validada, adicionar `VITE_ENABLE_SUPERSET_BI=true` ao build imutável em PR específico, testar menu no artefato, 403/PDP e layout desktop/tablet/mobile. Ativar `SUPERSET_EMBED_ENABLED=true` apenas com serviço real, UUIDs, domínio autorizado e CSP testados.
**05 — Produção e aceite:** promover Superset Compose separadamente após backup/restore, validar contas e datasets de produção; publicar Web/API por digest imutável; conferir menu e painéis autenticados no próprio site, multiunidade, métricas, logs e rollback. Aceite empresarial da OS é independente; nunca fabricar evidência.

## Novos preflights não mutáveis
- `psql -X -v ON_ERROR_STOP=1 -f infra/superset/sql/00-preflight-source-schema.sql`: valida cinco relações e colunas de HML **sem executar DDL**.
- `node --test infra/superset/tools/check-config-readiness.test.mjs`: testes do validador estático, não prova runtime.
- `node infra/superset/tools/check-config-readiness.mjs`: verifica somente formato de configuração do processo, sem mostrar secrets; `configValidated=true` não significa implantação nem segurança aprovada.

## Critério de DONE e bloqueios externos
É necessário comprovar serviço Superset real, duas unidades com guest RLS, catálogo físico revisado, dashboards com UUID e métricas corretas, flag no bundle Web, guest token/API, UI navegável e testes em produção. GitHub Actions por si só não fornece autenticação no Coolify nem banco HML; sem acesso autorizado, o gate deve permanecer **pendente**, jamais ser declarado verde.

Rollback: desabilitar backend Superset, reconstruir Web sem a flag se necessário, restaurar último digest conhecido e **preservar volumes e backups**. Não usar `docker compose down -v`.
