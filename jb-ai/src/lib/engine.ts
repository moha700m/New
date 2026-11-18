import "server-only";
import type { AiModel, ModelCategory, Plan, Provider, RoutingConfig } from "@prisma/client";
import { bumpConfigVersion, freshVersion, registerInvalidator } from "./config-bus";
import { prisma } from "./db";
import { HttpError } from "./http";
import { getAdapter, type DiscoveredModel } from "./providers";

/* ---------------------------------------------------------------- routing config */

export async function getRouting(): Promise<RoutingConfig> {
  return prisma.routingConfig.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
}

export type RouteRole = "text" | "reasoning" | "code" | "vision" | "image";

const roleField: Record<RouteRole, keyof RoutingConfig> = {
  text: "defaultTextModelId",
  reasoning: "defaultReasoningModelId",
  code: "defaultCodingModelId",
  vision: "defaultVisionModelId",
  image: "defaultImageModelId",
};

/* ---------------------------------------------------------------- model sync */

export async function syncProviderModels(providerId: string) {
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  let discovered: DiscoveredModel[];
  try {
    discovered = await getAdapter(provider).listModels();
  } catch (e) {
    await prisma.provider.update({
      where: { id: providerId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: (e as Error).message.slice(0, 500) },
    });
    throw new HttpError(502, `فشل اكتشاف النماذج: ${(e as Error).message}`);
  }
  const existing = await prisma.aiModel.findMany({ where: { providerId } });
  const byId = new Map(existing.map((m) => [m.modelId, m]));
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  for (const d of discovered) {
    seen.add(d.modelId);
    const caps = {
      supportsText: d.supportsText,
      supportsStreaming: d.supportsStreaming,
      supportsVision: d.supportsVision,
      supportsTools: d.supportsTools,
      supportsWebSearch: d.supportsWebSearch,
      supportsReasoning: d.supportsReasoning,
      supportsStructuredOutput: d.supportsStructuredOutput,
      supportsImageGeneration: d.supportsImageGeneration,
      supportsCode: d.supportsCode,
      extraCapabilities: (d.extraCapabilities ?? undefined) as object | undefined,
      contextLength: d.contextLength ?? null,
      maxOutputTokens: d.maxOutputTokens ?? null,
      inputPricePerM: d.inputPricePerM ?? null,
      outputPricePerM: d.outputPricePerM ?? null,
      offline: Boolean(d.offline),
      rawMetadata: (d.raw ?? undefined) as object | undefined,
      inCatalog: true,
    };
    const prev = byId.get(d.modelId);
    if (prev) {
      // Admin-curated fields (name, description, category, enabled, order) are preserved.
      // Manually-added models adopt live capabilities once the provider lists them.
      await prisma.aiModel.update({ where: { id: prev.id }, data: caps });
      updated++;
    } else {
      await prisma.aiModel.create({
        data: { providerId, modelId: d.modelId, displayName: d.displayName, description: d.description?.slice(0, 2000), category: d.category, source: "SYNCED", enabled: false, ...caps },
      });
      created++;
    }
  }
  const removed = existing.filter((m) => m.source === "SYNCED" && !seen.has(m.modelId));
  if (removed.length) await prisma.aiModel.updateMany({ where: { id: { in: removed.map((m) => m.id) } }, data: { inCatalog: false } });
  await prisma.provider.update({
    where: { id: providerId },
    data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastSyncError: null, lastSyncCount: discovered.length },
  });
  await bumpConfigVersion();
  return { discovered: discovered.length, created, updated, removedFromCatalog: removed.length };
}

/** Use provider-suggested defaults (Venice /models/traits) to fill routing + enable those models. */
export async function applySuggestedDefaults(providerId: string) {
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  const adapter = getAdapter(provider);
  if (!adapter.suggestedDefaults) throw new HttpError(400, "هذا المزوّد لا ينشر إعدادات افتراضية مقترحة");
  const traits = await adapter.suggestedDefaults();
  const map: [RouteRole, string | undefined][] = [
    ["text", traits.default],
    ["reasoning", traits.default_reasoning],
    ["code", traits.default_code],
    ["vision", traits.default_vision],
    ["image", traits["image:default"]],
  ];
  const data: Partial<RoutingConfig> = { defaultProviderId: providerId };
  const applied: Record<string, string> = {};
  for (const [role, modelId] of map) {
    if (!modelId) continue;
    const m = await prisma.aiModel.findUnique({ where: { providerId_modelId: { providerId, modelId } } });
    if (!m) continue;
    if (!m.enabled) await prisma.aiModel.update({ where: { id: m.id }, data: { enabled: true } });
    (data as Record<string, string>)[roleField[role]] = m.id;
    applied[role] = modelId;
  }
  await prisma.routingConfig.upsert({ where: { id: "global" }, create: { id: "global", ...data }, update: data });
  await bumpConfigVersion();
  return { traits, applied };
}

