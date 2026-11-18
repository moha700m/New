import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { mailerConfigured } from "@/lib/mailer";
import { json, parseBody } from "@/lib/http";
import { getSettings, saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const schema = z.object({
  siteName: z.string().trim().min(1).max(60).optional(),
  tagline: z.string().trim().max(200).optional(),
  registrationOpen: z.boolean().optional(),
  requireEmailVerification: z.boolean().optional(),
  systemPrompt: z.string().max(8000).optional(),
  maxHistoryMessages: z.number().int().min(2).max(200).optional(),
  chatRateLimitPerMinute: z.number().int().min(1).max(600).optional(),
  maintenanceMode: z.boolean().optional(),
  supportEmail: z.string().trim().max(200).optional(),
});

export const GET = adminRoute(async () =>
  json({
    settings: await getSettings(),
    environment: {
      mailerConfigured: mailerConfigured(),
      appUrl: process.env.APP_URL ?? null,
      ownerEmailConfigured: Boolean(process.env.OWNER_EMAIL),
      encryptionKeyConfigured: Boolean(process.env.MASTER_ENCRYPTION_KEY),
      nodeEnv: process.env.NODE_ENV,
    },
  }),
);

export const PUT = adminRoute(async ({ req, log, publish }) => {
  const body = await parseBody(req, schema);
  const settings = await saveSettings(body);
  await log("settings.update", { entityType: "settings", details: { changed: Object.keys(body) } });
  await publish();
  return json({ settings });
});
