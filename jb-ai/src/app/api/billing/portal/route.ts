import { requireUser } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { createPortal } from "@/lib/payments";

export const POST = handler(async () => {
  const user = await requireUser();
  return json({ url: await createPortal(user.id) });
});
