import "server-only";
import type { AiModel, Attachment, Plan, Provider } from "@prisma/client";
import { prisma } from "./db";
import { getPublicCatalog, resolveRoute, type RouteRole, type RouteTarget } from "./engine";
import { HttpError } from "./http";
import { enforceQuota, planAllowsModel } from "./plans";
import { getAdapter, ProviderError, type ChatImage, type ChatMessageInput } from "./providers";
import type { SystemSettings } from "./settings";

export interface ChatInput {
  conversationId?: string | null;
  content: string;
  attachmentIds: string[];
  modelId?: string | null;
  think: boolean;
  webSearch: boolean;
  regenerate: boolean;
  editMessageId?: string | null;
}

type Emit = (event: Record<string, unknown>) => void;

const MAX_IMAGES_IN_CONTEXT = 4;

function estimateCost(model: AiModel, promptTokens?: number, completionTokens?: number) {
  if (model.inputPricePerM == null || model.outputPricePerM == null || promptTokens == null || completionTokens == null) return null;
  return (promptTokens * model.inputPricePerM + completionTokens * model.outputPricePerM) / 1_000_000;
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t ? (t.length > 60 ? t.slice(0, 57) + "…" : t) : "New chat";
}

async function markProvider(p: Provider, ok: boolean, err?: string) {
  try {
    if (ok && p.healthStatus !== "HEALTHY") {
      await prisma.provider.update({ where: { id: p.id }, data: { healthStatus: "HEALTHY", lastHealthAt: new Date(), lastHealthError: null } });
    } else if (!ok) {
      await prisma.provider.update({ where: { id: p.id }, data: { healthStatus: "DEGRADED", lastHealthAt: new Date(), lastHealthError: err?.slice(0, 500) } });
    }
  } catch {}
}

/** Everything that must be validated before a stream is opened. Throws HttpError on failure. */
export async function prepareChat(userId: string, plan: Plan, input: ChatInput, settings: SystemSettings) {
  await enforceQuota(userId, plan);

  // ----- conversation ownership
  let conversation = input.conversationId
    ? await prisma.conversation.findFirst({ where: { id: input.conversationId, userId } })
    : null;
  if (input.conversationId && !conversation) throw new HttpError(404, "Conversation not found");
  if ((input.regenerate || input.editMessageId) && !conversation) throw new HttpError(400, "Conversation required");
  if (!input.regenerate && !input.content.trim() && !input.attachmentIds.length) throw new HttpError(400, "Message is empty");

  // ----- attachments must belong to the user and be unused
  let attachments: Attachment[] = [];
  if (input.attachmentIds.length) {
    if (!plan.allowUploads) throw new HttpError(403, `File uploads are not included in the ${plan.name} plan.`);
    attachments = await prisma.attachment.findMany({ where: { id: { in: input.attachmentIds }, userId, messageId: null } });
    if (attachments.length !== input.attachmentIds.length) throw new HttpError(400, "One or more attachments are invalid");
  }

  // ----- decide routing role and requested model
  const catalog = await getPublicCatalog();
  let requested = input.modelId ?? conversation?.modelId ?? null;
  if (requested && !catalog.models.some((m) => m.id === requested)) {
    if (input.modelId) throw new HttpError(409, "The selected model is no longer available. Please choose another model.", "model_unavailable");
    requested = null; // conversation's old model was disabled → use current default
  }
  const requestedPublic = requested ? catalog.models.find((m) => m.id === requested) : undefined;
  let role: RouteRole = "text";
  if (requestedPublic?.capabilities.imageGeneration) role = "image";
  else if (input.think) {
    if (!requestedPublic) role = "reasoning";
    else if (!requestedPublic.capabilities.reasoning && catalog.defaults.reasoning) {
      const r = catalog.models.find((m) => m.id === catalog.defaults.reasoning);
      if (r && (r.plans.includes(plan.key))) requested = r.id;
    }
  }
  if (role === "image" && !plan.allowImageGeneration) throw new HttpError(403, `Image generation is not included in the ${plan.name} plan.`, "image_not_in_plan");

  // history may contain earlier images too
  const needsVision = attachments.some((a) => a.kind === "image");

  const targets = await resolveRoute({
    requestedModelId: requested,
    role,
    plan,
    needsVision,
    allowsModel: (m) => planAllowsModel(plan, m.id),
  });

  const webSearch = input.webSearch && plan.allowWebSearch;

  // ----- persist the user turn
  if (!conversation) {
    conversation = await prisma.conversation.create({ data: { userId, title: titleFrom(input.content || attachments[0]?.filename || "New chat"), modelId: targets[0]!.model.id } });
  }
  let userMessageId: string | null = null;
  if (input.editMessageId) {
    const msg = await prisma.message.findFirst({ where: { id: input.editMessageId, conversationId: conversation.id, role: "user" } });
    if (!msg) throw new HttpError(404, "Message not found");
    await prisma.message.update({ where: { id: msg.id }, data: { content: input.content } });
    await prisma.message.deleteMany({ where: { conversationId: conversation.id, createdAt: { gt: msg.createdAt } } });
    userMessageId = msg.id;
  } else if (input.regenerate) {
    const lastUser = await prisma.message.findFirst({ where: { conversationId: conversation.id, role: "user" }, orderBy: { createdAt: "desc" } });
    if (!lastUser) throw new HttpError(400, "Nothing to regenerate");
    await prisma.message.deleteMany({ where: { conversationId: conversation.id, createdAt: { gt: lastUser.createdAt } } });
    userMessageId = lastUser.id;
  } else {
    const m = await prisma.message.create({ data: { conversationId: conversation.id, role: "user", content: input.content } });
    if (attachments.length) await prisma.attachment.updateMany({ where: { id: { in: attachments.map((a) => a.id) } }, data: { messageId: m.id } });
    userMessageId = m.id;
  }

  // ----- build context
  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id, status: { in: ["complete", "stopped"] } },
    orderBy: { createdAt: "desc" },
    take: settings.maxHistoryMessages,
    include: { attachments: true },
  });
  history.reverse();
  let imagesLeft = MAX_IMAGES_IN_CONTEXT;
  const contextMessages: ChatMessageInput[] = [];
  if (settings.systemPrompt.trim()) contextMessages.push({ role: "system", content: settings.systemPrompt });
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    let content = h.content;
    const images: ChatImage[] = [];
    for (const a of h.attachments) {
      if (a.kind === "text") {
        content += `\n\n[Attached file: ${a.filename}]\n\`\`\`\n${Buffer.from(a.data).toString("utf8").slice(0, 100_000)}\n\`\`\``;
      } else if (a.kind === "image" && h.role === "user" && imagesLeft > 0) {
        images.push({ mimeType: a.mimeType, base64: Buffer.from(a.data).toString("base64") });
        imagesLeft--;
      }
    }
    if (h.role === "assistant" && !content.trim()) continue;
    contextMessages.splice(settings.systemPrompt.trim() ? 1 : 0, 0, { role: h.role as "user" | "assistant", content, images: images.length ? images : undefined });
  }
  const lastUserText = input.content || history.filter((h) => h.role === "user").pop()?.content || "";

  return { conversation, userMessageId, targets, role, webSearch, contextMessages, lastUserText, isNew: !input.conversationId };
}

