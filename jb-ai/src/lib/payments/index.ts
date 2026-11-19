import "server-only";
import Stripe from "stripe";
import type { BillingInterval, Plan, SubscriptionStatus } from "@prisma/client";
import { bumpConfigVersion } from "../config-bus";
import { decryptSecret, encryptSecret, last4 } from "../crypto";
import { prisma } from "../db";
import { HttpError } from "../http";
import { appUrl } from "../mailer";

/**
 * Payment provider adapter. Stripe is the implemented provider (hosted Checkout + Billing Portal + signed webhooks).
 * Secrets come from the admin dashboard (encrypted at rest) or, if not set there, from env vars.
 * Subscriptions are ONLY activated from verified webhook events, never from browser redirects.
 */

interface StoredPaymentSettings {
  provider: "stripe";
  secretKeyEnc?: string;
  secretKeyLast4?: string;
  webhookSecretEnc?: string;
  webhookSecretLast4?: string;
}

export async function getPaymentSettings(): Promise<StoredPaymentSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "payments" } });
  return { provider: "stripe", ...((row?.value as Partial<StoredPaymentSettings>) ?? {}) };
}

export async function savePaymentSecrets(input: { secretKey?: string; webhookSecret?: string }) {
  const cur = await getPaymentSettings();
  const next: StoredPaymentSettings = { ...cur };
  if (input.secretKey) {
    if (!/^(sk|rk)_(test|live)_/.test(input.secretKey)) throw new HttpError(400, "يجب أن يبدأ مفتاح Stripe السري بـ sk_test_ أو sk_live_ أو rk_test_ أو rk_live_");
    next.secretKeyEnc = encryptSecret(input.secretKey);
    next.secretKeyLast4 = last4(input.secretKey);
  }
  if (input.webhookSecret) {
    if (!input.webhookSecret.startsWith("whsec_")) throw new HttpError(400, "يجب أن يبدأ سر إشعارات Stripe بـ whsec_");
    next.webhookSecretEnc = encryptSecret(input.webhookSecret);
    next.webhookSecretLast4 = last4(input.webhookSecret);
  }
  await prisma.setting.upsert({ where: { key: "payments" }, create: { key: "payments", value: next as object, secret: true }, update: { value: next as object } });
}

async function secrets() {
  const s = await getPaymentSettings();
  const secretKey = s.secretKeyEnc ? decryptSecret(s.secretKeyEnc) : process.env.STRIPE_SECRET_KEY || null;
  const webhookSecret = s.webhookSecretEnc ? decryptSecret(s.webhookSecretEnc) : process.env.STRIPE_WEBHOOK_SECRET || null;
  return { secretKey, webhookSecret };
}

export async function paymentStatus() {
  const s = await getPaymentSettings();
  const { secretKey, webhookSecret } = await secrets();
  return {
    provider: "stripe",
    secretKeyConfigured: Boolean(secretKey),
    secretKeySource: s.secretKeyEnc ? "dashboard" : secretKey ? "env" : null,
    secretKeyLast4: s.secretKeyLast4 ?? (secretKey ? last4(secretKey) : null),
    mode: secretKey ? (secretKey.includes("_test_") ? "test" : "live") : null,
    webhookSecretConfigured: Boolean(webhookSecret),
    webhookSecretLast4: s.webhookSecretLast4 ?? (webhookSecret ? last4(webhookSecret) : null),
    webhookUrl: appUrl("/api/webhooks/stripe"),
  };
}

async function stripe(): Promise<Stripe> {
  const { secretKey } = await secrets();
  if (!secretKey) throw new HttpError(503, "الدفع غير مُفعّل بعد. يرجى التواصل مع الدعم.", "payments_unconfigured");
  return new Stripe(secretKey, { appInfo: { name: "Mohammed Tech" } });
}

export async function testStripe() {
  const s = await stripe();
  const acct = await s.balance.retrieve();
  return { ok: true, livemode: acct.livemode, available: acct.available.map((b) => `${b.amount / 100} ${b.currency.toUpperCase()}`) };
}

export async function createCheckout(user: { id: string; email: string }, plan: Plan, interval: BillingInterval) {
  const amount = interval === "YEAR" ? plan.priceYearlyCents : plan.priceMonthlyCents;
  if (!plan.active || amount <= 0) throw new HttpError(400, "لا يمكن شراء هذه الباقة");
  const s = await stripe();
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const meta = { userId: user.id, planId: plan.id, planKey: plan.key, interval };
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: user.id,
    ...(dbUser.billingCustomerId ? { customer: dbUser.billingCustomerId } : { customer_email: user.email }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: plan.currency,
          unit_amount: amount,
          recurring: { interval: interval === "YEAR" ? "year" : "month" },
          product_data: { name: `محمد | التقني — ${plan.name} (${interval === "YEAR" ? "yearly" : "monthly"})`, metadata: { planKey: plan.key } },
        },
      },
    ],
    metadata: meta,
    subscription_data: { metadata: meta },
    allow_promotion_codes: true,
    success_url: appUrl("/settings?tab=billing&checkout=success"),
    cancel_url: appUrl("/plans?checkout=canceled"),
  });
  if (!session.url) throw new HttpError(502, "لم يُرجع مزوّد الدفع رابط صفحة الدفع");
  return session.url;
}

export async function createPortal(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!u.billingCustomerId) throw new HttpError(400, "لا يوجد حساب فوترة بعد");
  const s = await stripe();
  const portal = await s.billingPortal.sessions.create({ customer: u.billingCustomerId, return_url: appUrl("/settings?tab=billing") });
  return portal.url;
}

