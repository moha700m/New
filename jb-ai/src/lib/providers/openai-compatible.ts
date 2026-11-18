import type { ModelCategory } from "@prisma/client";
import { authHeaders, joinUrl, providerFetch, sseData, ThinkTagSplitter } from "./http";
import {
  ProviderError,
  type ChatChunk,
  type ChatMessageInput,
  type ChatRequest,
  type DiscoveredModel,
  type ImageRequest,
  type ImageResult,
  type ProviderAdapter,
  type ProviderRuntimeConfig,
  type TestResult,
} from "./types";

export function toOpenAIMessages(messages: ChatMessageInput[]) {
  return messages.map((m) => {
    if (m.role === "user" && m.images?.length) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content || " " },
          ...m.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** Guess capabilities from an id when the provider only returns bare ids (plain OpenAI-compatible /models). */
export function guessFromId(id: string): Partial<DiscoveredModel> & { category: ModelCategory } {
  const s = id.toLowerCase();
  const image = /(dall-e|gpt-image|stable-diffusion|sdxl|flux|imagen|image)/.test(s) && !/vision|vl/.test(s);
  const reasoning = /(^o\d|reason|think|r1|qwq)/.test(s);
  const code = /(code|coder|codex|devstral)/.test(s);
  const vision = /(vision|vl|gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-(sonnet|opus|haiku)|gemini|pixtral|llava)/.test(s);
  const nonChat = /(embed|whisper|tts|moderation|audio|transcribe|rerank)/.test(s);
  return {
    category: image ? "IMAGE" : code ? "CODE" : reasoning ? "REASONING" : "TEXT",
    supportsText: !image && !nonChat,
    supportsImageGeneration: image,
    supportsVision: vision && !image,
    supportsReasoning: reasoning,
    supportsCode: code,
  };
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  constructor(protected cfg: ProviderRuntimeConfig) {}

  protected headers(json = true): Record<string, string> {
    return { ...(json ? { "Content-Type": "application/json" } : {}), Accept: "application/json", ...authHeaders(this.cfg) };
  }

  /** Extra body fields (overridden by provider-specific adapters). */
  protected extraChatBody(_req: ChatRequest): Record<string, unknown> {
    return {};
  }

  async listModels(): Promise<DiscoveredModel[]> {
    const res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/models"), { headers: this.headers(false), timeoutMs: 30000 });
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const list = Array.isArray(body.data) ? body.data : [];
    return list
      .filter((m) => typeof m.id === "string")
      .map((m) => {
        const id = m.id as string;
        const g = guessFromId(id);
        return {
          modelId: id,
          displayName: (m.name as string) || (m.display_name as string) || id,
          description: typeof m.description === "string" ? m.description : undefined,
          category: g.category,
          supportsText: g.supportsText ?? true,
          supportsStreaming: true,
          supportsVision: g.supportsVision ?? false,
          supportsTools: false,
          supportsWebSearch: false,
          supportsReasoning: g.supportsReasoning ?? false,
          supportsStructuredOutput: false,
          supportsImageGeneration: g.supportsImageGeneration ?? false,
          supportsCode: g.supportsCode ?? false,
          contextLength: typeof m.context_length === "number" ? m.context_length : undefined,
          raw: m,
        } satisfies DiscoveredModel;
      });
  }

  async *chat(req: ChatRequest): AsyncGenerator<ChatChunk> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...this.extraChatBody(req),
    };
    let res: Response;
    try {
      res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      // Some OpenAI-compatible servers reject stream_options; retry once without it.
      if (e instanceof ProviderError && e.status === 400 && /stream_options/i.test(e.message)) {
        delete body.stream_options;
        res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/chat/completions"), {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } else throw e;
    }

    const splitter = new ThinkTagSplitter();
    for await (const { data } of sseData(res)) {
      if (data === "[DONE]") break;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new ProviderError(`${this.cfg.name}: ${chunk.error.message ?? JSON.stringify(chunk.error)}`, 502, true, false);
      const delta = chunk.choices?.[0]?.delta ?? {};
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === "string" && reasoning) yield { type: "reasoning", text: reasoning };
      if (typeof delta.content === "string" && delta.content) {
        for (const part of splitter.push(delta.content)) yield part;
      }
      if (chunk.usage) {
        const u = chunk.usage;
        const cost = typeof u.cost === "number" ? u.cost : typeof u.total_cost === "number" ? u.total_cost : undefined;
        yield { type: "usage", promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: u.total_tokens, costUsd: cost };
      }
    }
    for (const part of splitter.flush()) yield part;
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/images/generations"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: req.model, prompt: req.prompt, n: 1, size: `${req.width ?? 1024}x${req.height ?? 1024}`, response_format: "b64_json" }),
      signal: req.signal,
    });
    const body = (await res.json()) as { data?: { b64_json?: string }[] };
    const images = (body.data ?? []).filter((d) => d.b64_json).map((d) => ({ mimeType: "image/png", base64: d.b64_json! }));
    if (!images.length) throw new ProviderError(`${this.cfg.name}: no image returned`, 502, true, false);
    return { images };
  }

  async testConnection(): Promise<TestResult> {
    const t0 = Date.now();
    try {
      const models = await this.listModels();
      return { ok: true, latencyMs: Date.now() - t0, detail: `Connected. ${models.length} models available.`, info: { modelCount: models.length } };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: (e as Error).message };
    }
  }
}
