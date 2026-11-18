import { z } from "zod";

export const providerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, "slug: 2-40 chars a-z, 0-9, -"),
  type: z.enum(["VENICE", "OPENAI_COMPATIBLE", "ANTHROPIC"]),
  baseUrl: z.string().trim().url().refine((u) => /^https?:\/\//.test(u), "must be http(s)"),
  apiKey: z.string().trim().max(500).optional(),
  authHeader: z.string().trim().max(60).regex(/^[A-Za-z0-9-]+$/).optional(),
  authScheme: z.string().trim().max(30).optional(),
  extraHeaders: z.record(z.string().max(60), z.string().max(500)).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  timeoutMs: z.number().int().min(5000).max(600000).optional(),
});

const caps = {
  supportsText: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  supportsWebSearch: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  supportsStructuredOutput: z.boolean().optional(),
  supportsImageGeneration: z.boolean().optional(),
  supportsCode: z.boolean().optional(),
};

export const modelPatchSchema = z.object({
  modelId: z.string().trim().min(1).max(200).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(["TEXT", "REASONING", "CODE", "VISION", "IMAGE"]).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  contextLength: z.number().int().positive().nullable().optional(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
  inputPricePerM: z.number().min(0).nullable().optional(),
  outputPricePerM: z.number().min(0).nullable().optional(),
  planKeys: z.array(z.string().max(40)).optional(),
  ...caps,
});

export const modelCreateSchema = modelPatchSchema.extend({
  providerId: z.string().min(1).max(40),
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
});

export const routingSchema = z.object({
  defaultProviderId: z.string().max(40).nullable().optional(),
  defaultTextModelId: z.string().max(40).nullable().optional(),
  defaultReasoningModelId: z.string().max(40).nullable().optional(),
  defaultCodingModelId: z.string().max(40).nullable().optional(),
  defaultVisionModelId: z.string().max(40).nullable().optional(),
  defaultImageModelId: z.string().max(40).nullable().optional(),
  fallbackEnabled: z.boolean().optional(),
  fallbackProviderId: z.string().max(40).nullable().optional(),
  fallbackModelId: z.string().max(40).nullable().optional(),
});

export const planSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  features: z.array(z.string().max(120)).max(20).optional(),
  priceMonthlyCents: z.number().int().min(0).max(10_000_000),
  priceYearlyCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().toLowerCase().length(3).default("usd"),
  dailyMessageLimit: z.number().int().min(0).nullable(),
  monthlyMessageLimit: z.number().int().min(0).nullable(),
  monthlyTokenLimit: z.number().int().min(0).nullable(),
  maxUploadMb: z.number().int().min(1).max(100),
  allowUploads: z.boolean(),
  allowWebSearch: z.boolean(),
  allowImageGeneration: z.boolean(),
  allowAllModels: z.boolean(),
  isDefault: z.boolean().optional(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
  modelIds: z.array(z.string().max(40)).optional(),
});
