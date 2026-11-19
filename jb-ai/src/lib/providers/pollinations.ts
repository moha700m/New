import { providerFetch } from "./http";
import { OpenAICompatibleAdapter } from "./openai-compatible";
import { ProviderError, type DiscoveredModel, type ImageRequest, type ImageResult, type TestResult } from "./types";

/**
 * Pollinations.ai — free, no API key needed (anonymous tier).
 * Chat: OpenAI-compatible at https://text.pollinations.ai/openai/chat/completions
 * Catalog: https://text.pollinations.ai/models and https://image.pollinations.ai/models
 * Images: GET https://image.pollinations.ai/prompt/{prompt}?model=…  (returns the image bytes)
 */
const TEXT_MODELS = "https://text.pollinations.ai/models";
const IMAGE_BASE = "https://image.pollinations.ai";

export class PollinationsAdapter extends OpenAICompatibleAdapter {
  async listModels(): Promise<DiscoveredModel[]> {
    const [tRes, iRes] = await Promise.all([
      providerFetch(this.cfg, TEXT_MODELS, { headers: { Accept: "application/json" }, timeoutMs: 20000 }),
      providerFetch(this.cfg, `${IMAGE_BASE}/models`, { headers: { Accept: "application/json" }, timeoutMs: 20000 }),
    ]);
    const text = (await tRes.json()) as any[];
    const image = (await iRes.json()) as any[];
    const out: DiscoveredModel[] = [];
    for (const m of Array.isArray(text) ? text : []) {
      const id = typeof m === "string" ? m : m?.name;
      if (!id) continue;
      out.push({
        modelId: id,
        displayName: `Pollinations ${id}`,
        description: (m?.description ? `${m.description} — ` : "") + "مجاني بدون مفتاح (Pollinations)",
        category: m?.reasoning ? "REASONING" : m?.vision ? "VISION" : "TEXT",
        supportsText: true,
        supportsStreaming: true,
        supportsVision: Boolean(m?.vision),
        supportsTools: Boolean(m?.tools),
        supportsWebSearch: false,
        supportsReasoning: Boolean(m?.reasoning),
        supportsStructuredOutput: false,
        supportsImageGeneration: false,
        supportsCode: false,
        extraCapabilities: { free: true },
        inputPricePerM: 0,
        outputPricePerM: 0,
        raw: m,
      });
    }
    for (const m of Array.isArray(image) ? image : []) {
      const id = typeof m === "string" ? m : m?.name;
      if (!id) continue;
      out.push({
        modelId: `image:${id}`,
        displayName: `Pollinations ${id} (صور)`,
        description: "توليد صور مجاني بدون مفتاح (Pollinations)",
        category: "IMAGE",
        supportsText: false,
        supportsStreaming: false,
        supportsVision: false,
        supportsTools: false,
        supportsWebSearch: false,
        supportsReasoning: false,
        supportsStructuredOutput: false,
        supportsImageGeneration: true,
        supportsCode: false,
        extraCapabilities: { free: true, pricePerImageUsd: 0 },
        raw: m,
      });
    }
    return out;
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const model = req.model.replace(/^image:/, "");
    const qs = new URLSearchParams({ model, width: String(req.width ?? 1024), height: String(req.height ?? 1024), nologo: "true", safe: "false", private: "true", seed: String(Math.floor(Math.random() * 1e9)) });
    const url = `${IMAGE_BASE}/prompt/${encodeURIComponent(req.prompt.slice(0, 1500))}?${qs}`;
    const res = await providerFetch(this.cfg, url, { headers: { Accept: "image/*" }, signal: req.signal, timeoutMs: 120000 });
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0]!;
    if (!mimeType.startsWith("image/")) throw new ProviderError(`${this.cfg.name}: no image returned`, 502, true, false);
    const buf = Buffer.from(await res.arrayBuffer());
    return { images: [{ mimeType, base64: buf.toString("base64") }], costUsd: 0 };
  }

  async testConnection(): Promise<TestResult> {
    const t0 = Date.now();
    try {
      const models = await this.listModels();
      return { ok: true, latencyMs: Date.now() - t0, detail: `تم الاتصال بـ Pollinations (مجاني بدون مفتاح). ${models.length} نموذج.`, info: { modelCount: models.length } };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: (e as Error).message };
    }
  }
}

export const isPollinations = (p: { slug: string; baseUrl: string }) => p.slug === "pollinations" || /pollinations\.ai/i.test(p.baseUrl);
