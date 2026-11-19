import "server-only";
import { prisma } from "./db";

export async function setModelPlans(modelId: string, planKeys: string[]) {
  const plans = await prisma.plan.findMany({ where: { key: { in: planKeys } } });
  await prisma.planModel.deleteMany({ where: { modelId } });
  if (plans.length) await prisma.planModel.createMany({ data: plans.map((p) => ({ planId: p.id, modelId })) });
}
