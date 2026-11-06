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
