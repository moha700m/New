import { adminRoute } from "@/lib/admin";
import { json } from "@/lib/http";
import { getGithubConnection, githubPublicState } from "@/lib/agent/github";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => json({ github: githubPublicState(await getGithubConnection()) }));
