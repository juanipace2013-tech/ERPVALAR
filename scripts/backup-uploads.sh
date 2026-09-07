#!/usr/bin/env bash
#
# Backup diario de los archivos subidos al ERP (public/uploads).
#
# La base vive en Supabase y tiene backup automático, pero los uploads solo
# existen en el disco del droplet. En la caída de DonWeb (30/8/2026) quedaron
# inaccesibles: este script los saca del servidor todos los días.
#
# Tamaños al 2026-09-07: fichas-tecnicas 7,3 GB (regenerables desde los
# catálogos de proveedores, pero con mucho trabajo), cotizaciones-oc 126 MB y
# remitos-firmados 68 MB (irremplazables).
#
# Qué hace:
#   1. rclone sync incremental de TODO public/uploads al remote. Solo sube lo
#      que cambió. Lo que se borra o se pisa localmente no se pierde en el
#      remote: va a deleted/YYYYMMDD (--backup-dir), así un borrado accidental
#      o un bug que sobreescriba archivos se puede revertir.
#   2. tar.gz diario SOLO de los directorios irremplazables (CRITICAL_DIRS) en
#      ~/backups/uploads/, con rotación local (KEEP_LOCAL) y copia al remote.
#
# Setup en el droplet (una sola vez):
#   sudo apt-get install -y rclone
#   # como deploy, con las claves de un Space de DigitalOcean (API → Spaces Keys):
#   rclone config create valarg-backup s3 provider DigitalOcean \
#     access_key_id TU_ACCESS_KEY secret_access_key TU_SECRET_KEY \
#     endpoint nyc3.digitaloceanspaces.com acl private
#   rclone lsd valarg-backup:            # tiene que listar el Space sin error
#   crontab -e
#   30 3 * * * RCLONE_REMOTE=valarg-backup:valarg-backups bash /home/deploy/crm-valarg/scripts/backup-uploads.sh >> /home/deploy/logs/backup-uploads.log 2>&1
#
# Restaurar todo desde el remote (por ejemplo en un server nuevo):
#   rclone sync valarg-backup:valarg-backups/uploads /home/deploy/crm-valarg/public/uploads
# Restaurar un archivo borrado por error el 7/9:
#   rclone ls valarg-backup:valarg-backups/deleted/20260907
#   rclone copy valarg-backup:valarg-backups/deleted/20260907/remitos-firmados/X.pdf /home/deploy/crm-valarg/public/uploads/remitos-firmados/
# Restaurar los directorios críticos desde un tar:
#   tar -xzf ~/backups/uploads/uploads-criticos-20260907.tar.gz -C /home/deploy/crm-valarg/public/
#
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/crm-valarg}"
UPLOADS_DIR="$APP_DIR/public/uploads"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/uploads}"
KEEP_LOCAL="${KEEP_LOCAL:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"   # ej: valarg-backup:valarg-backups (vacío = solo tar local)
CRITICAL_DIRS="${CRITICAL_DIRS:-cotizaciones-oc remitos-firmados}"

STAMP="$(date +%Y%m%d)"
ARCHIVE="$BACKUP_DIR/uploads-criticos-$STAMP.tar.gz"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ ! -d "$UPLOADS_DIR" ]; then
  log "ERROR: no existe $UPLOADS_DIR"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── 1. Tar de los directorios irremplazables ────────────────────────────────
EXISTING=""
for d in $CRITICAL_DIRS; do
  [ -d "$UPLOADS_DIR/$d" ] && EXISTING="$EXISTING uploads/$d"
done
if [ -n "$EXISTING" ]; then
  log "Empaquetando$EXISTING -> $ARCHIVE"
  # shellcheck disable=SC2086
  tar -czf "$ARCHIVE.tmp" -C "$APP_DIR/public" $EXISTING
  mv "$ARCHIVE.tmp" "$ARCHIVE"
  log "Listo: $(du -h "$ARCHIVE" | cut -f1)"
else
  log "AVISO: ninguno de los directorios críticos existe ($CRITICAL_DIRS)"
fi

# Rotación local
ls -1t "$BACKUP_DIR"/uploads-criticos-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | while read -r old; do
  log "Borrando backup local viejo: $old"
  rm -f "$old"
done

# ── 2. Remote ────────────────────────────────────────────────────────────────
if [ -z "$RCLONE_REMOTE" ]; then
  log "AVISO: RCLONE_REMOTE vacío, el backup quedó solo en este servidor"
  log "Backup terminado"
  exit 0
fi

if ! command -v rclone >/dev/null 2>&1; then
  log "ERROR: RCLONE_REMOTE definido pero rclone no está instalado"
  exit 1
fi

log "Sync incremental de uploads/ a $RCLONE_REMOTE/uploads ($(find "$UPLOADS_DIR" -type f | wc -l) archivos, $(du -sh "$UPLOADS_DIR" | cut -f1))"
rclone sync "$UPLOADS_DIR" "$RCLONE_REMOTE/uploads" \
  --backup-dir "$RCLONE_REMOTE/deleted/$STAMP" \
  --transfers 8 --checkers 16 --stats-one-line --stats 5m
log "Sync OK"

if [ -f "$ARCHIVE" ]; then
  log "Subiendo $ARCHIVE a $RCLONE_REMOTE/tars"
  rclone copy "$ARCHIVE" "$RCLONE_REMOTE/tars/" --quiet
  # Rotación en el remote: mismo criterio que local
  rclone delete "$RCLONE_REMOTE/tars" --min-age "$((KEEP_LOCAL * 2))d" --quiet || true
fi

# Limpiar carpetas deleted/ de más de 60 días
rclone delete "$RCLONE_REMOTE/deleted" --min-age 60d --quiet || true
rclone rmdirs "$RCLONE_REMOTE/deleted" --leave-root --quiet || true

log "Backup terminado"
