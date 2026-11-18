import type { ModelCategory } from "@prisma/client";
import { joinUrl, providerFetch } from "./http";
import { OpenAICompatibleAdapter } from "./openai-compatible";
import { ProviderError, type ChatRequest, type DiscoveredModel, type ImageRequest, type ImageResult, type TestResult } from "./types";

/**
 * Venice AI adapter — https://docs.venice.ai
 * Chat: OpenAI-compatible /chat/completions plus `venice_parameters`.
 * Catalog: GET /models?type=text|image (rich model_spec incl. capabilities & pricing), GET /models/traits.
 * Images: POST /image/generate.
 */
export class VeniceAdapter extends OpenAICompatibleAdapter {
  protected extraChatBody(req: ChatRequest) {
    return {
      venice_parameters: {
        include_venice_system_prompt: false,
        enable_web_search: req.webSearch ? "on" : "off",
      },
    };
  }

  private async fetchType(type: "text" | "image"): Promise<any[]> {
    const res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, `/models?type=${type}`), { headers: this.headers(false), timeoutMs: 30000 });
    const body = (await res.json()) as { data?: any[] };
    return Array.isArray(body.data) ? body.data : [];
  }

  async listModels(): Promise<DiscoveredModel[]> {
    const [text, image] = await Promise.all([this.fetchType("text"), this.fetchType("image")]);
    const out: DiscoveredModel[] = [];
    for (const m of text) {
      const spec = m.model_spec ?? {};
      const c = spec.capabilities ?? {};
      const traits: string[] = Array.isArray(spec.traits) ? spec.traits : [];
      const code = Boolean(c.optimizedForCode) || traits.includes("default_code");
      const reasoning = Boolean(c.supportsReasoning);
      const category: ModelCategory = code ? "CODE" : reasoning ? "REASONING" : c.supportsVision ? "VISION" : "TEXT";
      out.push({
        modelId: m.id,
        displayName: spec.name || m.id,
        description: spec.description,
        category,
        supportsText: true,
        supportsStreaming: true,
        supportsVision: Boolean(c.supportsVision),
        supportsTools: Boolean(c.supportsFunctionCalling),
        supportsWebSearch: Boolean(c.supportsWebSearch),
        supportsReasoning: reasoning,
        supportsStructuredOutput: Boolean(c.supportsResponseSchema),
        supportsImageGeneration: false,
        supportsCode: code,
        extraCapabilities: {
          audioInput: Boolean(c.supportsAudioInput),
          videoInput: Boolean(c.supportsVideoInput),
          multipleImages: Boolean(c.supportsMultipleImages),
          reasoningEffort: Boolean(c.supportsReasoningEffort),
          logProbs: Boolean(c.supportsLogProbs),
          e2ee: Boolean(c.supportsE2EE),
          privacy: spec.privacy,
          uncensored: Boolean(spec.uncensored),
          traits,
        },
        contextLength: spec.availableContextTokens ?? m.context_length,
        maxOutputTokens: spec.maxCompletionTokens,
        inputPricePerM: spec.pricing?.input?.usd,
        outputPricePerM: spec.pricing?.output?.usd,
        offline: Boolean(spec.offline),
        raw: m,
      });
    }
    for (const m of image) {
      const spec = m.model_spec ?? {};
      out.push({
        modelId: m.id,
        displayName: spec.name || m.id,
        description: spec.description,
        category: "IMAGE",
        supportsText: false,
        supportsStreaming: false,
        supportsVision: false,
        supportsTools: false,
        supportsWebSearch: Boolean(spec.supportsWebSearch),
        supportsReasoning: false,
        supportsStructuredOutput: false,
        supportsImageGeneration: true,
        supportsCode: false,
        extraCapabilities: { traits: spec.traits ?? [], privacy: spec.privacy, constraints: spec.constraints, pricePerImageUsd: spec.pricing?.generation?.usd },
        offline: Boolean(spec.offline),
        raw: m,
      });
    }
    return out;
  }

  async suggestedDefaults(): Promise<Record<string, string>> {
    const res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/models/traits"), { headers: this.headers(false), timeoutMs: 20000 });
    const body = (await res.json()) as { data?: Record<string, string> };
    const out: Record<string, string> = { ...(body.data ?? {}) };
    try {
      const r2 = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/models/traits?type=image"), { headers: this.headers(false), timeoutMs: 20000 });
      const b2 = (await r2.json()) as { data?: Record<string, string> };
      for (const [k, v] of Object.entries(b2.data ?? {})) out[`image:${k}`] = v;
    } catch {}
    return out;
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/image/generate"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: req.model, prompt: req.prompt.slice(0, 1500), width: req.width ?? 1024, height: req.height ?? 1024, format: "webp", return_binary: false, safe_mode: false }),
      signal: req.signal,
    });
    const body = (await res.json()) as { images?: string[] };
    const images = (body.images ?? []).map((b64) => ({ mimeType: "image/webp", base64: b64 }));
    if (!images.length) throw new ProviderError(`${this.cfg.name}: no image returned`, 502, true, false);
    return { images };
  }

  async testConnection(): Promise<TestResult> {
    const t0 = Date.now();
    try {
      const models = await this.fetchType("text");
      if (!this.cfg.apiKey) {
        return { ok: false, latencyMs: Date.now() - t0, detail: `الكتالوج متاح (${models.length} نموذج نصي) لكن لم يتم إضافة مفتاح API.` };
      }
      const res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/api_keys/rate_limits"), { headers: this.headers(false), timeoutMs: 20000 });
      const info = ((await res.json()) as { data?: any }).data ?? {};
      const balances = info.balances ?? {};
      const permitted = info.accessPermitted !== false;
      return {
        ok: permitted,
        latencyMs: Date.now() - t0,
        detail: permitted
          ? `تم التحقق من المفتاح. ${models.length} نموذج نصي. الرصيد: ${balances.USD ?? "?"} دولار، ${balances.DIEM ?? "?"} DIEM.`
          : `مفتاح API صحيح لكن Venice لا يسمح بالاستخدام (الرصيد ${balances.USD ?? 0} دولار، ${balances.DIEM ?? 0} DIEM). اشحن الرصيد من venice.ai/settings/api.`,
        info: { balances, apiTier: info.apiTier, modelCount: models.length },
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: (e as Error).message };
    }
  }
}
