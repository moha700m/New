import "server-only";
import crypto from "node:crypto";
import { prisma } from "../db";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";

/**
 * GitHub connection without pasting tokens:
 * 1) GitHub App manifest flow creates the owner's own GitHub App (credentials saved encrypted automatically).
 * 2) Installing it (request_oauth_on_install) / "Connect" runs the user-to-server OAuth flow → expiring user token + refresh token.
 * The agent then talks to GitHub's MCP server (api.githubcopilot.com/mcp) — or the REST fallback tools — with that user token.
 */

export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";
export const GITHUB_TOOLSETS = "context,repos,issues,pull_requests,users,actions";
export const MANIFEST_CALLBACK = "/api/github/manifest/callback";
export const USER_CALLBACK = "/api/github/oauth/callback";
const GH_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "JB-AI-Agent" };

export async function getGithubConnection() {
  return prisma.githubConnection.findUnique({ where: { id: "global" } });
}

export function githubPublicState(c: Awaited<ReturnType<typeof getGithubConnection>>) {
  return {
    appCreated: Boolean(c?.clientId && c.clientSecretEncrypted),
    appSlug: c?.appSlug ?? null,
    appName: c?.appName ?? null,
    appHtmlUrl: c?.appHtmlUrl ?? null,
    installUrl: c?.appSlug ? `https://github.com/apps/${c.appSlug}/installations/new` : null,
    connected: Boolean(c?.userTokenEncrypted),
    login: c?.login ?? null,
    avatarUrl: c?.avatarUrl ?? null,
    connectedAt: c?.connectedAt ?? null,
  };
}

async function newState(kind: string, data: Record<string, unknown> = {}) {
  const state = randomToken(24);
  await prisma.oAuthState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 60 * 60_000) } } });
  await prisma.oAuthState.create({ data: { id: state, kind, data: data as any } });
  return state;
}

export async function consumeState(state: string | null, kind: string) {
  if (!state) return null;
  const st = await prisma.oAuthState.findUnique({ where: { id: state } });
  if (!st || st.kind !== kind) return null;
  await prisma.oAuthState.delete({ where: { id: state } });
  if (Date.now() - st.createdAt.getTime() > 60 * 60_000) return null;
  return st;
}

/** Builds the manifest + the github.com URL the browser must POST it to. */
export async function buildManifest(origin: string, org?: string | null) {
  const state = await newState("github_manifest", { origin });
  const suffix = crypto.randomBytes(2).toString("hex");
  const manifest = {
    name: `JB AI Agent ${suffix}`,
    url: origin,
    description: "JB AI agent mode: lets my private AI assistant read and change my repositories (files, branches, commits, pull requests, issues).",
    hook_attributes: { url: `${origin}/api/webhooks/github`, active: false },
    redirect_url: `${origin}${MANIFEST_CALLBACK}`,
    callback_urls: [`${origin}${USER_CALLBACK}`],
    request_oauth_on_install: true,
    public: false,
    default_permissions: {
      contents: "write",
      pull_requests: "write",
      issues: "write",
      metadata: "read",
      actions: "write",
      workflows: "write",
      checks: "read",
      statuses: "read",
    },
    default_events: [],
  };
  const action = org ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}` : `https://github.com/settings/apps/new?state=${state}`;
  return { action, manifest, state };
}

/** Exchanges the manifest code for the new app's credentials and stores them encrypted. */
export async function convertManifest(code: string) {
  const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST", headers: GH_HEADERS, signal: AbortSignal.timeout(20_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.client_id) throw new Error(`تحويل الـ manifest فشل (${r.status}): ${j.message ?? ""}`);
  return prisma.githubConnection.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      appId: j.id,
      appSlug: j.slug,
      appName: j.name,
      appHtmlUrl: j.html_url,
      clientId: j.client_id,
      clientSecretEncrypted: encryptSecret(j.client_secret),
      privateKeyEncrypted: j.pem ? encryptSecret(j.pem) : null,
      webhookSecretEncrypted: j.webhook_secret ? encryptSecret(j.webhook_secret) : null,
    },
    update: {
      appId: j.id,
      appSlug: j.slug,
      appName: j.name,
      appHtmlUrl: j.html_url,
      clientId: j.client_id,
      clientSecretEncrypted: encryptSecret(j.client_secret),
      privateKeyEncrypted: j.pem ? encryptSecret(j.pem) : null,
      webhookSecretEncrypted: j.webhook_secret ? encryptSecret(j.webhook_secret) : null,
      userTokenEncrypted: null,
      refreshTokenEncrypted: null,
      login: null,
      avatarUrl: null,
      connectedAt: null,
    },
  });
}

