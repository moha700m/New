import { getCurrentUser } from "@/lib/auth";
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
      defaults: catalog.defaults,
      models: catalog.models.map((m) => ({ ...m, allowed: planKey ? m.plans.includes(planKey) : false })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
