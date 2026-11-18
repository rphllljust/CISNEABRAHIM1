# Dependency audit exceptions

## CVE-2026-112366 — `picomatch`

- Status: explicitly ignored by `audit:deps` until an upstream patched release exists.
- Scope: transitive development-tool dependencies (`@nestjs/cli` and `unplugin-swc`); not a runtime application dependency.
- Reason: the npm advisory currently reports no patched version (`patched_versions: <0.0.0`); the latest published `picomatch` version remains `4.0.7`.
- Control: the CI command ignores only this CVE. Any other high or critical advisory still fails the pipeline.
- Follow-up: remove the ignore and regenerate the lockfile as soon as an upstream patched version is published.
