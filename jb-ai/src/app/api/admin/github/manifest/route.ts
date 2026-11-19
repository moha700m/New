import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { json, parseBody } from "@/lib/http";
import { buildManifest } from "@/lib/agent/github";
import { publicOrigin } from "@/lib/agent/oauth";

const schema = z.object({ org: z.string().trim().max(100).regex(/^[A-Za-z0-9-]*$/).optional() });

/** Returns the GitHub App manifest + form action; the browser POSTs it to github.com (manifest flow). */
export const POST = adminRoute(async ({ req, log }) => {
  const body = await parseBody(req, schema);
  const m = await buildManifest(publicOrigin(req), body.org || null);
  await log("github.manifest_start", { entityType: "github", details: { name: m.manifest.name, org: body.org ?? null } });
  return json({ action: m.action, manifest: JSON.stringify(m.manifest) });
});
