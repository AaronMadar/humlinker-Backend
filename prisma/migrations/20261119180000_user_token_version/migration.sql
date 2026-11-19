-- Sessions : version des jetons (déconnexion de tous les appareils)
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
