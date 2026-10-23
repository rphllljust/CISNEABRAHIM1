# Deploy Coolify — CISNE Rondônia

Runbook autoritativo da produção.

## Arquitetura

```
GitHub
→ CI + Release Ready
→ GHCR
  → cisne-api
  → cisne-worker
  → cisne-web
→ OVH VPS
→ Coolify
→ Traefik
→ produção
```

## Invariantes

1. Build ocorre no GitHub Actions, nunca no VPS.
2. Imagens são promovidas por SHA/digest imutável; `latest` é proibido.
3. API, worker e web pertencem ao mesmo SOURCE_SHA autorizado.
4. Coolify recebe somente imagens já publicadas no GHCR.
5. PostgreSQL e object storage permanecem persistentes e privados.
6. Sem `Release ready = success`, não existe release.

## Workflow

O único workflow de promoção é `.github/workflows/coolify-release.yml`.

Ele resolve o CI pelo SHA, exige Release Ready, verifica provenance, publica API/worker/web, gera payload fail-closed e usa a API oficial do Coolify até estado terminal.

## Validação pós-deploy

Comprove:

- API readiness = 200 e database = up;
- API liveness = 200;
- worker running, restarts=0 e CMD do worker;
- web healthy;
- API/worker/web no mesmo SOURCE_SHA;
- smoke autenticado sem 5xx.

## Railway

Railway foi aposentado como plataforma de deploy. Não existe workflow Railway ativo, script de promoção Railway ou Dockerfile específico do Railway no caminho de produção.
