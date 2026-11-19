#!/usr/bin/env bash
# Mise à jour de l'appli : récupère le code de GitHub et reconstruit.
# Usage : bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")"
bash backup.sh
git -C .. pull --ff-only
git -C ../../humlinker-Frontend pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
docker compose -f docker-compose.prod.yml ps
