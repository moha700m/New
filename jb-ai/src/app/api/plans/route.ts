import { prisma } from "@/lib/db";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return json({
    plans: plans.map((p) => ({
      id: p.id, key: p.key, name: p.name, description: p.description, features: p.features, currency: p.currency,
      priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents, isDefault: p.isDefault,
      dailyMessageLimit: p.dailyMessageLimit, monthlyMessageLimit: p.monthlyMessageLimit, allowWebSearch: p.allowWebSearch, allowImageGeneration: p.allowImageGeneration, allowAllModels: p.allowAllModels,
    })),
  });
});
