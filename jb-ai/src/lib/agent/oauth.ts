import "server-only";
import crypto from "node:crypto";
import type { McpServer } from "@prisma/client";
import { prisma } from "../db";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";

/**
 * MCP authorization (spec 2025-06-18): OAuth 2.1 + PKCE, Protected Resource Metadata (RFC 9728),
 * Authorization Server Metadata (RFC 8414 / OIDC discovery), Dynamic Client Registration (RFC 7591), resource indicators (RFC 8707).
 */

export interface OAuthConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  client_id?: string;
  token_endpoint_auth_method?: string;
  redirect_uri?: string;
  resource: string;
  scope?: string;
}

const UA = { "User-Agent": "JB-AI-MCP-Client/1.0" };

export function publicOrigin(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export const MCP_OAUTH_CALLBACK = "/api/oauth/mcp/callback";
/**
 * Some providers (e.g. appdeploy.ai) only accept redirect URIs of the big AI clients plus loopback
 * (RFC 8252 native-app style). For those we register a loopback redirect: after sign-in the browser lands on
 * a localhost address that doesn't open, and the owner pastes that address back into the site (paste-back step).
 */
export const LOOPBACK_REDIRECT = "http://localhost:8976/jb-ai/oauth/callback";

async function getJson(url: string, timeoutMs = 10_000): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", ...UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function parseWwwAuthenticate(h: string | null) {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const m of h.matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) out[m[1]!.toLowerCase()] = m[2]!;
  return out;
}

export type ProbeResult = { needsAuth: false } | { needsAuth: true; resourceMetadataUrl?: string; scope?: string; status: number };

/** Sends an unauthenticated `initialize` to see whether the server needs authorization. */
export async function probeMcp(url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...UA, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "jb-ai-agent", version: "1.0.0" } } }),
    signal: AbortSignal.timeout(15_000),
  });
  await r.body?.cancel().catch(() => {});
  if (r.status === 401 || r.status === 403) {
    const w = parseWwwAuthenticate(r.headers.get("www-authenticate"));
    return { needsAuth: true, resourceMetadataUrl: w.resource_metadata, scope: w.scope, status: r.status };
  }
  return { needsAuth: false };
}

/** Full discovery: protected resource metadata → authorization server metadata. */
export async function discoverOAuth(mcpUrl: string, probe: Extract<ProbeResult, { needsAuth: true }>): Promise<OAuthConfig> {
  const u = new URL(mcpUrl);
  const path = u.pathname.replace(/\/+$/, "");
  const prmCandidates = [probe.resourceMetadataUrl, `${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`].filter(Boolean) as string[];
  let prm: any = null;
  for (const c of prmCandidates) {
    prm = await getJson(c);
    if (prm) break;
  }
  const issuer: string = (prm?.authorization_servers?.[0] as string | undefined) ?? u.origin;
  const iu = new URL(issuer);
  const ipath = iu.pathname.replace(/\/+$/, "");
  const asCandidates = ipath
    ? [`${iu.origin}/.well-known/oauth-authorization-server${ipath}`, `${iu.origin}/.well-known/openid-configuration${ipath}`, `${iu.origin}${ipath}/.well-known/openid-configuration`, `${iu.origin}${ipath}/.well-known/oauth-authorization-server`]
    : [`${iu.origin}/.well-known/oauth-authorization-server`, `${iu.origin}/.well-known/openid-configuration`];
  let meta: any = null;
  for (const c of asCandidates) {
    meta = await getJson(c);
    if (meta?.authorization_endpoint && meta?.token_endpoint) break;
    meta = null;
  }
  if (!meta) meta = { issuer, authorization_endpoint: `${iu.origin}/authorize`, token_endpoint: `${iu.origin}/token`, registration_endpoint: `${iu.origin}/register` };
  const methods: string[] | undefined = meta.code_challenge_methods_supported;
  if (methods && !methods.includes("S256")) throw new Error("خادم التفويض لا يدعم PKCE S256");
  const scopes: string[] = Array.isArray(prm?.scopes_supported) ? prm.scopes_supported : [];
  return {
    issuer: meta.issuer ?? issuer,
    authorization_endpoint: meta.authorization_endpoint,
    token_endpoint: meta.token_endpoint,
    registration_endpoint: meta.registration_endpoint,
    revocation_endpoint: meta.revocation_endpoint,
    resource: (prm?.resource as string | undefined) ?? mcpUrl,
    scope: probe.scope ?? (scopes.length ? scopes.join(" ") : undefined),
  };
}

