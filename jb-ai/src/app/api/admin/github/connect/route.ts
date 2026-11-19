import { adminRoute } from "@/lib/admin";
import { json } from "@/lib/http";
import { authorizeUrl } from "@/lib/agent/github";
import { publicOrigin } from "@/lib/agent/oauth";

export const POST = adminRoute(async ({ req }) => json({ authorizeUrl: await authorizeUrl(publicOrigin(req)) }));
