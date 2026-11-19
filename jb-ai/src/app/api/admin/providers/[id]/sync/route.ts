import { adminRoute } from "@/lib/admin";
import { syncProviderModels } from "@/lib/engine";
import { json } from "@/lib/http";

export const maxDuration = 120;

export const POST = adminRoute<{ id: string }>(async ({ params, log }) => {
  const result = await syncProviderModels(params.id);
  await log("provider.sync_models", { entityType: "provider", entityId: params.id, details: result });
  return json({ result });
});
