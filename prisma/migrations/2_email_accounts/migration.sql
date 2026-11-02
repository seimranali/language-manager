ALTER TABLE "users" ADD COLUMN "email" VARCHAR(254), ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "email_verifications" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_verifications_email_createdAt_idx" ON "email_verifications"("email", "createdAt");
