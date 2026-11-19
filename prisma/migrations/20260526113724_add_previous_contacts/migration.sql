-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "UserGender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "UserAuthProvider" AS ENUM ('local', 'google');

-- CreateEnum
CREATE TYPE "UserPlaceholderSource" AS ENUM ('humlinker_invitation', 'manual');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "gender" "UserGender",
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "email" TEXT,
    "phoneNumber" TEXT,
    "language" TEXT NOT NULL,
    "passwordHash" TEXT,
    "authProviders" "UserAuthProvider"[],
    "profilePicture" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "placeholderSource" "UserPlaceholderSource",
    "previousEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previousPhoneNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");