/** RFC 7591 dynamic client registration (public client, PKCE). */
async function registerClient(cfg: OAuthConfig, redirectUri: string, clientName: string) {
  if (!cfg.registration_endpoint) throw new Error("الخادم ما يدعم التسجيل التلقائي (Dynamic Client Registration) — استخدم الإعدادات المتقدمة");
  const r = await fetch(cfg.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...UA },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(cfg.scope ? { scope: cfg.scope } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`تسجيل العميل فشل (${r.status}): ${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  if (!j.client_id) throw new Error("تسجيل العميل ما رجّع client_id");
  return { client_id: String(j.client_id), client_secret: j.client_secret ? String(j.client_secret) : undefined, token_endpoint_auth_method: String(j.token_endpoint_auth_method ?? (j.client_secret ? "client_secret_post" : "none")) };
}

function pkce() {
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Starts the authorization-code + PKCE flow. Returns the URL to send the browser to. */
export async function startMcpOAuth(server: McpServer, origin: string, probe: Extract<ProbeResult, { needsAuth: true }>, back = "/"): Promise<{ url: string; state: string; pasteBack: boolean }> {
  const webRedirect = `${origin}${MCP_OAUTH_CALLBACK}`;
  const prev = (server.oauthConfig ?? null) as OAuthConfig | null;
  let cfg = await discoverOAuth(server.url, probe);
  let secret: string | undefined;
  let redirectUri = webRedirect;
  if (prev?.client_id && (prev.redirect_uri === webRedirect || prev.redirect_uri === LOOPBACK_REDIRECT) && prev.issuer === cfg.issuer) {
    redirectUri = prev.redirect_uri;
    cfg = { ...cfg, client_id: prev.client_id, token_endpoint_auth_method: prev.token_endpoint_auth_method, redirect_uri: redirectUri };
    secret = server.oauthClientSecretEncrypted ? decryptSecret(server.oauthClientSecretEncrypted) : undefined;
  } else {
    let reg;
    try {
      reg = await registerClient(cfg, webRedirect, "JB AI Agent");
    } catch (e) {
      // provider allow-lists redirect URIs → fall back to a loopback redirect + paste-back
      if (!/invalid_redirect_uri|redirect_uri/i.test((e as Error).message)) throw e;
      redirectUri = LOOPBACK_REDIRECT;
      reg = await registerClient(cfg, redirectUri, "JB AI Agent");
    }
    cfg = { ...cfg, client_id: reg.client_id, token_endpoint_auth_method: reg.token_endpoint_auth_method, redirect_uri: redirectUri };
    secret = reg.client_secret;
  }
  await prisma.mcpServer.update({
    where: { id: server.id },
    data: { oauthConfig: cfg as any, oauthClientSecretEncrypted: secret ? encryptSecret(secret) : null, authType: "oauth" },
  });
  const { verifier, challenge } = pkce();
  const state = randomToken(24);
  await prisma.oAuthState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 60 * 60_000) } } });
  await prisma.oAuthState.create({ data: { id: state, kind: "mcp", serverId: server.id, data: { verifier: encryptSecret(verifier), redirectUri, back } } });
  const a = new URL(cfg.authorization_endpoint);
  a.searchParams.set("response_type", "code");
  a.searchParams.set("client_id", cfg.client_id!);
  a.searchParams.set("redirect_uri", redirectUri);
  a.searchParams.set("code_challenge", challenge);
  a.searchParams.set("code_challenge_method", "S256");
  a.searchParams.set("state", state);
  a.searchParams.set("resource", cfg.resource);
  if (cfg.scope) a.searchParams.set("scope", cfg.scope);
  return { url: a.toString(), state, pasteBack: redirectUri === LOOPBACK_REDIRECT };
}

/** Paste-back step: the owner pasted the (unopenable) localhost address that holds ?code=…&state=… */
export function parsePastedCallback(raw: string) {
  const t = raw.trim();
  let q: URLSearchParams;
  try {
    q = new URL(t).searchParams;
  } catch {
    q = new URLSearchParams(t.includes("?") ? t.slice(t.indexOf("?") + 1) : t);
  }
  return { code: q.get("code"), state: q.get("state"), error: q.get("error"), errorDescription: q.get("error_description") };
}

async function tokenRequest(cfg: OAuthConfig, secretEnc: string | null, params: Record<string, string>) {
  const body = new URLSearchParams({ ...params, resource: cfg.resource });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...UA };
  const secret = secretEnc ? decryptSecret(secretEnc) : undefined;
  if (secret && cfg.token_endpoint_auth_method === "client_secret_basic") {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.client_id!)}:${encodeURIComponent(secret)}`).toString("base64")}`;
  } else {
    body.set("client_id", cfg.client_id!);
    if (secret) body.set("client_secret", secret);
  }
  const r = await fetch(cfg.token_endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    j = Object.fromEntries(new URLSearchParams(text));
  }
  if (!r.ok || !j.access_token) throw new Error(`طلب التوكن فشل (${r.status}): ${(j.error_description ?? j.error ?? text).toString().slice(0, 200)}`);
  return j as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

function tokenData(t: { access_token: string; refresh_token?: string; expires_in?: number }, keepRefresh?: string | null) {
  return {
    tokenEncrypted: encryptSecret(t.access_token),
    tokenLast4: t.access_token.slice(-4),
    refreshTokenEncrypted: t.refresh_token ? encryptSecret(t.refresh_token) : keepRefresh ?? null,
    tokenExpiresAt: t.expires_in ? new Date(Date.now() + Number(t.expires_in) * 1000) : null,
  };
}

/** Handles the redirect back from the authorization server. */
/** Peeks at a pending state (without consuming it) — used to name the connector in error pages. */
export async function peekMcpState(state: string | null) {
  if (!state) return null;
  const st = await prisma.oAuthState.findUnique({ where: { id: state } });
  if (!st?.serverId) return null;
  const s = await prisma.mcpServer.findUnique({ where: { id: st.serverId }, select: { name: true, slug: true } });
  return { name: s?.name ?? null, back: (st.data as { back?: string } | null)?.back ?? "/" };
}

export async function finishMcpOAuth(state: string, code: string) {
  const st = await prisma.oAuthState.findUnique({ where: { id: state } });
  if (!st || st.kind !== "mcp" || !st.serverId) throw new Error("جلسة الربط انتهت أو غير صالحة — جرّب «ربط» مرة ثانية");
  await prisma.oAuthState.delete({ where: { id: state } });
  if (Date.now() - st.createdAt.getTime() > 30 * 60_000) throw new Error("جلسة الربط انتهت — جرّب مرة ثانية");
  const server = await prisma.mcpServer.findUniqueOrThrow({ where: { id: st.serverId } });
  const cfg = server.oauthConfig as unknown as OAuthConfig;
  const d = st.data as { verifier: string; redirectUri: string; back?: string };
  const t = await tokenRequest(cfg, server.oauthClientSecretEncrypted, { grant_type: "authorization_code", code, redirect_uri: d.redirectUri, code_verifier: decryptSecret(d.verifier) });
  const updated = await prisma.mcpServer.update({ where: { id: server.id }, data: { ...tokenData(t), authType: "oauth", connectedAt: new Date(), lastError: null } });
  return { server: updated, back: d.back ?? "/" };
}

/** Returns a valid access token for an OAuth-connected server, refreshing it when it is about to expire. */
export async function oauthAccessToken(server: McpServer, force = false): Promise<string | null> {
  if (!server.tokenEncrypted) return null;
  const soon = server.tokenExpiresAt && server.tokenExpiresAt.getTime() < Date.now() + 60_000;
  if ((soon || force) && server.refreshTokenEncrypted && server.oauthConfig) {
    try {
      const cfg = server.oauthConfig as unknown as OAuthConfig;
      const t = await tokenRequest(cfg, server.oauthClientSecretEncrypted, { grant_type: "refresh_token", refresh_token: decryptSecret(server.refreshTokenEncrypted) });
      const updated = await prisma.mcpServer.update({ where: { id: server.id }, data: tokenData(t, server.refreshTokenEncrypted) });
      return decryptSecret(updated.tokenEncrypted!);
    } catch (e) {
      await prisma.mcpServer.update({ where: { id: server.id }, data: { lastError: `انتهى الربط — اضغط «ربط» مرة ثانية (${(e as Error).message})`.slice(0, 500), ...(soon ? { connectedAt: null } : {}) } }).catch(() => {});
      if (soon) return null;
    }
  }
  return decryptSecret(server.tokenEncrypted);
}
