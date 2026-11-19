-- Migration: username → pin, retirer SMS/WhatsApp/Contact/Twilio

-- 1. Retirer la contrainte unique sur username
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_key";

-- 2. Ajouter la colonne pin (temporairement nullable pour les données existantes)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pin" TEXT;

-- 3. Générer un PIN temporaire pour les users existants (8 chars aléatoires)
UPDATE "users"
SET "pin" = UPPER(SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT) FROM 1 FOR 8))
WHERE "pin" IS NULL;

-- 4. Passer pin en NOT NULL + unique
ALTER TABLE "users" ALTER COLUMN "pin" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_pin_key" UNIQUE ("pin");

-- 5. Retirer la colonne username
ALTER TABLE "users" DROP COLUMN IF EXISTS "username";

-- 6. Retirer twilioConversationSid de users et humlinkers
ALTER TABLE "users" DROP COLUMN IF EXISTS "twilioConversationSid";
ALTER TABLE "humlinkers" DROP COLUMN IF EXISTS "twilioConversationSid";

-- 7. Retirer previousEmails, previousPhoneNumbers de users
ALTER TABLE "users" DROP COLUMN IF EXISTS "previousEmails";
ALTER TABLE "users" DROP COLUMN IF EXISTS "previousPhoneNumbers";

-- 8. Mettre à jour l'enum HumlinkerChannel (supprimer sms et whatsapp)
-- Convertir les humlinkers sms/whatsapp existants vers email
UPDATE "humlinkers" SET "communicationChannel" = 'email' WHERE "communicationChannel" IN ('sms', 'whatsapp');

-- Dropper le DEFAULT avant de modifier le type
ALTER TABLE "humlinkers" ALTER COLUMN "communicationChannel" DROP DEFAULT;

-- Recréer l'enum sans sms/whatsapp
ALTER TYPE "HumlinkerChannel" RENAME TO "HumlinkerChannel_old";
CREATE TYPE "HumlinkerChannel" AS ENUM ('app', 'email');
ALTER TABLE "humlinkers" ALTER COLUMN "communicationChannel" TYPE "HumlinkerChannel" USING "communicationChannel"::TEXT::"HumlinkerChannel";
DROP TYPE "HumlinkerChannel_old";

-- 9. Supprimer la table contacts
DROP TABLE IF EXISTS "contacts";
