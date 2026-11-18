/* Idempotent bootstrap: plans, Venice provider, routing singleton, settings, and a live Venice catalog sync. */
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function masterKey() {
  const raw = process.env.MASTER_ENCRYPTION_KEY!;
  return /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
}

function decrypt(payload: string): string | null {
  try {
    const [v, ivB, tagB, dataB] = payload.split(":");
    if (v !== "v1" || !ivB || !tagB || !dataB) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB, "base64"));
    d.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([d.update(Buffer.from(dataB, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function encrypt(plain: string) {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

async function main() {
  const plans = [
    { key: "free", name: "المجانية", description: "ابدأ بأسئلتك اليومية.", priceMonthlyCents: 0, priceYearlyCents: 0, dailyMessageLimit: 20, monthlyMessageLimit: 300, monthlyTokenLimit: 500_000, maxUploadMb: 2, allowUploads: true, allowWebSearch: false, allowImageGeneration: false, allowAllModels: false, isDefault: true, sortOrder: 0, features: ["٢٠ رسالة يوميًا", "النماذج الأساسية", "إرفاق صور وملفات حتى ٢ ميجابايت"] },
    { key: "pro", name: "برو", description: "رسائل أكثر، ونماذج أكثر، وبحث في الويب.", priceMonthlyCents: 1200, priceYearlyCents: 12000, dailyMessageLimit: 300, monthlyMessageLimit: 5000, monthlyTokenLimit: 10_000_000, maxUploadMb: 4, allowUploads: true, allowWebSearch: true, allowImageGeneration: true, allowAllModels: false, isDefault: false, sortOrder: 1, features: ["٣٠٠ رسالة يوميًا", "نماذج التفكير والبرمجة", "البحث في الويب", "توليد الصور", "مرفقات حتى ٤ ميجابايت"] },
    { key: "premium", name: "بريميوم", description: "كل النماذج، وأعلى الحدود.", priceMonthlyCents: 2900, priceYearlyCents: 29000, dailyMessageLimit: null, monthlyMessageLimit: 20000, monthlyTokenLimit: 50_000_000, maxUploadMb: 4, allowUploads: true, allowWebSearch: true, allowImageGeneration: true, allowAllModels: true, isDefault: false, sortOrder: 2, features: ["رسائل يومية بدون حد", "كل النماذج بما فيها النماذج المتقدمة", "البحث في الويب وتوليد الصور", "مرفقات حتى ٤ ميجابايت", "أولوية في المعالجة"] },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({ where: { key: p.key }, create: p, update: {} });
  }

  let venice = await prisma.provider.findUnique({ where: { slug: "venice" } });
  if (!venice) {
    venice = await prisma.provider.create({
      data: {
        slug: "venice",
        name: "Venice AI",
        type: "VENICE",
        baseUrl: "https://api.venice.ai/api/v1",
        priority: 10,
        ...(process.env.VENICE_API_KEY ? { apiKeyEncrypted: encrypt(process.env.VENICE_API_KEY), apiKeyLast4: process.env.VENICE_API_KEY.slice(-4) } : {}),
      },
    });
  }
  // VENICE_API_KEY (Vercel env) is the source of truth for the Venice key: keep the encrypted copy in sync.
  const envKey = process.env.VENICE_API_KEY?.trim();
  if (envKey && process.env.MASTER_ENCRYPTION_KEY) {
    const current = venice.apiKeyEncrypted ? decrypt(venice.apiKeyEncrypted) : null;
    if (current !== envKey) {
      venice = await prisma.provider.update({ where: { id: venice.id }, data: { apiKeyEncrypted: encrypt(envKey), apiKeyLast4: envKey.slice(-4) } });
      console.log("Venice API key updated from VENICE_API_KEY.");
    }
  }
  await prisma.routingConfig.upsert({ where: { id: "global" }, create: { id: "global", defaultProviderId: venice.id }, update: {} });
  await prisma.configState.upsert({ where: { id: "global" }, create: { id: "global", version: 1 }, update: {} });
  await prisma.setting.upsert({ where: { key: "system" }, create: { key: "system", value: {} }, update: {} });
  try {
    await syncVeniceCatalog(venice.id, venice.baseUrl);
  } catch (e) {
    console.warn("Venice catalog sync skipped:", (e as Error).message);
  }
  try {
    await privateModeHousekeeping();
  } catch (e) {
    console.warn("Private-mode housekeeping skipped:", (e as Error).message);
  }
  console.log("Seed complete. Provider:", venice.name);
}

/* ------------------------------------------------------------------ Venice catalog
 * Venice's /models and /models/traits endpoints are public, so the full catalog is synced on every deploy.
 * Every Venice model (incl. the uncensored ones) is offered to every plan. Newly discovered models are enabled
 * automatically; a one-time bootstrap also enables models that an earlier sync stored as disabled.
 * Later admin curation (disabling a model, removing it from a plan) is preserved on subsequent deploys. */
async function veniceGet(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as { data?: any };
}

function textModelFields(m: any) {
  const spec = m.model_spec ?? {};
  const c = spec.capabilities ?? {};
  const traits: string[] = Array.isArray(spec.traits) ? spec.traits : [];
  const code = Boolean(c.optimizedForCode) || traits.includes("default_code");
  const reasoning = Boolean(c.supportsReasoning);
  return {
    displayName: spec.name || m.id,
    description: spec.description?.slice(0, 2000),
    category: (code ? "CODE" : reasoning ? "REASONING" : c.supportsVision ? "VISION" : "TEXT") as "CODE" | "REASONING" | "VISION" | "TEXT",
    caps: {
      supportsText: true,
      supportsStreaming: true,
      supportsVision: Boolean(c.supportsVision),
      supportsTools: Boolean(c.supportsFunctionCalling),
      supportsWebSearch: Boolean(c.supportsWebSearch),
      supportsReasoning: reasoning,
      supportsStructuredOutput: Boolean(c.supportsResponseSchema),
      supportsImageGeneration: false,
      supportsCode: code,
      extraCapabilities: { uncensored: Boolean(spec.uncensored), e2ee: Boolean(c.supportsE2EE), privacy: spec.privacy, traits, reasoningEffort: Boolean(c.supportsReasoningEffort), multipleImages: Boolean(c.supportsMultipleImages) },
      contextLength: spec.availableContextTokens ?? m.context_length ?? null,
      maxOutputTokens: spec.maxCompletionTokens ?? null,
      inputPricePerM: spec.pricing?.input?.usd ?? null,
      outputPricePerM: spec.pricing?.output?.usd ?? null,
      offline: Boolean(spec.offline),
      rawMetadata: m,
      inCatalog: true,
    },
  };
}

function imageModelFields(m: any) {
  const spec = m.model_spec ?? {};
  return {
    displayName: spec.name || m.id,
    description: spec.description?.slice(0, 2000),
    category: "IMAGE" as const,
    caps: {
      supportsText: false,
      supportsStreaming: false,
      supportsVision: false,
      supportsTools: false,
      supportsWebSearch: false,
      supportsReasoning: false,
      supportsStructuredOutput: false,
      supportsImageGeneration: true,
      supportsCode: false,
      extraCapabilities: { traits: spec.traits ?? [], privacy: spec.privacy, constraints: spec.constraints, pricePerImageUsd: spec.pricing?.generation?.usd },
      offline: Boolean(spec.offline),
      rawMetadata: m,
      inCatalog: true,
    },
  };
}

async function syncVeniceCatalog(providerId: string, baseUrl: string) {
  const [text, image, textTraits, imageTraits] = await Promise.all([
    veniceGet(baseUrl, "/models?type=text"),
    veniceGet(baseUrl, "/models?type=image"),
    veniceGet(baseUrl, "/models/traits").catch(() => ({ data: {} })),
    veniceGet(baseUrl, "/models/traits?type=image").catch(() => ({ data: {} })),
  ]);
  const discovered = [
    ...(Array.isArray(text.data) ? text.data : []).map((m: any, i: number) => ({ modelId: m.id as string, sortOrder: 100 + i, ...textModelFields(m) })),
    ...(Array.isArray(image.data) ? image.data : []).map((m: any, i: number) => ({ modelId: m.id as string, sortOrder: 1000 + i, ...imageModelFields(m) })),
  ].filter((d) => typeof d.modelId === "string");
  if (!discovered.length) throw new Error("Venice returned no models");

  const BOOTSTRAP = "venice_open_catalog_v1";
  const bootstrapped = Boolean(await prisma.setting.findUnique({ where: { key: BOOTSTRAP } }));
  const plans = await prisma.plan.findMany({ select: { id: true } });
  const existing = await prisma.aiModel.findMany({ where: { providerId } });
  const byId = new Map(existing.map((m) => [m.modelId, m]));
  let created = 0;
  for (const d of discovered) {
    const prev = byId.get(d.modelId);
    let rowId: string;
    if (prev) {
      await prisma.aiModel.update({ where: { id: prev.id }, data: { ...d.caps, ...(bootstrapped ? {} : { enabled: true }) } });
      rowId = prev.id;
    } else {
      const row = await prisma.aiModel.create({
        data: { providerId, modelId: d.modelId, displayName: d.displayName, description: d.description, category: d.category, source: "SYNCED", enabled: true, sortOrder: d.sortOrder, ...d.caps },
      });
      rowId = row.id;
      created++;
    }
    if (!prev || !bootstrapped) {
      await prisma.planModel.createMany({ data: plans.map((p) => ({ planId: p.id, modelId: rowId })), skipDuplicates: true });
    }
  }
  const seen = new Set(discovered.map((d) => d.modelId));
  const gone = existing.filter((m) => m.source === "SYNCED" && !seen.has(m.modelId));
  if (gone.length) await prisma.aiModel.updateMany({ where: { id: { in: gone.map((m) => m.id) } }, data: { inCatalog: false } });

  // Routing defaults from Venice traits — only fill empty slots so admin choices win.
  const routing = await prisma.routingConfig.findUniqueOrThrow({ where: { id: "global" } });
  const t = textTraits.data || {};
  const it = imageTraits.data || {};
  const want: Record<string, string | undefined> = {
    defaultTextModelId: t.default,
    defaultReasoningModelId: t.default_reasoning,
    defaultCodingModelId: t.default_code,
    defaultVisionModelId: t.default_vision,
    defaultImageModelId: it.default,
  };
  const rows = await prisma.aiModel.findMany({ where: { providerId }, select: { id: true, modelId: true } });
  const rowByModel = new Map(rows.map((r) => [r.modelId, r.id]));
  const routingData: Record<string, string> = {};
  for (const [field, modelId] of Object.entries(want)) {
    if (!modelId || (routing as any)[field]) continue;
    const id = rowByModel.get(modelId);
    if (id) routingData[field] = id;
  }
  if (!routing.defaultProviderId) routingData.defaultProviderId = providerId;
  if (Object.keys(routingData).length) await prisma.routingConfig.update({ where: { id: "global" }, data: routingData });

  await prisma.provider.update({ where: { id: providerId }, data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastSyncError: null, lastSyncCount: discovered.length } });
  if (!bootstrapped) await prisma.setting.create({ data: { key: BOOTSTRAP, value: { at: new Date().toISOString() } } });
  await prisma.configState.update({ where: { id: "global" }, data: { version: { increment: 1 } } });
  console.log(`Venice catalog synced: ${discovered.length} models (${created} new)${bootstrapped ? "" : ", all enabled for every plan"}.`);
}

/* Private mode: make sure the owner account has the OWNER role, block the automated test accounts,
 * and print an access report (non-owner accounts are blocked at runtime by PRIVATE_MODE, not deleted). */
async function privateModeHousekeeping() {
  const owners = (process.env.OWNER_EMAIL ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const priv = (process.env.PRIVATE_MODE ?? "on").trim().toLowerCase() !== "off";
  if (owners.length) await prisma.user.updateMany({ where: { email: { in: owners }, role: { not: "OWNER" } }, data: { role: "OWNER" } });
  const test = { email: { startsWith: "grokbot-test-", endsWith: "@example.com" } };
  const blocked = await prisma.user.updateMany({ where: { ...test, disabled: false }, data: { disabled: true } });
  await prisma.session.deleteMany({ where: { user: test } });
  const users = await prisma.user.findMany({
    select: { email: true, role: true, disabled: true, createdAt: true, subscription: { select: { status: true, plan: { select: { key: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const top = await prisma.plan.findFirst({ where: { active: true }, orderBy: [{ sortOrder: "desc" }, { priceMonthlyCents: "desc" }] });
  const missing = owners.filter((o) => !users.some((u) => u.email.toLowerCase() === o));
  if (missing.length) console.log(`[access] WARNING: OWNER_EMAIL account(s) not registered yet: ${missing.join(", ")}`);
  console.log(`[access] PRIVATE_MODE=${priv ? "on" : "off"}; test accounts newly disabled: ${blocked.count}; users: ${users.length}`);
  for (const u of users) {
    const isOwner = u.role === "OWNER" || owners.includes(u.email.toLowerCase());
    const access = isOwner ? `OWNER -> plan "${top?.key}" unlimited (no daily/monthly/token caps, all models, all features)` : priv || u.disabled ? "BLOCKED" : "allowed";
    console.log(`[access] ${u.email} role=${u.role} disabled=${u.disabled} created=${u.createdAt.toISOString()} sub=${u.subscription ? `${u.subscription.plan.key}/${u.subscription.status}` : "none"} => ${access}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
