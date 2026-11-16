# CISNE frontend v2 — isolated upstream import

**Status:** SOURCE_IMPORTED_ONLY. No CISNE authentication, API integration,
business module or production deployment has been certified.

- Source: https://github.com/Kiranism/next-shadcn-dashboard-starter
- Pinned source SHA: 47da494b89e330d884a0f9b5c37a605fbabb3987
- License: MIT; upstream license retained in this directory.
- Existing app: `apps/web` (Vite/React); remains authoritative.
- New template: `frontend-v2` (Next.js); intentionally outside the
  pnpm workspace until compatibility, security, and quality gates pass.
- Existing API/database: `apps/api` / `packages/database`; no modifications.

## Hard boundaries
1. Do not deploy, route production traffic, or switch DNS to frontend-v2.
2. Do not use Clerk as an alternative identity authority for CISNE.
3. Audit and replace Clerk middleware/session/org/permission dependencies
   with a CISNE-compatible server-side session integration before serving
   business routes. Keep this template isolated until then.
4. Preserve backend capabilities, tenant isolation, CSRF/session strategy,
   authorization, and API contracts; never treat UI permissions as security.
5. Never copy demo accounts, fixtures, or mock data into production APIs.
6. Port one end-to-end CISNE module at a time and compare outputs with
   the existing app through functional, browser, and authorization tests.
7. No merge to main without explicit acceptance and verified CI/E2E.
