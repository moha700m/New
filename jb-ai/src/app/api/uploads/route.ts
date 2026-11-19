import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, HttpError, json } from "@/lib/http";
import { effectiveUploadMb, getUserPlan } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|html|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|sql|toml|ini|log|swift|dart|r|lua|vue|svelte)$/i;

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  await rateLimit(`upload:${user.id}`, 30, 60_000);
  const { plan } = await getUserPlan(user.id);
  if (!plan.allowUploads) throw new HttpError(403, `رفع الملفات غير متاح في باقة ${plan.name}.`);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "لم يتم إرفاق ملف");
  const maxMb = effectiveUploadMb(plan);
  if (file.size > maxMb * 1024 * 1024) throw new HttpError(413, `الحد الأقصى لحجم الملف في باقة ${plan.name} هو ${maxMb} ميجابايت`);
  const buf = Buffer.from(await file.arrayBuffer());
  let kind: "image" | "text";
  let mime = file.type || "application/octet-stream";
  if (IMAGE_TYPES.has(mime)) {
    kind = "image";
    const sig = buf.subarray(0, 12).toString("hex");
    const ok = sig.startsWith("89504e47") || sig.startsWith("ffd8ff") || sig.startsWith("47494638") || (sig.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP");
    if (!ok) throw new HttpError(400, "محتوى الملف لا يطابق نوع الصورة");
  } else if (TEXT_EXT.test(file.name) || mime.startsWith("text/") || mime === "application/json") {
    kind = "text";
    if (buf.includes(0)) throw new HttpError(400, "الملفات الثنائية غير مدعومة");
    mime = "text/plain";
  } else {
    throw new HttpError(415, "نوع الملف غير مدعوم. أرفق صورًا (PNG أو JPEG أو WebP أو GIF) أو ملفات نصية وبرمجية.");
  }
  const att = await prisma.attachment.create({
    data: { userId: user.id, filename: file.name.slice(0, 200), mimeType: mime, size: buf.length, kind, data: buf },
    select: { id: true, filename: true, mimeType: true, size: true, kind: true },
  });
  return json({ attachment: att }, 201);
});
