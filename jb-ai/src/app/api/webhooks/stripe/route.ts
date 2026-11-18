import { audit } from "@/lib/audit";
import { handler, json } from "@/lib/http";
import { handleStripeWebhook } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Stripe webhook endpoint. The raw body is verified against the Stripe-Signature header before anything is applied. */
export const POST = handler(async (req: Request) => {
  const raw = await req.text();
  const result = await handleStripeWebhook(raw, req.headers.get("stripe-signature"));
  if (!result.duplicate) await audit(null, "billing.webhook", { details: { outcome: result.outcome } });
  return json({ received: true, ...result });
});
