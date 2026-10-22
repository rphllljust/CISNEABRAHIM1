#!/usr/bin/env bash
# BOOTSTRAP DO RUNNER SELF-HOSTED — REFERENCIA, NAO USAR NO VPS-1
#
# ─────────────────────────────────────────────────────────────────────────────────────────────
# AVISO ARQUITETURAL (2026-10-22)
# ─────────────────────────────────────────────────────────────────────────────────────────────
#
# O CI do CISNE roda em runners GitHub-hosted. O VPS-1 da OVH e o host de PRODUCAO
# (Coolify + CISNE API + CISNE Web) e NAO deve executar CI.
#
# Este script permanece no repositorio como referencia para o cenario em que o CI volte a
# precisar de um host dedicado — e nesse caso sera um VPS EXCLUSIVO de CI, nunca o de producao.
#
# NAO EXECUTE ESTE SCRIPT NO VPS-1.
# Ver docs/ci/execution-plane.md.
#
# BOOTSTRAP DO RUNNER SELF-HOSTED DE CI — reproduzivel, idempotente, nao-interativo.
#
# Uso (como root, numa VM Linux limpa):
#
#   CISNE_RUNNER_TOKEN=<token> \
#   CISNE_REPO_URL=https://github.com/rphllljust/CISNEABRAHIM1 \
#   bash scripts/ci/bootstrap-runner.sh
#
# O token vem de: GitHub > Settings > Actions > Runners > New self-hosted runner.
# NUNCA commite o token. Este script nao o grava em lugar nenhum alem do `config.sh`,
# e o passo de registro roda uma unica vez.
#
# O QUE ESTE SCRIPT GARANTE
#
#   1. Docker instalado e habilitado (para o PostgreSQL efemero do CI).
#   2. Node 22 + pnpm 9.15.9 (a mesma versao do CI) — evita divergencia entre local e CI.
#   3. PostgreSQL de teste em container residente, com credenciais DESCARTÁVEIS.
#   4. Caches persistentes com identidade por conteudo (pnpm store, turbo).
#   5. Runner self-hosted registrado com os labels exigidos pelo workflow.
#   6. Paths de cache fora do diretorio de trabalho: `actions/checkout` limpa o workspace
#      a cada job, e um cache dentro dele seria apagado — inutil.
#
# SEGURANCA
#
#   - O PostgreSQL de teste escuta apenas em 127.0.0.1. Nunca exposto.
#   - Credenciais sao descartaveis por design; nao sao secrets de producao.
#   - O runner roda como usuario dedicado `cisne-ci`, nunca como root.
set -euo pipefail

RUNNER_VERSION="${RUNNER_VERSION:-2.329.0}"
RUNNER_USER="${RUNNER_USER:-cisne-ci}"
RUNNER_HOME="${RUNNER_HOME:-/opt/cisne-ci-runner}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,cisne-ci,ovh,linux,x64}"
WORK_ROOT="${WORK_ROOT:-/opt/cisne-ci-work}"
CACHE_ROOT="${CACHE_ROOT:-/opt/cisne-ci-cache}"
PG_CONTAINER="${PG_CONTAINER:-cisne-ci-postgres}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-cisne_ci}"
PG_PASSWORD="${PG_PASSWORD:-cisne_ci_disposable_password}"

: "${CISNE_REPO_URL:?CISNE_REPO_URL is required}"
: "${CISNE_RUNNER_TOKEN:?CISNE_RUNNER_TOKEN is required (Settings > Actions > Runners)}"

