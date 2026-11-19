import { getCurrentUser, isAdminRole, needsVerification } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { effectiveUploadMb, getUserPlan, usageSummary } from "@/lib/plans";
import { trialStatus } from "@/lib/trial";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const user = await getCurrentUser();
  if (!user) return json({ user: null });
  const [{ plan, subscription }, usage, verify] = await Promise.all([getUserPlan(user.id), usageSummary(user.id), needsVerification(user)]);
  return json({
    user: { ...user, isAdmin: isAdminRole(user.role), mustVerify: verify },
    plan: {
      key: plan.key,
      name: plan.name,
      dailyMessageLimit: plan.dailyMessageLimit,
      monthlyMessageLimit: plan.monthlyMessageLimit,
      monthlyTokenLimit: plan.monthlyTokenLimit,
      allowUploads: plan.allowUploads,
      maxUploadMb: effectiveUploadMb(plan),
      allowWebSearch: plan.allowWebSearch,
      allowImageGeneration: plan.allowImageGeneration,
    },
    subscription: subscription
      ? { status: subscription.status, interval: subscription.interval, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, planId: subscription.planId }
      : null,
    usage,
    trial: user.access === "trial" ? await trialStatus(user.id) : null,
  });
});
