-- Suppression de compte (RGPD)
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
