import { adminRoute } from "@/lib/admin";
import { applySuggestedDefaults } from "@/lib/engine";
import { json } from "@/lib/http";

export const POST = adminRoute<{ id: string }>(async ({ params, log }) => {
  const result = await applySuggestedDefaults(params.id);
  await log("routing.apply_provider_suggestions", { entityType: "provider", entityId: params.id, details: result.applied });
  return json({ result });
});