export async function setCancelAtPeriodEnd(userId: string, cancel: boolean) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub?.providerSubscriptionId) throw new HttpError(400, "لا يوجد اشتراك مدفوع نشط");
  const s = await stripe();
  const updated = await s.subscriptions.update(sub.providerSubscriptionId, { cancel_at_period_end: cancel });
  await applyStripeSubscription(updated);
}

export async function cancelImmediately(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub?.providerSubscriptionId) return;
  const s = await stripe();
  const canceled = await s.subscriptions.cancel(sub.providerSubscriptionId);
  await applyStripeSubscription(canceled);
}

/* ------------------------------------------------------------------ webhooks */

function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete":
      return "INCOMPLETE";
    default:
      return "EXPIRED";
  }
}

function periodOf(sub: Stripe.Subscription) {
  const anySub = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const item = sub.items?.data?.[0] as unknown as { current_period_start?: number; current_period_end?: number } | undefined;
  const start = anySub.current_period_start ?? item?.current_period_start;
  const end = anySub.current_period_end ?? item?.current_period_end;
  return { start: start ? new Date(start * 1000) : null, end: end ? new Date(end * 1000) : null };
}

export async function applyStripeSubscription(sub: Stripe.Subscription) {
  const userId = sub.metadata?.userId;
  const planId = sub.metadata?.planId;
  if (!userId || !planId) return "ignored: subscription without JB AI metadata";
  const [user, plan] = await Promise.all([prisma.user.findUnique({ where: { id: userId } }), prisma.plan.findUnique({ where: { id: planId } })]);
  if (!user || !plan) return "ignored: unknown user or plan";
  const { start, end } = periodOf(sub);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const status = mapStatus(sub.status);
  const interval: BillingInterval = sub.metadata?.interval === "YEAR" ? "YEAR" : "MONTH";
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId, status, interval, currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: sub.cancel_at_period_end, provider: "stripe", providerSubscriptionId: sub.id, providerCustomerId: customerId },
    update: { planId, status, interval, currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: sub.cancel_at_period_end, provider: "stripe", providerSubscriptionId: sub.id, providerCustomerId: customerId },
  });
  if (!user.billingCustomerId) await prisma.user.update({ where: { id: userId }, data: { billingCustomerId: customerId } }).catch(() => {});
  return `subscription ${sub.id} → ${status} (${plan.key})`;
}

async function recordInvoice(inv: Stripe.Invoice, status: string) {
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
  const anyInv = inv as unknown as { subscription_details?: { metadata?: Record<string, string> }; parent?: { subscription_details?: { metadata?: Record<string, string> } } };
  const meta = anyInv.subscription_details?.metadata ?? anyInv.parent?.subscription_details?.metadata ?? {};
  let userId: string | undefined = meta.userId;
  if (!userId && customerId) userId = (await prisma.user.findUnique({ where: { billingCustomerId: customerId } }))?.id;
  if (!userId || !inv.id) return "ignored: invoice without known user";
  await prisma.payment.upsert({
    where: { providerPaymentId: inv.id },
    create: { userId, provider: "stripe", providerPaymentId: inv.id, amountCents: status === "paid" ? inv.amount_paid : inv.amount_due, currency: inv.currency, status, description: inv.lines?.data?.[0]?.description ?? "Subscription", planKey: meta.planKey },
    update: { status, amountCents: status === "paid" ? inv.amount_paid : inv.amount_due },
  });
  return `invoice ${inv.id} ${status}`;
}

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const { secretKey, webhookSecret } = await secrets();
  if (!webhookSecret) throw new HttpError(503, "سر إشعارات الدفع غير مُعدّ");
  if (!signature) throw new HttpError(400, "ترويسة Stripe-Signature مفقودة");
  const s = new Stripe(secretKey || "sk_test_unused");
  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (e) {
    throw new HttpError(400, `فشل التحقق من توقيع الإشعار: ${(e as Error).message}`);
  }
  const seen = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
  if (seen) return { duplicate: true, outcome: seen.outcome };

  let outcome = "ignored";
  switch (event.type) {
    case "checkout.session.completed": {
      const cs = event.data.object as Stripe.Checkout.Session;
      const userId = cs.metadata?.userId ?? cs.client_reference_id;
      const customerId = typeof cs.customer === "string" ? cs.customer : cs.customer?.id;
      if (userId && customerId) await prisma.user.update({ where: { id: userId }, data: { billingCustomerId: customerId } }).catch(() => {});
      // Activation happens from the subscription object itself (authoritative status/period).
      if (cs.subscription && secretKey) {
        const sub = await s.subscriptions.retrieve(typeof cs.subscription === "string" ? cs.subscription : cs.subscription.id);
        outcome = await applyStripeSubscription(sub);
      } else outcome = "checkout recorded";
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      outcome = await applyStripeSubscription(event.data.object as Stripe.Subscription);
      break;
    case "invoice.paid":
    case "invoice.payment_succeeded":
      outcome = await recordInvoice(event.data.object as Stripe.Invoice, "paid");
      break;
    case "invoice.payment_failed":
      outcome = await recordInvoice(event.data.object as Stripe.Invoice, "failed");
      break;
  }
  await prisma.webhookEvent.create({ data: { id: event.id, provider: "stripe", type: event.type, outcome: outcome.slice(0, 300) } });
  if (event.type.startsWith("customer.subscription")) await bumpConfigVersion();
  return { duplicate: false, outcome };
}