export async function authorizeUrl(origin: string) {
  const c = await getGithubConnection();
  if (!c?.clientId) throw new Error("لازم تسوي تطبيق GitHub أول");
  const state = await newState("github_user", { origin });
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", `${origin}${USER_CALLBACK}`);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenExchange(params: Record<string, string>) {
  const c = await getGithubConnection();
  if (!c?.clientId || !c.clientSecretEncrypted) throw new Error("تطبيق GitHub غير موجود");
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "JB-AI-Agent" },
    body: JSON.stringify({ client_id: c.clientId, client_secret: decryptSecret(c.clientSecretEncrypted), ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`GitHub رفض الطلب: ${j.error_description ?? j.error ?? r.status}`);
  return j as { access_token: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number };
}

function tokenFields(t: { access_token: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }) {
  return {
    userTokenEncrypted: encryptSecret(t.access_token),
    refreshTokenEncrypted: t.refresh_token ? encryptSecret(t.refresh_token) : null,
    tokenExpiresAt: t.expires_in ? new Date(Date.now() + Number(t.expires_in) * 1000) : null,
    refreshExpiresAt: t.refresh_token_expires_in ? new Date(Date.now() + Number(t.refresh_token_expires_in) * 1000) : null,
  };
}

/** OAuth callback (after install with request_oauth_on_install, or after "Connect"). */
export async function finishUserOAuth(code: string, redirectUri: string) {
  const t = await tokenExchange({ code, redirect_uri: redirectUri });
  const me = await fetch("https://api.github.com/user", { headers: { ...GH_HEADERS, Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  const c = await prisma.githubConnection.update({
    where: { id: "global" },
    data: { ...tokenFields(t), login: me?.login ?? null, avatarUrl: me?.avatar_url ?? null, connectedAt: new Date() },
  });
  await prisma.mcpServer.upsert({
    where: { slug: "github" },
    create: { slug: "github", name: "GitHub", url: GITHUB_MCP_URL, transport: "streamable", authType: "github", extraHeaders: { "X-MCP-Toolsets": GITHUB_TOOLSETS }, connectedAs: me?.login ?? null, connectedAt: new Date() },
    update: { url: GITHUB_MCP_URL, authType: "github", tokenEncrypted: null, tokenLast4: null, enabled: true, connectedAs: me?.login ?? null, connectedAt: new Date(), lastError: null, tools: [] },
  });
  return c;
}

/** A valid user token, refreshed when about to expire. */
export async function githubUserToken(): Promise<string | null> {
  const c = await getGithubConnection();
  if (!c?.userTokenEncrypted) return null;
  if (c.tokenExpiresAt && c.tokenExpiresAt.getTime() < Date.now() + 120_000 && c.refreshTokenEncrypted) {
    try {
      const t = await tokenExchange({ grant_type: "refresh_token", refresh_token: decryptSecret(c.refreshTokenEncrypted) });
      const u = await prisma.githubConnection.update({ where: { id: "global" }, data: tokenFields(t) });
      return decryptSecret(u.userTokenEncrypted!);
    } catch {
      return null;
    }
  }
  return decryptSecret(c.userTokenEncrypted);
}

export async function disconnectGithub() {
  await prisma.githubConnection.updateMany({ where: { id: "global" }, data: { userTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null, refreshExpiresAt: null, login: null, avatarUrl: null, connectedAt: null } });
  await prisma.mcpServer.updateMany({ where: { slug: "github", authType: "github" }, data: { connectedAs: null, connectedAt: null, tools: [] } });
}

// ------------------------------------------------------------------ REST fallback (used if the GitHub MCP server rejects the token)
export async function ghRest(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}
