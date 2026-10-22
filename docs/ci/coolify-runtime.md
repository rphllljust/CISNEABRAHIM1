# Coolify immutable runtime

## Authority

GitHub Actions remains the release authority. Coolify is a runtime/deployment plane only.

```
GitHub main
  -> CI
  -> Release Ready
  -> immutable CI artifact
  -> provenance verification
  -> GHCR images by digest
  -> Coolify
  -> OVH VPS-1
```

A Coolify deployment must never rebuild `main` and must never use `:latest`.
The deployed API/Web image references must include `@sha256:<digest>`.

## Runtime resources

| Resource | Image / runtime | Port | Health |
| --- | --- | ---: | --- |
| cisne-api | immutable API image | 3000 | /api/v1/health/ready |
| cisne-worker | same immutable API image | none | process health |
| cisne-web | immutable NGINX image | 80 | /health |
| cisne-postgres | PostgreSQL production resource | internal | pg_isready |
| cisne-object-storage | S3-compatible resource | internal | provider health |

The worker command is `node apps/api/dist/worker/main.js`.

## Web runtime configuration

The Web image is immutable across environments. The container creates
`/runtime-config.js` at startup from `CISNE_PUBLIC_API_URL`, and the browser
prefers that value over the legacy build-time `VITE_API_BASE_URL`.

This removes the contradiction between a build-time API URL and
build-once/promote-many. The legacy Vite variable remains as a compatibility
fallback during migration.

## Current cutover constraints

A public domain is still required before final production cutover so
`CISNE_PUBLIC_API_URL` and CORS can use the final HTTPS origin. It does not
block registry publication, database/storage preparation, internal API/worker
validation, or immutable-image generation.

Railway remains available until Coolify passes readiness, authenticated smoke,
SHA/digest verification, backup validation and capacity checks.
