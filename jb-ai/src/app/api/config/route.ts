import { isPrivateMode, ownerSignupOpen } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { SERVERLESS } from "@/lib/config-bus";
import { getPublicCatalog } from "@/lib/engine";
import { handler, json } from "@/lib/http";
import { getUserPlan } from "@/lib/plans";
import { getSettings } from "@/lib/settings";
import { getTrialSettings, trialModelRows, trialRegistrationOpen } from "@/lib/trial";

export const dynamic = "force-dynamic";

/** Customer-facing live configuration: active model catalog + defaults, filtered to what the viewer's plan allows. No secrets. */
export const GET = handler(async () => {
  const [catalog, settings, user] = await Promise.all([getPublicCatalog(), getSettings(), getCurrentUser()]);
  const planKey = user ? (await getUserPlan(user.id)).plan.key : null;
  const t = await getTrialSettings();
  let models = isPrivateMode() && !user ? [] : catalog.models;
  let defaults: typeof catalog.defaults = isPrivateMode() && !user ? { text: null, reasoning: null, code: null, vision: null, image: null } : catalog.defaults;
  if (planKey === "trial") {
    // trial accounts only ever see their few allowed models
    const rows = await trialModelRows(t);
    const ids = rows.map((r) => r.id);
    const byId = new Map(rows.map((r) => [r.id, r.modelId]));
    models = catalog.models
      .filter((m) => ids.includes(m.id))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      // friendly Saudi names only — the real model ids stay server-side
      .map((m) => {
        const l = t.labels[byId.get(m.id) ?? ""];
        return { ...m, name: l?.name ?? m.name, description: l?.desc ?? m.description, capabilities: { ...m.capabilities, uncensored: true, reasoning: false, imageGeneration: false } };
      });
    defaults = { text: ids[0] ?? null, reasoning: null, code: null, vision: null, image: null };
  }
  return json(
    {
      version: catalog.version,
      site: { name: settings.siteName, tagline: settings.tagline, maintenanceMode: settings.maintenanceMode, registrationOpen: settings.registrationOpen },
      planKey,
      live: SERVERLESS ? { mode: "poll", intervalMs: 5000 } : { mode: "sse", intervalMs: 30000 },
      private: isPrivateMode(),
      ownerSignupOpen: isPrivateMode() && !user ? await ownerSignupOpen((emails) => prisma.user.count({ where: { email: { in: emails } } })) : false,
      trialSignupOpen: isPrivateMode() && !user ? trialRegistrationOpen(t) : false,
      trialEnabled: t.enabled,
      trialListTitle: planKey === "trial" ? t.listTitle : null,
      defaults,
      models: models.map((m) => ({ ...m, allowed: planKey === "trial" || planKey === "full" ? true : planKey ? m.plans.includes(planKey) : false })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
