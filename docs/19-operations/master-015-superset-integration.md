# MASTER 015 — Superset integration (increment 01)

Status: bridge committed for review. No Superset instance, dashboard or frontend SDK has been deployed.

## Existing CISNE components

Audited on main: NestJS API, React web, PostgreSQL/Drizzle, analytics, dashboards,
reports, authorization PDP, scope-matcher and existing rpt read contracts.
No existing CISNE module has been replaced.

## Architecture and security boundary

CISNE browser -> authenticated NestJS endpoint POST /api/v1/analytics/embedded/guest-token
-> current session JWT -> CISNE PDP unit-scoped authorization for EVERY required domain
-> internal Superset login using secret environment credentials -> Superset guest token.
Only short-lived guest tokens, UUID from server config and public Superset origin
are returned to the browser. No credentials are exposed to VITE_ or localStorage.

The server denies by default if disabled, if config is missing, or if PDP cannot prove
unit access. A GLOBAL grant still produces a token for only ONE specified unit.
CLIENT, OWN, ASSIGNED and CONTRACT grants do not silently become UNIT grants.

## Environment variables (backend only, secret manager)

SUPERSET_EMBED_ENABLED=false
SUPERSET_INTERNAL_URL=http://superset:8088/
SUPERSET_PUBLIC_URL=https://superset-hml.example.invalid/
SUPERSET_SERVICE_USERNAME=<secret>
SUPERSET_SERVICE_PASSWORD=<secret>

Per-dashboard UUID keys:
SUPERSET_DASHBOARD_SERVICE_ORDERS_ID
SUPERSET_DASHBOARD_FLEET_ASSETS_ID
SUPERSET_DASHBOARD_CONTRACTS_MEASUREMENTS_ID
SUPERSET_DASHBOARD_FINANCE_TREASURY_ID
SUPERSET_DASHBOARD_OPERATIONAL_COSTS_ID
SUPERSET_DASHBOARD_TRANSPORT_RENTALS_ID
SUPERSET_DASHBOARD_TEAM_PRODUCTIVITY_ID
SUPERSET_DASHBOARD_EXECUTIVE_ID

Values MUST be registered UUIDs from real Superset Embed settings, not invented.

## Infra and requirements for remaining increments

Pin Apache Superset 6.1.0 (verified stable); install @superset-ui/embedded-sdk@0.4.0
with a valid pnpm lockfile only after review. Superset must use its OWN metadata
PostgreSQL, Redis/cache, HTTPS, security keys, monitoring, backup and lifecycle.
Do not use the upstream developer docker-compose unchanged in production.
Enable EMBEDDED_SUPERSET, dedicated guest role, strict Allowed Domains, no SQL Lab,
no SQL-based or semantic datasets accessible to guests, reviewed physical datasets.

HML SQL file infra/superset/sql/01-read-views.sql is NOT an automatic migration.
It adds five read-only analytic views and a NOLOGIN group role. The operator must
verify every column against HML schema, apply manually with rollback readiness,
provision a separate database LOGIN role and confirm it has no direct table read.
Guest-token RLS on unit_id is only safe if all embedded datasets expose unit_id and
the guest role cannot reach unscoped or virtual datasets.

Remaining dashboards (operational costs, transport/rentals, team productivity and
executive) require domain view design and reconciled calculations before activation.
Mixed currencies, null data, accrual bases and unit ownership must not be guessed.

## Release gates

- Unit: input validation, session 401, scope 403, config 503, upstream timeout/failure.
- Integration: PDP direct + role grants, revoked grant/session, global vs unit scope,
  cross-unit denial, RLS cache segregation, guest role resource access, SQL Lab denial.
- PostgreSQL HML: least privilege, row counts and aggregates reconciled with real ERP
  data by unit, distinguish empty result from query failure. No artificial prod data.
- UI increment: SDK, responsive iframe, shell integration, capability probes and
  graceful errors, then Playwright mobile/desktop checks.
- CI, approval, HML evidence, backups and rollback must pass BEFORE production deploy.

