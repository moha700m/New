import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, HttpError, json } from "@/lib/http";
import { getUserPlan } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|html|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|sql|toml|ini|log|swift|dart|r|lua|vue|svelte)$/i;

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  rateLimit(`upload:${user.id}`, 30, 60_000);
  const { plan } = await getUserPlan(user.id);
  if (!plan.allowUploads) throw new HttpError(403, `File uploads are not included in the ${plan.name} plan.`);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file provided");
  if (file.size > plan.maxUploadMb * 1024 * 1024) throw new HttpError(413, `Files on the ${plan.name} plan are limited to ${plan.maxUploadMb} MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  let kind: "image" | "text";
  let mime = file.type || "application/octet-stream";
  if (IMAGE_TYPES.has(mime)) {
    kind = "image";
    const sig = buf.subarray(0, 12).toString("hex");
    const ok = sig.startsWith("89504e47") || sig.startsWith("ffd8ff") || sig.startsWith("47494638") || (sig.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP");
    if (!ok) throw new HttpError(400, "File content does not match its image type");
  } else if (TEXT_EXT.test(file.name) || mime.startsWith("text/") || mime === "application/json") {
    kind = "text";
    if (buf.includes(0)) throw new HttpError(400, "Binary files are not supported");
    mime = "text/plain";
  } else {
    throw new HttpError(415, "Unsupported file type. Attach images (PNG, JPEG, WebP, GIF) or text/code files.");
  }
  const att = await prisma.attachment.create({
    data: { userId: user.id, filename: file.name.slice(0, 200), mimeType: mime, size: buf.length, kind, data: buf },
    select: { id: true, filename: true, mimeType: true, size: true, kind: true },
  });
  return json({ attachment: att }, 201);
});
