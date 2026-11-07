# Release Coolify: aceite empresarial independente (06/11/2026)

O release do CISNE API/Web/Worker continua exigindo CI `Release ready`, HML isolada no SHA exato da `main`, proveniência imutável dos artefatos, segredos/configuração do Coolify, deploy, smoke autenticado e Browser Gate técnico. **Esses gates não foram dispensados.**

O teste de aceite empresarial da cadeia OS → medição → aceite → faturamento **deixa de bloquear o release técnico**. Uma OS incompleta, inexistente ou sem workbench elegível não pode impedir a publicação de código que tenha passado pelos gates técnicos.

A comprovação de negócio não é falsificada: o validador preserva `businessVerified=false`, `productionBusinessValidated=false` ou `NOT_APPLICABLE`/`UNKNOWN`, `businessOutcome` e `productionValidated=false`/`CONDITIONAL`. A evidência permanece no artefato `browser-gate-<SHA>` e no resumo do job. **Release técnico SUCCESS não significa aceite empresarial PASS.**

O workflow **Production Business Evidence** continua independente, read-only, com seu próprio status. Não criar OS, clientes, medidas, documentos, dados fictícios ou mudar status manualmente para passar aceite. Não publicar Superset ou ativar flags só porque API/Web/Worker foram implantados; dados, dashboards e RLS do Superset continuam sujeitos à homologação real.

**Rollback:** usar o último digest imutável confirmado, sem apagar volumes ou bypass de credenciais.
