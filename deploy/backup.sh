#!/usr/bin/env bash
# Sauvegarde de la base (compressée), conserve les 14 dernières.
# Cron quotidien (3 h) : crontab -e →  0 3 * * * bash ~/humlinker/humlinker-Backend/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
f="backups/humlinker-$(date +%Y%m%d-%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U humlinker humlinker | gzip > "$f"
chmod 600 "$f"
ls -1t backups/humlinker-*.sql.gz | tail -n +15 | xargs -r rm --
echo "Sauvegarde : $f"
