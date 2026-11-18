import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler, json, parseBody } from "@/lib/http";
import { setCancelAtPeriodEnd } from "@/lib/payments";

/** Cancel (at period end) or resume a subscription. The provider's response is applied server-side. */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const { cancel } = await parseBody(req, z.object({ cancel: z.boolean() }));
  await setCancelAtPeriodEnd(user.id, cancel);
  return json({ ok: true });
});
