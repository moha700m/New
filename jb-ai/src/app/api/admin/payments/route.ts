import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { paymentStatus, savePaymentSecrets, testStripe } from "@/lib/payments";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => {
  const [status, payments, subscriptions, events] = await Promise.all([
    paymentStatus(),
    prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { email: true } } } }),
    prisma.subscription.findMany({ orderBy: { updatedAt: "desc" }, take: 100, include: { user: { select: { email: true } }, plan: { select: { key: true, name: true } } } }),
    prisma.webhookEvent.findMany({ orderBy: { processedAt: "desc" }, take: 30 }),
  ]);
  return json({ status, payments, subscriptions, events });
});

export const PUT = adminRoute(async ({ req, user, log }) => {
  if (user.role !== "OWNER") throw new HttpError(403, "Only the owner can change payment credentials");
  const body = await parseBody(req, z.object({ secretKey: z.string().trim().max(300).optional(), webhookSecret: z.string().trim().max(300).optional() }));
  await savePaymentSecrets(body);
  await log("payments.credentials_updated", { details: { secretKey: Boolean(body.secretKey), webhookSecret: Boolean(body.webhookSecret) } });
  return json({ status: await paymentStatus() });
});

export const POST = adminRoute(async ({ log }) => {
  try {
    const r = await testStripe();
    await log("payments.test", { details: { ok: true } });
    return json({ result: r });
  } catch (e) {
    return json({ result: { ok: false, error: (e as Error).message } });
  }
});
