import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { getAdapter } from "@/lib/providers";

export const maxDuration = 120;

/** Sends a real request to the model through its provider adapter and reports latency, output and usage. */
export const POST = adminRoute<{ id: string }>(async ({ params, user, log }) => {
  const m = await prisma.aiModel.findUnique({ where: { id: params.id }, include: { provider: true } });
  if (!m) throw new HttpError(404, "Model not found");
  const adapter = getAdapter(m.provider);
  const t0 = Date.now();
  const signal = AbortSignal.timeout(90_000);
  let output = "";
  let reasoning = "";
  let usage: Record<string, unknown> | null = null;
  let ok = true;
  let error: string | null = null;
  let firstTokenMs: number | null = null;
  try {
    if (m.supportsImageGeneration && !m.supportsText) {
      if (!adapter.generateImage) throw new Error("Provider adapter has no image generation support");
      const r = await adapter.generateImage({ model: m.modelId, prompt: "A small red cube on a white table, studio lighting", width: 512, height: 512, signal });
      output = `Generated ${r.images.length} image(s) (${r.images[0]?.mimeType}, ${Math.round((r.images[0]?.base64.length ?? 0) * 0.75 / 1024)} KB)`;
    } else {
      for await (const c of adapter.chat({ model: m.modelId, messages: [{ role: "user", content: "Reply with exactly: JB AI model test OK" }], maxTokens: 300, signal })) {
        if (firstTokenMs === null && (c.type === "text" || c.type === "reasoning")) firstTokenMs = Date.now() - t0;
        if (c.type === "text") output += c.text;
        else if (c.type === "reasoning") reasoning += c.text;
        else usage = c;
      }
    }
  } catch (e) {
    ok = false;
    error = (e as Error).message;
  }
  const latencyMs = Date.now() - t0;
  await prisma.usageRecord.create({
    data: {
      userId: user.id, providerId: m.providerId, modelRowId: m.id, modelKey: m.modelId, kind: "test", status: ok ? "success" : "error", errorMessage: error?.slice(0, 500), latencyMs,
      promptTokens: (usage?.promptTokens as number) ?? null, completionTokens: (usage?.completionTokens as number) ?? null, totalTokens: (usage?.totalTokens as number) ?? null,
    },
  });
  await log("model.test", { entityType: "model", entityId: m.id, details: { modelId: m.modelId, ok, error: error?.slice(0, 200) } });
  return json({ result: { ok, latencyMs, firstTokenMs, output: output.slice(0, 2000), reasoning: reasoning.slice(0, 1000), usage, error } });
});
