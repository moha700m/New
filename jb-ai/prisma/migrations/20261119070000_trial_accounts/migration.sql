-- Free-trial accounts
ALTER TABLE "User" ADD COLUMN "access" TEXT;
ALTER TABLE "User" ADD COLUMN "emailCanonical" TEXT;
ALTER TABLE "User" ADD COLUMN "trialUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "signupIp" TEXT;
CREATE UNIQUE INDEX "User_emailCanonical_key" ON "User"("emailCanonical");
