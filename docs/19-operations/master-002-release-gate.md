# MASTER 002 — Autoridade de liberação empresarial por SHA

O merge técnico não autoriza GHCR/Coolify. O workflow `.github/workflows/coolify-release.yml` usa um controle **fail-closed**, antes da seleção do CI/HML e antes da publicação de imagens.

## Autorizações aceitas

A liberação necessita de **um** dos dois canais abaixo, vinculados ao SHA EXATO do commit atual de `main`:

1. **Variável operacional já existente:** `CISNE_BUSINESS_APPROVED_SHA`, em Settings → Secrets and variables → Actions → Variables. Valor inválido/desatualizado bloqueia o release.
2. **Decisão explícita do proprietário via GitHub Issue #240:** quando a variável está vazia, o gate consulta a API autenticada do GitHub com `issues: read`, exige comentário **não editado** da conta administradora `rphllljust` (ID 264246201) com a linha exata:

   `CISNE_RELEASE_GO_V1 SHA=<SHA_HEXADECIMAL_40_CARACTERES> DECISION=APPROVE`

   Para revogar, o proprietário publica comentário novo com:

   `CISNE_RELEASE_GO_V1 SHA=<MESMO_SHA> DECISION=REVOKE`

   O comentário **mais recente** do proprietário para aquele SHA determina o resultado. Sem comentário válido, comentário editado, revogação, API indisponível ou SHA divergente: bloqueia. Outros usuários e textos do PR não constituem aprovação.

Não editar um comentário de decisão; revogar por novo comentário, preservando o histórico. **Um aceite comercial não é prova de que os 192 critérios e cinco jornadas tenham sido individualmente testados.** A matriz permanece fiel aos resultados `NOT_RUN` até haver evidência por critério.

## Procedimento

1. Verificar `main`, CI `Release ready`, PostgreSQL Integration, API E2E e HML para o mesmo SHA.
2. Registrar o GO do proprietário (ou a variável) com o SHA final da `main` e os riscos/pendências explicitados no Issue #240.
3. Reexecutar somente o job de release com falha (ou usar `workflow_dispatch` em `main`), sem ignorar os gates.
4. Confirmar sucesso de `Require Release Ready`, publicação das três imagens (API/Web/Worker) no GHCR com digests imutáveis e execução do Coolify.
5. Validar versão efetiva no runtime, health/readiness, login, smoke autenticado, browser de produção, TLS e integridade das transações. Não Railway. Sem dados sintéticos em produção.
6. Se qualquer evidência falhar, interromper a promoção, investigar causa concreta e revogar aprovação por comentário novo.

**O gate técnico só prova a autorização explícita de publicação; não converte automaticamente requisitos funcionais em `PASS`.**

Testes: `node --test scripts/cd/verify-business-release-approval.test.mjs scripts/cd/verify-owner-business-release-approval.test.mjs`.
