# Mise en ligne sur Oracle Cloud (offre gratuite « Always Free »)

Une seule machine virtuelle fait tout tourner avec Docker :

```
Internet ──HTTPS──▶ Caddy (site React + certificat automatique)
                       ├── /api/*, /socket.io/* ──▶ backend NestJS
                       │                              ├── PostgreSQL (non exposé)
                       │                              └── Redis (non exposé)
                       └── le reste ──▶ fichiers du site
```

Fichiers utilisés : `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/.env.example`,
`deploy/setup-server.sh`, `deploy/init-env.sh`, `deploy/backup.sh`, `deploy/update.sh`,
`Dockerfile` (backend) et `Dockerfile` du dépôt frontend.

---

## Étape 1 — Créer le compte Oracle Cloud (toi)

1. Va sur **oracle.com/cloud/free** → « Start for free ».
2. **Région d'origine (home region)** : choisis **France Central (Paris)** ou **France South (Marseille)**.
   ⚠️ Elle ne peut plus être changée ensuite, et les ressources gratuites n'existent que dans cette région.
3. Une carte bancaire est demandée pour vérifier ton identité (petite autorisation annulée ensuite).
   Tant que tu restes dans l'offre « Always Free », rien n'est facturé.
4. Une fois connecté : menu **Billing → Budgets → Create Budget**, montant **1 €**, alerte par email à 50 %.
   Tu seras prévenu si une ressource payante était créée par erreur.

> **Bon à savoir** : Oracle peut récupérer une machine gratuite jugée « inactive » (très peu de CPU,
> de réseau et de mémoire utilisés pendant 7 jours). Pour l'éviter, passe le compte en
> **« Pay As You Go »** (Billing → Upgrade) : les ressources Always Free restent gratuites,
> la machine n'est plus récupérée, et le budget à 1 € te protège.

## Étape 2 — Créer la clé SSH (toi, sur ton PC Windows)

Dans PowerShell :

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\humlinker_oracle
```

Appuie sur Entrée deux fois (ou choisis une phrase de passe). Cela crée deux fichiers :
`humlinker_oracle` (privé — **ne le partage jamais**) et `humlinker_oracle.pub` (public — à donner à Oracle).

## Étape 3 — Créer la machine (toi)

Menu **Compute → Instances → Create instance** :

| Réglage | Valeur |
|---|---|
| Name | `humlinker` |
| Image | **Canonical Ubuntu 24.04** (bouton « Change image ») |
| Shape | « Change shape » → **Ampere** → **VM.Standard.A1.Flex**, **4 OCPU**, **24 Go** (tout le quota gratuit) |
| Networking | laisser créer un nouveau réseau (VCN) avec sous-réseau **public**, « Assign a public IPv4 address » coché |
| Add SSH keys | « Upload public key files » → `humlinker_oracle.pub` |
| Boot volume | 100 Go (gratuit jusqu'à 200 Go au total) |

Clique **Create**. Si Oracle répond **« Out of capacity »** : réessaie un peu plus tard ou change
l'« Availability domain » (c'est fréquent avec les machines gratuites).

Quand la machine est « Running », note son **adresse IP publique** (page de l'instance).

## Étape 4 — Ouvrir les ports web (toi)

Page de l'instance → **Subnet** → **Security List** (Default) → **Add Ingress Rules** :

| Source CIDR | Protocole | Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |
| `0.0.0.0/0` | UDP | `443` |

(Le port 22 pour SSH est déjà ouvert.)

## Étape 5 — Se connecter et préparer le serveur

Depuis PowerShell (remplace l'IP) :

```powershell
ssh -i $HOME\.ssh\humlinker_oracle ubuntu@152.70.10.20
```

Puis, sur le serveur :

```bash
mkdir -p ~/humlinker && cd ~/humlinker
git clone https://github.com/AaronMadar/humlinker-Backend.git
git clone https://github.com/AaronMadar/humlinker-Frontend.git
sudo bash humlinker-Backend/deploy/setup-server.sh
exit
```

(Si les dépôts sont privés, GitHub demandera un identifiant : utilise un « fine-grained token »
en lecture seule sur ces deux dépôts — GitHub → Settings → Developer settings.)

Reconnecte-toi (pour que Docker marche sans `sudo`).

## Étape 6 — Configurer l'appli

**Sans nom de domaine pour l'instant**, utilise l'adresse gratuite `sslip.io` construite avec l'IP
(points remplacés par des tirets) : `152-70-10-20.sslip.io`. Le HTTPS marche quand même.

```bash
cd ~/humlinker/humlinker-Backend
bash deploy/init-env.sh 152-70-10-20.sslip.io humlinker@gmail.com
nano deploy/.env
```

Les mots de passe (base, Redis, JWT) sont déjà générés. Complète dans `nano` :
- `GEMINI_API_KEY` — **crée une clé dédiée à la production** dans Google AI Studio, avec une limite de dépense ;
- `MAIL_*` — le service d'envoi d'emails ;
- `GOOGLE_*`, `FIREBASE_*`, `VITE_*` — connexion Google (mêmes valeurs qu'en local) ;
- `STRIPE_*` — clés de test `sk_test_…` pour commencer (les clés live viendront avec le SIRET).
- `TWILIO_*` — SMS de vérification du téléphone (obligatoire en production).

⚠️ En production, le backend **refuse de démarrer** s'il manque une clé obligatoire
(email, SMS, webhook Stripe…) : le message d'erreur liste ce qui manque
(`docker compose -f docker-compose.prod.yml logs backend`).

Enregistrer : `Ctrl+O`, Entrée, `Ctrl+X`. **Ne colle jamais ces clés dans une discussion.**

## Étape 7 — Lancer

(Pile testée en local à l'identique : site, API, temps réel, HTTPS et migrations sur base vide.)

```bash
cd ~/humlinker/humlinker-Backend/deploy
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