log() { printf '\n[bootstrap-runner] %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "This script must run as root (it installs packages and creates a service user)." >&2
  exit 1
fi

# ───────────────────────────────────────────────────────────────────────────────
# 1. DOCKER
# ───────────────────────────────────────────────────────────────────────────────
log "installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker
log "docker $(docker --version)"

# ───────────────────────────────────────────────────────────────────────────────
# 2. USUARIO DO RUNNER (nunca root)
# ───────────────────────────────────────────────────────────────────────────────
log "creating user ${RUNNER_USER}"
if ! id -u "${RUNNER_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${RUNNER_USER}"
fi
usermod -aG docker "${RUNNER_USER}"

# ───────────────────────────────────────────────────────────────────────────────
# 3. NODE + PNPM — mesma versao do CI para nao divergir
# ───────────────────────────────────────────────────────────────────────────────
log "installing Node.js 22 + pnpm 9.15.9"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pnpm@9.15.9
log "node $(node -v) · pnpm $(pnpm -v)"

# ───────────────────────────────────────────────────────────────────────────────
# 4. CACHES PERSISTENTES — fora do workspace, que o checkout limpa a cada job
# ───────────────────────────────────────────────────────────────────────────────
log "preparing persistent caches at ${CACHE_ROOT}"
mkdir -p "${CACHE_ROOT}/pnpm-store" "${CACHE_ROOT}/turbo"
chown -R "${RUNNER_USER}:${RUNNER_USER}" "${CACHE_ROOT}"
# `pnpm config` por usuario: o store sobrevive entre jobs e nao e tocado pelo checkout.
sudo -u "${RUNNER_USER}" pnpm config set store-dir "${CACHE_ROOT}/pnpm-store" --global

# ───────────────────────────────────────────────────────────────────────────────
# 5. POSTGRESQL DE TESTE — residente, apenas loopback
# ───────────────────────────────────────────────────────────────────────────────
log "starting test PostgreSQL on 127.0.0.1:${PG_PORT}"
docker rm -f "${PG_CONTAINER}" >/dev/null 2>&1 || true
docker run -d \
  --name "${PG_CONTAINER}" \
  --restart unless-stopped \
  -e POSTGRES_USER="${PG_USER}" \
  -e POSTGRES_PASSWORD="${PG_PASSWORD}" \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1:"${PG_PORT}":5432 \
  postgres:18-alpine \
  -c max_connections=200 \
  -c fsync=off \
  -c synchronous_commit=off \
  -c full_page_writes=off

# `fsync=off` e seguro AQUI: este banco so contem dados de teste descartaveis, e o ganho de
# escrita acelera migrations e fixtures. Nunca use isso num banco com dado real.

for i in $(seq 1 60); do
  if docker exec "${PG_CONTAINER}" pg_isready -U "${PG_USER}" -d postgres >/dev/null 2>&1; then
    log "postgres ready"
    break
  fi
  [[ $i -eq 60 ]] && { echo "postgres did not become ready" >&2; exit 1; }
  sleep 1
done

# ───────────────────────────────────────────────────────────────────────────────
# 6. RUNNER SELF-HOSTED
# ───────────────────────────────────────────────────────────────────────────────
log "installing GitHub Actions runner ${RUNNER_VERSION}"
mkdir -p "${RUNNER_HOME}" "${WORK_ROOT}"
cd "${RUNNER_HOME}"

if [[ ! -f ./config.sh ]]; then
  ARCH="x64"
  curl -fL -o runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${ARCH}-${RUNNER_VERSION}.tar.gz"
  tar xzf runner.tar.gz
  rm -f runner.tar.gz
  ./bin/installdependencies.sh
fi

# Registro: se ja existe `--runnertoken`, o runner ja foi configurado; reinstalar quebraria.
if [[ ! -f .runner ]]; then
  log "registering runner with labels ${RUNNER_LABELS}"
  sudo -u "${RUNNER_USER}" ./config.sh \
    --unattended \
    --replace \
    --url "${CISNE_REPO_URL}" \
    --token "${CISNE_RUNNER_TOKEN}" \
    --name "cisne-ci-ovh-$(hostname -s)" \
    --work "${WORK_ROOT}" \
    --labels "${RUNNER_LABELS}"
fi

chown -R "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_HOME}" "${WORK_ROOT}"

# Servico systemd: o runner precisa sobreviver a reboot da VM.
log "installing systemd service"
./svc.sh install "${RUNNER_USER}"
./svc.sh start
./svc.sh status || true

log "DONE"
cat <<EOF

Runner online. Verifique em:
  GitHub > Settings > Actions > Runners

Labels: ${RUNNER_LABELS}
Workspace: ${WORK_ROOT}
Caches: ${CACHE_ROOT}
Test PostgreSQL: 127.0.0.1:${PG_PORT} (container ${PG_CONTAINER})

Proximo passo no repositorio (uma vez):
  gh variable set CI_INTEGRATION_RUNNER --body "ovh"
  gh variable set CI_INTEGRATION_WORKERS --body "3"
EOF
