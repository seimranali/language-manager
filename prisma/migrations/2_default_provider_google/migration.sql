ALTER TABLE "user_preferences" ALTER COLUMN "preferredProvider" SET DEFAULT 'google';
UPDATE "user_preferences" SET "preferredProvider" = 'google' WHERE "preferredProvider" = 'auto';
