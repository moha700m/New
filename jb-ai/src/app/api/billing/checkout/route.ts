import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, HttpError, json, parseBody } from "@/lib/http";
import { createCheckout } from "@/lib/payments";
import { rateLimit } from "@/lib/rate-limit";

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  rateLimit(`checkout:${user.id}`, 10, 600_000);
  const { planKey, interval } = await parseBody(req, z.object({ planKey: z.string().max(40), interval: z.enum(["MONTH", "YEAR"]) }));
  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan || !plan.active) throw new HttpError(404, "Plan not found");
  const url = await createCheckout(user, plan, interval);
  return json({ url });
});
