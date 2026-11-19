# Humlinker — Plan de mise en production

*Audit initial du 18/11/2026 — mis à jour le 19/11/2026.*
Dépôts : `humlinker-Backend` (NestJS + Prisma/PostgreSQL + Redis + Gemini + Stripe) et `humlinker-Frontend` (React + Vite).
Règle de travail : chaque étape = une branche ; validée → fusionnée dans `main` et poussée sur GitHub.

## Avancement

| # | Étape | État |
|---|---|---|
| 0 | Remise à plat Git | ✅ Fait |
| 1 | Sécurité critique | ✅ Fait |
| 2 | Offres et quotas (gratuit / Pro) | ✅ Fait |
| 3 | Paiement Stripe (€, $, £, ₪) | ✅ Fait — offre créée en mode test ; reste le test de paiement complet (Docker + Stripe CLI) |
| 4 | IA médiatrice : prompt, fiabilité, coût | ✅ Fait — évaluation 390/390 (6 langues dont hébreu et arabe) |
| 5 | Auth pro + suppression de compte | ⏳ À faire |
| 6 | Tests + CI GitHub Actions | ⏳ À faire (71+ tests unitaires et évaluation IA déjà en place) |
| 7 | Infra & déploiement | ⏳ À faire |
| 8 | Légal & RGPD | ⏳ À faire |
| 9 | Bêta puis lancement | ⏳ À faire |

---

## Ce qui est en place

### 1. Sécurité
- Rate limiting Redis (multi-instances) : 300 req/min/IP + limites par route (SMS, login, IA, envoi, recherche, création).
- OTP : générateur cryptographique, 5 essais max, 60 s entre envois, 3 SMS/h et 6/j par numéro, disjoncteur SMS global.
- Login bloqué 15 min après 5 échecs, temps de réponse identique que le compte existe ou non.
- Recherche par PIN : profil public uniquement. Emails : contenu échappé. helmet, CORS strict (HTTP + WebSocket).
- Démarrage refusé en production si une variable critique manque ou est une valeur d'exemple.

### 2. Offres et quotas — `src/modules/billing/plans.config.ts`
| | Gratuit | Pro |
|---|---|---|
| Reformulations IA (humlinkers lancés) | 15/jour, 100/mois | 100/jour, 1 000/mois |
| Réponses IA (humlinkers reçus) | 30/jour, 300/mois | 100/jour, 1 000/mois |
| Messages envoyés | 10/jour | 100/jour |
| Emails à un non-inscrit | 3/mois | 10/jour, 50/mois |
| Humlinkers actifs lancés | 3 | illimité |
| Longueur d'un message | 1 000 caractères | 4 000 caractères |

- Coût réel de chaque appel IA enregistré (`usage_records`) ; disjoncteurs journaliers budget IA et SMS + alerte email.
- Quotas Pro ancrés sur la date d'abonnement (y compris en annuel).

### 3. Paiement Stripe
Offre créée sur le compte de test par `npm run stripe:setup` (idempotent, à relancer avec la clé live au lancement).

| | Mensuel | Annuel |
|---|---|---|
| € (référence) | 6,99 € | 59 € |
| $ (défaut, reste du monde) | 7,99 $ | 65 $ |
| £ (Royaume-Uni) | 5,99 £ | 50 £ |
| ₪ (Israël) | 25,90 ₪ | 212 ₪ |

Autres devises = prix en euros au taux BCE du 18/11/2026, arrondi au-dessus. Devise choisie selon la localisation du client (fuseau horaire), dollar par défaut.

Checkout mensuel/annuel, portail client (résiliation, carte, factures), webhooks signés, accès Pro synchronisé :
- résiliation → Pro jusqu'à la fin de la période payée ; impayé au renouvellement → 3 jours de grâce max, puis gratuit.

### 4. IA médiatrice
- Prompt professionnel (`src/modules/ai/ai.prompt.ts`) : fidélité absolue, désescalade (insultes retirées, ironie traduite, pas de généralisations accusatrices), refus des menaces/harcèlement/chantage/haine, ton formel et neutre, sécurité anti-manipulation.
- SDK officiel `@google/genai`, sortie JSON imposée + validation, délai max + nouvel essai, filet de sécurité déterministe.
- Raisonnement Gemini désactivé : **0,00058 $ / message** (au lieu de 0,00198 $), réponse en ~1 s.
- Évaluation automatique `npm run eval:ai` : 34 cas réels × 5 essais, **340/340 conformes** sur 2 validations (19/11/2026).

---

## Actions de votre côté

1. **Stripe** : ✅ clé de test en place, offre créée. Reste : lancer Docker Desktop et installer la Stripe CLI pour le test de paiement complet (voir docs/DEMARRAGE.md).
2. **Gemini** : vérifier que la clé `GEMINI_API_KEY` est sur une offre **payante** (l'offre gratuite peut utiliser les messages pour entraîner les modèles — incompatible avec des messages privés).
3. **`ADMIN_ALERT_EMAIL`** : renseigner l'email qui reçoit les alertes de budget.

---

## Étapes restantes

### 5. Auth pro + suppression de compte
- Access token court (15 min) + refresh token en cookie `httpOnly`, révocable (Redis) ; déconnexion de tous les appareils.
- `DELETE /users/me` : suppression/anonymisation des données + résiliation de l'abonnement Stripe (obligatoire RGPD).
- Ne plus exposer l'email du destinataire dans les « snapshots » de humlinker.

### 6. Tests + CI
- GitHub Actions sur chaque push/PR (lint, build, tests) pour les deux dépôts.
- Reformatage Prettier global (les anciens fichiers ne sont pas formatés) ; ESLint côté front.
- Tests e2e des parcours critiques (inscription, quotas, paiement).

### 7. Infra & déploiement
- Dockerfile backend (multi-stage, non-root), `prisma migrate deploy` au déploiement.
- Hébergement : backend (Railway / Render / Fly.io ou VPS), PostgreSQL et Redis managés avec sauvegardes, front (Vercel / Netlify / Cloudflare Pages).
- Emails transactionnels (Resend, Brevo, Postmark…) + SPF/DKIM/DMARC à la place de Gmail SMTP.
- Domaine + HTTPS, environnement de staging, adaptateur Redis pour Socket.io (plusieurs instances), Sentry, monitoring.

### 8. Légal & RGPD (France / UE)
- Mentions légales, CGU, CGV (abonnement, droit de rétractation), politique de confidentialité (sous-traitants : Google, Stripe, Twilio, hébergeur), bannière cookies si analytics.
- Export et suppression des données, durées de conservation, lien de désinscription dans les emails aux non-inscrits.
- TVA : envisager Stripe Tax.

### 9. Lancement
Bêta fermée, suivi des coûts réels (`usage_records`) et des retours, ajustement des quotas/prix, puis lancement public.
