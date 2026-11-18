import { freshVersion } from "@/lib/config-bus";

export const dynamic = "force-dynamic";

/** Tiny endpoint polled by browsers on serverless hosting; the full catalog is refetched only when this changes. */
export async function GET() {
  return Response.json({ version: await freshVersion() }, { headers: { "Cache-Control": "no-store" } });
}
