import type { ModelCategory, ProviderType } from "@prisma/client";

export interface ProviderRuntimeConfig {
  id: string;
  slug: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string | null;
  authHeader: string;
  authScheme: string;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
}

export interface ChatImage {
  mimeType: string;
  base64: string;
}

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
  images?: ChatImage[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessageInput[];
  maxTokens?: number;
  temperature?: number;
  webSearch?: boolean;
  reasoning?: boolean;
  signal: AbortSignal;
}

export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "usage"; promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number };

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  description?: string;
  category: ModelCategory;
  supportsText: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsWebSearch: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutput: boolean;
  supportsImageGeneration: boolean;
  supportsCode: boolean;
  extraCapabilities?: Record<string, unknown>;
  contextLength?: number;
  maxOutputTokens?: number;
  inputPricePerM?: number;
  outputPricePerM?: number;
  offline?: boolean;
  raw?: unknown;
}

export interface ImageRequest {
  model: string;
  prompt: string;
  width?: number;
  height?: number;
  signal: AbortSignal;
}

export interface ImageResult {
  images: ChatImage[];
  costUsd?: number;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
  info?: Record<string, unknown>;
}

export interface ProviderAdapter {
  listModels(): Promise<DiscoveredModel[]>;
  chat(req: ChatRequest): AsyncGenerator<ChatChunk>;
  generateImage?(req: ImageRequest): Promise<ImageResult>;
  testConnection(): Promise<TestResult>;
  /** Provider-suggested defaults by role (e.g. Venice /models/traits). */
  suggestedDefaults?(): Promise<Record<string, string>>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    /** true when another provider/model could reasonably succeed (auth, balance, 5xx, timeout, network). */
    public fallbackable: boolean,
    /** true when retrying the same request may succeed (429/5xx/network). */
    public retryable: boolean,
  ) {
    super(message);
  }
}
