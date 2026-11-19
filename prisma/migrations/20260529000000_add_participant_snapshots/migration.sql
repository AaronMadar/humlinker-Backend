-- Migration: add_participant_snapshots
--
-- Remplace les champs plats du humlinker (creatorLanguage, targetLanguage,
-- targetContactEmail, targetContactPhone) par deux colonnes JSONB embarquant
-- le snapshot complet de chaque participant (sender + target).
--
-- Structure du snapshot :
--   { userId, firstName, lastName, email, phone, language,
--     gender, profilePicture, isPlaceholder }

-- 1. Ajout des nouvelles colonnes JSONB
--    Temporairement nullable pour la migration des données existantes
ALTER TABLE "humlinkers"
  ADD COLUMN "senderSnapshot" JSONB,
  ADD COLUMN "targetSnapshot" JSONB;

-- 2. Backfill : construit les snapshots depuis les données existantes
--    Pour les lignes existantes on reconstruit un snapshot minimal
--    avec les infos disponibles (language, pas de nom/photo en stock)
UPDATE "humlinkers" h
SET
  "senderSnapshot" = jsonb_build_object(
    'userId',         h."senderId",
    'firstName',      NULL,
    'lastName',       NULL,
    'email',          NULL,
    'phone',          NULL,
    'language',       h."creatorLanguage",
    'gender',         NULL,
    'profilePicture', NULL,
    'isPlaceholder',  false
  ),
  "targetSnapshot" = jsonb_build_object(
    'userId',         h."targetId",
    'firstName',      NULL,
    'lastName',       h."targetContactName",
    'email',          h."targetContactEmail",
    'phone',          h."targetContactPhone",
    'language',       COALESCE(h."targetLanguage", 'fr'),
    'gender',         NULL,
    'profilePicture', NULL,
    'isPlaceholder',  true
  );

-- 3. Rendre les colonnes NOT NULL maintenant que le backfill est fait
ALTER TABLE "humlinkers"
  ALTER COLUMN "senderSnapshot" SET NOT NULL,
  ALTER COLUMN "targetSnapshot" SET NOT NULL;

-- 4. Suppression des anciennes colonnes
ALTER TABLE "humlinkers"
  DROP COLUMN "creatorLanguage",
  DROP COLUMN "targetLanguage",
  DROP COLUMN "targetContactEmail",
  DROP COLUMN "targetContactPhone";
