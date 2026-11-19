import { z } from "zod";
import { resolveMentions } from "@/lib/mentions";
import { CONNECTOR_PRESETS } from "@/lib/agent/mcp-admin";
import { after } from "next/server";
import { ChatJob } from "@/lib/chat-jobs";
import { needsVerification, requireUser } from "@/lib/auth";
import { executeChat, prepareChat } from "@/lib/gateway";
import { errorResponse, HttpError, parseBody } from "@/lib/http";
import { isOwnerAccount } from "@/lib/access";
import { getUserPlan } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { getTrialSettings, isTrialUser, refundTrialImage, refundTrialMessage, takeTrialImage, takeTrialMessage, trialImageRows, trialLabel, trialModelRows } from "@/lib/trial";

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
  let trialTaken = false;
  let trialImage = false;
  try {
    const user = await requireUser();
    userId = user.id;
    const settings = await getSettings();
    if (settings.maintenanceMode) throw new HttpError(503, "الموقع تحت الصيانة الحين، ارجع بعد شوي.");
    if (await needsVerification(user)) throw new HttpError(403, "أكّد إيميلك أول عشان تبدأ السوالف.", "email_unverified");
    input = await parseBody(req, schema);
    if (!isOwnerAccount(user)) await rateLimit(`chat:${user.id}`, settings.chatRateLimitPerMinute, 60_000);
    const canAgent = isOwnerAccount(user) || user.role === "ADMIN" || user.role === "OWNER";
    // an @mention of a tool / deploy target / connector switches agent mode on by itself
    if (!input.agent && canAgent && resolveMentions(input.content, CONNECTOR_PRESETS.map((p) => ({ slug: p.key, name: p.name }))).length) input.agent = true;
    if (input.agent && !isOwnerAccount(user) && user.role !== "ADMIN" && user.role !== "OWNER") throw new HttpError(403, "وضع الوكيل متاح للمالك فقط.", "agent_owner_only");
    const { plan } = await getUserPlan(user.id);
    if (isTrialUser(user) && !isOwnerAccount(user)) {
      // free trial: plain chat only, allowed cheap models only, one message taken atomically from the account
      const t = await getTrialSettings();
      const [rows, imageRows] = await Promise.all([trialModelRows(t), trialImageRows(t)]);
      if (!rows.length) throw new HttpError(503, "التجربة المجانية مو متاحة الحين، جرّب بعد شوي.", "trial_off");
      if (input.attachmentIds.length) throw new HttpError(403, "رفع الملفات للمشتركين بس.", "trial_feature");
      input.agent = false;
      input.think = false;
      input.webSearch = false;
      trialImage = Boolean(input.modelId && imageRows.some((r) => r.id === input.modelId));
      if (!trialImage && (!input.modelId || !rows.some((r) => r.id === input.modelId))) input.modelId = rows[0]!.id;
      // text messages and free images are two separate quotas
      if (trialImage) await takeTrialImage(user.id, t);
      else await takeTrialMessage(user.id, t);
      trialTaken = true;
      const refund = () => (trialImage ? refundTrialImage(user.id) : refundTrialMessage(user.id));
      try {
        prep = await prepareChat(user.id, plan, input, { ...settings, systemPrompt: [settings.systemPrompt, t.systemPrompt].filter((x) => x?.trim()).join("\n\n"), maxHistoryMessages: Math.min(settings.maxHistoryMessages, t.historyMessages) }, { maxOutputTokens: t.maxOutputTokens, maxInputChars: t.maxInputChars });
      } catch (e) {
        await refund();
        throw e;
      }
      // trial users only ever see the friendly Saudi names (also stored on the message)
      for (const tg of prep.targets) tg.model.displayName = trialLabel(t, tg.model.modelId, tg.model.displayName);
    } else {
      prep = await prepareChat(user.id, plan, input, settings);
    }
  } catch (e) {
    return errorResponse(e);
  }

  // The run belongs to the server, not to this connection: it keeps going (after()) if the phone locks or the tab
  // closes, and every event is stored so the client can resume from GET /api/chat/stream/<messageId>?after=<seq>.
  const job = new ChatJob();
  const work = (async () => {
    try {
      const r = await executeChat(userId, prep, input, job.emit, job.controller.signal);
      // a trial message that produced nothing (provider error) is given back
      if (trialTaken && r.status === "error") await (trialImage ? refundTrialImage(userId) : refundTrialMessage(userId));
    } catch (e) {
      console.error("[chat] run failure", e);
      job.emit({ type: "error", error: "صار خطأ غير متوقع في الخادم أثناء توليد الرد." });
    } finally {
      await job.finish();
    }
  })();
  after(() => work);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(ctrl) {
      unsubscribe = job.subscribe((rows) => {
        try {
          if (!rows.length) {
            unsubscribe?.();
            ctrl.close();
            return;
          }
          ctrl.enqueue(encoder.encode(rows.map((r) => JSON.stringify({ ...r.data, seq: r.seq })).join("\n") + "\n"));
        } catch {}
      });
    },
    cancel() {
      unsubscribe?.(); // the client went away: the run continues in the background
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
