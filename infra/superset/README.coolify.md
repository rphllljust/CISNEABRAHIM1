# MASTER 015 — Coolify deployment contract

This file documents an opt-in Superset **HML first** deployment. It does not state that a Coolify application or an external database already exists.

## Deploy as an isolated stack

1. In Coolify select the **HML project/environment**, then create a Git-based Docker Compose Application from this repository/branch.
2. Set **Base directory** to `/infra/superset` and **Compose file** to `compose.coolify.yaml` (adjust to the Coolify version's file-path selector; inspect the rendered Compose to ensure the bind mount resolves to `superset_config.py`).
3. Set `SUPERSET_METADATA_USER`, `SUPERSET_METADATA_PASSWORD`, `SUPERSET_SECRET_KEY` and `SUPERSET_GUEST_TOKEN_JWT_SECRET` in Coolify's secret-aware Environment Variables, with distinct randomly generated secrets. Never commit values or copy them to GitHub Actions logs.
4. In the Domains setting confirm the generated `SERVICE_URL_SUPERSET_WEB_8088` points to the authorized HML HTTPS domain on **internal port 8088**. The Compose has **no host-published ports**.
5. Inspect the resulting Coolify network, containers, volume names, first-run `superset-init` exit status and `superset-web` health. Do not mistake a green web container for valid guest security.
6. Using an interactive operator session, provision the **Superset service user** with the minimum role allowing guest-token issuance. Provision `CISNE_EMBEDDED_GUEST` with access only to the reviewed physical datasets, and **no SQL Lab, SQL execution, database creation, virtual dataset, or datasource administration** capabilities. Apply per-dashboard Allowed Domains; verify the TLS proxy's frame-ancestors CSP against only the CISNE HML web origin.
7. In the **separate CISNE HML database** (not Superset metadata Postgres), have the DBA review/apply `sql/01-read-views.sql`, create a distinct least-privilege reader LOGIN, grant membership in `cisne_superset_reader`, and run all three read-only gates `02-verify-reader-privileges.sql`, `03-verify-login-privileges.sql`, `04-verify-exact-dataset-scope.sql` with `psql -X -v ON_ERROR_STOP=1`. Record HML database/role identifiers without including any passwords.
8. Configure exactly the authorized **five physical views** as Superset datasets; ensure every embedded resource uses these views and has `unit_id`, and that no virtual or unscoped dataset is reachable by guests. Eight dashboard families are planned; enable a family only after its full dataset and permission contract has been verified. Never invent dashboard UUIDs or data.
9. Execute authenticated HML browser tests for at least two real authorized units, including cross-unit negative queries, PDP revocation, iframe refresh, dashboard cache isolation, and reconciliation against the native CISNE reports. Complete metadata database backup and **restore drill**.
10. Only after the HML evidence passes, configure the CISNE HML API `SUPERSET_INTERNAL_URL` using the **actual** verified Coolify service hostname, `SUPERSET_PUBLIC_URL` using the authorized HTTPS origin, service credentials and verified dashboard UUIDs. Test first with `SUPERSET_EMBED_ENABLED=false`; only enable in HML after authorization tests. The React menu uses the independent build flag `VITE_ENABLE_SUPERSET_BI=true`.

## Release policy

The existing `.github/workflows/coolify-release.yml` is **not** a Superset installer. It publishes CISNE API/Web/Worker images by immutable digest and requires an exact-SHA business approval, CI and isolated HML gate. Do not change or bypass it just because a new Superset Compose file exists.

Deploy Superset to the production Coolify environment separately **only after** the HML security proof and backup/rollback signoff. Keep the API feature flag disabled during infrastructure rollout, enable it only after the approved dashboard/dataset policy is reconciled with production data and CSP. Never use Railway for MASTER 015.

Rollback: disable `SUPERSET_EMBED_ENABLED`, disable `VITE_ENABLE_SUPERSET_BI` on the next web build, and redeploy the last approved immutable CISNE image digests. Preserve Superset metadata volumes and database backups; do not `docker compose down -v`. Validate production health and the actual deployed SHA before declaring completion.
