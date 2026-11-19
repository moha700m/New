import "server-only";
import type { Plan } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { mailerConfigured } from "./mailer";

/**
 * Public free trial (site stays private for everyone else):
 * - sign-up with a verified email, one account per person (normalized email, disposable domains blocked, 2 sign-ups / IP / day)
 * - only a few cheap uncensored Venice text models, N messages per account, capped output/context
 * - a global daily spend cap (Riyadh day) for all trial usage together; the owner is never limited
 * - no agent, connectors, publishing, uploads, web search or images
 */
export interface TrialSettings {
  enabled: boolean;
  requireVerification: boolean;
  messages: number;
  dailyCapUsd: number;
  maxOutputTokens: number;
  historyMessages: number;
  maxInputChars: number;
  models: string[]; // provider modelIds (Venice)
  /** free uncensored image generations per account (separate from the text messages) */
  images: number;
  imageModels: string[]; // provider modelIds (Venice image models, cheapest)
  /** friendly Saudi names shown to trial users instead of the real model names */
  labels: Record<string, { name: string; desc: string }>;
  listTitle: string;
  priceUsd: number;
  creditLabel: string;
  telegramUrl: string;
}

export const DEFAULT_TRIAL: TrialSettings = {
  enabled: false,
  requireVerification: true,
  messages: 5,
  dailyCapUsd: 1,
  maxOutputTokens: 3500,
  historyMessages: 6,
  maxInputChars: 6000,
  // ONE trial text model: Venice's own app default — DeepSeek V4.1 Flash Uncensored, code-optimised ($0.33 in / $1.32 out per 1M)
  models: ["deepseek-v4-1-flash-1017-uncensored"],
  images: 2,
  // cheapest Venice image models ($0.01 / image), generated with safe_mode:false
  imageModels: ["lustify-v8", "z-image-turbo"],
  labels: {
    "deepseek-v4-1-flash-1017-uncensored": { name: "الجريء", desc: "بدون قيود +١٨، يكتب لك أكواد ويجاوبك على كل شي" },
    "olafangensan-glm-4.7-flash-heretic": { name: "السريع", desc: "يرد عليك بسرعة البرق وبدون لف ودوران" },
    "gemma-4-uncensored": { name: "الجريء القديم", desc: "يقول اللي في خاطره بدون قيود ولا مجاملة" },
    "glm-5-3-flash-uncensored": { name: "الذكي", desc: "يفكّر زين ويفهمك من نص كلمة" },
    "venice-uncensored-1-2": { name: "الفلّة", desc: "يسولف معك على راحتك وما عنده خطوط حمرا" },
    "lustify-v8": { name: "الرسّام الجريء", desc: "يرسم لك اللي في بالك بدون قيود +١٨" },
    "z-image-turbo": { name: "الرسّام السريع", desc: "صورة بثواني، أي فكرة تخطر لك" },
  },
  listTitle: "نماذج بدون قيود +١٨",
  priceUsd: 20,
  creditLabel: "رصيد شهري",
  telegramUrl: "https://t.me/Justoio",
};

export async function getTrialSettings(): Promise<TrialSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "trial" } });
  const v = (row?.value as Partial<TrialSettings>) ?? {};
  return { ...DEFAULT_TRIAL, ...v, labels: { ...DEFAULT_TRIAL.labels, ...(v.labels ?? {}) }, imageModels: v.imageModels ?? DEFAULT_TRIAL.imageModels, images: v.images ?? DEFAULT_TRIAL.images };
}

export const trialLabel = (t: TrialSettings, modelId: string, fallback: string) => t.labels[modelId]?.name || fallback;

export async function saveTrialSettings(patch: Partial<TrialSettings>) {
  const next = { ...(await getTrialSettings()), ...patch };
  await prisma.setting.upsert({ where: { key: "trial" }, create: { key: "trial", value: next as object }, update: { value: next as object } });
  return next;
}

export const isTrialUser = (u: { access?: string | null }) => u.access === "trial";
export const isFullUser = (u: { access?: string | null }) => u.access === "full";

