import { requireAdmin } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { getSpend } from "@/lib/spend";

export const dynamic = "force-dynamic";

/** Owner-only spending meter: Venice balance, spent today / 7d / 30d, average cost per message, messages left. */
export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  return json(await getSpend(force));
});
