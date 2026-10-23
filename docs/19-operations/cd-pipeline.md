# OPS-CD-001 — Continuous Delivery

| Campo | Valor |
| ----- | ----- |
| Document ID | OPS-CD-001 |
| Status | IMPLEMENTED |
| Runtime authority | Coolify on OVH VPS |
| Image registry | GHCR |

## Fluxo autoritativo

```
main
→ CI
→ Release ready
→ immutable artifact + provenance
→ GHCR (api / worker / web)
→ Coolify API
→ OVH production
```

Railway não participa do fluxo de build, promoção ou produção.

## Build once

- CI compila uma vez e publica `cisne-build-<run_id>`.
- O bundle imutável vive em `artifacts/release`.
- `deploy-manifest.json` registra `artifactDigest`, `commitSha` e `buildRunId`.
- Divergência entre SOURCE_SHA, BUILD_SHA e MANIFEST_SHA bloqueia o release.

## Release authority

`.github/workflows/coolify-release.yml` só publica quando o job `Release ready` do CI do mesmo SHA terminou com `success`.

Imagens publicadas no GHCR:

- `cisne-api:<SOURCE_SHA>`
- `cisne-worker:<SOURCE_SHA>`
- `cisne-web:<SOURCE_SHA>`

O deploy usa digests imutáveis; `latest` é proibido.

## Runtime

Coolify é o plano de implantação. O VPS não compila source e não funciona como runner de CI.

A promoção é:

```
PATCH imagem por digest
→ POST deploy
→ estado terminal
→ prova de SHA/digest implantados
```

## Migrations

A política em `migration-policy.ts` permanece fail-closed. Mudança incompatível exige expand/contract; o gate não pode ser enfraquecido para liberar deploy.

## Rollback

Rollback de aplicação = redeploy de digest anterior autorizado. Banco de dados não é revertido automaticamente.

## Arquitetura congelada

GitHub = source/release authority.
GHCR = registry.
Coolify = deployment/runtime plane.
OVH VPS = compute.
Traefik = edge.

Nenhum workflow alternativo pode promover produção em paralelo.
