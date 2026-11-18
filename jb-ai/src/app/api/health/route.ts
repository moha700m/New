import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "ok", latencyMs: Date.now() - t0, time: new Date().toISOString() });
  } catch (e) {
    return Response.json({ status: "error", database: "unreachable", error: (e as Error).message.slice(0, 200) }, { status: 503 });
  }
}
