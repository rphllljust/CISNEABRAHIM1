# Coolify — política de publicação automática por CI/HML (MASTER 015)

A publicação da API/Web/Worker na `main` não exige mais aprovação empresarial manual por `CISNE_BUSINESS_APPROVED_SHA` nem comentário de issue.

**Autoridade técnica obrigatória** no workflow `.github/workflows/coolify-release.yml`:
1. O workflow de CI na `main` precisa terminar com SUCCESS para o commit exato (não basta uma execução anterior).
2. O job `Release ready` do mesmo SHA precisa terminar com SUCCESS.
3. A HML isolada da `main` deve ter a execução e o job autoritativo aprovados para o mesmo SHA. HML ausente, pendente, falha ou cancelada não autoriza release.
4. O SHA atual da `main` deve ser exatamente o do release; `main` avançada interrompe a publicação.
5. As imagens API/Web/Worker são publicadas com provenance e digest imutável verificados.
6. A implantação exige secrets e UUIDs reais do Coolify, validação do ambiente, health, smoke autenticado e browser gate. Falhas continuam bloqueando ou sinalizando o deploy conforme a etapa.

**Atenção ao escopo:** este workflow continua publicando somente **CISNE API/Web/Worker**, não provisiona Apache Superset. O Superset permanece opt-in com `SUPERSET_EMBED_ENABLED=false` por padrão e requer seus próprios testes de RLS, datasets e autenticação em ambiente real antes de ser habilitado. O teste HML isolado existente usa stack/dados sintéticos e não prova, sozinho, a segurança dos dashboards Superset em Coolify.

**Risco operacional explícito:** após mesclar este ajuste, cada novo SHA aprovado pelos gates CI/HML da `main` poderá acionar automaticamente uma implantação de produção no Coolify, sem uma confirmação manual adicional. Faça rollback apenas usando o último artefato imutável comprovadamente válido, sem desabilitar gates ou expor secrets.
