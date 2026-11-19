#!/usr/bin/env bash
# Crée deploy/.env à partir du modèle, avec des mots de passe forts générés.
# Usage : bash deploy/init-env.sh <domaine> <email>
set -euo pipefail
cd "$(dirname "$0")"
if [ -f .env ]; then echo "deploy/.env existe déjà : rien modifié."; exit 0; fi
DOMAIN="${1:?Usage: bash deploy/init-env.sh <domaine> <email>}"
EMAIL="${2:?Usage: bash deploy/init-env.sh <domaine> <email>}"
gen() { openssl rand -hex "$1"; }
cp .env.example .env
chmod 600 .env
sed -i \
  -e "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" \
  -e "s|^ACME_EMAIL=.*|ACME_EMAIL=${EMAIL}|" \
  -e "s|^ADMIN_ALERT_EMAIL=.*|ADMIN_ALERT_EMAIL=${EMAIL}|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(gen 24)|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(gen 24)|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$(gen 48)|" \
  .env
echo "deploy/.env créé (mots de passe générés). Complète maintenant les clés avec : nano deploy/.env"
