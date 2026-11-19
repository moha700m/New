export interface ProviderRow {
  id: string; slug: string; name: string; type: "VENICE" | "OPENAI_COMPATIBLE" | "ANTHROPIC"; baseUrl: string; hasApiKey: boolean; apiKeyLast4: string | null;
  authHeader: string; authScheme: string; extraHeaders: Record<string, string> | null; enabled: boolean; priority: number; timeoutMs: number;
  healthStatus: string; healthLatencyMs: number | null; lastHealthAt: string | null; lastHealthError: string | null;
  lastSyncAt: string | null; lastSyncStatus: string | null; lastSyncError: string | null; lastSyncCount: number | null; modelCount: number; enabledModelCount: number;
}

export interface ModelRow {
  id: string; providerId: string; modelId: string; displayName: string; description: string | null;
  category: "TEXT" | "REASONING" | "CODE" | "VISION" | "IMAGE"; enabled: boolean; sortOrder: number; source: "SYNCED" | "MANUAL"; inCatalog: boolean; offline: boolean;
  supportsText: boolean; supportsStreaming: boolean; supportsVision: boolean; supportsTools: boolean; supportsWebSearch: boolean; supportsReasoning: boolean;
  supportsStructuredOutput: boolean; supportsImageGeneration: boolean; supportsCode: boolean; extraCapabilities: Record<string, unknown> | null;
  contextLength: number | null; maxOutputTokens: number | null; inputPricePerM: number | null; outputPricePerM: number | null;
  provider: { id: string; name: string; enabled: boolean }; planKeys: string[]; updatedAt: string;
}

export interface PlanRow {
  id: string; key: string; name: string; description: string | null; features: string[] | null; priceMonthlyCents: number; priceYearlyCents: number; currency: string;
  dailyMessageLimit: number | null; monthlyMessageLimit: number | null; monthlyTokenLimit: number | null; maxUploadMb: number; allowUploads: boolean; allowWebSearch: boolean;
  allowImageGeneration: boolean; allowAllModels: boolean; isDefault: boolean; active: boolean; sortOrder: number; modelIds: string[]; subscriberCount: number;
}

export const CATEGORY_LABEL: Record<string, string> = { TEXT: "عام", REASONING: "تفكير", CODE: "برمجة", VISION: "رؤية", IMAGE: "توليد صور" };
