import "server-only";
import type { Provider } from "@prisma/client";
import { decryptSecret } from "../crypto";
import { AnthropicAdapter } from "./anthropic";
import { OpenAICompatibleAdapter } from "./openai-compatible";
import type { ProviderAdapter, ProviderRuntimeConfig } from "./types";
import { isPollinations, PollinationsAdapter } from "./pollinations";
import { VeniceAdapter } from "./venice";

export * from "./types";

export const PROVIDER_TYPES = [
  { type: "VENICE", label: "Venice AI", defaultBaseUrl: "https://api.venice.ai/api/v1", authHeader: "Authorization", authScheme: "Bearer" },
  { type: "OPENAI_COMPATIBLE", label: "متوافق مع OpenAI (OpenAI و OpenRouter و Groq و Together و vLLM و Ollama…)", defaultBaseUrl: "https://api.openai.com/v1", authHeader: "Authorization", authScheme: "Bearer" },
  { type: "ANTHROPIC", label: "Anthropic (واجهة Messages الأصلية)", defaultBaseUrl: "https://api.anthropic.com/v1", authHeader: "x-api-key", authScheme: "" },
] as const;

export function runtimeConfig(p: Provider): ProviderRuntimeConfig {
  let apiKey: string | null = null;
  if (p.apiKeyEncrypted) apiKey = decryptSecret(p.apiKeyEncrypted);
  else if (p.type === "VENICE" && process.env.VENICE_API_KEY) apiKey = process.env.VENICE_API_KEY;
  const extra = (p.extraHeaders && typeof p.extraHeaders === "object" ? p.extraHeaders : {}) as Record<string, string>;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    type: p.type,
    baseUrl: p.baseUrl,
    apiKey,
    authHeader: p.authHeader,
    authScheme: p.authScheme,
    extraHeaders: extra,
    timeoutMs: p.timeoutMs,
  };
}

export function getAdapter(p: Provider): ProviderAdapter {
  const cfg = runtimeConfig(p);
  switch (p.type) {
    case "VENICE":
      return new VeniceAdapter(cfg);
    case "ANTHROPIC":
      return new AnthropicAdapter(cfg);
    default:
      return isPollinations(p) ? new PollinationsAdapter(cfg) : new OpenAICompatibleAdapter(cfg);
  }
}
