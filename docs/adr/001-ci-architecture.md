# ADR-001 — Arquitetura de CI: o que bloqueia PR, o que roda async

- Status: **Aceito** (2026-11-08). Decisor: @rphllljust (decisões fechadas por instrução do owner na sessão de 2026-11-08; revisão em 2026-11-22).
- Evidência de origem: Visual full do #284 (run 42502657505): 163 falhas, 126 ok; run do #278 (42488676000): 84 únicos. Os "174" iniciais contavam retries; a maioria era mock drift, seletor e baseline defasado, não regressão de produto.

## Contexto
1. `Visual full` roda a suíte completa (300 testes, ~15 min) e vira obrigatório via `Release ready` quando o PR toca superfície visual (`ci.yml`, classificador de risco visual). Resultado medido: 163 falhas num PR de fixtures; 0 delas eram bug de produto novo.
2. Baselines de screenshot ficam em `apps/web/e2e/**-snapshots/*.png`, gerados sem container pinado. Contabilidade tem baseline de 2026-09-30, anterior ao shell (`0b7819b6` 2026-10-07; `53e65f94` 2026-10-14): largura +32/+8/+4px constante em dois runs, com e sem container.
3. Mocks de API são escritos à mão em `apps/web/e2e/fixtures/*.ts`, um por família. Mock ausente vira 404 e a tela cai em "Erro inesperado" (`/dashboard/executive` na Contabilidade: `reading 'charts'`), só descoberto no Visual full.
4. `Production Business Evidence` já é job de ambiente (`workflow_run` do TLS na main + `schedule`) e "does not gate this technical release" (`coolify-release.yml:337`); a confusão é de leitura, não de gatilho.
5. PRs grandes travam: #278 tem 102 arquivos (67 PNG), e remove o filtro `paths` do Visual full.

## Decisão
1. **Visual full não gateia PR de código.** Roda nightly e em `push: main`, abre issue automática se falhar. Gate de PR visual = `Visual critical` (3 specs, 1 viewport).
   **Decidido:** `Visual critical` bloqueia PR; `Visual full` é async (nightly + `push: main`). **Porque:** o run real do #284 teve 163 falhas sem bug de produto novo, e o gate já operava assim na prática (merges com `Release ready` verde e Visual full vermelho, ex.: #284 `9915a8e1`). **Consequência:** `ci.yml` deixa de exigir `visual-full` no `Release ready` e README/AGENTS precisam refletir isso (PR de implementação; até lá o contrato atual vale).
2. **Baseline só via bot, em container pinado** `mcr.microsoft.com/playwright:v1.62.1-noble` (versão de `@playwright/test@1.62.1`, `pnpm-lock.yaml:1223`), por `workflow_dispatch` (`visual-baseline.yml`, #290), sempre em PR **draft** revisado tela a tela. Nunca local.
3. **E2E completo async; smoke no PR.**
   **Decidido:** smoke no PR (`API E2E` + `Visual critical`), E2E completo nightly. **Porque:** `Integration` (~12–15 min) já é o caminho crítico e o resto do E2E só soma tempo. **Consequência:** a lista exata de specs do smoke é a de `test:visual:critical` + `API E2E`; mover o restante para agendado fica para a ADR-002.
4. **Mock coberto por teste de contrato.** Curto prazo: teste de ratchet que falha em NOVO 404 de `/api/v1` na primeira renderização de cada rota visual. Longo prazo: mocks gerados de contrato OpenAPI.
   **Decidido:** mock gerado de contrato OpenAPI no próximo trimestre (alvo: 2027-02-28); **débito registrado**. **Porque:** `apps/api` não publica OpenAPI no CI hoje (não verificado se o Nest já gera o documento) e o ratchet do #292 cobre o risco no intervalo. **Consequência:** até lá, todo mock novo entra com a rota coberta pelo ratchet e o baseline só encolhe (issue #294 lista as 6 rotas restantes, prazo 2026-11-15).
5. **Branch protection mínima:** `Release ready` agregando lint+typecheck+audit, unit, integration, API E2E, build, migration gate e `Visual critical`.
   **Decidido:** configuração proposta — checks obrigatórios: `Release ready` (agrega lint/typecheck/audit, unit, integration, API E2E, build, migration gate, `Visual critical`), branch atualizada (`strict`), sem `Visual full`. **Porque:** a API de proteção devolve 403 ao token da sessão (a lista real não foi lida), então só o admin do repositório pode aplicar. **Consequência:** aplicar manualmente em Settings → Branches até **2026-11-10**; até lá a proteção vigente é a que existe hoje.
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
