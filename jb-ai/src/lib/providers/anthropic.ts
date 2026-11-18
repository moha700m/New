import { joinUrl, providerFetch, sseData } from "./http";
import { guessFromId } from "./openai-compatible";
import { ProviderError, type ChatChunk, type ChatRequest, type DiscoveredModel, type ProviderAdapter, type ProviderRuntimeConfig, type TestResult } from "./types";

/** Native Anthropic Messages API adapter — https://docs.anthropic.com/en/api/messages */
export class AnthropicAdapter implements ProviderAdapter {
  constructor(private cfg: ProviderRuntimeConfig) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(this.cfg.apiKey ? { "x-api-key": this.cfg.apiKey } : {}),
      ...this.cfg.extraHeaders,
    };
  }

  async listModels(): Promise<DiscoveredModel[]> {
    const res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/models?limit=1000"), { headers: this.headers(), timeoutMs: 30000 });
    const body = (await res.json()) as { data?: { id: string; display_name?: string }[] };
    return (body.data ?? []).map((m) => {
      const g = guessFromId(m.id);
      return {
        modelId: m.id,
        displayName: m.display_name || m.id,
        category: "TEXT",
        supportsText: true,
        supportsStreaming: true,
        supportsVision: true,
        supportsTools: true,
        supportsWebSearch: false,
        supportsReasoning: Boolean(g.supportsReasoning),
        supportsStructuredOutput: true,
        supportsImageGeneration: false,
        supportsCode: true,
        raw: m,
      } satisfies DiscoveredModel;
    });
  }

  async *chat(req: ChatRequest): AsyncGenerator<ChatChunk> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: [
          ...(m.images ?? []).map((img) => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.base64 } })),
          { type: "text", text: m.content || " " },
        ],
      }));
    const res = await providerFetch(this.cfg, joinUrl(this.cfg.baseUrl, "/messages"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens ?? 8192, stream: true, ...(system ? { system } : {}), messages }),
      signal: req.signal,
    });
    let input: number | undefined;
    let output: number | undefined;
    for await (const { data } of sseData(res)) {
      let ev: any;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev.type === "error") throw new ProviderError(`${this.cfg.name}: ${ev.error?.message ?? "stream error"}`, 502, true, false);
      if (ev.type === "message_start") input = ev.message?.usage?.input_tokens;
      if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta") yield { type: "text", text: ev.delta.text };
        else if (ev.delta?.type === "thinking_delta") yield { type: "reasoning", text: ev.delta.thinking };
      }
      if (ev.type === "message_delta" && ev.usage) output = ev.usage.output_tokens;
    }
    if (input !== undefined || output !== undefined) {
      yield { type: "usage", promptTokens: input, completionTokens: output, totalTokens: (input ?? 0) + (output ?? 0) };
    }
  }

  async testConnection(): Promise<TestResult> {
    const t0 = Date.now();
    try {
      const models = await this.listModels();
      return { ok: true, latencyMs: Date.now() - t0, detail: `Authenticated. ${models.length} models available.` };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: (e as Error).message };
    }
  }
}
