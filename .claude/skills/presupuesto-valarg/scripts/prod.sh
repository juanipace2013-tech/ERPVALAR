#!/usr/bin/env bash
# Corre un script .ts del skill contra el ERP de PRODUCCIÓN (la base local tiene
# datos viejos). Lo copia al server, lo ejecuta con tsx y lo borra.
#
# Uso:  prod.sh <script.ts> [entrada.json] [--flags...]
# La salida del script (JSON) va a stdout; los avisos a stderr.
set -euo pipefail

HOST="deploy@147.182.238.63"
SSH_OPTS="-o ConnectTimeout=15 -o BatchMode=yes"

script="$1"; shift
id="_presup-$$-$RANDOM"
remote_in=""

scp -q $SSH_OPTS "$script" "$HOST:crm-valarg/scripts/$id.ts"
if [ $# -gt 0 ] && [ -f "$1" ]; then
  scp -q $SSH_OPTS "$1" "$HOST:crm-valarg/scripts/$id.json"
  remote_in="scripts/$id.json"
  shift
fi

# shellcheck disable=SC2029
ssh $SSH_OPTS "$HOST" "cd ~/crm-valarg && npx tsx scripts/$id.ts $remote_in $*; rc=\$?; rm -f scripts/$id.ts scripts/$id.json; exit \$rc"
