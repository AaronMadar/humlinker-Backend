#!/usr/bin/env bash
# Préparation d'une machine Ubuntu (Oracle Cloud) : Docker, pare-feu, mises à jour auto.
# Usage (une seule fois) : sudo bash deploy/setup-server.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lancer avec sudo"; exit 1; }

apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl git openssl unattended-upgrades netfilter-persistent iptables-persistent

# Docker (dépôt officiel)
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "${SUDO_USER:-ubuntu}"
systemctl enable --now docker

# Pare-feu interne des images Oracle : ouvrir 80 et 443 (HTTP/HTTPS)
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 6 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
netfilter-persistent save

# Mises à jour de sécurité automatiques
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Serveur prêt. Déconnecte-toi puis reconnecte-toi (pour utiliser docker sans sudo)."
