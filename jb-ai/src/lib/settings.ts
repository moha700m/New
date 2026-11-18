import "server-only";
import { isPrivateMode } from "./access";
import { prisma } from "./db";

export interface SystemSettings {
  siteName: string;
  tagline: string;
  registrationOpen: boolean;
  requireEmailVerification: boolean;
  systemPrompt: string;
  maxHistoryMessages: number;
  chatRateLimitPerMinute: number;
  maintenanceMode: boolean;
  supportEmail: string;
}

export const DEFAULT_SETTINGS: SystemSettings = {
  siteName: "JB AI",
  tagline: "مساعدة في البرمجة، وأسئلة تقنية، وأكثر.",
  registrationOpen: true,
  requireEmailVerification: true,
  systemPrompt: "أنت JB AI، مساعد ذكي ودقيق ومفيد. أجب بلغة المستخدم (بالعربية افتراضيًا إذا كتب بالعربية)، ونسّق إجاباتك بـ Markdown عند الحاجة.",
  maxHistoryMessages: 40,
  chatRateLimitPerMinute: 20,
  maintenanceMode: false,
  supportEmail: "",
};

export async function getSettings(): Promise<SystemSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "system" } });
  const s = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<SystemSettings>) ?? {}) };
  // Private mode keeps registration closed regardless of the admin toggle.
  return isPrivateMode() ? { ...s, registrationOpen: false } : s;
}

export async function saveSettings(patch: Partial<SystemSettings>): Promise<SystemSettings> {
  const next = { ...(await getSettings()), ...patch };
  await prisma.setting.upsert({ where: { key: "system" }, create: { key: "system", value: next as object }, update: { value: next as object } });
  return next;
}
