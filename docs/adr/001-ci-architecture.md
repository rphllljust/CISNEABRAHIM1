# ADR-001 — Arquitetura de CI: o que bloqueia PR, o que roda async

- Status: **Proposto** (2026-11-08). Decisor: @rphllljust. Prazo: 2026-11-09.
- Evidência de origem: Visual full do #284 (run 42502657505): 163 falhas, 126 ok; run do #278 (42488676000): 84 únicos. Os "174" iniciais contavam retries; a maioria era mock drift, seletor e baseline defasado, não regressão de produto.

## Contexto
1. `Visual full` roda a suíte completa (300 testes, ~15 min) e vira obrigatório via `Release ready` quando o PR toca superfície visual (`ci.yml`, classificador de risco visual). Resultado medido: 163 falhas num PR de fixtures; 0 delas eram bug de produto novo.
2. Baselines de screenshot ficam em `apps/web/e2e/**-snapshots/*.png`, gerados sem container pinado. Contabilidade tem baseline de 2026-09-30, anterior ao shell (`0b7819b6` 2026-10-07; `53e65f94` 2026-10-14): largura +32/+8/+4px constante em dois runs, com e sem container.
3. Mocks de API são escritos à mão em `apps/web/e2e/fixtures/*.ts`, um por família. Mock ausente vira 404 e a tela cai em "Erro inesperado" (`/dashboard/executive` na Contabilidade: `reading 'charts'`), só descoberto no Visual full.
4. `Production Business Evidence` já é job de ambiente (`workflow_run` do TLS na main + `schedule`) e "does not gate this technical release" (`coolify-release.yml:337`); a confusão é de leitura, não de gatilho.
5. PRs grandes travam: #278 tem 102 arquivos (67 PNG), e remove o filtro `paths` do Visual full.

## Decisão
1. **Visual full não gateia PR de código.** Roda nightly e em `push: main`, abre issue automática se falhar. Gate de PR visual = `Visual critical` (3 specs, 1 viewport). [DECISÃO PENDENTE: @rphllljust, 2026-11-09 — contraria o contrato atual em que `Release ready` exige Visual full em PR de risco visual; muda o README/AGENTS.]
2. **Baseline só via bot, em container pinado** `mcr.microsoft.com/playwright:v1.62.1-noble` (versão de `@playwright/test@1.62.1`, `pnpm-lock.yaml:1223`), por `workflow_dispatch` (`visual-baseline.yml`, #290), sempre em PR **draft** revisado tela a tela. Nunca local.
3. **E2E completo async; smoke no PR.** [DECISÃO PENDENTE: @rphllljust, 2026-11-09 — definir quais specs formam o smoke; hoje `API E2E` e `Integration` (~12 min) estão no caminho crítico.]
4. **Mock coberto por teste de contrato.** Curto prazo: teste de ratchet que falha em NOVO 404 de `/api/v1` na primeira renderização de cada rota visual. Longo prazo: mocks gerados de contrato OpenAPI. [DECISÃO PENDENTE: @rphllljust, 2026-11-14 — `apps/api` não exporta OpenAPI no CI hoje; não verificado se o Nest já gera o documento.]
5. **Branch protection mínima:** `Release ready` agregando lint+typecheck+audit, unit, integration, API E2E, build, migration gate e `Visual critical`. [DECISÃO PENDENTE: @rphllljust — a API de proteção de branch retorna 403 para o token da sessão; a lista real não foi lida.]
6. **PR com mais de 20 arquivos não mergeia** (PNG de baseline e lockfile não contam). Dividir é obrigatório; vale para #278.
7. **Production Business Evidence é job de ambiente**, nunca check de PR. Permanece como está; esta ADR só registra a regra.

## Consequências
- (+) Menos falso vermelho no PR; diferença entre "código quebrou" e "baseline envelheceu" fica explícita.
- (+) Regressão visual real detectada em até 24 h (nightly) com issue, em vez de bloquear merge.
- (−) Uma regressão visual pode entrar na main antes de ser vista (janela de até 24 h). Mitigação: Visual critical + `push: main`.
- (−) Baseline por bot exige workflow extra e revisão humana do PR draft.
- (−) Exige alterar `ci.yml` (classificador visual) e a branch protection.

## Alternativas rejeitadas
- **Manter Visual full gate e subir `retries`/timeout/tolerância:** esconde causa; viola a regra de não mascarar flaky.
- **Re-baselinar localmente:** Chrome/fonte divergem; o baseline passaria a ser o ambiente de quem gerou.
- **Mover tudo para manual:** perde o sinal diário.
- **Aceitar o #278 inteiro:** 102 arquivos, `paths` removido (todo PR roda 35 min de Visual full), PNGs sem prova de geração por bot.
