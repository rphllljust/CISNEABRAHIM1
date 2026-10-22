#!/bin/bash
# Backup diario de producao do CISNE no VPS-1.
#
# Politica: pg_dump -Fc + AES-256-GCM (iv[12]||tag[16]||ct, formato do app),
# retencao de 7 dias, prova de restauracao semanal.
#
# Segredos vem de /etc/cisne/backup.env (root, 600). NUNCA em argv nem em log.
set -uo pipefail

ENV_FILE=/etc/cisne/backup.env
if [ ! -r "$ENV_FILE" ]; then
  echo "[backup] ERRO: $ENV_FILE ausente ou ilegivel" >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${CISNE_PG_HOST:?}" "${CISNE_PG_USER:?}" "${CISNE_PG_DB:?}"
: "${CISNE_PG_PASSWORD:?}" "${CISNE_BACKUP_KEY_B64:?}"

DIR=/srv/cisne-backups
TS=$(date -u +%Y-%m-%dT%H-%M-%S)
DAY=$(date -u +%Y-%m-%d)
OUTDIR="$DIR/postgres/$DAY"
mkdir -p "$OUTDIR"
chmod 700 "$DIR" "$DIR/postgres" "$OUTDIR"

LOG="$DIR/backup.log"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }

log "[backup] inicio ts=$TS db=$CISNE_PG_DB"

# 1. Dump logico pela rede interna do Coolify (nenhuma porta publicada).
#    Um artefato por dia (sobrescreve o do mesmo dia): mantem exatamente
#    RETENTION_DAYS dias distintos e evita proliferacao por execucao manual.
RAW="$OUTDIR/postgres-$TS.dump"
docker run --rm --network coolify \
  -e PGPASSWORD="$CISNE_PG_PASSWORD" \
  -v "$OUTDIR":/dump \
  --entrypoint pg_dump postgres:18-alpine \
  -h "$CISNE_PG_HOST" -U "$CISNE_PG_USER" -d "$CISNE_PG_DB" -Fc -f "/dump/postgres-$TS.dump"
RC=$?
if [ $RC -ne 0 ]; then
  log "[backup] FALHA pg_dump rc=$RC"
  exit 1
fi
log "[backup] pg_dump ok bytes=$(stat -c %s "$RAW")"

# 2. Cifragem AES-256-GCM no formato do app.
KEY_HEX=$(printf '%s' "$CISNE_BACKUP_KEY_B64" | base64 -d | xxd -p | tr -d '\n')
python3 - "$RAW" "$KEY_HEX" <<'PY'
import hashlib, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

src, khex = sys.argv[1], sys.argv[2]
key = bytes.fromhex(khex)
if len(key) != 32:
    sys.exit('BACKUP key invalida: ' + str(len(key)) + ' bytes')

plain = open(src, 'rb').read()
iv = os.urandom(12)
sealed = AESGCM(key).encrypt(iv, plain, None)
out = iv + sealed[-16:] + sealed[:-16]
dest = src + '.enc'
with open(dest, 'wb') as fh:
    fh.write(out)
os.remove(src)

dec = AESGCM(key).decrypt(out[:12], out[28:] + out[12:28], None)
if dec != plain:
    sys.exit('roundtrip falhou')
print('[backup] cifrado ok bytes=%d sha256=%s' % (len(out), hashlib.sha256(out).hexdigest()))
PY
RC=$?
if [ $RC -ne 0 ]; then
  log "[backup] FALHA cifragem rc=$RC"
  exit 1
fi

# 3. Retencao: manter os 7 dias mais recentes (diretorios ordenados por data).
RETENTION_DAYS=7
cd "$DIR/postgres" || exit 1
ls -1d 20*/ 2>/dev/null | sort -r | tail -n +$((RETENTION_DAYS + 1)) | while read -r old; do
  log "[backup] retencao remove $old"
  rm -rf -- "$old"
done

# 4. Status legivel pelo app (prod-validation le BACKUP_STATUS_FILE).
python3 - "$DIR/status/latest.json" "$DAY" "$TS" <<'PY'
import glob, json, os, sys
dest, day, ts = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(os.path.dirname(dest), exist_ok=True)
files = sorted(glob.glob('/srv/cisne-backups/postgres/20*/*.dump.enc'))
payload = {
    'status': 'ok' if files else 'failed',
    'startedAt': ts,
    'finishedAt': ts,
    'artifactCount': len(files),
    'latest': files[-1] if files else None,
    'day': day,
    'retentionDays': 7,
}
if not files:
    payload['error'] = 'nenhum artefato .dump.enc encontrado apos o backup'
with open(dest, 'w') as fh:
    json.dump(payload, fh, indent=2)
    fh.write('\n')
PY

log "[backup] concluido ok artefatos=$(ls -1 "$OUTDIR" | wc -l)"