CRITICAL BLOCK: keep SUPERSET_EMBED_ENABLED=false until Superset datasets, RLS,
guest role and all security checks have concrete HML evidence. A token already issued
is not instantly revoked if CISNE permissions change: respect short TTL and re-issue
through the authoritative PDP on refresh; for strict instant revocation add a
revocation-aware broker before release.


## Separate HML service scaffold (increment 01)

An opt-in HML Docker Compose stack is supplied in infra/superset/compose.hml.yaml
with Apache Superset 6.1.0, isolated Postgres metadata, Redis and its Python config.
Copy infra/superset/env.hml.example to an untracked .env.hml and replace ALL
placeholders via a secure environment. First validate image entrypoint and config
against Superset 6.1.0 in HML. Initialization is manual; the service is NOT running
and no default admin or guest roles are created by the CISNE integration.


## Increment 02 — React bridge (candidate for CI)

- Added browser-only @superset-ui/embedded-sdk@0.4.0, lockfile pinned against
  npm-registry package integrity and explicit dependency versions.
- Route /app/reports/embedded uses existing CISNE shell, auth context and operational
  unit loader; the native reports center remains untouched.
- Backend GET /api/v1/analytics/embedded/catalog evaluates PDP by scope and advertises
  only configured and permitted dashboards; POST issues guest tokens after PDP recheck.
- Menu item is opt-in at web build: VITE_ENABLE_SUPERSET_BI=true. By default not shown.
  Backend separately requires SUPERSET_EMBED_ENABLED=true and actual configured UUIDs.
- Runtime guest tokens are held only in closure memory. Iframe unmounts on route, unit,
  user or session change; SDK token refresh rechecks PDP and resource identity.
- Error states distinguish HTTP 403, HTTP 401 and service/network failure. Empty data
  is never fabricated on transport errors.

This is source integration, not proof of runtime embedding. The HML Superset service,
allowed origins, dashboards, dataset RLS, separate DB reader and real-data E2E must
still be verified before release/merge/deploy.

## Increment 03 — HML initialization dependency and release evidence

The HML web service now requires `superset-init` to exit successfully before
starting, in addition to metadata health and cache availability. A failed
schema upgrade or security-role initialization must not be hidden by a healthy
web process. This is an opt-in Compose configuration, not proof of a running
instance. Validate the image's entrypoint and Gunicorn application import in
HML before enabling the service.

Release evidence is still missing: live HML URL and credentials, a completed
metadata backup/restore drill, approved OLTP read grants and dataset mappings,
real multiunit RLS isolation (including cache and token refresh), Allowed
Domains and iframe CSP, and dashboard-level reconciled counts. The 14 green
GitHub CI jobs on the previous commit validate source-level gates only.

## Increment 04 — fail-closed HML database privilege preflight

Run `psql -X -v ON_ERROR_STOP=1 -f infra/superset/sql/02-verify-reader-privileges.sql`
using a privileged HML database connection **after** reviewing/applying the views.
The preflight is read-only and fails if any expected view lacks `unit_id`,
`security_barrier=true`, or SELECT for the NOLOGIN reader group; it also rejects
SELECT access to OLTP or unrelated non-BI relations for that group. It does not
establish that the eventual LOGIN role has no direct grants, that Superset's guest
role is restricted, or that row-level filtering actually works. Those require
separate live HML checks and evidence. Do not enable embedding based on this
preflight alone.


## Increment 06 — exact dataset scope preflight

Run 04-verify-exact-dataset-scope.sql against the HML Superset LOGIN with psql -X -v ON_ERROR_STOP=1 and reader_login supplied. The read-only gate rejects effective SELECT outside the five reviewed views, including unreviewed BI relations, and rejects unexpected columns. It does not prove Superset guest RLS; test cross-unit denial and real datasets in HML separately.


## Increment 07 — bidirectional dataset column preflight

The exact-scope SQL gate now rejects missing mandatory columns in addition to unexpected columns. This is a read-only HML check and is not proof of live execution. PostgreSQL security_barrier views are not unit RLS. Superset guest-token RLS, dataset scoping, cache isolation and real multiunit negative tests remain mandatory before enablement, merge or deployment.
