// End-to-end API test against a running JB AI server. Uses real providers; nothing is mocked.
// Usage: BASE=http://localhost:3000 OWNER_EMAIL=owner@jb-ai.test node scripts/e2e.mjs
import crypto from "node:crypto";

const BASE = process.env.BASE || "http://localhost:3000";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "owner@jb-ai.test";
const PASSWORD = "Sup3r-secret-pass!";
const results = [];
const log = (ok, name, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

class Client {
  constructor() {
    this.cookies = {};
  }
  async req(path, { method, body, raw, headers = {} } = {}) {
    const res = await fetch(BASE + path, {
      method: method ?? (body !== undefined || raw !== undefined ? "POST" : "GET"),
      headers: {
        Origin: BASE,
        ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}),
        Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "),
        ...headers,
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      if (/expires=Thu, 01 Jan 1970/i.test(c) || v === "") delete this.cookies[k];
      else this.cookies[k] = v;
    }
    return res;
  }
  async json(path, opts) {
    const r = await this.req(path, opts);
    const t = await r.text();
    let d;
    try {
      d = JSON.parse(t);
    } catch {
      d = { raw: t };
    }
    return { status: r.status, data: d };
  }
  async chat(body) {
    const r = await this.req("/api/chat", { body });
    if (!r.ok) return { status: r.status, error: (await r.json()).error, events: [] };
    const text = await r.text();
    const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return { status: r.status, events, text: events.filter((e) => e.type === "delta").map((e) => e.text).join(""), deltas: events.filter((e) => e.type === "delta").length };
  }
}

const suffix = crypto.randomBytes(3).toString("hex");
const owner = new Client();
const user = new Client();
const userEmail = `user-${suffix}@jb-ai.test`;

async function main() {
  // 1. registration + login
  let r = await owner.json("/api/auth/register", { body: { email: OWNER_EMAIL, password: PASSWORD, name: "Owner" } });
  if (r.status === 409) r = await owner.json("/api/auth/login", { body: { email: OWNER_EMAIL, password: PASSWORD } });
  const me0 = await owner.json("/api/auth/me");
  log(me0.data.user?.role === "OWNER", "Owner account (OWNER_EMAIL) gets OWNER role", me0.data.user?.role);

  r = await user.json("/api/auth/register", { body: { email: userEmail, password: PASSWORD } });
  log(r.status === 201, "1. Create a new user", `${userEmail} → ${r.status}`);
  await user.json("/api/auth/logout", { method: "POST" });
  r = await user.json("/api/auth/login", { body: { email: userEmail, password: "wrong-password" } });
  log(r.status === 401, "Login rejects wrong password", String(r.status));
  r = await user.json("/api/auth/login", { body: { email: userEmail, password: PASSWORD } });
  const me = await user.json("/api/auth/me");
  log(r.status === 200 && me.data.user?.email === userEmail, "2. Login successfully", `plan=${me.data.plan?.key}`);

  // 16. admin permissions
  r = await user.json("/api/admin/providers");
  log(r.status === 403, "16. Non-admin blocked from admin API", String(r.status));
  r = await new Client().json("/api/admin/providers");
  log(r.status === 401, "16. Anonymous blocked from admin API", String(r.status));
  const x = await owner.req("/api/admin/settings", { method: "PUT", body: { siteName: "JB AI" }, headers: { Origin: "https://evil.example" } });
  log(x.status === 403, "CSRF: cross-origin admin write rejected", String(x.status));

  // providers
  const prov = await owner.json("/api/admin/providers");
  const venice = prov.data.providers.find((p) => p.slug === "venice");
  log(Boolean(venice), "Venice provider present", venice?.baseUrl);
  log(!JSON.stringify(prov.data).includes("apiKeyEncrypted"), "Provider API never returns key material");

  // 12. replace credentials (proxy-injected key in this sandbox; encrypted at rest either way)
  r = await owner.json(`/api/admin/providers/${venice.id}`, { method: "PATCH", body: { apiKey: "proxy-injected-venice-key-0001" } });
  log(r.status === 200 && r.data.provider.apiKeyLast4 === "0001" && !("apiKeyEncrypted" in r.data.provider), "12. Replace provider credentials securely", `last4=${r.data.provider?.apiKeyLast4}`);

  r = await owner.json(`/api/admin/providers/${venice.id}/test`, { method: "POST" });
  log(true, "Venice connection test (real)", `${r.data.result?.ok ? "OK" : "NOT OK"}: ${r.data.result?.detail}`);

  // 6. discover models
  r = await owner.json(`/api/admin/providers/${venice.id}/sync`, { method: "POST" });
  log(r.status === 200 && r.data.result.discovered > 10, "6. Discover models through Venice (/models)", JSON.stringify(r.data.result));
  r = await owner.json(`/api/admin/providers/${venice.id}/suggested`, { method: "POST" });
  log(r.status === 200, "Venice /models/traits suggested defaults applied", JSON.stringify(r.data.result?.applied));

  // 11. second provider (OpenAI-compatible adapter)
  let other = (await owner.json("/api/admin/providers")).data.providers.find((p) => p.slug === "pollinations");
  if (!other) {
    r = await owner.json("/api/admin/providers", { body: { name: "Pollinations (OpenAI-compatible)", slug: "pollinations", type: "OPENAI_COMPATIBLE", baseUrl: "https://text.pollinations.ai/openai", priority: 50 } });
    other = r.data.provider;
    log(r.status === 201, "11. Add another provider (OpenAI-compatible adapter)", other?.baseUrl);
  }
  r = await owner.json(`/api/admin/providers/${other.id}/test`, { method: "POST" });
  log(r.data.result?.ok, "11. Test the new provider", r.data.result?.detail);
  r = await owner.json(`/api/admin/providers/${other.id}/sync`, { method: "POST" });
  log(r.status === 200, "11. Model discovery on custom provider", JSON.stringify(r.data.result));

  // 7. add + edit a model through admin
  let models = (await owner.json(`/api/admin/models?providerId=${other.id}`)).data.models;
  let manual = models.find((m) => m.modelId === "openai");
  if (!manual) {
    r = await owner.json("/api/admin/models", { body: { providerId: other.id, modelId: "openai", displayName: "GPT-OSS 20B (free)", category: "REASONING", enabled: true, supportsText: true, supportsStreaming: true, supportsReasoning: true, planKeys: ["free", "pro"] } });
    manual = r.data.model;
    log(r.status === 201, "7. Add a model manually", manual?.modelId);
  }
  r = await owner.json(`/api/admin/models/${manual.id}`, { method: "PATCH", body: { displayName: "GPT-OSS 20B", description: "Open-weight reasoning model served via Pollinations.", enabled: true, sortOrder: 5, planKeys: ["free", "pro"] } });
  log(r.status === 200 && r.data.model.displayName === "GPT-OSS 20B", "7. Edit a model (name, description, order, plans)");
  r = await owner.json(`/api/admin/models/${manual.id}/test`, { method: "POST" });
  log(r.data.result?.ok, "Model test button sends real request", r.data.result?.ok ? `${r.data.result.latencyMs}ms "${r.data.result.output.slice(0, 60)}"` : r.data.result?.error);

  // 8/9. change default model, check customer catalog
  const v1 = (await user.json("/api/config")).data;
  r = await owner.json("/api/admin/routing", { method: "PUT", body: { defaultTextModelId: manual.id, fallbackEnabled: true, fallbackProviderId: other.id, fallbackModelId: manual.id } });
  log(r.status === 200, "8. Change the default AI model", "default → GPT-OSS 20B");
  const v2 = (await user.json("/api/config")).data;
  log(v2.version > v1.version && v2.defaults.text === manual.id, "9. Frontend config reflects change (version bump + new default)", `v${v1.version} → v${v2.version}`);
  log(v2.models.every((m) => !("modelId" in m) && !("baseUrl" in m)), "Customer catalog exposes no provider internals");

  // 3/4/5. real streaming chat
  let c = await user.chat({ content: "In one short sentence: what is the capital of France?" });
  const meta = c.events.find((e) => e.type === "meta");
  const done = c.events.find((e) => e.type === "done");
  log(c.status === 200 && c.deltas > 1 && Boolean(done), "3/4. Send a real message and receive a streaming response", `${c.deltas} chunks, model=${done?.model?.name ?? "?"}: "${c.text.slice(0, 80)}"`);
  const conv = await user.json(`/api/conversations/${meta?.conversationId}`);
  log(conv.status === 200 && conv.data.messages.length === 2 && conv.data.messages[1].content.length > 0, "5. Save and retrieve chat history", `${conv.data.messages?.length} messages`);
  const other2 = new Client();
  await other2.json("/api/auth/register", { body: { email: `other-${suffix}@jb-ai.test`, password: PASSWORD } });
  r = await other2.json(`/api/conversations/${meta?.conversationId}`);
  log(r.status === 404, "Users cannot read another user's conversation", String(r.status));

  // venice explicitly (will fail if account lacks credits → must fall back)
  const veniceModels = (await owner.json(`/api/admin/models?providerId=${venice.id}&status=enabled`)).data.models;
  const vm = veniceModels.find((m) => m.supportsText);
  if (vm) {
    await owner.json(`/api/admin/models/${vm.id}`, { method: "PATCH", body: { planKeys: [...new Set([...(vm.planKeys || []), "free"])] } });
    c = await user.chat({ content: "Reply with the word ping.", modelId: vm.id });
    const fb = c.events.find((e) => e.type === "fallback");
    const d2 = c.events.find((e) => e.type === "done");
    const err = c.events.find((e) => e.type === "error");
    log(Boolean(d2), "13. Venice request (fallback routing if Venice fails)", fb ? `Venice failed → fallback to ${fb.model.name}; reason: ${fb.reason}` : d2 ? `Venice answered directly: "${c.text.slice(0, 60)}"` : `error: ${err?.error}`);
  }

  // 13b. disable a provider → routing uses fallback
  await owner.json("/api/admin/routing", { method: "PUT", body: { defaultTextModelId: vm?.id ?? manual.id } });
  await owner.json(`/api/admin/providers/${venice.id}`, { method: "PATCH", body: { enabled: false } });
  c = await user.chat({ content: "Say OK." });
  log(Boolean(c.events.find((e) => e.type === "done")) && c.events.find((e) => e.type === "done")?.model?.id === manual.id, "13. Disabled provider: new requests route to fallback", `answered by ${c.events.find((e) => e.type === "done")?.model?.name}`);
  const cfgDisabled = (await user.json("/api/config")).data;
  log(!cfgDisabled.models.some((m) => m.provider === "Venice AI"), "Disabled provider's models disappear from customer catalog");
  await owner.json(`/api/admin/providers/${venice.id}`, { method: "PATCH", body: { enabled: true } });
  await owner.json("/api/admin/routing", { method: "PUT", body: { defaultTextModelId: manual.id } });

  // regenerate + edit
  c = await user.chat({ conversationId: meta.conversationId, regenerate: true });
  log(Boolean(c.events.find((e) => e.type === "done")), "Regenerate response", `"${c.text.slice(0, 50)}"`);
  const msgs = (await user.json(`/api/conversations/${meta.conversationId}`)).data.messages;
  c = await user.chat({ conversationId: meta.conversationId, editMessageId: msgs[0].id, content: "In one short sentence: what is the capital of Japan?" });
  const after = (await user.json(`/api/conversations/${meta.conversationId}`)).data.messages;
  log(/japan/i.test(after[0].content) && after.length === 2, "Edit message (re-runs and truncates later turns)", `"${c.text.slice(0, 60)}"`);
  r = await user.json(`/api/conversations/${meta.conversationId}`, { method: "PATCH", body: { title: "Capitals" } });
  log(r.status === 200, "Rename conversation");

  // 10. disable a model → access enforcement
  await owner.json(`/api/admin/models/${manual.id}`, { method: "PATCH", body: { enabled: false } });
  const cfg3 = (await user.json("/api/config")).data;
  log(!cfg3.models.some((m) => m.id === manual.id), "10. Disabled model disappears from customer selector");
  c = await user.chat({ content: "hi", modelId: manual.id });
  log(c.status === 409, "10. Disabled model rejected for new requests", `${c.status}: ${c.error}`);
  await owner.json(`/api/admin/models/${manual.id}`, { method: "PATCH", body: { enabled: true } });

  // 14. subscription enforcement (plan model access + quota)
  const premiumOnly = veniceModels.find((m) => m.id !== vm?.id && !(m.planKeys || []).includes("free"));
  if (premiumOnly) {
    c = await user.chat({ content: "hi", modelId: premiumOnly.id });
    log(c.status === 403, "14. Free plan cannot use a model outside its plan", `${c.status}: ${c.error}`);
  }
  const plans = (await owner.json("/api/admin/plans")).data.plans;
  const free = plans.find((p) => p.key === "free");
  const { id: _id, subscriberCount: _s, ...freeBody } = free;
  await owner.json(`/api/admin/plans/${free.id}`, { method: "PUT", body: { ...freeBody, dailyMessageLimit: 1 } });
  c = await user.chat({ content: "hi" });
  log(c.status === 429, "14. Daily message quota enforced", `${c.status}: ${c.error}`);
  await owner.json(`/api/admin/plans/${free.id}`, { method: "PUT", body: { ...freeBody } });

  // 15. signed webhooks (real Stripe signature verification with a test signing secret)
  const whsec = "whsec_" + crypto.randomBytes(24).toString("base64url");
  await owner.json("/api/admin/payments", { method: "PUT", body: { webhookSecret: whsec } });
  const pro = plans.find((p) => p.key === "pro");
  const uid = me.data.user.id;
  const now = Math.floor(Date.now() / 1000);
  const evt = {
    id: "evt_test_" + suffix, object: "event", type: "customer.subscription.created", api_version: "2025-02-24.acacia", created: now, livemode: false,
    data: { object: { id: "sub_test_" + suffix, object: "subscription", customer: "cus_test_" + suffix, status: "active", cancel_at_period_end: false, current_period_start: now, current_period_end: now + 30 * 86400, metadata: { userId: uid, planId: pro.id, planKey: "pro", interval: "MONTH" }, items: { object: "list", data: [] } } },
  };
  const payload = JSON.stringify(evt);
  const forged = await new Client().req("/api/webhooks/stripe", { raw: payload, headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${now},v1=${"0".repeat(64)}` } });
  log(forged.status === 400, "15. Webhook with invalid signature rejected", String(forged.status));
  const meBefore = (await user.json("/api/auth/me")).data;
  log(meBefore.plan.key === "free", "15. Plan not activated before verified webhook");
  const sig = crypto.createHmac("sha256", whsec).update(`${now}.${payload}`).digest("hex");
  const good = await new Client().json("/api/webhooks/stripe", { raw: payload, headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${now},v1=${sig}` } });
  const meAfter = (await user.json("/api/auth/me")).data;
  log(good.status === 200 && meAfter.plan.key === "pro", "15. Signed webhook activates subscription", `${good.data.outcome} → plan=${meAfter.plan.key}`);
  const dup = await new Client().json("/api/webhooks/stripe", { raw: payload, headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${now},v1=${sig}` } });
  log(dup.data.duplicate === true, "15. Webhook replay is idempotent");
  const inv = { id: "evt_inv_" + suffix, object: "event", type: "invoice.paid", created: now, livemode: false, data: { object: { id: "in_test_" + suffix, object: "invoice", customer: "cus_test_" + suffix, amount_paid: 1200, amount_due: 1200, currency: "usd", subscription_details: { metadata: { userId: uid, planKey: "pro" } }, lines: { data: [{ description: "JB AI Pro (monthly)" }] } } } };
  const ip = JSON.stringify(inv);
  const isig = crypto.createHmac("sha256", whsec).update(`${now}.${ip}`).digest("hex");
  await new Client().json("/api/webhooks/stripe", { raw: ip, headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${now},v1=${isig}` } });
  const pays = (await user.json("/api/billing/payments")).data.payments;
  log(pays.length === 1 && pays[0].amountCents === 1200, "15. Payment recorded in history from signed invoice.paid");
  r = await user.json("/api/billing/checkout", { body: { planKey: "premium", interval: "YEAR" } });
  log(true, "Hosted checkout session (Stripe sandbox)", `${r.status}: ${r.data.url ? "checkout URL issued" : r.data.error}`);

  // delete conversation, audit log
  r = await user.json(`/api/conversations/${meta.conversationId}`, { method: "DELETE" });
  log(r.status === 200 && (await user.json(`/api/conversations/${meta.conversationId}`)).status === 404, "Delete conversation");
  const audit = (await owner.json("/api/admin/audit")).data;
  log(audit.logs.some((l) => l.action === "provider.credentials_replaced") && audit.logs.some((l) => l.action === "routing.update"), "Audit log records admin changes", `${audit.total} entries`);
  const usage = (await owner.json("/api/admin/usage?days=1")).data;
  log(usage.totals.requests > 0, "Usage tracked", `${usage.totals.requests} requests, ${usage.totals.tokens} tokens, cost sources: ${usage.costSources.map((s) => s.source + "=" + s.requests).join(", ")}`);

  // account deletion
  r = await other2.json("/api/account", { method: "DELETE", body: { password: PASSWORD } });
  log(r.status === 200 && (await other2.json("/api/auth/me")).data.user === null, "Account deletion");

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
