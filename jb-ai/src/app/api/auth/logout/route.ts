import { destroySession } from "@/lib/auth";
import { handler, json } from "@/lib/http";

export const POST = handler(async () => {
  await destroySession();
  return json({ ok: true });
});