/** Start of the current day in Asia/Riyadh (UTC+3, no DST). */
export function riyadhDayStart(d = new Date()) {
  const shifted = new Date(d.getTime() + 3 * 3600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 3 * 3600_000);
}

export async function trialSpendToday() {
  const r = await prisma.usageRecord.aggregate({ where: { createdAt: { gte: riyadhDayStart() }, user: { access: "trial" } }, _sum: { costUsd: true }, _count: true });
  return { usd: r._sum.costUsd ?? 0, requests: r._count };
}

/** In-memory plan for trial accounts (no DB row: limits are enforced by the trial counters below). */
export function trialPlan(): Plan {
  const now = new Date(0);
  return {
    id: "trial",
    key: "trial",
    name: "التجربة المجانية",
    description: null,
    features: null,
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    currency: "usd",
    dailyMessageLimit: null,
    monthlyMessageLimit: null,
    monthlyTokenLimit: null,
    maxUploadMb: 0,
    allowUploads: false,
    allowWebSearch: false,
    allowImageGeneration: true, // only the trial image models (planAllowsModel), counted separately
    allowAllModels: false,
    isDefault: false,
    active: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Trial model rows the admin allowed (enabled Venice text models only). */
export async function trialModelRows(s?: TrialSettings) {
  const t = s ?? (await getTrialSettings());
  const rows = await prisma.aiModel.findMany({
    where: { modelId: { in: t.models }, enabled: true, supportsImageGeneration: false, provider: { enabled: true } },
    select: { id: true, modelId: true, displayName: true, inputPricePerM: true, outputPricePerM: true },
  });
  return t.models.map((id) => rows.find((r) => r.modelId === id)).filter(Boolean) as typeof rows;
}

/** Trial image model rows (enabled image models the admin allowed; empty when the image quota is 0). */
export async function trialImageRows(s?: TrialSettings) {
  const t = s ?? (await getTrialSettings());
  if (t.images <= 0 || !t.imageModels.length) return [];
  const rows = await prisma.aiModel.findMany({
    where: { modelId: { in: t.imageModels }, enabled: true, supportsImageGeneration: true, provider: { enabled: true } },
    select: { id: true, modelId: true, displayName: true },
  });
  return t.imageModels.map((id) => rows.find((r) => r.modelId === id)).filter(Boolean) as typeof rows;
}

export function trialRegistrationOpen(t: TrialSettings) {
  return t.enabled && (!t.requireVerification || mailerConfigured());
}

/** Atomically takes one trial message (race-proof); throws a coded 429 when none are left or the daily cap is reached. */
export async function takeTrialMessage(userId: string, t: TrialSettings) {
  if (!t.enabled) throw new HttpError(403, "التجربة المجانية واقفة الحين، جرّب بعدين.", "trial_off");
  const spend = await trialSpendToday();
  if (spend.usd >= t.dailyCapUsd) throw new HttpError(429, "التجربة المجانية وصلت حدّها اليوم، ترجع بكرة إن شاء الله.", "trial_daily_cap");
  const r = await prisma.user.updateMany({ where: { id: userId, trialUsed: { lt: t.messages } }, data: { trialUsed: { increment: 1 } } });
  if (r.count === 0) throw new HttpError(429, "خلصت رسايلك المجانية.", "trial_exhausted");
}

/** Same as takeTrialMessage, for the separate free image quota. */
export async function takeTrialImage(userId: string, t: TrialSettings) {
  if (!t.enabled) throw new HttpError(403, "التجربة المجانية واقفة الحين، جرّب بعدين.", "trial_off");
  const spend = await trialSpendToday();
  if (spend.usd >= t.dailyCapUsd) throw new HttpError(429, "التجربة المجانية وصلت حدّها اليوم، ترجع بكرة إن شاء الله.", "trial_daily_cap");
  const r = await prisma.user.updateMany({ where: { id: userId, trialImagesUsed: { lt: t.images } }, data: { trialImagesUsed: { increment: 1 } } });
  if (r.count === 0) throw new HttpError(429, "خلصت صورك المجانية.", "trial_images_exhausted");
}

export async function refundTrialImage(userId: string) {
  await prisma.user.updateMany({ where: { id: userId, trialImagesUsed: { gt: 0 } }, data: { trialImagesUsed: { decrement: 1 } } }).catch(() => {});
}

export async function refundTrialMessage(userId: string) {
  await prisma.user.updateMany({ where: { id: userId, trialUsed: { gt: 0 } }, data: { trialUsed: { decrement: 1 } } }).catch(() => {});
}

export async function trialStatus(userId: string) {
  const [t, u, spend] = await Promise.all([getTrialSettings(), prisma.user.findUnique({ where: { id: userId }, select: { trialUsed: true, trialImagesUsed: true } }), trialSpendToday()]);
  const used = u?.trialUsed ?? 0;
  return {
    used,
    limit: t.messages,
    remaining: Math.max(0, t.messages - used),
    imagesUsed: u?.trialImagesUsed ?? 0,
    imagesLimit: t.images,
    imagesRemaining: Math.max(0, t.images - (u?.trialImagesUsed ?? 0)),
    capReached: spend.usd >= t.dailyCapUsd,
    enabled: t.enabled,
    priceUsd: t.priceUsd,
    creditLabel: t.creditLabel,
    telegramUrl: t.telegramUrl,
    listTitle: t.listTitle,
  };
}

// ---------- one account per person
const DISPOSABLE = new Set(
  "10minutemail.com 10minutemail.net 20minutemail.com 33mail.com anonaddy.com burnermail.io dispostable.com dropmail.me emailondeck.com fakeinbox.com fakemail.net getairmail.com getnada.com guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamailblock.com sharklasers.com grr.la pokemail.net spam4.me harakirimail.com inboxkitten.com jetable.org mailcatch.com maildrop.cc mailinator.com mailinator.net mailinator2.com mailnesia.com mailnull.com mailsac.com mailtemp.net mintemail.com moakt.com mohmal.com mytemp.email mytrashmail.com nada.email no-spam.ws nowmymail.com onetimemail.com spambox.us spamgourmet.com tempail.com tempinbox.com tempmail.com tempmail.net tempmail.dev temp-mail.org temp-mail.io tempmailo.com tempr.email throwawaymail.com trashmail.com trashmail.de trashmail.net trbvm.com yopmail.com yopmail.fr yopmail.net cool.fr.nf jetable.fr.nf courriel.fr.nf moncourrier.fr.nf monemail.fr.nf monmail.fr.nf mailpoof.com emailfake.com fakemailgenerator.com tmail.ws tmpmail.org tmpmail.net tmpeml.com 1secmail.com 1secmail.net 1secmail.org esiix.com wwjmp.com xojxe.com yoggm.com kzccv.com qiott.com vjuum.com laafd.com txcct.com dpptd.com rteet.com dcctb.com emltmp.com tmpbox.net tempmailaddress.com burnermailbox.com luxusmail.org minuteinbox.com discard.email discardmail.com spamdecoy.net mail-temp.com mailtothis.com emailtemporanea.net correotemporal.org crazymailing.com instaddr.ch mvrht.net etranquil.com tempmail.plus inboxbear.com fexpost.com fexbox.org mailbox.in.ua byom.de linshiyouxiang.net 027168.com chacuo.net bccto.me snapmail.cc gufum.com mailforspam.com spamex.com example.com example.org test.com"
    .split(/\s+/),
);

export function isDisposableEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return true;
  if (DISPOSABLE.has(domain)) return true;
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) if (DISPOSABLE.has(parts.slice(i).join("."))) return true;
  return /(^|\.)(temp|trash|throwaway|disposable|fake|spam|burner)[-a-z0-9]*mail/i.test(domain);
}

/** gmail/googlemail: dots and +tags ignored; other providers: +tags ignored. */
export function canonicalEmail(email: string) {
  const [localRaw, domainRaw] = email.trim().toLowerCase().split("@");
  let local = localRaw ?? "";
  let domain = domainRaw ?? "";
  if (domain === "googlemail.com") domain = "gmail.com";
  local = local.split("+")[0]!;
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}
