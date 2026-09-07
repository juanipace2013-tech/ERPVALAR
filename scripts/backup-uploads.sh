#!/usr/bin/env bash
#
# Backup diario de los archivos subidos al ERP (public/uploads: fichas
# técnicas, remitos firmados, órdenes de compra de clientes).
#
# La base vive en Supabase y tiene backup automático, pero los uploads solo
# existen en el disco del droplet. En la caída de DonWeb (30/8/2026) quedaron
# inaccesibles: este script los saca del servidor todos los días.
#
# Qué hace:
#   1. Empaqueta public/uploads en ~/backups/uploads/uploads-YYYYMMDD.tar.gz
#   2. Conserva los últimos KEEP_LOCAL archivos locales
#   3. Si hay un remote de rclone configurado (RCLONE_REMOTE), sube el tar y
#      además hace un `rclone sync` incremental del directorio (más rápido
#      para restaurar un archivo suelto).
#
# Setup en el droplet (una sola vez, como usuario deploy):
#   sudo apt-get install -y rclone
#   rclone config        # crear remote "valarg-backup" tipo S3 apuntando a un
#                        # DigitalOcean Space (o Backblaze B2, o Google Drive)
#   crontab -e
#   30 3 * * * RCLONE_REMOTE=valarg-backup:crm-valarg-backups /home/deploy/crm-valarg/scripts/backup-uploads.sh >> /home/deploy/logs/backup-uploads.log 2>&1
#
# Restaurar un día completo:
#   tar -xzf ~/backups/uploads/uploads-20260907.tar.gz -C /home/deploy/crm-valarg/public/
# Restaurar desde el remote:
#   rclone copy valarg-backup:crm-valarg-backups/uploads-20260907.tar.gz ~/backups/uploads/
#
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/crm-valarg}"
UPLOADS_DIR="$APP_DIR/public/uploads"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/uploads}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"   # ej: valarg-backup:crm-valarg-backups (vacío = solo local)

STAMP="$(date +%Y%m%d)"
ARCHIVE="$BACKUP_DIR/uploads-$STAMP.tar.gz"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ ! -d "$UPLOADS_DIR" ]; then
  log "ERROR: no existe $UPLOADS_DIR"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

log "Empaquetando $UPLOADS_DIR -> $ARCHIVE"
tar -czf "$ARCHIVE.tmp" -C "$APP_DIR/public" uploads
mv "$ARCHIVE.tmp" "$ARCHIVE"
log "Listo: $(du -h "$ARCHIVE" | cut -f1) ($(find "$UPLOADS_DIR" -type f | wc -l) archivos)"

# Rotación local
ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | while read -r old; do
  log "Borrando backup local viejo: $old"
  rm -f "$old"
done

if [ -n "$RCLONE_REMOTE" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "ERROR: RCLONE_REMOTE definido pero rclone no está instalado"
    exit 1
  fi
  log "Subiendo tar a $RCLONE_REMOTE"
  rclone copy "$ARCHIVE" "$RCLONE_REMOTE/" --quiet
  log "Sync incremental de uploads/ a $RCLONE_REMOTE/uploads"
  rclone sync "$UPLOADS_DIR" "$RCLONE_REMOTE/uploads" --quiet
  log "Remote OK"
else
  log "AVISO: RCLONE_REMOTE vacío, el backup quedó solo en este servidor"
fi

log "Backup terminado"