/* ---------------------------------------------------------------- customer catalog (cached by version) */

export interface PublicModel {
  id: string;
  name: string;
  description: string | null;
  category: ModelCategory;
  provider: string;
  contextLength: number | null;
  capabilities: { vision: boolean; webSearch: boolean; reasoning: boolean; tools: boolean; imageGeneration: boolean; code: boolean; streaming: boolean; structuredOutput: boolean };
  plans: string[]; // plan keys that may use it
}

export interface PublicCatalog {
  version: number;
  models: PublicModel[];
  defaults: Record<RouteRole, string | null>;
  plans: { key: string; name: string; allowAllModels: boolean }[];
}

type ModelWithProvider = AiModel & { provider: Provider; plans: { planId: string }[] };

let catalogCache: { version: number; data: PublicCatalog } | null = null;
registerInvalidator(() => {
  catalogCache = null;
});

/** A model is usable when it and its provider are enabled, it's still offered by the provider, and it isn't marked offline. */
export function isUsable(m: AiModel & { provider: Provider }) {
  return m.enabled && m.provider.enabled && (m.inCatalog || m.source === "MANUAL") && !m.offline;
}

export async function getPublicCatalog(): Promise<PublicCatalog> {
  const v = await freshVersion();
  if (catalogCache && catalogCache.version === v) return catalogCache.data;
  const [models, routing, plans] = await Promise.all([
    prisma.aiModel.findMany({
      where: { enabled: true, provider: { enabled: true } },
      include: { provider: true, plans: { select: { planId: true } } },
      orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
    }),
    getRouting(),
    prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const usable = (models as ModelWithProvider[]).filter(isUsable);
  const ids = new Set(usable.map((m) => m.id));
  const planKeysFor = (m: ModelWithProvider) =>
    plans.filter((p) => p.allowAllModels || m.plans.some((pm) => pm.planId === p.id)).map((p) => p.key);
  const pick = (id: string | null) => (id && ids.has(id) ? id : null);
  const firstOf = (pred: (m: ModelWithProvider) => boolean) => usable.find(pred)?.id ?? null;
  const textDefault = pick(routing.defaultTextModelId) ?? firstOf((m) => m.supportsText && m.provider.id === routing.defaultProviderId) ?? firstOf((m) => m.supportsText);
  const data: PublicCatalog = {
    version: v,
    models: usable.map((m) => ({
      id: m.id,
      name: m.displayName,
      description: m.description,
      category: m.category,
      provider: m.provider.name,
      contextLength: m.contextLength,
      capabilities: {
        vision: m.supportsVision,
        webSearch: m.supportsWebSearch,
        reasoning: m.supportsReasoning,
        tools: m.supportsTools,
        imageGeneration: m.supportsImageGeneration,
        code: m.supportsCode,
        streaming: m.supportsStreaming,
        structuredOutput: m.supportsStructuredOutput,
      },
      plans: planKeysFor(m),
    })),
    defaults: {
      text: textDefault,
      reasoning: pick(routing.defaultReasoningModelId) ?? firstOf((m) => m.supportsReasoning && m.supportsText),
      code: pick(routing.defaultCodingModelId) ?? firstOf((m) => m.supportsCode && m.supportsText),
      vision: pick(routing.defaultVisionModelId) ?? firstOf((m) => m.supportsVision),
      image: pick(routing.defaultImageModelId) ?? firstOf((m) => m.supportsImageGeneration),
    },
    plans: plans.map((p) => ({ key: p.key, name: p.name, allowAllModels: p.allowAllModels })),
  };
  catalogCache = { version: v, data };
  return data;
}

/* ---------------------------------------------------------------- request routing */

export interface RouteTarget {
  model: AiModel & { provider: Provider };
  isFallback: boolean;
  reason?: string;
}

async function loadModel(id: string | null | undefined) {
  if (!id) return null;
  return prisma.aiModel.findUnique({ where: { id }, include: { provider: true } });
}

/**
 * Server-side routing. Customers can only pick a catalog model id; provider, base URL and credentials
 * always come from admin configuration. Returns the primary target followed by fallback candidates.
 */
export async function resolveRoute(opts: {
  requestedModelId?: string | null;
  role: RouteRole;
  plan: Plan;
  needsVision?: boolean;
  allowsModel: (m: AiModel) => Promise<boolean>;
}): Promise<RouteTarget[]> {
  const routing = await getRouting();
  const catalog = await getPublicCatalog();
  let primary: (AiModel & { provider: Provider }) | null = null;
  let reason: string | undefined;

  if (opts.requestedModelId) {
    const m = await loadModel(opts.requestedModelId);
    if (!m || !m.enabled || !(m.inCatalog || m.source === "MANUAL") || m.offline) {
      throw new HttpError(409, "النموذج المحدد لم يعد متاحًا. يرجى اختيار نموذج آخر.", "model_unavailable");
    }
    if (!(await opts.allowsModel(m))) {
      throw new HttpError(403, `النموذج ${m.displayName} غير متاح في باقتك (${opts.plan.name}).`, "model_not_in_plan");
    }
    if (opts.role === "image" && !m.supportsImageGeneration) throw new HttpError(400, `النموذج ${m.displayName} لا يستطيع توليد الصور.`);
    if (opts.role !== "image" && !m.supportsText) throw new HttpError(400, `النموذج ${m.displayName} ليس نموذج محادثة.`);
    if (m.provider.enabled) primary = m;
    else reason = `المزوّد ${m.provider.name} معطّل`;
    if (primary && opts.needsVision && !primary.supportsVision) {
      const vision = await loadModel(catalog.defaults.vision);
      if (vision && (await opts.allowsModel(vision))) {
        primary = vision;
        reason = `تم التحويل إلى ${vision.displayName} لأن النموذج المحدد لا يقرأ الصور`;
      } else {
        throw new HttpError(400, `النموذج ${m.displayName} لا يستطيع قراءة الصور. اختر نموذجًا يدعم الرؤية.`, "vision_unsupported");
      }
    }
  } else {
    const role = opts.needsVision && opts.role === "text" ? "vision" : opts.role;
    const m = await loadModel(catalog.defaults[role] ?? catalog.defaults.text);
    if (m && isUsable(m) && (await opts.allowsModel(m))) primary = m;
    else if (m && !(await opts.allowsModel(m))) {
      const alt = catalog.models.find((x) => x.plans.includes(opts.plan.key) && (role === "image" ? x.capabilities.imageGeneration : true) && (opts.needsVision ? x.capabilities.vision : true));
      primary = alt ? await loadModel(alt.id) : null;
    }
  }

  const targets: RouteTarget[] = [];
  if (primary) targets.push({ model: primary, isFallback: false, reason });

  if (routing.fallbackEnabled) {
    const fb = await loadModel(routing.fallbackModelId);
    const candidates: (AiModel & { provider: Provider })[] = [];
    if (fb && isUsable(fb)) candidates.push(fb);
    if (routing.fallbackProviderId && primary) {
      const same = await prisma.aiModel.findFirst({
        where: { providerId: routing.fallbackProviderId, modelId: primary.modelId, enabled: true },
        include: { provider: true },
      });
      if (same && isUsable(same)) candidates.unshift(same);
    }
    if (routing.fallbackProviderId && !candidates.length) {
      const any = await prisma.aiModel.findFirst({
        where: { providerId: routing.fallbackProviderId, enabled: true, ...(opts.role === "image" ? { supportsImageGeneration: true } : { supportsText: true }) },
        include: { provider: true },
        orderBy: { sortOrder: "asc" },
      });
      if (any && isUsable(any)) candidates.push(any);
    }
    for (const c of candidates) {
      if (targets.some((t) => t.model.id === c.id)) continue;
      if (opts.role === "image" ? !c.supportsImageGeneration : !c.supportsText) continue;
      if (opts.needsVision && !c.supportsVision) continue;
      targets.push({ model: c, isFallback: true, reason: primary ? undefined : reason ?? "المسار الأساسي غير متاح" });
    }
  }

  if (!targets.length) {
    throw new HttpError(503, reason ? `${reason} ولا يوجد نموذج احتياطي مُعدّ.` : "لا يوجد نموذج ذكاء اصطناعي متاح حاليًا. يرجى المحاولة لاحقًا.", "no_route");
  }
  return targets;
}
