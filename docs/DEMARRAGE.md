# Démarrer Humlinker en local — pas à pas

Guide pour allumer l'application complète sur ton PC (Windows). À suivre dans l'ordre.

## Une seule fois (première installation)

1. Installer **Docker Desktop**, **Node.js 20+** et **Git**.
2. Récupérer les deux dépôts dans le même dossier :
   ```bash
   git clone https://github.com/AaronMadar/humlinker-Backend.git
   git clone https://github.com/AaronMadar/humlinker-Frontend.git
   ```
3. Dans **chaque** dossier : `npm install`
4. Créer les fichiers de configuration (jamais envoyés sur GitHub) :
   - `humlinker-Backend/.env` à partir de `humlinker-Backend/.env.example`
   - `humlinker-Frontend/.env` à partir de `humlinker-Frontend/.env.example`
   puis remplir les clés (base de données, Gemini, Stripe test, etc.).
5. Créer l'offre Stripe de test (une fois par compte Stripe) :
   ```bash
   cd humlinker-Backend
   npm run stripe:setup -- --write-env
   ```

## À chaque fois que tu veux allumer l'appli

### 1. Lancer Docker Desktop
Ouvre l'application **Docker Desktop** et attends qu'elle indique « Engine running ».
Si elle se ferme toute seule : regarde si une fenêtre attend une action (mise à jour, conditions, connexion).

### 2. Démarrer la base de données et Redis
```bash
cd humlinker-Backend
docker compose up -d postgres redis
```

### 3. Mettre la base à jour (après chaque `git pull`)
```bash
npx prisma migrate deploy
```

### 4. Démarrer le backend (terminal n°1)
```bash
cd humlinker-Backend
npm run start:dev
```
Prêt quand le terminal affiche `Server: http://localhost:3000/api/v1`.
Documentation de l'API : http://localhost:3000/docs

### 5. Démarrer le frontend (terminal n°2)
```bash
cd humlinker-Frontend
npm run dev
```
Ouvre http://localhost:5173 dans le navigateur.

### 6. (Optionnel) Recevoir les paiements Stripe en local (terminal n°3)
Nécessite la [Stripe CLI](https://docs.stripe.com/stripe-cli) (connexion une fois avec `stripe login`) :
```bash
stripe listen --forward-to localhost:3000/api/v1/billing/webhook
```
Copie le secret `whsec_…` affiché dans `STRIPE_WEBHOOK_SECRET` du `.env` backend, puis redémarre le backend.
Carte de test : `4242 4242 4242 4242`, date future, n'importe quel code.

## Éteindre
- `Ctrl + C` dans les terminaux du backend et du frontend.
- Pour arrêter la base et Redis : `docker compose stop` (les données sont conservées).

## Vérifier que tout va bien
```bash
cd humlinker-Backend
npm run test       # tests unitaires
npm run eval:ai    # qualité de l'IA médiatrice (vrai Gemini, ~0,06 $)
```

## Problèmes fréquents

| Symptôme | Cause / solution |
|---|---|
| `Can't reach database server at localhost:5433` | Docker Desktop n'est pas lancé, ou les conteneurs non plus → étapes 1 et 2. |
| `Authentication failed` sur la base | Le port pointe vers une autre base de ton PC. Sur ce poste, 5432/6379 sont déjà pris : on utilise **5433** (Postgres) et **6380** (Redis) — `POSTGRES_PORT`, `REDIS_PORT` et le port de `DATABASE_URL` doivent correspondre dans `.env`. |
| `EADDRINUSE :3000` | Un ancien backend tourne encore. PowerShell : `Get-NetTCPConnection -LocalPort 3000 -State Listen` puis `Stop-Process -Id <OwningProcess>`. |
| Le front affiche des erreurs réseau | Le backend n'est pas démarré, ou `VITE_API_URL` est faux dans `humlinker-Frontend/.env`. |
| « Le paiement est momentanément indisponible » | Clés Stripe absentes du `.env` backend → étape « une seule fois » n°5. |
| Paiement réussi mais l'utilisateur reste gratuit | `stripe listen` n'est pas lancé ou `STRIPE_WEBHOOK_SECRET` est faux → étape 6. |
