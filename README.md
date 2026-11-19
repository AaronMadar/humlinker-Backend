# Humlinker — Backend

API NestJS de Humlinker : deux personnes communiquent **uniquement par l'intermédiaire d'une IA médiatrice** qui reformule chaque message de façon neutre, fidèle et apaisée.

**Stack** : NestJS 11 · PostgreSQL (Prisma 5) · Redis · Socket.io · Gemini (`@google/genai`) · Stripe · Firebase (push) · Twilio (SMS) · Nodemailer.

**Allumer l'application pas à pas : [docs/DEMARRAGE.md](docs/DEMARRAGE.md).**
Plan de mise en production et avancement : [docs/PLAN_PRODUCTION.md](docs/PLAN_PRODUCTION.md).

---

## Démarrage local

```bash
npm install
cp .env.example .env          # PowerShell : Copy-Item .env.example .env
docker compose up -d postgres redis
npm run prisma:generate
npx prisma migrate deploy
npm run start:dev
```

- API : `http://localhost:3000/api/v1` — documentation Swagger (hors production) : `http://localhost:3000/docs`
- Si les ports 5432 / 6379 sont déjà pris sur votre machine, changez `POSTGRES_PORT`, `REDIS_PORT` **et** le port de `DATABASE_URL` dans `.env` (ex. 5433 / 6380), puis relancez `docker compose up -d`.

Toutes les variables sont documentées dans [.env.example](.env.example). En **production**, le serveur refuse de démarrer si une variable critique manque ou est restée à une valeur d'exemple (`src/config/env.validation.ts`).

---

## Architecture

```
src/
├── config/          Configuration + validation des variables d'environnement
├── common/          Rate limiting Redis (@RateLimit), adaptateur Socket.io CORS
├── modules/
│   ├── auth/        Inscription (OTP email + SMS), connexion, Google
│   ├── users/       Profil, recherche par PIN (profil public uniquement)
│   ├── humlinker/   Conversations (humlinker + miroir côté destinataire)
│   ├── messages/    Chat avec l'IA, drafts, envoi au destinataire, WebSocket
│   ├── ai/          IA médiatrice : prompt (ai.prompt.ts) + appel Gemini (ai.service.ts)
│   ├── billing/     Offres, quotas, disjoncteurs de coûts, Stripe
│   └── notifications/  Push FCM + temps réel
└── integrations/    Email, SMS
```

### IA médiatrice (`src/modules/ai`)
- **Prompt** : `ai.prompt.ts` — source unique des règles de médiation (fidélité, désescalade, refus des menaces/harcèlement, ton formel, sécurité).
- **Robustesse** : règles en instruction système, messages utilisateurs transmis comme **données JSON** (anti prompt-injection), schéma de réponse imposé + validation, délai max + nouvel essai, filet de sécurité contre les généralisations accusatrices.
- Si l'IA échoue : rien n'est enregistré, le quota n'est pas décompté, l'utilisateur récupère son message (503 `AI_UNAVAILABLE`).
- Réglages : `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_THINKING_BUDGET` (0 par défaut : même qualité mesurée, 3,4× moins cher), `AI_THINKING_BUDGET_GENDERED` (512 : raisonnement activé seulement pour l'hébreu et l'arabe, dont les accords en dépendent).
- Le genre de l'expéditeur (profil) est transmis à l'IA pour les accords ; s'il est inconnu, formulation neutre.

### Offres, quotas et coûts (`src/modules/billing`)
- Limites de chaque offre : **`plans.config.ts`** (source unique). L'IA étant médiatrice des deux côtés, les réponses dans un humlinker reçu ont leur propre quota (`ai_reply`).
- Chaque action coûteuse est enregistrée dans `usage_records` avec son coût réel (tokens Gemini).
- Disjoncteurs journaliers globaux : budget IA (`GLOBAL_DAILY_AI_BUDGET_USD`) et nombre de SMS (`GLOBAL_DAILY_SMS_LIMIT`), avec alerte email (`ADMIN_ALERT_EMAIL`).
- Erreurs métier renvoyées avec un `code` stable (`QUOTA_EXCEEDED`, `HUMLINKER_LIMIT_REACHED`, `MESSAGE_TOO_LONG`, `SERVICE_BUDGET_EXCEEDED`, `AI_UNAVAILABLE`) que le front traduit.

### Paiement Stripe
- `POST /billing/checkout` (mensuel / annuel) → page Stripe Checkout ; `POST /billing/portal` → portail client.
- `POST /billing/webhook` : signature vérifiée ; chaque événement relit l'abonnement chez Stripe (ordre et rejeu sans effet).
- Sans clés Stripe (dev), le paiement est désactivé proprement (503 `BILLING_DISABLED`).
- Tester en local : `stripe listen --forward-to localhost:3000/api/v1/billing/webhook`, carte `4242 4242 4242 4242`.

### Sécurité
Rate limiting Redis global + par route, OTP durcis (5 essais, délai entre envois, plafond par numéro), blocage du login après 5 échecs, helmet, CORS limité à `FRONTEND_URL`, échappement HTML des emails, identifiants Stripe jamais exposés.

---

## Principales routes (`/api/v1`)

| Domaine | Routes |
|---|---|
| Santé | `GET /health` |
| Auth (publiques) | `POST /auth/send-otp/email`, `POST /auth/send-otp/phone?purpose=register\|reset-password`, `POST /auth/verify-otp`, `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `POST /auth/reset-password` |
| Utilisateur | `GET/PATCH /users/me`, `PATCH /users/me/password`, `GET /users/search?q=<PIN>` |
| Humlinkers | `POST /humlinkers`, `GET /humlinkers`, `PATCH /humlinkers/:id/(accept\|decline\|archive\|unarchive\|cancel\|block)` |
| Messages | `GET/POST /humlinkers/:id/messages`, `PATCH /humlinkers/:id/draft`, `POST /humlinkers/:id/send` |
| Offre | `GET /billing/usage`, `GET /billing/prices`, `POST /billing/checkout`, `POST /billing/portal`, `POST /billing/webhook` |

Routes protégées : en-tête `Authorization: Bearer <token>`. Documentation complète : Swagger.

---

## Tests

```bash
npm run test        # tests unitaires (sans services externes)
npm run eval:ai     # évaluation de l'IA contre le vrai Gemini (~0,06 $)
```

### Évaluation de l'IA (`test/ai-eval`)
39 cas réels en 8 catégories (transmission, fidélité des détails, désescalade, mise à jour, hors sujet, refus, sécurité, langues), joués plusieurs fois et vérifiés automatiquement : bon résultat, faits conservés, insultes et généralisations absentes, tournure indirecte, jamais de « je » du Sender, bonne langue et forme de politesse.

- `EVAL_RUNS=5 npm run eval:ai` pour plus de confiance, `EVAL_ONLY=C` pour une seule catégorie.
- **À relancer après toute modification du prompt ou du modèle.** Ajouter un cas à chaque défaut constaté en production.
- Dernier résultat (19/11/2026) : **390/390 conformes** sur 2 validations × 39 cas × 5 essais (français, anglais, espagnol, allemand, hébreu, arabe ; genre de l'expéditeur connu ou non).

---

## Mise en production (rappel)

- `NODE_ENV=production`, toutes les variables critiques renseignées (sinon refus de démarrer).
- `npx prisma migrate deploy` à chaque déploiement (jamais `migrate dev`).
- `TRUST_PROXY=1` derrière un reverse proxy, `FRONTEND_URL` en https.
- Webhook Stripe configuré vers `https://<api>/api/v1/billing/webhook`.
