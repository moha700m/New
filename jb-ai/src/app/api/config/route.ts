import { isPrivateMode, ownerSignupOpen } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { SERVERLESS } from "@/lib/config-bus";
import { getPublicCatalog } from "@/lib/engine";
import { handler, json } from "@/lib/http";
import { getUserPlan } from "@/lib/plans";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Customer-facing live configuration: active model catalog + defaults, filtered to what the viewer's plan allows. No secrets. */
export const GET = handler(async () => {
  const [catalog, settings, user] = await Promise.all([getPublicCatalog(), getSettings(), getCurrentUser()]);
  const planKey = user ? (await getUserPlan(user.id)).plan.key : null;
  return json(
    {
      version: catalog.version,
      site: { name: settings.siteName, tagline: settings.tagline, maintenanceMode: settings.maintenanceMode, registrationOpen: settings.registrationOpen },
      planKey,
      live: SERVERLESS ? { mode: "poll", intervalMs: 5000 } : { mode: "sse", intervalMs: 30000 },
      private: isPrivateMode(),
      ownerSignupOpen: isPrivateMode() && !user ? await ownerSignupOpen((emails) => prisma.user.count({ where: { email: { in: emails } } })) : false,
      defaults: isPrivateMode() && !user ? { text: null, reasoning: null, code: null, vision: null, image: null } : catalog.defaults,
      models: (isPrivateMode() && !user ? [] : catalog.models).map((m) => ({ ...m, allowed: planKey ? m.plans.includes(planKey) : false })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
