import { z } from "zod";
import { needsVerification, requireUser } from "@/lib/auth";
import { executeChat, prepareChat } from "@/lib/gateway";
import { errorResponse, HttpError, parseBody } from "@/lib/http";
import { isOwnerAccount } from "@/lib/access";
import { getUserPlan } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  conversationId: z.string().max(40).nullish(),
  content: z.string().max(100_000).default(""),
  attachmentIds: z.array(z.string().max(40)).max(8).default([]),
  modelId: z.string().max(40).nullish(),
  think: z.boolean().default(false),
  webSearch: z.boolean().default(false),
  regenerate: z.boolean().default(false),
  editMessageId: z.string().max(40).nullish(),
  agent: z.boolean().optional(),
});

/**
 * AI gateway entry point. Pipeline: auth → validation → rate limit → plan/quota → server-side routing
 * (admin config) → provider adapter → streamed NDJSON events → persistence + usage accounting.
 */
export async function POST(req: Request) {
  let prep: Awaited<ReturnType<typeof prepareChat>>;
  let userId: string;
  let input: z.infer<typeof schema>;
  try {
    const user = await requireUser();
    userId = user.id;
    const settings = await getSettings();
    if (settings.maintenanceMode) throw new HttpError(503, "الخدمة تحت الصيانة. يرجى المحاولة لاحقًا.");
    if (await needsVerification(user)) throw new HttpError(403, "يرجى تأكيد بريدك الإلكتروني قبل بدء المحادثة.", "email_unverified");
    input = await parseBody(req, schema);
    if (!isOwnerAccount(user)) await rateLimit(`chat:${user.id}`, settings.chatRateLimitPerMinute, 60_000);
    if (input.agent && !isOwnerAccount(user) && user.role !== "ADMIN" && user.role !== "OWNER") throw new HttpError(403, "وضع الوكيل متاح للمالك فقط.", "agent_owner_only");
    const { plan } = await getUserPlan(user.id);
    prep = await prepareChat(user.id, plan, input, settings);
  } catch (e) {
    return errorResponse(e);
  }

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (ev: Record<string, unknown>) => {
        try {
          ctrl.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {}
      };
      try {
        await executeChat(userId, prep, input, emit, controller.signal);
      } catch (e) {
        console.error("[chat] stream failure", e);
        emit({ type: "error", error: "حدث خطأ غير متوقع في الخادم أثناء توليد الرد." });
      } finally {
        try {
          ctrl.close();
        } catch {}
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
