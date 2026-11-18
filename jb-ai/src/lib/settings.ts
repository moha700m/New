import "server-only";
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
  tagline: "Coding help, technical questions and more.",
  registrationOpen: true,
  requireEmailVerification: true,
  systemPrompt: "You are JB AI, a helpful, precise assistant. Format answers with Markdown when useful.",
  maxHistoryMessages: 40,
  chatRateLimitPerMinute: 20,
  maintenanceMode: false,
  supportEmail: "",
};

export async function getSettings(): Promise<SystemSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "system" } });
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<SystemSettings>) ?? {}) };
}

export async function saveSettings(patch: Partial<SystemSettings>): Promise<SystemSettings> {
  const next = { ...(await getSettings()), ...patch };
  await prisma.setting.upsert({ where: { key: "system" }, create: { key: "system", value: next as object }, update: { value: next as object } });
  return next;
}
