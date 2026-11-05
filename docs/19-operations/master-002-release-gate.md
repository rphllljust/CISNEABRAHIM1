# MASTER 002 — Separação de merge técnico e publicação empresarial

Este controle tem semântica **fail-closed**. A integração de um PR na `main` não constitui aceite funcional. O workflow `.github/workflows/coolify-release.yml` executa o gate de aprovação **antes de publicar imagens GHCR**. Se a aprovação estiver ausente, inválida ou corresponder a outro SHA, **GHCR e deploy Coolify não são iniciados**.

## Regra operacional

1. Manter `CISNE_BUSINESS_APPROVED_SHA` (GitHub **Settings → Secrets and variables → Actions → Variables**) sem valor válido enquanto os 185 critérios do MASTER 002, as 16 áreas e as cinco jornadas não tiverem provas e sign-off documentados. Essa variável é de autorização operacional; o SHA não é um segredo.
2. Todo commit que altere `main` exige **novo aceite pelo SHA exato**. O gate lê `EXPECTED_SHA` do evento do workflow e compara-o com a variável, recusando aprovações obsoletas.
3. Para liberar uma publicação após o aceite, validar os registros e a revisão, preencher `CISNE_BUSINESS_APPROVED_SHA` com o SHA atual de `main`, e acionar **Coolify Release Images** por `workflow_dispatch` na `main`. CI `Release ready` e HML no mesmo SHA continuam obrigatórios; a variável não os substitui.
4. Confirmar digests GHCR, deployment API/Web/Worker Coolify, smoke autenticado, TLS, browser e aceite em produção. Não usar Railway. Não criar dados de negócio sintéticos em produção.

**Importante:** o gate valida a autorização explícita do responsável, **não** finge executar os 185 critérios. A comprovação desses critérios continua registrada no issue #240. Um merge técnico com esta proteção não autoriza release empresarial.

Testes: `node --test scripts/cd/verify-business-release-approval.test.mjs`.