/** Executes the prepared request against the routed provider(s), streaming events to the client. */
export async function executeChat(
  userId: string,
  prep: Awaited<ReturnType<typeof prepareChat>>,
  input: ChatInput,
  emit: Emit,
  signal: AbortSignal,
) {
  const { conversation, targets, role } = prep;
  const assistant = await prisma.message.create({
    data: { conversationId: conversation.id, role: "assistant", status: "streaming", modelKey: targets[0]!.model.modelId, modelName: targets[0]!.model.displayName, providerName: targets[0]!.model.provider.name },
  });
  emit({
    type: "meta",
    conversationId: conversation.id,
    title: conversation.title,
    userMessageId: prep.userMessageId,
    assistantMessageId: assistant.id,
    model: { id: targets[0]!.model.id, name: targets[0]!.model.displayName },
    notice: targets[0]!.reason,
    webSearch: prep.webSearch,
  });

  let text = "";
  let reasoning = "";
  let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number } = {};
  let used: RouteTarget | null = null;
  let lastError: Error | null = null;
  const t0 = Date.now();

  for (const target of targets) {
    if (signal.aborted) break;
    const adapter = getAdapter(target.model.provider);
    if (target.isFallback) {
      emit({ type: "fallback", model: { id: target.model.id, name: target.model.displayName }, provider: target.model.provider.name, reason: lastError?.message ?? target.reason });
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      let produced = false;
      try {
        if (role === "image") {
          if (!adapter.generateImage) throw new ProviderError(`${target.model.provider.name} does not support image generation`, 400, true, false);
          const result = await adapter.generateImage({ model: target.model.modelId, prompt: prep.lastUserText, signal });
          produced = true;
          for (const img of result.images) {
            const buf = Buffer.from(img.base64, "base64");
            const att = await prisma.attachment.create({
              data: { userId, messageId: assistant.id, filename: `image-${Date.now()}.${img.mimeType.split("/")[1]}`, mimeType: img.mimeType, size: buf.length, kind: "generated-image", data: buf },
            });
            emit({ type: "image", attachmentId: att.id, mimeType: img.mimeType });
          }
          const perImage = (target.model.extraCapabilities as { pricePerImageUsd?: number } | null)?.pricePerImageUsd;
          usage = { costUsd: result.costUsd ?? (perImage != null ? perImage * result.images.length : undefined) };
        } else {
          const stream = adapter.chat({
            model: target.model.modelId,
            messages: target.model.supportsVision ? prep.contextMessages : prep.contextMessages.map((m) => ({ ...m, images: undefined })),
            webSearch: prep.webSearch && target.model.supportsWebSearch,
            reasoning: input.think,
            maxTokens: target.model.maxOutputTokens ? Math.min(target.model.maxOutputTokens, 16384) : undefined,
            signal,
          });
          for await (const chunk of stream) {
            if (chunk.type === "text") {
              produced = true;
              text += chunk.text;
              emit({ type: "delta", text: chunk.text });
            } else if (chunk.type === "reasoning") {
              produced = true;
              reasoning += chunk.text;
              emit({ type: "reasoning", text: chunk.text });
            } else if (chunk.type === "usage") {
              usage = chunk;
            }
          }
        }
        used = target;
        lastError = null;
        void markProvider(target.model.provider, true);
        break;
      } catch (e) {
        if (signal.aborted) break;
        lastError = e as Error;
        const pe = e instanceof ProviderError ? e : null;
        void markProvider(target.model.provider, false, lastError.message);
        await prisma.usageRecord.create({
          data: { userId, conversationId: conversation.id, providerId: target.model.providerId, modelRowId: target.model.id, modelKey: target.model.modelId, kind: role === "image" ? "image" : "chat", status: "error", errorMessage: lastError.message.slice(0, 500), latencyMs: Date.now() - t0, usedFallback: target.isFallback },
        });
        if (produced) break; // never splice two different answers together
        if (pe?.retryable && attempt === 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        break;
      }
    }
    if (used || signal.aborted || (lastError && (text || reasoning))) break;
    if (lastError && !(lastError instanceof ProviderError && lastError.fallbackable)) break;
  }

  const stopped = signal.aborted;
  const final = used ?? targets[0]!;
  const status = stopped ? "stopped" : used ? "complete" : "error";
  const errMsg = !used && !stopped ? lastError?.message ?? "The AI provider did not respond." : null;
  const providerCost = usage.costUsd;
  const estimated = providerCost == null ? estimateCost(final.model, usage.promptTokens, usage.completionTokens) : null;

  await prisma.message.update({
    where: { id: assistant.id },
    data: {
      content: text,
      reasoning: reasoning || null,
      status,
      error: errMsg,
      modelKey: final.model.modelId,
      modelName: final.model.displayName,
      providerName: final.model.provider.name,
      usedFallback: Boolean(used?.isFallback),
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date(), modelId: used && !used.isFallback ? used.model.id : undefined } });
  if (used || stopped) {
    await prisma.usageRecord.create({
      data: {
        userId,
        conversationId: conversation.id,
        providerId: final.model.providerId,
        modelRowId: final.model.id,
        modelKey: final.model.modelId,
        kind: role === "image" ? "image" : "chat",
        promptTokens: usage.promptTokens ?? null,
        completionTokens: usage.completionTokens ?? null,
        totalTokens: usage.totalTokens ?? (usage.promptTokens != null && usage.completionTokens != null ? usage.promptTokens + usage.completionTokens : null),
        costUsd: providerCost ?? estimated,
        costSource: providerCost != null ? "provider" : estimated != null ? "estimated" : null,
        status: stopped ? "stopped" : "success",
        latencyMs: Date.now() - t0,
        usedFallback: Boolean(used?.isFallback),
      },
    });
  }
  if (errMsg) {
    emit({ type: "error", error: friendlyError(errMsg), messageId: assistant.id });
  } else {
    emit({ type: "done", status, messageId: assistant.id, usage: { promptTokens: usage.promptTokens ?? null, completionTokens: usage.completionTokens ?? null }, model: { id: final.model.id, name: final.model.displayName }, fallback: Boolean(used?.isFallback) });
  }
}

function friendlyError(msg: string) {
  if (/insufficient|balance|402/i.test(msg)) return "The AI provider rejected the request (insufficient provider credits). The administrator has been notified via the engine dashboard.";
  if (/401|403|unauthori|invalid api key/i.test(msg)) return "The AI provider rejected the configured credentials.";
  if (/timed out/i.test(msg)) return "The AI provider timed out. Please try again.";
  if (/429/.test(msg)) return "The AI provider is rate limiting requests. Please try again shortly.";
  return "The AI provider returned an error: " + msg.replace(/^[^:]+:\s*/, "").slice(0, 200);
}

export type { RouteTarget };
export type ModelWithProvider = AiModel & { provider: Provider };
