/* Idempotent bootstrap: plans, Venice provider, routing singleton, settings, and a live Venice catalog sync. */
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function encrypt(plain: string) {
  const raw = process.env.MASTER_ENCRYPTION_KEY!;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

async function main() {
  const plans = [
    { key: "free", name: "Free", description: "Get started with everyday questions.", priceMonthlyCents: 0, priceYearlyCents: 0, dailyMessageLimit: 20, monthlyMessageLimit: 300, monthlyTokenLimit: 500_000, maxUploadMb: 2, allowUploads: true, allowWebSearch: false, allowImageGeneration: false, allowAllModels: false, isDefault: true, sortOrder: 0, features: ["20 messages per day", "Standard models", "Image & file attachments up to 2 MB"] },
    { key: "pro", name: "Pro", description: "More messages, more models, web search.", priceMonthlyCents: 1200, priceYearlyCents: 12000, dailyMessageLimit: 300, monthlyMessageLimit: 5000, monthlyTokenLimit: 10_000_000, maxUploadMb: 10, allowUploads: true, allowWebSearch: true, allowImageGeneration: true, allowAllModels: false, isDefault: false, sortOrder: 1, features: ["300 messages per day", "Reasoning & coding models", "Web search", "Image generation", "10 MB attachments"] },
    { key: "premium", name: "Premium", description: "Every model, highest allowances.", priceMonthlyCents: 2900, priceYearlyCents: 29000, dailyMessageLimit: null, monthlyMessageLimit: 20000, monthlyTokenLimit: 50_000_000, maxUploadMb: 25, allowUploads: true, allowWebSearch: true, allowImageGeneration: true, allowAllModels: true, isDefault: false, sortOrder: 2, features: ["Unlimited daily messages", "All models incl. premium frontier models", "Web search & image generation", "25 MB attachments", "Priority routing"] },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({ where: { key: p.key }, create: p, update: {} });
  }

  let venice = await prisma.provider.findUnique({ where: { slug: "venice" } });
  if (!venice) {
    venice = await prisma.provider.create({
      data: {
        slug: "venice",
        name: "Venice AI",
        type: "VENICE",
        baseUrl: "https://api.venice.ai/api/v1",
        priority: 10,
        ...(process.env.VENICE_API_KEY ? { apiKeyEncrypted: encrypt(process.env.VENICE_API_KEY), apiKeyLast4: process.env.VENICE_API_KEY.slice(-4) } : {}),
      },
    });
  }
  await prisma.routingConfig.upsert({ where: { id: "global" }, create: { id: "global", defaultProviderId: venice.id }, update: {} });
  await prisma.configState.upsert({ where: { id: "global" }, create: { id: "global", version: 1 }, update: {} });
  await prisma.setting.upsert({ where: { key: "system" }, create: { key: "system", value: {} }, update: {} });
  console.log("Seed complete. Provider:", venice.name, "— sync the live model catalog from Admin → Model Management.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
