import { adminRoute } from "@/lib/admin";
import { json } from "@/lib/http";
import { disconnectGithub, getGithubConnection, githubPublicState } from "@/lib/agent/github";

export const POST = adminRoute(async ({ log }) => {
  await disconnectGithub();
  await log("github.disconnect", { entityType: "github" });
  return json({ github: githubPublicState(await getGithubConnection()) });
});