La première construction prend quelques minutes. Ensuite, ouvre `https://152-70-10-20.sslip.io`.
Vérification de l'API : `https://152-70-10-20.sslip.io/api/v1/health`.

Journaux en cas de souci :

```bash
docker compose -f docker-compose.prod.yml logs --tail 100 backend
docker compose -f docker-compose.prod.yml logs --tail 50 web
```

## Étape 8 — Brancher les services externes sur la nouvelle adresse

- **Google Cloud Console** → Identifiants → client OAuth : ajouter `https://<DOMAIN>` aux
  « Origines JavaScript autorisées ». Firebase → Authentication → Settings → Authorized domains : ajouter `<DOMAIN>`.
- **Stripe** → Développeurs → Webhooks → ajouter `https://<DOMAIN>/api/v1/billing/webhook`
  (événements `checkout.session.completed`, `customer.subscription.*`, `invoice.*`), puis mettre le
  nouveau `whsec_…` dans `deploy/.env` et relancer `docker compose … up -d`.

## Étape 9 — Sauvegardes automatiques

```bash
crontab -e
```

Ajouter la ligne :

```
0 3 * * * bash /home/ubuntu/humlinker/humlinker-Backend/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1
```

Une sauvegarde compressée chaque nuit à 3 h, les 14 dernières sont gardées dans `deploy/backups/`.
Restaurer une sauvegarde :

```bash
gunzip -c deploy/backups/humlinker-AAAAMMJJ-HHMM.sql.gz | docker compose -f deploy/docker-compose.prod.yml exec -T postgres psql -U humlinker humlinker
```

(Conseil : copier de temps en temps une sauvegarde hors du serveur, par ex. avec `scp` vers ton PC.)

## Mettre à jour l'appli après un push sur GitHub

```bash
cd ~/humlinker/humlinker-Backend && bash deploy/update.sh
```

(Sauvegarde, récupération du code, reconstruction, redémarrage.)

## Plus tard : vrai nom de domaine

1. Acheter le domaine, créer un enregistrement DNS **A** `@` → IP du serveur (et `www` si voulu).
2. Changer `DOMAIN=` dans `deploy/.env`, relancer `docker compose -f docker-compose.prod.yml up -d --build`.
3. Refaire l'étape 8 avec le nouveau domaine, et remplir `websiteUrl` / hébergeur dans
   `humlinker-Frontend/src/legal/legalInfo.ts` (hébergeur : Oracle Cloud Infrastructure, données en France).
