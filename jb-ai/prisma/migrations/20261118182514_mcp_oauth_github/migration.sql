-- AlterTable
ALTER TABLE "McpServer" ADD COLUMN     "authType" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "connectedAs" TEXT,
ADD COLUMN     "connectedAt" TIMESTAMP(3),
ADD COLUMN     "oauthClientSecretEncrypted" TEXT,
ADD COLUMN     "oauthConfig" JSONB,
ADD COLUMN     "refreshTokenEncrypted" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "serverId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubConnection" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "appId" INTEGER,
    "appSlug" TEXT,
    "appName" TEXT,
    "appHtmlUrl" TEXT,
    "clientId" TEXT,
    "clientSecretEncrypted" TEXT,
    "privateKeyEncrypted" TEXT,
    "webhookSecretEncrypted" TEXT,
    "userTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "refreshExpiresAt" TIMESTAMP(3),
    "login" TEXT,
    "avatarUrl" TEXT,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubConnection_pkey" PRIMARY KEY ("id")
);
